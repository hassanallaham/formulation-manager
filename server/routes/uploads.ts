import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { THUMBS_DIR, TMP_DIR, UPLOADS_DIR, resolveConfinedPath } from '../config.js';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { handleDbError } from '../utils/errors.js';

export const uploadsRouter = Router();
uploadsRouter.use(requireAuth);

const ALLOWED_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.tiff',
  '.svg',
  '.pdf',
  '.md',
  '.markdown',
  '.txt',
]);

const uploadMiddleware = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TMP_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (
      ALLOWED_EXTENSIONS.has(ext) ||
      file.mimetype.startsWith('image/') ||
      file.mimetype === 'application/pdf' ||
      file.mimetype.startsWith('text/')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Allowed: images, PDF, Markdown, and TXT.'));
    }
  },
});

function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

function safeUnlink(filePath: string | null | undefined): void {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore cleanup errors
  }
}

async function getSubcategoryIds(rootId: number): Promise<number[]> {
  const rows = await db.raw<{ id: number }[]>(
    `
    WITH RECURSIVE tree(id) AS (
      SELECT ?
      UNION ALL
      SELECT c.id FROM categories c JOIN tree t ON c.parent = t.id
    )
    SELECT id FROM tree
    `,
    [rootId]
  );
  return rows.map((r) => r.id);
}

// Lookup for typeahead combobox
uploadsRouter.get('/lookup', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const imagesOnly = req.query.imagesOnly === 'true';

    let query = db('uploads').select('id', 'original_name as name', 'mimetype', 'thumbnail_path', 'extension');
    if (q) {
      query = query.where('original_name', 'like', `%${q}%`);
    }
    if (imagesOnly) {
      query = query.where('mimetype', 'like', 'image/%');
    }
    const items = await query.orderBy('created_at', 'desc').limit(20);
    res.json({ items });
  } catch (err) {
    handleDbError(res, err);
  }
});

// Paginated list (page_size = 10)
uploadsRouter.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 10;
    const offset = (page - 1) * limit;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
    const includeSubcategories = req.query.includeSubcategories === 'true';
    const tagId = req.query.tagId ? Number(req.query.tagId) : null;
    const mimetypeFilter = typeof req.query.mimetype === 'string' ? req.query.mimetype.trim() : '';
    const sortBy = ['original_name', 'size', 'mimetype', 'created_at'].includes(String(req.query.sortBy))
      ? String(req.query.sortBy)
      : 'created_at';
    const sortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc';

    let baseQuery = db('uploads as u')
      .leftJoin('categories as c', 'u.category', 'c.id');

    if (q) {
      baseQuery = baseQuery.where((qb) => {
        qb.where('u.original_name', 'like', `%${q}%`)
          .orWhere('u.notes', 'like', `%${q}%`)
          .orWhere('u.hash', 'like', `%${q}%`);
      });
    }

    if (categoryId) {
      if (includeSubcategories) {
        const ids = await getSubcategoryIds(categoryId);
        baseQuery = baseQuery.whereIn('u.category', ids);
      } else {
        baseQuery = baseQuery.where('u.category', categoryId);
      }
    }

    if (tagId) {
      baseQuery = baseQuery.whereExists(function () {
        this.select(1)
          .from('uploads_tags as ut')
          .whereRaw('ut.upload = u.id')
          .andWhere('ut.tag', tagId);
      });
    }

    if (mimetypeFilter) {
      baseQuery = baseQuery.where('u.mimetype', 'like', `${mimetypeFilter}%`);
    }

    const countRow = await baseQuery.clone().count<{ count: number }[]>('u.id as count').first();
    const total = Number(countRow?.count ?? 0);

    const items = await baseQuery
      .clone()
      .select(
        'u.*',
        'c.name as category_name'
      )
      .orderBy(`u.${sortBy}`, sortDir)
      .limit(limit)
      .offset(offset);

    res.json({
      items,
      pagination: {
        page,
        pageSize: limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    handleDbError(res, err);
  }
});

// Upload new file with streaming SHA-256 deduplication
uploadsRouter.post('/', uploadMiddleware.single('file'), async (req, res) => {
  const tempFile = req.file;
  if (!tempFile) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  let finalFilePath: string | null = null;
  let thumbFilePath: string | null = null;

  try {
    const hash = await computeFileSha256(tempFile.path);

    // Check for duplicate hash
    const existing = await db('uploads as u')
      .leftJoin('categories as c', 'u.category', 'c.id')
      .where('u.hash', hash)
      .select('u.*', 'c.name as category_name')
      .first();

    if (existing) {
      safeUnlink(tempFile.path);
      res.status(409).json({
        duplicate: true,
        error: `Duplicate file detected: "${existing.original_name}" has the identical SHA-256 hash and is already stored.`,
        existingUpload: existing,
      });
      return;
    }

    const ext = path.extname(tempFile.originalname).toLowerCase() || '.bin';
    const storedName = `${crypto.randomUUID()}${ext}`;
    finalFilePath = resolveConfinedPath(UPLOADS_DIR, storedName);
    if (!finalFilePath) {
      throw new Error('Invalid storage path');
    }

    fs.renameSync(tempFile.path, finalFilePath);

    let thumbnailRelPath: string | null = null;
    if (tempFile.mimetype.startsWith('image/') && tempFile.mimetype !== 'image/svg+xml') {
      const thumbName = `${crypto.randomUUID()}.webp`;
      thumbFilePath = resolveConfinedPath(THUMBS_DIR, thumbName);
      if (thumbFilePath) {
        try {
          await sharp(finalFilePath)
            .rotate()
            .resize(200, 200, { fit: 'cover', withoutEnlargement: true })
            .webp({ quality: 80 })
            .toFile(thumbFilePath);
          thumbnailRelPath = thumbName;
        } catch {
          safeUnlink(thumbFilePath);
          thumbnailRelPath = null;
        }
      }
    }

    const category = req.body?.category ? Number(req.body.category) : 1;
    const notes = typeof req.body?.notes === 'string' && req.body.notes.trim() ? req.body.notes.trim() : null;
    const ingested = req.body?.ingested === 'true' || req.body?.ingested === true;

    let tagIds: number[] = [];
    if (req.body?.tags) {
      try {
        const parsed = typeof req.body.tags === 'string' ? JSON.parse(req.body.tags) : req.body.tags;
        if (Array.isArray(parsed)) {
          tagIds = parsed.map(Number).filter((n) => Number.isInteger(n) && n > 0);
        }
      } catch {
        // ignore invalid tags JSON
      }
    }

    const insertedId = await db.transaction(async (trx) => {
      const [id] = await trx('uploads').insert({
        original_name: path.basename(tempFile.originalname),
        extension: ext.replace(/^\./, ''),
        stored_path: storedName,
        thumbnail_path: thumbnailRelPath,
        hash,
        size: tempFile.size,
        mimetype: tempFile.mimetype,
        notes,
        ingested: ingested ? 1 : 0,
        category,
      });

      if (tagIds.length > 0) {
        await trx('uploads_tags').insert(tagIds.map((tag) => ({ upload: id, tag })));
      }
      return id;
    });

    const created = await db('uploads as u')
      .leftJoin('categories as c', 'u.category', 'c.id')
      .where('u.id', insertedId)
      .select('u.*', 'c.name as category_name')
      .first();

    res.status(201).json(created);
  } catch (err) {
    safeUnlink(tempFile.path);
    safeUnlink(finalFilePath);
    safeUnlink(thumbFilePath);
    handleDbError(res, err);
  }
});

// Single upload detail
uploadsRouter.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = await db('uploads as u')
      .leftJoin('categories as c', 'u.category', 'c.id')
      .where('u.id', id)
      .select('u.*', 'c.name as category_name')
      .first();

    if (!item) {
      res.status(404).json({ error: 'Upload not found' });
      return;
    }

    const tags = await db('uploads_tags as ut')
      .join('tags as t', 'ut.tag', 't.id')
      .where('ut.upload', id)
      .select('t.id', 't.name');

    res.json({ ...item, tags });
  } catch (err) {
    handleDbError(res, err);
  }
});

// Paginated related records for Upload detail tabs
uploadsRouter.get('/:id/relations/:rel', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rel = req.params.rel;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 10;
    const offset = (page - 1) * limit;

    let query;
    let countQuery;

    if (rel === 'tags') {
      query = db('uploads_tags as ut')
        .join('tags as t', 'ut.tag', 't.id')
        .where('ut.upload', id)
        .select('t.*')
        .orderBy('t.name', 'asc');
      countQuery = db('uploads_tags').where('upload', id).count<{ count: number }[]>('tag as count').first();
    } else if (rel === 'materials') {
      query = db('materials as m')
        .leftJoin('categories as c', 'm.category', 'c.id')
        .where('m.photo', id)
        .orWhereExists(function () {
          this.select(1).from('materials_uploads as mu').whereRaw('mu.material = m.id').andWhere('mu.upload', id);
        })
        .select('m.*', 'c.name as category_name')
        .orderBy('m.name', 'asc');
      countQuery = db('materials as m')
        .where('m.photo', id)
        .orWhereExists(function () {
          this.select(1).from('materials_uploads as mu').whereRaw('mu.material = m.id').andWhere('mu.upload', id);
        })
        .count<{ count: number }[]>('m.id as count')
        .first();
    } else if (rel === 'ingredients') {
      query = db('ingredients as i')
        .leftJoin('categories as c', 'i.category', 'c.id')
        .leftJoin('suppliers as s', 'i.supplier', 's.id')
        .where('i.photo', id)
        .orWhereExists(function () {
          this.select(1).from('ingredients_uploads as iu').whereRaw('iu.ingredient = i.id').andWhere('iu.upload', id);
        })
        .select('i.*', 'c.name as category_name', 's.name as supplier_name')
        .orderBy('i.name', 'asc');
      countQuery = db('ingredients as i')
        .where('i.photo', id)
        .orWhereExists(function () {
          this.select(1).from('ingredients_uploads as iu').whereRaw('iu.ingredient = i.id').andWhere('iu.upload', id);
        })
        .count<{ count: number }[]>('i.id as count')
        .first();
    } else if (rel === 'suppliers') {
      query = db('suppliers_uploads as su')
        .join('suppliers as s', 'su.supplier', 's.id')
        .where('su.upload', id)
        .select('s.*')
        .orderBy('s.name', 'asc');
      countQuery = db('suppliers_uploads').where('upload', id).count<{ count: number }[]>('supplier as count').first();
    } else if (rel === 'formulas') {
      query = db('formulas_uploads as fu')
        .join('formulas as f', 'fu.formula', 'f.id')
        .leftJoin('categories as c', 'f.category', 'c.id')
        .where('fu.upload', id)
        .select('f.*', 'c.name as category_name')
        .orderBy('f.name', 'asc');
      countQuery = db('formulas_uploads').where('upload', id).count<{ count: number }[]>('formula as count').first();
    } else {
      res.status(400).json({ error: 'Unknown relation' });
      return;
    }

    const [items, countRow] = await Promise.all([query.limit(limit).offset(offset), countQuery]);
    const total = Number(countRow?.count ?? 0);

    res.json({
      items,
      pagination: { page, pageSize: limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) {
    handleDbError(res, err);
  }
});

// Update upload metadata & tags
uploadsRouter.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await db('uploads').where('id', id).first();
    if (!existing) {
      res.status(404).json({ error: 'Upload not found' });
      return;
    }

    const updates: Record<string, unknown> = { updated_at: db.fn.now() };
    if (typeof req.body?.original_name === 'string' && req.body.original_name.trim()) {
      updates.original_name = req.body.original_name.trim();
    }
    if (req.body?.notes !== undefined) {
      updates.notes = req.body.notes ? String(req.body.notes) : null;
    }
    if (req.body?.ingested !== undefined) {
      updates.ingested = req.body.ingested ? 1 : 0;
    }
    if (req.body?.category !== undefined) {
      updates.category = Number(req.body.category);
    }

    await db.transaction(async (trx) => {
      await trx('uploads').where('id', id).update(updates);
      if (Array.isArray(req.body?.tags)) {
        await trx('uploads_tags').where('upload', id).del();
        const tagIds = [...new Set(req.body.tags.map(Number).filter((n: number) => n > 0))];
        if (tagIds.length > 0) {
          await trx('uploads_tags').insert(tagIds.map((tag) => ({ upload: id, tag })));
        }
      }
    });

    const updated = await db('uploads as u')
      .leftJoin('categories as c', 'u.category', 'c.id')
      .where('u.id', id)
      .select('u.*', 'c.name as category_name')
      .first();
    res.json(updated);
  } catch (err) {
    handleDbError(res, err);
  }
});

// Serve original file safely
uploadsRouter.get('/:id/file', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = await db('uploads').where('id', id).first();
    if (!item) {
      res.status(404).json({ error: 'Upload not found' });
      return;
    }
    const filePath = resolveConfinedPath(UPLOADS_DIR, item.stored_path);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File missing on disk' });
      return;
    }
    res.setHeader('Content-Type', item.mimetype);
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(item.original_name)}"`);
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(item.original_name)}"`);
    }
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    handleDbError(res, err);
  }
});

// Serve thumbnail safely
uploadsRouter.get('/:id/thumbnail', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = await db('uploads').where('id', id).first();
    if (!item || !item.thumbnail_path) {
      res.status(404).json({ error: 'Thumbnail not available' });
      return;
    }
    const thumbPath = resolveConfinedPath(THUMBS_DIR, item.thumbnail_path);
    if (!thumbPath || !fs.existsSync(thumbPath)) {
      res.status(404).json({ error: 'Thumbnail missing on disk' });
      return;
    }
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    fs.createReadStream(thumbPath).pipe(res);
  } catch (err) {
    handleDbError(res, err);
  }
});

// Delete upload and clean files from disk
uploadsRouter.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = await db('uploads').where('id', id).first();
    if (!item) {
      res.status(404).json({ error: 'Upload not found' });
      return;
    }

    await db('uploads').where('id', id).del();

    safeUnlink(resolveConfinedPath(UPLOADS_DIR, item.stored_path));
    if (item.thumbnail_path) {
      safeUnlink(resolveConfinedPath(THUMBS_DIR, item.thumbnail_path));
    }

    res.json({ ok: true });
  } catch (err) {
    handleDbError(res, err);
  }
});
