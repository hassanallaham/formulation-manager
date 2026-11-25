import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { handleDbError } from '../utils/errors.js';
import { buildPagination, normalizePage } from '../utils/queryHelpers.js';

export const categoriesRouter = Router();
categoriesRouter.use(requireAuth);

categoriesRouter.get('/lookup', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const excludeId = req.query.excludeId ? Number(req.query.excludeId) : null;
    let query = db('categories').select('id', 'name', 'parent');
    if (q) query = query.where('name', 'like', `%${q}%`);
    if (excludeId) query = query.whereNot('id', excludeId);
    const items = await query.orderBy('name', 'asc').limit(20);
    res.json({ items });
  } catch (err) {
    handleDbError(res, err);
  }
});

categoriesRouter.get('/tree', async (_req, res) => {
  try {
    const all = await db('categories').select('*').orderBy('name', 'asc');
    res.json({ items: all });
  } catch (err) {
    handleDbError(res, err);
  }
});

categoriesRouter.get('/', async (req, res) => {
  try {
    const { page, limit, offset } = normalizePage(req.query.page);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const parentId = req.query.parentId ? Number(req.query.parentId) : null;
    const sortBy = ['name', 'created_at', 'id'].includes(String(req.query.sortBy))
      ? String(req.query.sortBy)
      : 'name';
    const sortDir = req.query.sortDir === 'desc' ? 'desc' : 'asc';

    let base = db('categories as c').leftJoin('categories as p', 'c.parent', 'p.id');
    if (q) {
      base = base.where((qb) => {
        qb.where('c.name', 'like', `%${q}%`).orWhere('c.description', 'like', `%${q}%`);
      });
    }
    if (parentId) {
      base = base.where('c.parent', parentId);
    }

    const countRow = await base.clone().count<{ count: number }[]>('c.id as count').first();
    const total = Number(countRow?.count ?? 0);

    const items = await base
      .clone()
      .select('c.*', 'p.name as parent_name')
      .orderBy(`c.${sortBy}`, sortDir)
      .limit(limit)
      .offset(offset);

    res.json({ items, pagination: buildPagination(page, total, limit) });
  } catch (err) {
    handleDbError(res, err);
  }
});

categoriesRouter.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = await db('categories as c')
      .leftJoin('categories as p', 'c.parent', 'p.id')
      .where('c.id', id)
      .select('c.*', 'p.name as parent_name')
      .first();

    if (!item) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
    res.json(item);
  } catch (err) {
    handleDbError(res, err);
  }
});

categoriesRouter.get('/:id/relations/:rel', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rel = req.params.rel;
    const { page, limit, offset } = normalizePage(req.query.page);

    let query;
    let countQuery;

    if (rel === 'children') {
      query = db('categories as c')
        .leftJoin('categories as p', 'c.parent', 'p.id')
        .where('c.parent', id)
        .select('c.*', 'p.name as parent_name')
        .orderBy('c.name', 'asc');
      countQuery = db('categories').where('parent', id).count<{ count: number }[]>('id as count').first();
    } else if (rel === 'materials') {
      query = db('materials as m')
        .leftJoin('categories as c', 'm.category', 'c.id')
        .leftJoin('uploads as u', 'm.photo', 'u.id')
        .where('m.category', id)
        .select('m.*', 'c.name as category_name', 'u.original_name as photo_name', 'u.thumbnail_path as photo_thumbnail')
        .orderBy('m.name', 'asc');
      countQuery = db('materials').where('category', id).count<{ count: number }[]>('id as count').first();
    } else if (rel === 'ingredients') {
      query = db('ingredients as i')
        .leftJoin('categories as c', 'i.category', 'c.id')
        .leftJoin('suppliers as s', 'i.supplier', 's.id')
        .leftJoin('currencies as cur', 'i.currency', 'cur.id')
        .leftJoin('units as un', 'i.unit', 'un.id')
        .where('i.category', id)
        .select('i.*', 'c.name as category_name', 's.name as supplier_name', 'cur.name as currency_name', 'un.name as unit_name')
        .orderBy('i.name', 'asc');
      countQuery = db('ingredients').where('category', id).count<{ count: number }[]>('id as count').first();
    } else if (rel === 'formulas') {
      query = db('formulas as f')
        .leftJoin('categories as c', 'f.category', 'c.id')
        .where('f.category', id)
        .select('f.*', 'c.name as category_name')
        .orderBy('f.name', 'asc');
      countQuery = db('formulas').where('category', id).count<{ count: number }[]>('id as count').first();
    } else if (rel === 'uploads') {
      query = db('uploads as u')
        .leftJoin('categories as c', 'u.category', 'c.id')
        .where('u.category', id)
        .select('u.*', 'c.name as category_name')
        .orderBy('u.created_at', 'desc');
      countQuery = db('uploads').where('category', id).count<{ count: number }[]>('id as count').first();
    } else {
      res.status(400).json({ error: 'Unknown relation' });
      return;
    }

    const [items, countRow] = await Promise.all([query.limit(limit).offset(offset), countQuery]);
    res.json({ items, pagination: buildPagination(page, Number(countRow?.count ?? 0), limit) });
  } catch (err) {
    handleDbError(res, err);
  }
});

categoriesRouter.post('/', async (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'Category name is required' });
      return;
    }
    const description = req.body?.description ? String(req.body.description) : null;
    const parent = req.body?.parent ? Number(req.body.parent) : null;

    const [id] = await db('categories').insert({ name, description, parent });
    const created = await db('categories as c')
      .leftJoin('categories as p', 'c.parent', 'p.id')
      .where('c.id', id)
      .select('c.*', 'p.name as parent_name')
      .first();
    res.status(201).json(created);
  } catch (err) {
    handleDbError(res, err);
  }
});

categoriesRouter.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await db('categories').where('id', id).first();
    if (!existing) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    const updates: Record<string, unknown> = { updated_at: db.fn.now() };
    if (typeof req.body?.name === 'string' && req.body.name.trim()) {
      updates.name = req.body.name.trim();
    }
    if (req.body?.description !== undefined) {
      updates.description = req.body.description ? String(req.body.description) : null;
    }
    if (req.body?.parent !== undefined) {
      updates.parent = req.body.parent ? Number(req.body.parent) : null;
    }

    await db('categories').where('id', id).update(updates);
    const updated = await db('categories as c')
      .leftJoin('categories as p', 'c.parent', 'p.id')
      .where('c.id', id)
      .select('c.*', 'p.name as parent_name')
      .first();
    res.json(updated);
  } catch (err) {
    handleDbError(res, err);
  }
});

categoriesRouter.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (id === 1) {
      res.status(400).json({ error: 'Cannot delete default uncategorized category' });
      return;
    }
    const deleted = await db('categories').where('id', id).del();
    if (!deleted) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    handleDbError(res, err);
  }
});

// ================= TAGS =================
export const tagsRouter = Router();
tagsRouter.use(requireAuth);

tagsRouter.get('/lookup', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let query = db('tags').select('id', 'name');
    if (q) query = query.where('name', 'like', `%${q}%`);
    const items = await query.orderBy('name', 'asc').limit(20);
    res.json({ items });
  } catch (err) {
    handleDbError(res, err);
  }
});

tagsRouter.get('/', async (req, res) => {
  try {
    const { page, limit, offset } = normalizePage(req.query.page);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const sortBy = ['name', 'created_at', 'id'].includes(String(req.query.sortBy))
      ? String(req.query.sortBy)
      : 'name';
    const sortDir = req.query.sortDir === 'desc' ? 'desc' : 'asc';

    let base = db('tags');
    if (q) {
      base = base.where((qb) => {
        qb.where('name', 'like', `%${q}%`).orWhere('description', 'like', `%${q}%`);
      });
    }

    const countRow = await base.clone().count<{ count: number }[]>('id as count').first();
    const total = Number(countRow?.count ?? 0);
    const items = await base.clone().orderBy(sortBy, sortDir).limit(limit).offset(offset);

    res.json({ items, pagination: buildPagination(page, total, limit) });
  } catch (err) {
    handleDbError(res, err);
  }
});

tagsRouter.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = await db('tags').where('id', id).first();
    if (!item) {
      res.status(404).json({ error: 'Tag not found' });
      return;
    }
    res.json(item);
  } catch (err) {
    handleDbError(res, err);
  }
});

tagsRouter.get('/:id/relations/:rel', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rel = req.params.rel;
    const { page, limit, offset } = normalizePage(req.query.page);

    let query;
    let countQuery;

    if (rel === 'materials') {
      query = db('materials_tags as mt')
        .join('materials as m', 'mt.material', 'm.id')
        .leftJoin('categories as c', 'm.category', 'c.id')
        .where('mt.tag', id)
        .select('m.*', 'c.name as category_name')
        .orderBy('m.name', 'asc');
      countQuery = db('materials_tags').where('tag', id).count<{ count: number }[]>('material as count').first();
    } else if (rel === 'ingredients') {
      query = db('ingredients_tags as it')
        .join('ingredients as i', 'it.ingredient', 'i.id')
        .leftJoin('categories as c', 'i.category', 'c.id')
        .leftJoin('suppliers as s', 'i.supplier', 's.id')
        .where('it.tag', id)
        .select('i.*', 'c.name as category_name', 's.name as supplier_name')
        .orderBy('i.name', 'asc');
      countQuery = db('ingredients_tags').where('tag', id).count<{ count: number }[]>('ingredient as count').first();
    } else if (rel === 'formulas') {
      query = db('formulas_tags as ft')
        .join('formulas as f', 'ft.formula', 'f.id')
        .leftJoin('categories as c', 'f.category', 'c.id')
        .where('ft.tag', id)
        .select('f.*', 'c.name as category_name')
        .orderBy('f.name', 'asc');
      countQuery = db('formulas_tags').where('tag', id).count<{ count: number }[]>('formula as count').first();
    } else if (rel === 'uploads') {
      query = db('uploads_tags as ut')
        .join('uploads as u', 'ut.upload', 'u.id')
        .leftJoin('categories as c', 'u.category', 'c.id')
        .where('ut.tag', id)
        .select('u.*', 'c.name as category_name')
        .orderBy('u.created_at', 'desc');
      countQuery = db('uploads_tags').where('tag', id).count<{ count: number }[]>('upload as count').first();
    } else {
      res.status(400).json({ error: 'Unknown relation' });
      return;
    }

    const [items, countRow] = await Promise.all([query.limit(limit).offset(offset), countQuery]);
    res.json({ items, pagination: buildPagination(page, Number(countRow?.count ?? 0), limit) });
  } catch (err) {
    handleDbError(res, err);
  }
});

tagsRouter.post('/', async (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'Tag name is required' });
      return;
    }
    const description = req.body?.description ? String(req.body.description) : null;
    const [id] = await db('tags').insert({ name, description });
    const created = await db('tags').where('id', id).first();
    res.status(201).json(created);
  } catch (err) {
    handleDbError(res, err);
  }
});

tagsRouter.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await db('tags').where('id', id).first();
    if (!existing) {
      res.status(404).json({ error: 'Tag not found' });
      return;
    }
    const updates: Record<string, unknown> = { updated_at: db.fn.now() };
    if (typeof req.body?.name === 'string' && req.body.name.trim()) {
      updates.name = req.body.name.trim();
    }
    if (req.body?.description !== undefined) {
      updates.description = req.body.description ? String(req.body.description) : null;
    }
    await db('tags').where('id', id).update(updates);
    res.json(await db('tags').where('id', id).first());
  } catch (err) {
    handleDbError(res, err);
  }
});

tagsRouter.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const deleted = await db('tags').where('id', id).del();
    if (!deleted) {
      res.status(404).json({ error: 'Tag not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    handleDbError(res, err);
  }
});
