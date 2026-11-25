import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(
  process.env.DATA_DIR || path.join(process.cwd(), 'data')
);

export const DB_PATH = path.join(DATA_DIR, 'app.db');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const THUMBS_DIR = path.join(DATA_DIR, 'thumbs');
export const TMP_DIR = path.join(DATA_DIR, 'tmp');

export function ensureDataDirectories(): void {
  for (const dir of [DATA_DIR, UPLOADS_DIR, THUMBS_DIR, TMP_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export function resolveConfinedPath(baseDir: string, relativePath: string): string | null {
  const normalizedBase = path.resolve(baseDir);
  const resolved = path.resolve(normalizedBase, relativePath);
  if (!resolved.startsWith(normalizedBase + path.sep)) {
    return null;
  }
  return resolved;
}
