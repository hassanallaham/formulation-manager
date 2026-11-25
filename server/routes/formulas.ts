import Decimal from 'decimal.js';
import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { recalculateFormulaCost } from '../services/costing.js';
import { handleDbError } from '../utils/errors.js';
import {
  buildPagination,
  getSubcategoryIds,
  normalizePage,
  parseIdArray,
} from '../utils/queryHelpers.js';

export const formulasRouter = Router();
formulasRouter.use(requireAuth);

async function getFormulaIngredientsWithMetrics(formulaId: number) {
  const rows = await db('formulas_ingredients as fi')
    .join('ingredients as i', 'fi.ingredient', 'i.id')
    .leftJoin('materials as m', 'i.material', 'm.id')
    .leftJoin('units as un', 'i.unit', 'un.id')
    .leftJoin('currencies as cur', 'i.currency', 'cur.id')
    .leftJoin('suppliers as s', 'i.supplier', 's.id')
    .where('fi.formula', formulaId)
    .select(
      'fi.formula',
      'fi.ingredient',
      'fi.quantity',
      'i.name as ingredient_name',
      'i.cost',
      'i.max_percent as ingredient_max_percent',
      'm.max_percent as material_max_percent',
      'i.unit',
      'un.name as unit_name',
      'un.equal_in_kg',
      'i.currency',
      'cur.name as currency_name',
      'cur.in_usd',
      'i.supplier',
      's.name as supplier_name'
    )
    .orderBy('i.name', 'asc');

  let totalWeightKg = new Decimal(0);
  let totalUsdCost = new Decimal(0);

  const enriched = rows.map((r) => {
    const qty = new Decimal(r.quantity ?? 0);
    const equalKg = new Decimal(r.equal_in_kg ?? 1);
    const cost = new Decimal(r.cost ?? 0);
    const inUsd = new Decimal(r.in_usd ?? 0);

    const weightKg = qty.times(equalKg);
    const lineUsdCost = qty.times(cost).times(inUsd);

    totalWeightKg = totalWeightKg.plus(weightKg);
    totalUsdCost = totalUsdCost.plus(lineUsdCost);

    const limits = [r.ingredient_max_percent, r.material_max_percent]
      .filter((v) => v !== null && v !== undefined)
      .map(Number);
    const effectiveMaxPercent = limits.length > 0 ? Math.min(...limits) : null;

    return {
      ...r,
      weight_kg: weightKg.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toNumber(),
      line_usd_cost: lineUsdCost.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
      weight_percent: 0,
      effective_max_percent: effectiveMaxPercent,
      exceeds_limit: false,
    };
  });

  for (const item of enriched) {
    if (totalWeightKg.gt(0)) {
      item.weight_percent = new Decimal(item.weight_kg)
        .div(totalWeightKg)
        .times(100)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
        .toNumber();
      if (item.effective_max_percent !== null && item.weight_percent > item.effective_max_percent) {
        item.exceeds_limit = true;
      }
    }
  }

  return {
    items: enriched,
    totals: {
      total_weight_kg: totalWeightKg.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toNumber(),
      calculated_usd_cost: totalUsdCost.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
      ingredient_count: enriched.length,
    },
  };
}

formulasRouter.get('/lookup', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let query = db('formulas').select('id', 'name', 'calculated_usd_cost');
    if (q) query = query.where('name', 'like', `%${q}%`);
    res.json({ items: await query.orderBy('name', 'asc').limit(20) });
  } catch (err) {
    handleDbError(res, err);
  }
});

formulasRouter.get('/', async (req, res) => {
  try {
    const { page, limit, offset } = normalizePage(req.query.page);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
    const includeSubcategories = req.query.includeSubcategories === 'true';
    const tagId = req.query.tagId ? Number(req.query.tagId) : null;
    const sortBy = ['name', 'calculated_usd_cost', 'created_at'].includes(String(req.query.sortBy))
      ? String(req.query.sortBy)
      : 'name';
    const sortDir = req.query.sortDir === 'desc' ? 'desc' : 'asc';

    let base = db('formulas as f').leftJoin('categories as c', 'f.category', 'c.id');

    if (q) {
      base = base.where((qb) => {
        qb.where('f.name', 'like', `%${q}%`)
          .orWhere('f.info', 'like', `%${q}%`)
          .orWhere('f.directions', 'like', `%${q}%`);
      });
    }
    if (categoryId) {
      if (includeSubcategories) {
        base = base.whereIn('f.category', await getSubcategoryIds(categoryId));
      } else {
        base = base.where('f.category', categoryId);
      }
    }
    if (tagId) {
      base = base.whereExists(function () {
        this.select(1)
          .from('formulas_tags as ft')
          .whereRaw('ft.formula = f.id')
          .andWhere('ft.tag', tagId);
      });
    }

    const countRow = await base.clone().count<{ count: number }[]>('f.id as count').first();
    const total = Number(countRow?.count ?? 0);

    const items = await base
      .clone()
      .select('f.*', 'c.name as category_name')
      .orderBy(`f.${sortBy}`, sortDir)
      .limit(limit)
      .offset(offset);

    res.json({ items, pagination: buildPagination(page, total, limit) });
  } catch (err) {
    handleDbError(res, err);
  }
});

formulasRouter.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = await db('formulas as f')
      .leftJoin('categories as c', 'f.category', 'c.id')
      .where('f.id', id)
      .select('f.*', 'c.name as category_name')
      .first();

    if (!item) {
      res.status(404).json({ error: 'Formula not found' });
      return;
    }

    const [tags, uploads, ingredientsData] = await Promise.all([
      db('formulas_tags as ft')
        .join('tags as t', 'ft.tag', 't.id')
        .where('ft.formula', id)
        .select('t.id', 't.name'),
      db('formulas_uploads as fu')
        .join('uploads as u', 'fu.upload', 'u.id')
        .where('fu.formula', id)
        .select('u.id', 'u.original_name as name', 'u.mimetype', 'u.thumbnail_path'),
      getFormulaIngredientsWithMetrics(id),
    ]);

    res.json({
      ...item,
      tags,
      uploads,
      ingredients: ingredientsData.items,
      totals: ingredientsData.totals,
    });
  } catch (err) {
    handleDbError(res, err);
  }
});

// Exception rule: NO pagination on formula ingredients list
formulasRouter.get('/:id/ingredients', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const exists = await db('formulas').where('id', id).first();
    if (!exists) {
      res.status(404).json({ error: 'Formula not found' });
      return;
    }
    const data = await getFormulaIngredientsWithMetrics(id);
    res.json(data);
  } catch (err) {
    handleDbError(res, err);
  }
});

// Add or update single ingredient quantity in formula
formulasRouter.post('/:id/ingredients', async (req, res) => {
  try {
    const formulaId = Number(req.params.id);
    const ingredientId = Number(req.body?.ingredient);
    const quantity = new Decimal(req.body?.quantity ?? 0).toDecimalPlaces(4).toNumber();

    if (!ingredientId || quantity < 0) {
      res.status(400).json({ error: 'Valid ingredient and non-negative quantity are required' });
      return;
    }

    await db.transaction(async (trx) => {
      await trx('formulas_ingredients')
        .insert({ formula: formulaId, ingredient: ingredientId, quantity })
        .onConflict(['formula', 'ingredient'])
        .merge({ quantity });
      await recalculateFormulaCost(trx, formulaId);
    });

    const data = await getFormulaIngredientsWithMetrics(formulaId);
    res.json(data);
  } catch (err) {
    handleDbError(res, err);
  }
});

// Remove ingredient from formula
formulasRouter.delete('/:id/ingredients/:ingredientId', async (req, res) => {
  try {
    const formulaId = Number(req.params.id);
    const ingredientId = Number(req.params.ingredientId);

    await db.transaction(async (trx) => {
      await trx('formulas_ingredients')
        .where({ formula: formulaId, ingredient: ingredientId })
        .del();
      await recalculateFormulaCost(trx, formulaId);
    });

    const data = await getFormulaIngredientsWithMetrics(formulaId);
    res.json(data);
  } catch (err) {
    handleDbError(res, err);
  }
});

// Paginated relation tabs for formula detail view (tags, uploads)
formulasRouter.get('/:id/relations/:rel', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rel = req.params.rel;
    const { page, limit, offset } = normalizePage(req.query.page);

    let query;
    let countQuery;

    if (rel === 'tags') {
      query = db('formulas_tags as ft')
        .join('tags as t', 'ft.tag', 't.id')
        .where('ft.formula', id)
        .select('t.*')
        .orderBy('t.name', 'asc');
      countQuery = db('formulas_tags').where('formula', id).count<{ count: number }[]>('tag as count').first();
    } else if (rel === 'uploads') {
      query = db('formulas_uploads as fu')
        .join('uploads as u', 'fu.upload', 'u.id')
        .leftJoin('categories as c', 'u.category', 'c.id')
        .where('fu.formula', id)
        .select('u.*', 'c.name as category_name')
        .orderBy('u.created_at', 'desc');
      countQuery = db('formulas_uploads').where('formula', id).count<{ count: number }[]>('upload as count').first();
    } else if (rel === 'cost_history') {
      query = db('formula_cost_snapshots')
        .where('formula', id)
        .select('*')
        .orderBy('created_at', 'desc');
      countQuery = db('formula_cost_snapshots').where('formula', id).count<{ count: number }[]>('id as count').first();
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

formulasRouter.post('/', async (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'Formula name is required' });
      return;
    }

    const tagIds = parseIdArray(req.body?.tags);
    const uploadIds = parseIdArray(req.body?.uploads);
    const ingRows = Array.isArray(req.body?.ingredients) ? req.body.ingredients : [];

    const id = await db.transaction(async (trx) => {
      const [newId] = await trx('formulas').insert({
        name,
        category: req.body?.category ? Number(req.body.category) : 1,
        info: req.body?.info ? String(req.body.info) : null,
        directions: req.body?.directions ? String(req.body.directions) : null,
        calculated_usd_cost: 0,
      });

      if (tagIds.length > 0) {
        await trx('formulas_tags').insert(tagIds.map((tag) => ({ formula: newId, tag })));
      }
      if (uploadIds.length > 0) {
        await trx('formulas_uploads').insert(uploadIds.map((upload) => ({ formula: newId, upload })));
      }
      for (const row of ingRows) {
        const ingId = Number(row?.ingredient);
        const qty = new Decimal(row?.quantity ?? 0).toDecimalPlaces(4).toNumber();
        if (ingId > 0 && qty >= 0) {
          await trx('formulas_ingredients')
            .insert({ formula: newId, ingredient: ingId, quantity: qty })
            .onConflict(['formula', 'ingredient'])
            .merge({ quantity: qty });
        }
      }

      await recalculateFormulaCost(trx, newId);
      return newId;
    });

    res.status(201).json(await db('formulas').where('id', id).first());
  } catch (err) {
    handleDbError(res, err);
  }
});

formulasRouter.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await db('formulas').where('id', id).first();
    if (!existing) {
      res.status(404).json({ error: 'Formula not found' });
      return;
    }

    await db.transaction(async (trx) => {
      const updates: Record<string, unknown> = { updated_at: trx.fn.now() };
      if (typeof req.body?.name === 'string' && req.body.name.trim()) updates.name = req.body.name.trim();
      if (req.body?.category !== undefined) updates.category = Number(req.body.category) || 1;
      if (req.body?.info !== undefined) updates.info = req.body.info ? String(req.body.info) : null;
      if (req.body?.directions !== undefined) updates.directions = req.body.directions ? String(req.body.directions) : null;

      await trx('formulas').where('id', id).update(updates);

      if (Array.isArray(req.body?.tags)) {
        await trx('formulas_tags').where('formula', id).del();
        const tagIds = parseIdArray(req.body.tags);
        if (tagIds.length > 0) {
          await trx('formulas_tags').insert(tagIds.map((tag) => ({ formula: id, tag })));
        }
      }
      if (Array.isArray(req.body?.uploads)) {
        await trx('formulas_uploads').where('formula', id).del();
        const uploadIds = parseIdArray(req.body.uploads);
        if (uploadIds.length > 0) {
          await trx('formulas_uploads').insert(uploadIds.map((upload) => ({ formula: id, upload })));
        }
      }
      if (Array.isArray(req.body?.ingredients)) {
        await trx('formulas_ingredients').where('formula', id).del();
        for (const row of req.body.ingredients) {
          const ingId = Number(row?.ingredient);
          const qty = new Decimal(row?.quantity ?? 0).toDecimalPlaces(4).toNumber();
          if (ingId > 0 && qty >= 0) {
            await trx('formulas_ingredients')
              .insert({ formula: id, ingredient: ingId, quantity: qty })
              .onConflict(['formula', 'ingredient'])
              .merge({ quantity: qty });
          }
        }
        await recalculateFormulaCost(trx, id);
      }
    });

    res.json(await db('formulas').where('id', id).first());
  } catch (err) {
    handleDbError(res, err);
  }
});

// Clone formula
formulasRouter.post('/:id/clone', async (req, res) => {
  try {
    const sourceId = Number(req.params.id);
    const source = await db('formulas').where('id', sourceId).first();
    if (!source) {
      res.status(404).json({ error: 'Formula not found' });
      return;
    }

    const newId = await db.transaction(async (trx) => {
      let candidateName = `${source.name} (Copy)`;
      let counter = 2;
      while (await trx('formulas').where('name', candidateName).first()) {
        candidateName = `${source.name} (Copy ${counter++})`;
      }

      const [clonedId] = await trx('formulas').insert({
        name: candidateName,
        category: source.category,
        info: source.info,
        directions: source.directions,
        calculated_usd_cost: source.calculated_usd_cost,
      });

      const [tags, uploads, ingredients] = await Promise.all([
        trx('formulas_tags').where('formula', sourceId).select('tag'),
        trx('formulas_uploads').where('formula', sourceId).select('upload'),
        trx('formulas_ingredients').where('formula', sourceId).select('ingredient', 'quantity'),
      ]);

      if (tags.length > 0) {
        await trx('formulas_tags').insert(tags.map((t) => ({ formula: clonedId, tag: t.tag })));
      }
      if (uploads.length > 0) {
        await trx('formulas_uploads').insert(uploads.map((u) => ({ formula: clonedId, upload: u.upload })));
      }
      if (ingredients.length > 0) {
        await trx('formulas_ingredients').insert(
          ingredients.map((i) => ({ formula: clonedId, ingredient: i.ingredient, quantity: i.quantity }))
        );
      }

      await recalculateFormulaCost(trx, clonedId);
      return clonedId;
    });

    res.status(201).json(await db('formulas').where('id', newId).first());
  } catch (err) {
    handleDbError(res, err);
  }
});

// Export formula to CSV or Markdown
formulasRouter.get('/:id/export', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const format = req.query.format === 'md' ? 'md' : 'csv';
    const formula = await db('formulas as f')
      .leftJoin('categories as c', 'f.category', 'c.id')
      .where('f.id', id)
      .select('f.*', 'c.name as category_name')
      .first();

    if (!formula) {
      res.status(404).json({ error: 'Formula not found' });
      return;
    }

    const { items, totals } = await getFormulaIngredientsWithMetrics(id);
    const safeSlug = String(formula.name).replace(/[^a-zA-Z0-9_-]+/g, '_');

    if (format === 'md') {
      const lines = [
        `# ${formula.name}`,
        ``,
        `- **Category:** ${formula.category_name || 'uncategorized'}`,
        `- **Total Weight (kg):** ${totals.total_weight_kg}`,
        `- **Calculated Cost (USD):** $${totals.calculated_usd_cost}`,
        ``,
        formula.info ? `## Notes\n${formula.info}\n` : '',
        formula.directions ? `## Directions\n${formula.directions}\n` : '',
        `## Ingredients`,
        ``,
        `| Ingredient | Supplier | Quantity | Unit | Weight (kg) | % Weight | Line Cost (USD) |`,
        `|---|---|---:|---|---:|---:|---:|`,
        ...items.map(
          (i) =>
            `| ${i.ingredient_name} | ${i.supplier_name || '-'} | ${i.quantity} | ${i.unit_name} | ${i.weight_kg} | ${i.weight_percent}% | $${i.line_usd_cost} |`
        ),
      ];
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeSlug}.md"`);
      res.send(lines.filter((l) => l !== undefined).join('\n'));
      return;
    }

    const csvEscape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csvRows = [
      ['Ingredient', 'Supplier', 'Quantity', 'Unit', 'Equal In Kg', 'Weight (kg)', 'Weight %', 'Cost', 'Currency', 'Line Cost (USD)'].join(','),
      ...items.map((i) =>
        [
          csvEscape(i.ingredient_name),
          csvEscape(i.supplier_name || ''),
          i.quantity,
          csvEscape(i.unit_name),
          i.equal_in_kg,
          i.weight_kg,
          i.weight_percent,
          i.cost,
          csvEscape(i.currency_name),
          i.line_usd_cost,
        ].join(',')
      ),
      ['TOTAL', '', '', '', '', totals.total_weight_kg, '100', '', 'USD', totals.calculated_usd_cost].join(','),
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeSlug}.csv"`);
    res.send(csvRows.join('\n'));
  } catch (err) {
    handleDbError(res, err);
  }
});

formulasRouter.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const deleted = await db('formulas').where('id', id).del();
    if (!deleted) {
      res.status(404).json({ error: 'Formula not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    handleDbError(res, err);
  }
});
