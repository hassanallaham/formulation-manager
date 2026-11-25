import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { runAgentTurn } from '../services/agent.js';
import {
  type LlmRole,
  decryptApiKey,
  encryptApiKey,
  fetchProviderModels,
  generateEmbedding,
  getLlmSetting,
  getPublicLlmSettings,
  validateLlmBaseUrl,
} from '../services/llmClient.js';
import {
  hybridSearch,
  indexCatalogEntities,
  ingestUpload,
  reindexAllDocuments,
} from '../services/rag.js';
import { handleDbError } from '../utils/errors.js';

export const llmRouter = Router();
llmRouter.use(requireAuth);

llmRouter.get('/settings', async (_req, res) => {
  try {
    const [settings, meta] = await Promise.all([
      getPublicLlmSettings(),
      db('rag_index_meta').where('id', 1).first(),
    ]);
    res.json({ settings, indexMeta: meta || null });
  } catch (err) {
    handleDbError(res, err);
  }
});

llmRouter.put('/settings/:role', async (req, res) => {
  try {
    const role = req.params.role as LlmRole;
    if (role !== 'chat' && role !== 'embedding') {
      res.status(400).json({ error: 'Role must be chat or embedding' });
      return;
    }

    const existing = await getLlmSetting(role);
    const baseUrl = validateLlmBaseUrl(String(req.body?.base_url || existing.base_url));
    const updates: Record<string, unknown> = {
      provider_preset: String(req.body?.provider_preset || existing.provider_preset),
      base_url: baseUrl,
      model: String(req.body?.model ?? existing.model).trim(),
      temperature:
        req.body?.temperature !== undefined ? Number(req.body.temperature) : existing.temperature,
      max_tokens:
        req.body?.max_tokens !== undefined ? Number(req.body.max_tokens) : existing.max_tokens,
      top_k_rag:
        req.body?.top_k_rag !== undefined ? Number(req.body.top_k_rag) : existing.top_k_rag,
      updated_at: db.fn.now(),
    };

    if (role === 'embedding') {
      const dims = req.body?.dimensions ? Number(req.body.dimensions) : null;
      if (dims !== null && (!Number.isInteger(dims) || dims < 32 || dims > 8192)) {
        res.status(400).json({ error: 'Dimensions must be an integer between 32 and 8192' });
        return;
      }
      updates.dimensions = dims;
    }

    if (typeof req.body?.api_key === 'string') {
      const trimmedKey = req.body.api_key.trim();
      updates.api_key_encrypted = trimmedKey ? encryptApiKey(trimmedKey) : null;
    } else if (req.body?.clear_api_key === true) {
      updates.api_key_encrypted = null;
    }

    await db('llm_settings').where('role', role).update(updates);
    res.json(await getPublicLlmSettings());
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

llmRouter.post('/models', async (req, res) => {
  try {
    const role = (req.body?.role === 'embedding' ? 'embedding' : 'chat') as LlmRole;
    const existing = await getLlmSetting(role);
    const baseUrl = String(req.body?.base_url || existing.base_url);
    const apiKey =
      typeof req.body?.api_key === 'string' && req.body.api_key.trim()
        ? req.body.api_key.trim()
        : decryptApiKey(existing.api_key_encrypted);

    const models = await fetchProviderModels(baseUrl, apiKey);
    res.json({ models });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

llmRouter.post('/test/:role', async (req, res) => {
  try {
    const role = req.params.role as LlmRole;
    if (role !== 'chat' && role !== 'embedding') {
      res.status(400).json({ error: 'Invalid role' });
      return;
    }

    const existing = await getLlmSetting(role);
    const baseUrl = String(req.body?.base_url || existing.base_url);
    const apiKey =
      typeof req.body?.api_key === 'string' && req.body.api_key.trim()
        ? req.body.api_key.trim()
        : decryptApiKey(existing.api_key_encrypted);

    const start = Date.now();
    if (role === 'embedding') {
      const dims = req.body?.dimensions ? Number(req.body.dimensions) : existing.dimensions;
      const emb = await generateEmbedding('FormuLab test embedding', {
        base_url: baseUrl,
        api_key: apiKey,
        model: req.body?.model !== undefined ? String(req.body.model) : existing.model,
        dimensions: dims,
      });
      res.json({
        ok: true,
        latencyMs: Date.now() - start,
        actualDimensions: emb.dimensions,
        message: `Embedding OK (${emb.dimensions} dims in ${Date.now() - start}ms)`,
      });
      return;
    }

    const models = await fetchProviderModels(baseUrl, apiKey);
    res.json({
      ok: true,
      latencyMs: Date.now() - start,
      modelsCount: models.length,
      message: `Connected (${models.length} model(s) discovered in ${Date.now() - start}ms)`,
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ================= RAG INDEXING & SEARCH =================
export const ragRouter = Router();
ragRouter.use(requireAuth);

ragRouter.get('/status', async (_req, res) => {
  try {
    const [totalUploads, ingestedUploads, totalChunks, vectorChunks, meta, embSetting] =
      await Promise.all([
        db('uploads').count<{ count: number }[]>('id as count').first(),
        db('uploads').where('ingested', 1).count<{ count: number }[]>('id as count').first(),
        db('rag_chunks').count<{ count: number }[]>('id as count').first(),
        db('rag_chunks').whereNotNull('embedding').count<{ count: number }[]>('id as count').first(),
        db('rag_index_meta').where('id', 1).first(),
        getLlmSetting('embedding'),
      ]);

    const dimensionMismatch =
      Boolean(meta?.dimensions) &&
      Boolean(embSetting.dimensions) &&
      Number(meta.dimensions) !== Number(embSetting.dimensions);

    res.json({
      totalUploads: Number(totalUploads?.count ?? 0),
      ingestedUploads: Number(ingestedUploads?.count ?? 0),
      totalChunks: Number(totalChunks?.count ?? 0),
      vectorChunks: Number(vectorChunks?.count ?? 0),
      indexMeta: meta || null,
      dimensionMismatch,
    });
  } catch (err) {
    handleDbError(res, err);
  }
});

ragRouter.post('/ingest/:uploadId', async (req, res) => {
  try {
    const uploadId = Number(req.params.uploadId);
    const result = await ingestUpload(uploadId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

ragRouter.post('/ingest-pending', async (_req, res) => {
  try {
    const pending = await db('uploads').where('ingested', 0).select('id');
    const results = [];
    for (const u of pending) {
      try {
        results.push(await ingestUpload(u.id));
      } catch (err) {
        results.push({ uploadId: u.id, error: (err as Error).message });
      }
    }
    const catalog = await indexCatalogEntities();
    res.json({ processed: results.length, results, catalog });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

ragRouter.post('/index-catalog', async (_req, res) => {
  try {
    const result = await indexCatalogEntities();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

ragRouter.post('/reindex-all', async (_req, res) => {
  try {
    const result = await reindexAllDocuments();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

ragRouter.post('/search', async (req, res) => {
  try {
    const query = String(req.body?.query || '').trim();
    if (!query) {
      res.status(400).json({ error: 'Search query is required' });
      return;
    }
    const hits = await hybridSearch(query, {
      topK: req.body?.topK ? Number(req.body.topK) : 8,
      sourceType: typeof req.body?.sourceType === 'string' ? req.body.sourceType : undefined,
    });
    res.json({ hits });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ================= AGENTIC CHAT =================
export const chatRouter = Router();
chatRouter.use(requireAuth);

chatRouter.get('/sessions', async (_req, res) => {
  try {
    const sessions = await db('chat_sessions').select('*').orderBy('updated_at', 'desc').limit(30);
    res.json({ items: sessions });
  } catch (err) {
    handleDbError(res, err);
  }
});

chatRouter.post('/sessions', async (req, res) => {
  try {
    const title =
      typeof req.body?.title === 'string' && req.body.title.trim()
        ? req.body.title.trim()
        : 'New Formulation Chat';
    const scopeEntity = typeof req.body?.scope_entity === 'string' ? req.body.scope_entity : null;
    const scopeId = req.body?.scope_id ? Number(req.body.scope_id) : null;

    const [id] = await db('chat_sessions').insert({
      title,
      scope_entity: scopeEntity,
      scope_id: scopeId,
    });
    res.status(201).json(await db('chat_sessions').where('id', id).first());
  } catch (err) {
    handleDbError(res, err);
  }
});

chatRouter.get('/sessions/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const session = await db('chat_sessions').where('id', id).first();
    if (!session) {
      res.status(404).json({ error: 'Chat session not found' });
      return;
    }
    const messages = await db('chat_messages').where('session_id', id).orderBy('id', 'asc');
    res.json({ session, messages });
  } catch (err) {
    handleDbError(res, err);
  }
});

chatRouter.delete('/sessions/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db('chat_sessions').where('id', id).del();
    res.json({ ok: true });
  } catch (err) {
    handleDbError(res, err);
  }
});

chatRouter.post('/sessions/:id/messages', async (req, res) => {
  const sessionId = Number(req.params.id);
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!content) {
    res.status(400).json({ error: 'Message content is required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await db('chat_messages').insert({
      session_id: sessionId,
      role: 'user',
      content,
    });

    // Update default session title on first prompt
    const countRow = await db('chat_messages')
      .where('session_id', sessionId)
      .count<{ count: number }[]>('id as count')
      .first();
    if (Number(countRow?.count ?? 0) <= 1) {
      await db('chat_sessions')
        .where('id', sessionId)
        .update({ title: content.slice(0, 60), updated_at: db.fn.now() });
    } else {
      await db('chat_sessions').where('id', sessionId).update({ updated_at: db.fn.now() });
    }

    const result = await runAgentTurn({
      sessionId,
      userMessage: content,
      onEvent: (evt) => sendEvent(evt.type, evt.data),
    });

    const [msgId] = await db('chat_messages').insert({
      session_id: sessionId,
      role: 'assistant',
      content: result.assistantText,
      tool_calls_json: JSON.stringify(result.toolTraces),
      citations_json: JSON.stringify(result.citations),
    });

    sendEvent('done', {
      messageId: msgId,
      toolTraces: result.toolTraces,
      citations: result.citations,
    });
    res.end();
  } catch (err) {
    sendEvent('error', { error: (err as Error).message });
    res.end();
  }
});

// ================= GLOBAL COMMAND PALETTE SEARCH =================
export const globalSearchRouter = Router();
globalSearchRouter.use(requireAuth);

globalSearchRouter.get('/', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const like = `%${q}%`;

    const [formulas, ingredients, materials, suppliers, uploads, categories, tags] =
      await Promise.all([
        db('formulas')
          .where('name', 'like', like)
          .select('id', 'name')
          .orderBy('name', 'asc')
          .limit(5),
        db('ingredients')
          .where('name', 'like', like)
          .select('id', 'name')
          .orderBy('name', 'asc')
          .limit(5),
        db('materials')
          .where((qb) => qb.where('name', 'like', like).orWhere('CAS', 'like', like).orWhere('FEMA', 'like', like))
          .select('id', 'name', 'CAS', 'FEMA')
          .orderBy('name', 'asc')
          .limit(5),
        db('suppliers')
          .where('name', 'like', like)
          .select('id', 'name')
          .orderBy('name', 'asc')
          .limit(4),
        db('uploads')
          .where('original_name', 'like', like)
          .select('id', 'original_name as name', 'mimetype')
          .orderBy('created_at', 'desc')
          .limit(4),
        db('categories')
          .where('name', 'like', like)
          .select('id', 'name')
          .orderBy('name', 'asc')
          .limit(4),
        db('tags')
          .where('name', 'like', like)
          .select('id', 'name')
          .orderBy('name', 'asc')
          .limit(4),
      ]);

    const results = [
      ...formulas.map((r) => ({ entity: 'formulas', id: r.id, name: r.name, subtitle: 'Formula' })),
      ...ingredients.map((r) => ({ entity: 'ingredients', id: r.id, name: r.name, subtitle: 'Ingredient' })),
      ...materials.map((r) => ({
        entity: 'materials',
        id: r.id,
        name: r.name,
        subtitle: ['Material', r.CAS ? `CAS ${r.CAS}` : '', r.FEMA ? `FEMA ${r.FEMA}` : ''].filter(Boolean).join(' · '),
      })),
      ...suppliers.map((r) => ({ entity: 'suppliers', id: r.id, name: r.name, subtitle: 'Supplier' })),
      ...uploads.map((r) => ({ entity: 'uploads', id: r.id, name: r.name, subtitle: `Upload · ${r.mimetype}` })),
      ...categories.map((r) => ({ entity: 'categories', id: r.id, name: r.name, subtitle: 'Category' })),
      ...tags.map((r) => ({ entity: 'tags', id: r.id, name: r.name, subtitle: 'Tag' })),
    ];

    res.json({ items: results });
  } catch (err) {
    handleDbError(res, err);
  }
});
