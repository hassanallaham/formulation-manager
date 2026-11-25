import Decimal from 'decimal.js';
import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { recalculateFormulasForCurrency } from '../services/costing.js';
import { handleDbError } from '../utils/errors.js';
import {
  buildPagination,
  getSubcategoryIds,
  normalizePage,
  parseIdArray,
} from '../utils/queryHelpers.js';

// ================= MATERIALS =================
export const materialsRouter = Router();
materialsRouter.use(requireAuth);

materialsRouter.get('/lookup', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let query = db('materials').select('id', 'name', 'CAS', 'FEMA');
    if (q) {
      query = query.where((qb) => {
        qb.where('name', 'like', `%${q}%`)
          .orWhere('CAS', 'like', `%${q}%`)
          .orWhere('FEMA', 'like', `%${q}%`);
      });
    }
    res.json({ items: await query.orderBy('name', 'asc').limit(20) });
  } catch (err) {
    handleDbError(res, err);
  }
});

materialsRouter.get('/', async (req, res) => {
  try {
    const { page, limit, offset } = normalizePage(req.query.page);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
    const includeSubcategories = req.query.includeSubcategories === 'true';
    const tagId = req.query.tagId ? Number(req.query.tagId) : null;
    const sortBy = ['name', 'CAS', 'FEMA', 'created_at'].includes(String(req.query.sortBy))
      ? String(req.query.sortBy)
      : 'name';
    const sortDir = req.query.sortDir === 'desc' ? 'desc' : 'asc';

    let base = db('materials as m')
      .leftJoin('categories as c', 'm.category', 'c.id')
      .leftJoin('uploads as u', 'm.photo', 'u.id');

    if (q) {
      base = base.where((qb) => {
        qb.where('m.name', 'like', `%${q}%`)
          .orWhere('m.CAS', 'like', `%${q}%`)
          .orWhere('m.FEMA', 'like', `%${q}%`)
          .orWhere('m.info', 'like', `%${q}%`);
      });
    }
    if (categoryId) {
      if (includeSubcategories) {
        base = base.whereIn('m.category', await getSubcategoryIds(categoryId));
      } else {
        base = base.where('m.category', categoryId);
      }
    }
    if (tagId) {
      base = base.whereExists(function () {
        this.select(1)
          .from('materials_tags as mt')
          .whereRaw('mt.material = m.id')
          .andWhere('mt.tag', tagId);
      });
    }

    const countRow = await base.clone().count<{ count: number }[]>('m.id as count').first();
    const total = Number(countRow?.count ?? 0);
    const items = await base
      .clone()
      .select(
        'm.*',
        'c.name as category_name',
        'u.original_name as photo_name',
        'u.thumbnail_path as photo_thumbnail'
      )
      .orderBy(`m.${sortBy}`, sortDir)
      .limit(limit)
      .offset(offset);

    res.json({ items, pagination: buildPagination(page, total, limit) });
  } catch (err) {
    handleDbError(res, err);
  }
});

materialsRouter.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = await db('materials as m')
      .leftJoin('categories as c', 'm.category', 'c.id')
      .leftJoin('uploads as u', 'm.photo', 'u.id')
      .where('m.id', id)
      .select(
        'm.*',
        'c.name as category_name',
        'u.original_name as photo_name',
        'u.thumbnail_path as photo_thumbnail'
      )
      .first();

    if (!item) {
      res.status(404).json({ error: 'Material not found' });
      return;
    }

    const [tags, uploads] = await Promise.all([
      db('materials_tags as mt')
        .join('tags as t', 'mt.tag', 't.id')
        .where('mt.material', id)
        .select('t.id', 't.name'),
      db('materials_uploads as mu')
        .join('uploads as u', 'mu.upload', 'u.id')
        .where('mu.material', id)
        .select('u.id', 'u.original_name as name', 'u.mimetype', 'u.thumbnail_path'),
    ]);

    res.json({ ...item, tags, uploads });
  } catch (err) {
    handleDbError(res, err);
  }
});

materialsRouter.get('/:id/relations/:rel', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rel = req.params.rel;
    const { page, limit, offset } = normalizePage(req.query.page);

    let query;
    let countQuery;

    if (rel === 'ingredients') {
      query = db('ingredients as i')
        .leftJoin('categories as c', 'i.category', 'c.id')
        .leftJoin('suppliers as s', 'i.supplier', 's.id')
        .leftJoin('currencies as cur', 'i.currency', 'cur.id')
        .leftJoin('units as un', 'i.unit', 'un.id')
        .where('i.material', id)
        .select('i.*', 'c.name as category_name', 's.name as supplier_name', 'cur.name as currency_name', 'un.name as unit_name')
        .orderBy('i.name', 'asc');
      countQuery = db('ingredients').where('material', id).count<{ count: number }[]>('id as count').first();
    } else if (rel === 'tags') {
      query = db('materials_tags as mt')
        .join('tags as t', 'mt.tag', 't.id')
        .where('mt.material', id)
        .select('t.*')
        .orderBy('t.name', 'asc');
      countQuery = db('materials_tags').where('material', id).count<{ count: number }[]>('tag as count').first();
    } else if (rel === 'uploads') {
      query = db('materials_uploads as mu')
        .join('uploads as u', 'mu.upload', 'u.id')
        .leftJoin('categories as c', 'u.category', 'c.id')
        .where('mu.material', id)
        .select('u.*', 'c.name as category_name')
        .orderBy('u.created_at', 'desc');
      countQuery = db('materials_uploads').where('material', id).count<{ count: number }[]>('upload as count').first();
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

materialsRouter.post('/', async (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'Material name is required' });
      return;
    }

    const tagIds = parseIdArray(req.body?.tags);
    const uploadIds = parseIdArray(req.body?.uploads);

    const id = await db.transaction(async (trx) => {
      const [newId] = await trx('materials').insert({
        name,
        CAS: req.body?.CAS ? String(req.body.CAS).trim() : null,
        FEMA: req.body?.FEMA ? String(req.body.FEMA).trim() : null,
        info: req.body?.info ? String(req.body.info) : null,
        category: req.body?.category ? Number(req.body.category) : 1,
        photo: req.body?.photo ? Number(req.body.photo) : null,
        max_percent:
          req.body?.max_percent !== undefined && req.body?.max_percent !== null && req.body?.max_percent !== ''
            ? Number(req.body.max_percent)
            : null,
      });

      if (tagIds.length > 0) {
        await trx('materials_tags').insert(tagIds.map((tag) => ({ material: newId, tag })));
      }
      if (uploadIds.length > 0) {
        await trx('materials_uploads').insert(uploadIds.map((upload) => ({ material: newId, upload })));
      }
      return newId;
    });

    res.status(201).json(await db('materials').where('id', id).first());
  } catch (err) {
    handleDbError(res, err);
  }
});

materialsRouter.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await db('materials').where('id', id).first();
    if (!existing) {
      res.status(404).json({ error: 'Material not found' });
      return;
    }

    await db.transaction(async (trx) => {
      const updates: Record<string, unknown> = { updated_at: trx.fn.now() };
      if (typeof req.body?.name === 'string' && req.body.name.trim()) updates.name = req.body.name.trim();
      if (req.body?.CAS !== undefined) updates.CAS = req.body.CAS ? String(req.body.CAS).trim() : null;
      if (req.body?.FEMA !== undefined) updates.FEMA = req.body.FEMA ? String(req.body.FEMA).trim() : null;
      if (req.body?.info !== undefined) updates.info = req.body.info ? String(req.body.info) : null;
      if (req.body?.category !== undefined) updates.category = Number(req.body.category) || 1;
      if (req.body?.photo !== undefined) updates.photo = req.body.photo ? Number(req.body.photo) : null;
      if (req.body?.max_percent !== undefined) {
        updates.max_percent =
          req.body.max_percent !== null && req.body.max_percent !== ''
            ? Number(req.body.max_percent)
            : null;
      }

      await trx('materials').where('id', id).update(updates);

      if (Array.isArray(req.body?.tags)) {
        await trx('materials_tags').where('material', id).del();
        const tagIds = parseIdArray(req.body.tags);
        if (tagIds.length > 0) {
          await trx('materials_tags').insert(tagIds.map((tag) => ({ material: id, tag })));
        }
      }
      if (Array.isArray(req.body?.uploads)) {
        await trx('materials_uploads').where('material', id).del();
        const uploadIds = parseIdArray(req.body.uploads);
        if (uploadIds.length > 0) {
          await trx('materials_uploads').insert(uploadIds.map((upload) => ({ material: id, upload })));
        }
      }
    });

    res.json(await db('materials').where('id', id).first());
  } catch (err) {
    handleDbError(res, err);
  }
});

materialsRouter.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const deleted = await db('materials').where('id', id).del();
    if (!deleted) {
      res.status(404).json({ error: 'Material not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    handleDbError(res, err);
  }
});

// ================= SUPPLIERS =================
export const suppliersRouter = Router();
suppliersRouter.use(requireAuth);

suppliersRouter.get('/lookup', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let query = db('suppliers').select('id', 'name');
    if (q) query = query.where('name', 'like', `%${q}%`);
    res.json({ items: await query.orderBy('name', 'asc').limit(20) });
  } catch (err) {
    handleDbError(res, err);
  }
});

suppliersRouter.get('/', async (req, res) => {
  try {
    const { page, limit, offset } = normalizePage(req.query.page);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const sortBy = ['name', 'created_at', 'id'].includes(String(req.query.sortBy))
      ? String(req.query.sortBy)
      : 'name';
    const sortDir = req.query.sortDir === 'desc' ? 'desc' : 'asc';

    let base = db('suppliers');
    if (q) {
      base = base.where((qb) => {
        qb.where('name', 'like', `%${q}%`).orWhere('info', 'like', `%${q}%`);
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

suppliersRouter.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = await db('suppliers').where('id', id).first();
    if (!item) {
      res.status(404).json({ error: 'Supplier not found' });
      return;
    }
    const uploads = await db('suppliers_uploads as su')
      .join('uploads as u', 'su.upload', 'u.id')
      .where('su.supplier', id)
      .select('u.id', 'u.original_name as name', 'u.mimetype', 'u.thumbnail_path');

    res.json({ ...item, uploads });
  } catch (err) {
    handleDbError(res, err);
  }
});

suppliersRouter.get('/:id/relations/:rel', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rel = req.params.rel;
    const { page, limit, offset } = normalizePage(req.query.page);

    let query;
    let countQuery;

    if (rel === 'ingredients') {
      query = db('ingredients as i')
        .leftJoin('categories as c', 'i.category', 'c.id')
        .leftJoin('materials as m', 'i.material', 'm.id')
        .leftJoin('currencies as cur', 'i.currency', 'cur.id')
        .leftJoin('units as un', 'i.unit', 'un.id')
        .where('i.supplier', id)
        .select('i.*', 'c.name as category_name', 'm.name as material_name', 'cur.name as currency_name', 'un.name as unit_name')
        .orderBy('i.name', 'asc');
      countQuery = db('ingredients').where('supplier', id).count<{ count: number }[]>('id as count').first();
    } else if (rel === 'uploads') {
      query = db('suppliers_uploads as su')
        .join('uploads as u', 'su.upload', 'u.id')
        .leftJoin('categories as c', 'u.category', 'c.id')
        .where('su.supplier', id)
        .select('u.*', 'c.name as category_name')
        .orderBy('u.created_at', 'desc');
      countQuery = db('suppliers_uploads').where('supplier', id).count<{ count: number }[]>('upload as count').first();
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

suppliersRouter.post('/', async (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'Supplier name is required' });
      return;
    }
    const uploadIds = parseIdArray(req.body?.uploads);

    const id = await db.transaction(async (trx) => {
      const [newId] = await trx('suppliers').insert({
        name,
        info: req.body?.info ? String(req.body.info) : null,
      });
      if (uploadIds.length > 0) {
        await trx('suppliers_uploads').insert(uploadIds.map((upload) => ({ supplier: newId, upload })));
      }
      return newId;
    });

    res.status(201).json(await db('suppliers').where('id', id).first());
  } catch (err) {
    handleDbError(res, err);
  }
});

suppliersRouter.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await db('suppliers').where('id', id).first();
    if (!existing) {
      res.status(404).json({ error: 'Supplier not found' });
      return;
    }

    await db.transaction(async (trx) => {
      const updates: Record<string, unknown> = { updated_at: trx.fn.now() };
      if (typeof req.body?.name === 'string' && req.body.name.trim()) updates.name = req.body.name.trim();
      if (req.body?.info !== undefined) updates.info = req.body.info ? String(req.body.info) : null;
      await trx('suppliers').where('id', id).update(updates);

      if (Array.isArray(req.body?.uploads)) {
        await trx('suppliers_uploads').where('supplier', id).del();
        const uploadIds = parseIdArray(req.body.uploads);
        if (uploadIds.length > 0) {
          await trx('suppliers_uploads').insert(uploadIds.map((upload) => ({ supplier: id, upload })));
        }
      }
    });

    res.json(await db('suppliers').where('id', id).first());
  } catch (err) {
    handleDbError(res, err);
  }
});

suppliersRouter.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (id === 1) {
      res.status(400).json({ error: 'Cannot delete default virtual supplier' });
      return;
    }
    const deleted = await db('suppliers').where('id', id).del();
    if (!deleted) {
      res.status(404).json({ error: 'Supplier not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    handleDbError(res, err);
  }
});

// ================= CURRENCIES =================
export const currenciesRouter = Router();
currenciesRouter.use(requireAuth);

currenciesRouter.get('/lookup', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let query = db('currencies').select('id', 'name', 'in_usd');
    if (q) query = query.where('name', 'like', `%${q}%`);
    res.json({ items: await query.orderBy('name', 'asc').limit(20) });
  } catch (err) {
    handleDbError(res, err);
  }
});

currenciesRouter.get('/', async (req, res) => {
  try {
    const { page, limit, offset } = normalizePage(req.query.page);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let base = db('currencies');
    if (q) base = base.where('name', 'like', `%${q}%`);

    const countRow = await base.clone().count<{ count: number }[]>('id as count').first();
    const total = Number(countRow?.count ?? 0);
    const items = await base.clone().orderBy('name', 'asc').limit(limit).offset(offset);
    res.json({ items, pagination: buildPagination(page, total, limit) });
  } catch (err) {
    handleDbError(res, err);
  }
});

currenciesRouter.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = await db('currencies').where('id', id).first();
    if (!item) {
      res.status(404).json({ error: 'Currency not found' });
      return;
    }
    res.json(item);
  } catch (err) {
    handleDbError(res, err);
  }
});

currenciesRouter.get('/:id/relations/:rel', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rel = req.params.rel;
    const { page, limit, offset } = normalizePage(req.query.page);

    if (rel !== 'ingredients') {
      res.status(400).json({ error: 'Unknown relation' });
      return;
    }

    const query = db('ingredients as i')
      .leftJoin('categories as c', 'i.category', 'c.id')
      .leftJoin('suppliers as s', 'i.supplier', 's.id')
      .leftJoin('units as un', 'i.unit', 'un.id')
      .where('i.currency', id)
      .select('i.*', 'c.name as category_name', 's.name as supplier_name', 'un.name as unit_name')
      .orderBy('i.name', 'asc');
    const countQuery = db('ingredients').where('currency', id).count<{ count: number }[]>('id as count').first();

    const [items, countRow] = await Promise.all([query.limit(limit).offset(offset), countQuery]);
    res.json({ items, pagination: buildPagination(page, Number(countRow?.count ?? 0), limit) });
  } catch (err) {
    handleDbError(res, err);
  }
});

currenciesRouter.post('/', async (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'Currency name is required' });
      return;
    }
    const inUsd = new Decimal(req.body?.in_usd ?? 0).toDecimalPlaces(6).toNumber();
    if (inUsd < 0) {
      res.status(400).json({ error: 'in_usd must be non-negative' });
      return;
    }
    const [id] = await db('currencies').insert({ name, in_usd: inUsd });
    res.status(201).json(await db('currencies').where('id', id).first());
  } catch (err) {
    handleDbError(res, err);
  }
});

currenciesRouter.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await db('currencies').where('id', id).first();
    if (!existing) {
      res.status(404).json({ error: 'Currency not found' });
      return;
    }

    await db.transaction(async (trx) => {
      const updates: Record<string, unknown> = { updated_at: trx.fn.now() };
      if (typeof req.body?.name === 'string' && req.body.name.trim()) updates.name = req.body.name.trim();
      let rateChanged = false;
      if (req.body?.in_usd !== undefined) {
        const nextVal = new Decimal(req.body.in_usd).toDecimalPlaces(6).toNumber();
        if (nextVal < 0) throw new Error('in_usd must be non-negative');
        if (id === 1 && nextVal !== 1) throw new Error('Default USD currency must have in_usd = 1');
        updates.in_usd = nextVal;
        rateChanged = nextVal !== Number(existing.in_usd);
      }

      await trx('currencies').where('id', id).update(updates);
      if (rateChanged) {
        await recalculateFormulasForCurrency(trx, id);
      }
    });

    res.json(await db('currencies').where('id', id).first());
  } catch (err) {
    handleDbError(res, err);
  }
});

currenciesRouter.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (id === 1) {
      res.status(400).json({ error: 'Cannot delete default USD currency' });
      return;
    }
    const deleted = await db('currencies').where('id', id).del();
    if (!deleted) {
      res.status(404).json({ error: 'Currency not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    handleDbError(res, err);
  }
});

// ================= UNITS =================
export const unitsRouter = Router();
unitsRouter.use(requireAuth);

unitsRouter.get('/lookup', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let query = db('units').select('id', 'name', 'equal_in_kg');
    if (q) query = query.where('name', 'like', `%${q}%`);
    res.json({ items: await query.orderBy('name', 'asc').limit(20) });
  } catch (err) {
    handleDbError(res, err);
  }
});

unitsRouter.get('/', async (req, res) => {
  try {
    const { page, limit, offset } = normalizePage(req.query.page);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let base = db('units');
    if (q) base = base.where('name', 'like', `%${q}%`);

    const countRow = await base.clone().count<{ count: number }[]>('id as count').first();
    const total = Number(countRow?.count ?? 0);
    const items = await base.clone().orderBy('name', 'asc').limit(limit).offset(offset);
    res.json({ items, pagination: buildPagination(page, total, limit) });
  } catch (err) {
    handleDbError(res, err);
  }
});

unitsRouter.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = await db('units').where('id', id).first();
    if (!item) {
      res.status(404).json({ error: 'Unit not found' });
      return;
    }
    res.json(item);
  } catch (err) {
    handleDbError(res, err);
  }
});

unitsRouter.get('/:id/relations/:rel', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rel = req.params.rel;
    const { page, limit, offset } = normalizePage(req.query.page);

    if (rel !== 'ingredients') {
      res.status(400).json({ error: 'Unknown relation' });
      return;
    }

    const query = db('ingredients as i')
      .leftJoin('categories as c', 'i.category', 'c.id')
      .leftJoin('suppliers as s', 'i.supplier', 's.id')
      .leftJoin('currencies as cur', 'i.currency', 'cur.id')
      .where('i.unit', id)
      .select('i.*', 'c.name as category_name', 's.name as supplier_name', 'cur.name as currency_name')
      .orderBy('i.name', 'asc');
    const countQuery = db('ingredients').where('unit', id).count<{ count: number }[]>('id as count').first();

    const [items, countRow] = await Promise.all([query.limit(limit).offset(offset), countQuery]);
    res.json({ items, pagination: buildPagination(page, Number(countRow?.count ?? 0), limit) });
  } catch (err) {
    handleDbError(res, err);
  }
});

unitsRouter.post('/', async (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'Unit name is required' });
      return;
    }
    const equalInKg = new Decimal(req.body?.equal_in_kg ?? 1).toDecimalPlaces(6).toNumber();
    if (equalInKg <= 0) {
      res.status(400).json({ error: 'equal_in_kg must be greater than 0' });
      return;
    }
    const [id] = await db('units').insert({ name, equal_in_kg: equalInKg });
    res.status(201).json(await db('units').where('id', id).first());
  } catch (err) {
    handleDbError(res, err);
  }
});

unitsRouter.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await db('units').where('id', id).first();
    if (!existing) {
      res.status(404).json({ error: 'Unit not found' });
      return;
    }

    const updates: Record<string, unknown> = { updated_at: db.fn.now() };
    if (typeof req.body?.name === 'string' && req.body.name.trim()) updates.name = req.body.name.trim();
    if (req.body?.equal_in_kg !== undefined) {
      const val = new Decimal(req.body.equal_in_kg).toDecimalPlaces(6).toNumber();
      if (val <= 0) {
        res.status(400).json({ error: 'equal_in_kg must be greater than 0' });
        return;
      }
      if (id === 1 && val !== 1) {
        res.status(400).json({ error: 'Default kg unit must have equal_in_kg = 1' });
        return;
      }
      updates.equal_in_kg = val;
    }

    await db('units').where('id', id).update(updates);
    res.json(await db('units').where('id', id).first());
  } catch (err) {
    handleDbError(res, err);
  }
});

unitsRouter.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (id === 1) {
      res.status(400).json({ error: 'Cannot delete default kg unit' });
      return;
    }
    const deleted = await db('units').where('id', id).del();
    if (!deleted) {
      res.status(404).json({ error: 'Unit not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    handleDbError(res, err);
  }
});
