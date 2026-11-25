import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { TMP_DIR, resolveConfinedPath } from '../config.js';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

export const systemRouter = Router();

systemRouter.get('/health', (_req, res) => {
  res.json({ ok: true });
});

systemRouter.get('/stats', requireAuth, async (_req, res) => {
  try {
    const tables = [
      'formulas',
      'ingredients',
      'materials',
      'suppliers',
      'uploads',
      'categories',
      'tags',
      'units',
      'currencies',
    ] as const;

    const results = await Promise.all(
      tables.map(async (table) => {
        const row = await db(table).count<{ count: number }[]>('id as count').first();
        return [table, Number(row?.count ?? 0)] as const;
      })
    );

    res.json(Object.fromEntries(results));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

systemRouter.get('/backup', requireAuth, async (_req, res) => {
  const backupName = `formulab-backup-${crypto.randomUUID()}.db`;
  const backupPath = resolveConfinedPath(TMP_DIR, backupName);
  if (!backupPath) {
    res.status(500).json({ error: 'Failed to prepare backup path' });
    return;
  }

  try {
    await db.raw('VACUUM INTO ?', [backupPath]);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/x-sqlite3');
    res.setHeader('Content-Disposition', `attachment; filename="formulab-${stamp}.db"`);

    const stream = fs.createReadStream(backupPath);
    stream.on('close', () => {
      try {
        if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      } catch {
        // ignore cleanup
      }
    });
    stream.pipe(res);
  } catch (err) {
    if (fs.existsSync(backupPath)) {
      try {
        fs.unlinkSync(backupPath);
      } catch {
        // ignore
      }
    }
    res.status(500).json({ error: (err as Error).message });
  }
});
