import type { Response } from 'express';

export function handleDbError(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);

  if (message.includes('UNIQUE constraint failed')) {
    res.status(409).json({ error: 'A record with this unique value already exists.' });
    return;
  }
  if (message.includes('FOREIGN KEY constraint failed')) {
    res.status(409).json({
      error: 'Cannot complete operation because this record is referenced by other records.',
    });
    return;
  }
  if (
    message.includes('Circular category loop') ||
    message.includes('Cannot delete default') ||
    message.includes('CHECK constraint failed')
  ) {
    res.status(400).json({ error: message });
    return;
  }

  console.error('Database error:', err);
  res.status(500).json({ error: message || 'Internal server error' });
}
