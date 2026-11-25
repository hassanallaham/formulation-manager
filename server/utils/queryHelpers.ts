import { db } from '../db.js';

export async function getSubcategoryIds(rootId: number): Promise<number[]> {
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

export function normalizePage(rawPage: unknown): { page: number; limit: number; offset: number } {
  const page = Math.max(1, Number(rawPage) || 1);
  const limit = 10;
  return { page, limit, offset: (page - 1) * limit };
}

export function buildPagination(page: number, total: number, limit = 10) {
  return {
    page,
    pageSize: limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export function parseIdArray(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}
