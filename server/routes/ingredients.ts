import Decimal from 'decimal.js';
import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { recalculateFormulasForIngredient } from '../services/costing.js';
import { handleDbError } from '../utils/errors.js';
import {
  buildPagination,
  getSubcategoryIds,
  normalizePage,
  parseIdArray,
} from '../utils/queryHelpers.js';

export const ingredientsRouter = Router();
ingredientsRouter.use(requireAuth);

ingredientsRouter.get('/lookup', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let query = db('ingredients as i')
      .leftJoin('units as un', 'i.unit', 'un.id')
      .leftJoin('currencies as cur', 'i.currency', 'cur.id')
      .select(
        'i.id',
        'i.name',
        'i.cost',
        'un.name as unit_name',
        'un.equal_in_kg',
        'cur.name as currency_name',
        'cur.in_usd'
      );
    if (q) query = query.where('i.name', 'like', `%${q}%`);
    res.json({ items: await query.orderBy('i.name', 'asc').limit(20) });
  } catch (err) {
    handleDbError(res, err);
  }
});

ingredientsRouter.get('/', async (req, res) => {
  try {
    const { page, limit, offset } = normalizePage(req.query.page);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
    const includeSubcategories = req.query.includeSubcategories === 'true';
    const tagId = req.query.tagId ? Number(req.query.tagId) : null;
    const sortBy = ['name', 'cost', 'created_at'].includes(String(req.query.sortBy))
      ? String(req.query.sortBy)
      : 'name';
    const sortDir = req.query.sortDir === 'desc' ? 'desc' : 'asc';

    let base = db('ingredients as i')
      .leftJoin('categories as c', 'i.category', 'c.id')
      .leftJoin('materials as m', 'i.material', 'm.id')
      .leftJoin('suppliers as s', 'i.supplier', 's.id')
      .leftJoin('units as un', 'i.unit', 'un.id')
      .leftJoin('currencies as cur', 'i.currency', 'cur.id')
      .leftJoin('uploads as u', 'i.photo', 'u.id');

    if (q) {
      base = base.where((qb) => {
        qb.where('i.name', 'like', `%${q}%`)
          .orWhere('i.info', 'like', `%${q}%`)
          .orWhere('s.name', 'like', `%${q}%`)
          .orWhere('m.name', 'like', `%${q}%`);
      });
    }
    if (categoryId) {
      if (includeSubcategories) {
        base = base.whereIn('i.category', await getSubcategoryIds(categoryId));
      } else {
        base = base.where('i.category', categoryId);
      }
    }
    if (tagId) {
      base = base.whereExists(function () {
        this.select(1)
          .from('ingredients_tags as it')
          .whereRaw('it.ingredient = i.id')
          .andWhere('it.tag', tagId);
      });
    }

    const countRow = await base.clone().count<{ count: number }[]>('i.id as count').first();
    const total = Number(countRow?.count ?? 0);

    const items = await base
      .clone()
      .select(
        'i.*',
        'c.name as category_name',
        'm.name as material_name',
        's.name as supplier_name',
        'un.name as unit_name',
        'un.equal_in_kg',
        'cur.name as currency_name',
        'cur.in_usd',
        'u.original_name as photo_name',
        'u.thumbnail_path as photo_thumbnail'
      )
      .orderBy(`i.${sortBy}`, sortDir)
      .limit(limit)
      .offset(offset);

    res.json({ items, pagination: buildPagination(page, total, limit) });
  } catch (err) {
    handleDbError(res, err);
  }
});

ingredientsRouter.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = await db('ingredients as i')
      .leftJoin('categories as c', 'i.category', 'c.id')
      .leftJoin('materials as m', 'i.material', 'm.id')
      .leftJoin('suppliers as s', 'i.supplier', 's.id')
      .leftJoin('units as un', 'i.unit', 'un.id')
      .leftJoin('currencies as cur', 'i.currency', 'cur.id')
      .leftJoin('uploads as u', 'i.photo', 'u.id')
      .where('i.id', id)
      .select(
        'i.*',
        'c.name as category_name',
        'm.name as material_name',
        's.name as supplier_name',
        'un.name as unit_name',
        'un.equal_in_kg',
        'cur.name as currency_name',
        'cur.in_usd',
        'u.original_name as photo_name',
        'u.thumbnail_path as photo_thumbnail'
      )
      .first();

    if (!item) {
      res.status(404).json({ error: 'Ingredient not found' });
      return;
    }

    const [tags, uploads] = await Promise.all([
      db('ingredients_tags as it')
        .join('tags as t', 'it.tag', 't.id')
        .where('it.ingredient', id)
        .select('t.id', 't.name'),
      db('ingredients_uploads as iu')
        .join('uploads as u', 'iu.upload', 'u.id')
        .where('iu.ingredient', id)
        .select('u.id', 'u.original_name as name', 'u.mimetype', 'u.thumbnail_path'),
    ]);

    res.json({ ...item, tags, uploads });
  } catch (err) {
    handleDbError(res, err);
  }
});

ingredientsRouter.get('/:id/relations/:rel', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rel = req.params.rel;
    const { page, limit, offset } = normalizePage(req.query.page);

    let query;
    let countQuery;

    if (rel === 'formulas') {
      query = db('formulas_ingredients as fi')
        .join('formulas as f', 'fi.formula', 'f.id')
        .leftJoin('categories as c', 'f.category', 'c.id')
        .where('fi.ingredient', id)
        .select('f.*', 'fi.quantity', 'c.name as category_name')
        .orderBy('f.name', 'asc');
      countQuery = db('formulas_ingredients')
        .where('ingredient', id)
        .count<{ count: number }[]>('formula as count')
        .first();
    } else if (rel === 'tags') {
      query = db('ingredients_tags as it')
        .join('tags as t', 'it.tag', 't.id')
        .where('it.ingredient', id)
        .select('t.*')
        .orderBy('t.name', 'asc');
      countQuery = db('ingredients_tags').where('ingredient', id).count<{ count: number }[]>('tag as count').first();
    } else if (rel === 'uploads') {
      query = db('ingredients_uploads as iu')
        .join('uploads as u', 'iu.upload', 'u.id')
        .leftJoin('categories as c', 'u.category', 'c.id')
        .where('iu.ingredient', id)
        .select('u.*', 'c.name as category_name')
        .orderBy('u.created_at', 'desc');
      countQuery = db('ingredients_uploads').where('ingredient', id).count<{ count: number }[]>('upload as count').first();
    } else if (rel === 'cost_history') {
      query = db('ingredient_cost_history as h')
        .leftJoin('currencies as cur', 'h.currency', 'cur.id')
        .where('h.ingredient', id)
        .select('h.*', 'cur.name as currency_name')
        .orderBy('h.created_at', 'desc');
      countQuery = db('ingredient_cost_history').where('ingredient', id).count<{ count: number }[]>('id as count').first();
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

ingredientsRouter.post('/', async (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'Ingredient name is required' });
      return;
    }
    const cost = new Decimal(req.body?.cost ?? 0).toDecimalPlaces(4).toNumber();
    if (cost < 0) {
      res.status(400).json({ error: 'Cost must be non-negative' });
      return;
    }

    const tagIds = parseIdArray(req.body?.tags);
    const uploadIds = parseIdArray(req.body?.uploads);

    const id = await db.transaction(async (trx) => {
      const currencyId = req.body?.currency ? Number(req.body.currency) : 1;
      const [newId] = await trx('ingredients').insert({
        name,
        category: req.body?.category ? Number(req.body.category) : 1,
        material: req.body?.material ? Number(req.body.material) : null,
        supplier: req.body?.supplier !== undefined ? (req.body.supplier ? Number(req.body.supplier) : null) : 1,
        photo: req.body?.photo ? Number(req.body.photo) : null,
        info: req.body?.info ? String(req.body.info) : null,
        cost,
        unit: req.body?.unit ? Number(req.body.unit) : 1,
        currency: currencyId,
        max_percent:
          req.body?.max_percent !== undefined && req.body?.max_percent !== null && req.body?.max_percent !== ''
            ? Number(req.body.max_percent)
            : null,
      });

      const cur = await trx('currencies').where('id', currencyId).first();
      await trx('ingredient_cost_history').insert({
        ingredient: newId,
        cost,
        currency: currencyId,
        in_usd: cur?.in_usd ?? 1,
      });

      if (tagIds.length > 0) {
        await trx('ingredients_tags').insert(tagIds.map((tag) => ({ ingredient: newId, tag })));
      }
      if (uploadIds.length > 0) {
        await trx('ingredients_uploads').insert(uploadIds.map((upload) => ({ ingredient: newId, upload })));
      }
      return newId;
    });

    res.status(201).json(await db('ingredients').where('id', id).first());
  } catch (err) {
    handleDbError(res, err);
  }
});

ingredientsRouter.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await db('ingredients').where('id', id).first();
    if (!existing) {
      res.status(404).json({ error: 'Ingredient not found' });
      return;
    }

    await db.transaction(async (trx) => {
      const updates: Record<string, unknown> = { updated_at: trx.fn.now() };
      let costOrCurrencyChanged = false;

      if (typeof req.body?.name === 'string' && req.body.name.trim()) updates.name = req.body.name.trim();
      if (req.body?.category !== undefined) updates.category = Number(req.body.category) || 1;
      if (req.body?.material !== undefined) updates.material = req.body.material ? Number(req.body.material) : null;
      if (req.body?.supplier !== undefined) updates.supplier = req.body.supplier ? Number(req.body.supplier) : null;
      if (req.body?.photo !== undefined) updates.photo = req.body.photo ? Number(req.body.photo) : null;
      if (req.body?.info !== undefined) updates.info = req.body.info ? String(req.body.info) : null;
      if (req.body?.unit !== undefined) updates.unit = Number(req.body.unit) || 1;
      if (req.body?.max_percent !== undefined) {
        updates.max_percent =
          req.body.max_percent !== null && req.body.max_percent !== ''
            ? Number(req.body.max_percent)
            : null;
      }

      if (req.body?.cost !== undefined) {
        const nextCost = new Decimal(req.body.cost).toDecimalPlaces(4).toNumber();
        if (nextCost < 0) throw new Error('Cost must be non-negative');
        updates.cost = nextCost;
        if (nextCost !== Number(existing.cost)) costOrCurrencyChanged = true;
      }

      if (req.body?.currency !== undefined) {
        const nextCur = Number(req.body.currency) || 1;
        updates.currency = nextCur;
        if (nextCur !== Number(existing.currency)) costOrCurrencyChanged = true;
      }

      await trx('ingredients').where('id', id).update(updates);

      if (costOrCurrencyChanged) {
        const finalCurrencyId = Number(updates.currency ?? existing.currency);
        const finalCost = Number(updates.cost ?? existing.cost);
        const cur = await trx('currencies').where('id', finalCurrencyId).first();
        await trx('ingredient_cost_history').insert({
          ingredient: id,
          cost: finalCost,
          currency: finalCurrencyId,
          in_usd: cur?.in_usd ?? 1,
        });
      }

      if (Array.isArray(req.body?.tags)) {
        await trx('ingredients_tags').where('ingredient', id).del();
        const tagIds = parseIdArray(req.body.tags);
        if (tagIds.length > 0) {
          await trx('ingredients_tags').insert(tagIds.map((tag) => ({ ingredient: id, tag })));
        }
      }

      if (Array.isArray(req.body?.uploads)) {
        await trx('ingredients_uploads').where('ingredient', id).del();
        const uploadIds = parseIdArray(req.body.uploads);
        if (uploadIds.length > 0) {
          await trx('ingredients_uploads').insert(uploadIds.map((upload) => ({ ingredient: id, upload })));
        }
      }

      if (costOrCurrencyChanged) {
        await recalculateFormulasForIngredient(trx, id);
      }
    });

    res.json(await db('ingredients').where('id', id).first());
  } catch (err) {
    handleDbError(res, err);
  }
});

ingredientsRouter.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const deleted = await db('ingredients').where('id', id).del();
    if (!deleted) {
      res.status(404).json({ error: 'Ingredient not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    handleDbError(res, err);
  }
});
