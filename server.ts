import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express from 'express';
import { initDatabase } from './server/migrations.js';
import { authRouter } from './server/routes/auth.js';
import { currenciesRouter, materialsRouter, suppliersRouter, unitsRouter } from './server/routes/catalog.js';
import { formulasRouter } from './server/routes/formulas.js';
import { ingredientsRouter } from './server/routes/ingredients.js';
import { systemRouter } from './server/routes/system.js';
import { categoriesRouter, tagsRouter } from './server/routes/taxonomy.js';
import { uploadsRouter } from './server/routes/uploads.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer(): Promise<void> {
  await initDatabase();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());

  // API Routes
  app.use('/api/auth', authRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/tags', tagsRouter);
  app.use('/api/uploads', uploadsRouter);
  app.use('/api/materials', materialsRouter);
  app.use('/api/suppliers', suppliersRouter);
  app.use('/api/currencies', currenciesRouter);
  app.use('/api/units', unitsRouter);
  app.use('/api/ingredients', ingredientsRouter);
  app.use('/api/formulas', formulasRouter);
  app.use('/api/system', systemRouter);

  // Multer & API error handler
  app.use('/api', (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : 'Unexpected server error';
    res.status(400).json({ error: message });
  });

  const isProd = process.env.NODE_ENV === 'production';
  const distDir = process.env.STATIC_DIR || path.resolve(__dirname, 'dist');

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';

  app.listen(port, host, () => {
    console.log(`FormuLab server listening on http://${host}:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start FormuLab server:', err);
  process.exit(1);
});
