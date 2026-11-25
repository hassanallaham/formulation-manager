import Decimal from 'decimal.js';
import type { Knex } from 'knex';

export async function recalculateFormulaCost(
  trx: Knex.Transaction | Knex,
  formulaId: number,
  reason = 'ingredient_update'
): Promise<string> {
  const existingFormula = await trx('formulas')
    .where('id', formulaId)
    .select('calculated_usd_cost')
    .first();

  const rows = await trx('formulas_ingredients as fi')
    .join('ingredients as i', 'fi.ingredient', 'i.id')
    .join('currencies as c', 'i.currency', 'c.id')
    .where('fi.formula', formulaId)
    .select('fi.quantity', 'i.cost', 'c.in_usd');

  let total = new Decimal(0);
  for (const row of rows) {
    const qty = new Decimal(row.quantity ?? 0);
    const cost = new Decimal(row.cost ?? 0);
    const inUsd = new Decimal(row.in_usd ?? 0);
    total = total.plus(qty.times(cost).times(inUsd));
  }

  const rounded = total.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();

  await trx('formulas')
    .where('id', formulaId)
    .update({
      calculated_usd_cost: rounded,
      updated_at: trx.fn.now(),
    });

  if (existingFormula && Number(existingFormula.calculated_usd_cost) !== rounded) {
    await trx('formula_cost_snapshots').insert({
      formula: formulaId,
      calculated_usd_cost: rounded,
      reason,
    });
  }

  return total.toFixed(4);
}

export async function recalculateFormulasForIngredient(
  trx: Knex.Transaction | Knex,
  ingredientId: number
): Promise<void> {
  const rows = await trx('formulas_ingredients')
    .where('ingredient', ingredientId)
    .distinct('formula')
    .select('formula');

  for (const row of rows) {
    await recalculateFormulaCost(trx, row.formula, 'ingredient_price_change');
  }
}

export async function recalculateFormulasForCurrency(
  trx: Knex.Transaction | Knex,
  currencyId: number
): Promise<void> {
  const rows = await trx('formulas_ingredients as fi')
    .join('ingredients as i', 'fi.ingredient', 'i.id')
    .where('i.currency', currencyId)
    .distinct('fi.formula')
    .select('fi.formula');

  for (const row of rows) {
    await recalculateFormulaCost(trx, row.formula, 'currency_rate_change');
  }
}
