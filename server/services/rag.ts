import fs from 'node:fs';
import { UPLOADS_DIR, resolveConfinedPath } from '../config.js';
import { db } from '../db.js';
import { generateEmbedding, getLlmSetting } from './llmClient.js';

interface TextSegment {
  pageNumber: number | null;
  sectionTitle: string | null;
  text: string;
}

interface ChunkDraft {
  chunkIndex: number;
  pageNumber: number | null;
  sectionTitle: string | null;
  content: string;
  tokenCount: number;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function chunkSegments(segments: TextSegment[], maxChars = 1600, overlap = 240): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];
  let idx = 0;

  for (const seg of segments) {
    const clean = seg.text.replace(/\r\n/g, '\n').trim();
    if (!clean) continue;

    if (clean.length <= maxChars) {
      chunks.push({
        chunkIndex: idx++,
        pageNumber: seg.pageNumber,
        sectionTitle: seg.sectionTitle,
        content: clean,
        tokenCount: estimateTokens(clean),
      });
      continue;
    }

    let start = 0;
    while (start < clean.length) {
      let end = Math.min(clean.length, start + maxChars);
      if (end < clean.length) {
        const lastBreak = Math.max(
          clean.lastIndexOf('\n\n', end),
          clean.lastIndexOf('. ', end),
          clean.lastIndexOf(' ', end)
        );
        if (lastBreak > start + maxChars * 0.5) {
          end = lastBreak + 1;
        }
      }

      const slice = clean.slice(start, end).trim();
      if (slice) {
        chunks.push({
          chunkIndex: idx++,
          pageNumber: seg.pageNumber,
          sectionTitle: seg.sectionTitle,
          content: slice,
          tokenCount: estimateTokens(slice),
        });
      }

      if (end >= clean.length) break;
      start = Math.max(0, end - overlap);
    }
  }

  return chunks;
}

async function extractPdfSegments(filePath: string): Promise<TextSegment[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const buf = fs.readFileSync(filePath);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: true,
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;
  const segments: TextSegment[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const strings = content.items
      .map((item: unknown) => {
        if (item && typeof item === 'object' && 'str' in item) {
          return String((item as { str: string }).str);
        }
        return '';
      })
      .filter(Boolean);
    const pageText = strings.join(' ').replace(/\s+/g, ' ').trim();
    if (pageText) {
      segments.push({ pageNumber: p, sectionTitle: `Page ${p}`, text: pageText });
    }
  }
  return segments;
}

function extractMarkdownSegments(text: string): TextSegment[] {
  const lines = text.split(/\r?\n/);
  const segments: TextSegment[] = [];
  let currentHeading: string | null = null;
  let buffer: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,4}\s+(.+)$/);
    if (headingMatch) {
      if (buffer.join('\n').trim()) {
        segments.push({
          pageNumber: null,
          sectionTitle: currentHeading,
          text: buffer.join('\n').trim(),
        });
      }
      currentHeading = headingMatch[1].trim();
      buffer = [line];
    } else {
      buffer.push(line);
    }
  }

  if (buffer.join('\n').trim()) {
    segments.push({
      pageNumber: null,
      sectionTitle: currentHeading,
      text: buffer.join('\n').trim(),
    });
  }

  return segments;
}

async function deleteChunksForSource(sourceType: string, sourceId: number): Promise<void> {
  const oldIds = await db('rag_chunks')
    .where({ source_type: sourceType, source_id: sourceId })
    .pluck('id');
  if (oldIds.length > 0) {
    await db('rag_fts').whereIn('chunk_id', oldIds).del();
    await db('rag_chunks').whereIn('id', oldIds).del();
  }
}

async function insertChunkWithIndex(params: {
  sourceType: string;
  sourceId: number;
  chunkIndex: number;
  title: string;
  metadataText: string;
  pageNumber: number | null;
  sectionTitle: string | null;
  content: string;
  tokenCount: number;
  embedding: Float32Array | null;
  dimensions: number | null;
}): Promise<void> {
  const embBuffer = params.embedding
    ? Buffer.from(params.embedding.buffer, params.embedding.byteOffset, params.embedding.byteLength)
    : null;

  const [chunkId] = await db('rag_chunks').insert({
    source_type: params.sourceType,
    source_id: params.sourceId,
    chunk_index: params.chunkIndex,
    title: params.title,
    metadata_text: params.metadataText,
    page_number: params.pageNumber,
    section_title: params.sectionTitle,
    content: params.content,
    token_count: params.tokenCount,
    dimensions: params.dimensions,
    embedding: embBuffer,
  });

  await db('rag_fts').insert({
    chunk_id: chunkId,
    title: params.title,
    metadata_text: params.metadataText,
    content: params.content,
  });
}

async function updateRagIndexMeta(dimensions: number | null): Promise<void> {
  const embSetting = await getLlmSetting('embedding');
  await db('rag_index_meta')
    .insert({
      id: 1,
      provider_preset: embSetting.provider_preset,
      base_url: embSetting.base_url,
      model: embSetting.model,
      dimensions: dimensions ?? embSetting.dimensions,
    })
    .onConflict('id')
    .merge({
      provider_preset: embSetting.provider_preset,
      base_url: embSetting.base_url,
      model: embSetting.model,
      dimensions: dimensions ?? embSetting.dimensions,
      updated_at: db.fn.now(),
    });
}

export async function ingestUpload(uploadId: number): Promise<{
  uploadId: number;
  chunksIndexed: number;
  vectorsGenerated: number;
  warning?: string;
}> {
  const upload = await db('uploads as u')
    .leftJoin('categories as c', 'u.category', 'c.id')
    .where('u.id', uploadId)
    .select('u.*', 'c.name as category_name')
    .first();

  if (!upload) {
    throw new Error('Upload not found');
  }

  await db('uploads')
    .where('id', uploadId)
    .update({ ingestion_status: 'processing', ingestion_error: null });

  try {
    const filePath = resolveConfinedPath(UPLOADS_DIR, upload.stored_path);
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error('Uploaded file missing from storage');
    }

    const mime = String(upload.mimetype || '').toLowerCase();
    const ext = String(upload.extension || '').toLowerCase();

    let segments: TextSegment[] = [];
    if (mime === 'application/pdf' || ext === 'pdf') {
      segments = await extractPdfSegments(filePath);
    } else if (
      mime.startsWith('text/') ||
      mime.includes('markdown') ||
      ext === 'md' ||
      ext === 'markdown' ||
      ext === 'txt'
    ) {
      const rawText = fs.readFileSync(filePath, 'utf8');
      segments = extractMarkdownSegments(rawText);
    } else if (mime.startsWith('image/')) {
      segments = [
        {
          pageNumber: null,
          sectionTitle: 'Image Metadata',
          text: `Image file: ${upload.original_name}. Category: ${upload.category_name || 'uncategorized'}. Notes: ${upload.notes || 'None'}.`,
        },
      ];
    }

    const tags = await db('uploads_tags as ut')
      .join('tags as t', 'ut.tag', 't.id')
      .where('ut.upload', uploadId)
      .pluck('t.name');

    const metadataText = [
      upload.original_name,
      upload.category_name || '',
      upload.notes || '',
      ...tags,
    ]
      .filter(Boolean)
      .join(' ');

    const chunks = chunkSegments(segments);
    if (chunks.length === 0) {
      chunks.push({
        chunkIndex: 0,
        pageNumber: null,
        sectionTitle: 'Metadata',
        content: `Document: ${upload.original_name}. ${upload.notes || ''}`.trim(),
        tokenCount: 10,
      });
    }

    await deleteChunksForSource('upload', uploadId);

    const embSetting = await getLlmSetting('embedding');
    const shouldTryEmbed = Boolean(embSetting.base_url);
    let vectorsGenerated = 0;
    let actualDimensions: number | null = null;
    let warning: string | undefined;

    for (const c of chunks) {
      let embedding: Float32Array | null = null;
      let dims: number | null = null;

      if (shouldTryEmbed) {
        try {
          const embRes = await generateEmbedding(
            `${upload.original_name}\n${c.sectionTitle ? c.sectionTitle + '\n' : ''}${c.content}`
          );
          embedding = embRes.vector;
          dims = embRes.dimensions;
          actualDimensions = dims;
          vectorsGenerated++;
        } catch (err) {
          warning = `Indexed text for keyword search (FTS5), but embedding server was unreachable: ${(err as Error).message}`;
        }
      }

      await insertChunkWithIndex({
        sourceType: 'upload',
        sourceId: uploadId,
        chunkIndex: c.chunkIndex,
        title: upload.original_name,
        metadataText,
        pageNumber: c.pageNumber,
        sectionTitle: c.sectionTitle,
        content: c.content,
        tokenCount: c.tokenCount,
        embedding,
        dimensions: dims,
      });
    }

    if (actualDimensions) {
      await updateRagIndexMeta(actualDimensions);
    }

    await db('uploads')
      .where('id', uploadId)
      .update({
        ingested: 1,
        ingestion_status: 'indexed',
        ingestion_error: warning || null,
        updated_at: db.fn.now(),
      });

    return {
      uploadId,
      chunksIndexed: chunks.length,
      vectorsGenerated,
      warning,
    };
  } catch (err) {
    const msg = (err as Error).message;
    await db('uploads')
      .where('id', uploadId)
      .update({
        ingestion_status: 'error',
        ingestion_error: msg,
        updated_at: db.fn.now(),
      });
    throw err;
  }
}

export async function indexCatalogEntities(): Promise<{ entitiesIndexed: number; vectorsGenerated: number }> {
  const embSetting = await getLlmSetting('embedding');
  let entitiesIndexed = 0;
  let vectorsGenerated = 0;
  let actualDimensions: number | null = null;

  const embedSafe = async (text: string) => {
    if (!embSetting.base_url) return { vector: null, dimensions: null };
    try {
      const res = await generateEmbedding(text);
      actualDimensions = res.dimensions;
      vectorsGenerated++;
      return res;
    } catch {
      return { vector: null, dimensions: null };
    }
  };

  // Materials
  const materials = await db('materials as m')
    .leftJoin('categories as c', 'm.category', 'c.id')
    .select('m.*', 'c.name as category_name');
  for (const m of materials) {
    const content = `Material: ${m.name}. Category: ${m.category_name || 'uncategorized'}. CAS: ${m.CAS || 'N/A'}. FEMA: ${m.FEMA || 'N/A'}. Max %: ${m.max_percent ?? 'N/A'}. Notes: ${m.info || 'None'}.`;
    await deleteChunksForSource('material', m.id);
    const { vector, dimensions } = await embedSafe(content);
    await insertChunkWithIndex({
      sourceType: 'material',
      sourceId: m.id,
      chunkIndex: 0,
      title: m.name,
      metadataText: `${m.CAS || ''} ${m.FEMA || ''} ${m.category_name || ''}`.trim(),
      pageNumber: null,
      sectionTitle: 'Material Record',
      content,
      tokenCount: estimateTokens(content),
      embedding: vector,
      dimensions,
    });
    entitiesIndexed++;
  }

  // Suppliers
  const suppliers = await db('suppliers').select('*');
  for (const s of suppliers) {
    const content = `Supplier: ${s.name}. Info: ${s.info || 'None'}.`;
    await deleteChunksForSource('supplier', s.id);
    const { vector, dimensions } = await embedSafe(content);
    await insertChunkWithIndex({
      sourceType: 'supplier',
      sourceId: s.id,
      chunkIndex: 0,
      title: s.name,
      metadataText: 'supplier',
      pageNumber: null,
      sectionTitle: 'Supplier Record',
      content,
      tokenCount: estimateTokens(content),
      embedding: vector,
      dimensions,
    });
    entitiesIndexed++;
  }

  // Ingredients
  const ingredients = await db('ingredients as i')
    .leftJoin('categories as c', 'i.category', 'c.id')
    .leftJoin('materials as m', 'i.material', 'm.id')
    .leftJoin('suppliers as s', 'i.supplier', 's.id')
    .leftJoin('units as u', 'i.unit', 'u.id')
    .leftJoin('currencies as cur', 'i.currency', 'cur.id')
    .select(
      'i.*',
      'c.name as category_name',
      'm.name as material_name',
      'm.CAS',
      'm.FEMA',
      's.name as supplier_name',
      'u.name as unit_name',
      'u.equal_in_kg',
      'cur.name as currency_name'
    );
  for (const i of ingredients) {
    const content = `Ingredient: ${i.name}. Category: ${i.category_name || ''}. Material: ${i.material_name || 'N/A'} (CAS: ${i.CAS || 'N/A'}, FEMA: ${i.FEMA || 'N/A'}). Supplier: ${i.supplier_name || 'N/A'}. Cost: ${i.cost} ${i.currency_name || 'USD'} per ${i.unit_name || 'kg'} (${i.equal_in_kg ?? 1} kg). Max %: ${i.max_percent ?? 'N/A'}. Notes: ${i.info || 'None'}.`;
    await deleteChunksForSource('ingredient', i.id);
    const { vector, dimensions } = await embedSafe(content);
    await insertChunkWithIndex({
      sourceType: 'ingredient',
      sourceId: i.id,
      chunkIndex: 0,
      title: i.name,
      metadataText: `${i.CAS || ''} ${i.FEMA || ''} ${i.supplier_name || ''} ${i.material_name || ''}`.trim(),
      pageNumber: null,
      sectionTitle: 'Ingredient Record',
      content,
      tokenCount: estimateTokens(content),
      embedding: vector,
      dimensions,
    });
    entitiesIndexed++;
  }

  // Formulas
  const formulas = await db('formulas as f')
    .leftJoin('categories as c', 'f.category', 'c.id')
    .select('f.*', 'c.name as category_name');
  for (const f of formulas) {
    const ings = await db('formulas_ingredients as fi')
      .join('ingredients as i', 'fi.ingredient', 'i.id')
      .leftJoin('units as u', 'i.unit', 'u.id')
      .where('fi.formula', f.id)
      .select('i.name', 'fi.quantity', 'u.name as unit_name');
    const ingSummary = ings.map((r) => `${r.name}: ${r.quantity} ${r.unit_name}`).join('; ');
    const content = `Formula: ${f.name}. Category: ${f.category_name || ''}. Calculated Cost: $${f.calculated_usd_cost} USD. Ingredients: ${ingSummary || 'None'}. Info: ${f.info || 'None'}. Directions: ${f.directions || 'None'}.`;
    await deleteChunksForSource('formula', f.id);
    const { vector, dimensions } = await embedSafe(content);
    await insertChunkWithIndex({
      sourceType: 'formula',
      sourceId: f.id,
      chunkIndex: 0,
      title: f.name,
      metadataText: `${f.category_name || ''} ${ingSummary}`.trim(),
      pageNumber: null,
      sectionTitle: 'Formula Record',
      content,
      tokenCount: estimateTokens(content),
      embedding: vector,
      dimensions,
    });
    entitiesIndexed++;
  }

  if (actualDimensions) {
    await updateRagIndexMeta(actualDimensions);
  }

  return { entitiesIndexed, vectorsGenerated };
}

export async function reindexAllDocuments(): Promise<{
  uploadsProcessed: number;
  entitiesIndexed: number;
  vectorsGenerated: number;
}> {
  await db('rag_fts').del();
  await db('rag_chunks').del();
  await db('uploads').update({
    ingested: 0,
    ingestion_status: 'pending',
    ingestion_error: null,
  });

  const uploads = await db('uploads').select('id').orderBy('id', 'asc');
  let vectorsGenerated = 0;
  for (const u of uploads) {
    try {
      const res = await ingestUpload(u.id);
      vectorsGenerated += res.vectorsGenerated;
    } catch {
      // individual upload error recorded on row
    }
  }

  const catalog = await indexCatalogEntities();
  vectorsGenerated += catalog.vectorsGenerated;

  return {
    uploadsProcessed: uploads.length,
    entitiesIndexed: catalog.entitiesIndexed,
    vectorsGenerated,
  };
}

function buildSafeFtsQuery(raw: string): string {
  const tokens = raw
    .replace(/[^\p{L}\p{N}_-]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 12);
  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
}

export interface HybridSearchHit {
  chunk_id: number;
  source_type: string;
  source_id: number;
  title: string;
  page_number: number | null;
  section_title: string | null;
  content: string;
  score: number;
  match_sources: ('fts' | 'vector')[];
}

export async function hybridSearch(
  query: string,
  opts?: {
    topK?: number;
    sourceType?: string;
    uploadIds?: number[];
  }
): Promise<HybridSearchHit[]> {
  const topK = opts?.topK || 8;
  const ftsRankMap = new Map<number, number>();
  const vecRankMap = new Map<number, number>();

  // 1. Lexical FTS5 BM25
  const safeFts = buildSafeFtsQuery(query);
  if (safeFts) {
    try {
      let ftsQuery = db('rag_fts as f')
        .join('rag_chunks as c', 'f.chunk_id', 'c.id')
        .whereRaw('rag_fts MATCH ?', [safeFts])
        .select('c.id', db.raw('bm25(rag_fts) as rank_score'))
        .orderBy('rank_score', 'asc')
        .limit(25);

      if (opts?.sourceType) {
        ftsQuery = ftsQuery.where('c.source_type', opts.sourceType);
      }
      if (opts?.uploadIds && opts.uploadIds.length > 0) {
        ftsQuery = ftsQuery.where('c.source_type', 'upload').whereIn('c.source_id', opts.uploadIds);
      }

      const ftsRows = await ftsQuery;
      ftsRows.forEach((row, index) => {
        ftsRankMap.set(Number(row.id), index + 1);
      });
    } catch {
      // Fallback safely if FTS query cannot be parsed
    }
  }

  // 2. Semantic Vector Cosine Search
  try {
    const embSetting = await getLlmSetting('embedding');
    if (embSetting.base_url) {
      const { vector: queryVec, dimensions } = await generateEmbedding(query);
      let vecQuery = db('rag_chunks')
        .whereNotNull('embedding')
        .andWhere('dimensions', dimensions)
        .select('id', 'embedding');

      if (opts?.sourceType) {
        vecQuery = vecQuery.where('source_type', opts.sourceType);
      }
      if (opts?.uploadIds && opts.uploadIds.length > 0) {
        vecQuery = vecQuery.where('source_type', 'upload').whereIn('source_id', opts.uploadIds);
      }

      const candidates = await vecQuery;
      const scored: Array<{ id: number; sim: number }> = [];

      for (const row of candidates) {
        const buf = row.embedding as Buffer;
        if (!buf || buf.byteLength !== dimensions * 4) continue;
        const vec = new Float32Array(buf.buffer, buf.byteOffset, dimensions);
        let dot = 0;
        for (let i = 0; i < dimensions; i++) {
          dot += queryVec[i] * vec[i];
        }
        scored.push({ id: Number(row.id), sim: dot });
      }

      scored.sort((a, b) => b.sim - a.sim);
      scored.slice(0, 25).forEach((entry, index) => {
        vecRankMap.set(entry.id, index + 1);
      });
    }
  } catch {
    // Graceful fallback to FTS-only if embedding server is offline
  }

  // 3. Reciprocal Rank Fusion (RRF, k = 60)
  const candidateIds = new Set<number>([...ftsRankMap.keys(), ...vecRankMap.keys()]);
  if (candidateIds.size === 0) return [];

  const rrfScores = new Map<number, { score: number; sources: ('fts' | 'vector')[] }>();
  for (const id of candidateIds) {
    let score = 0;
    const sources: ('fts' | 'vector')[] = [];
    const ftsRank = ftsRankMap.get(id);
    if (ftsRank !== undefined) {
      score += 1 / (60 + ftsRank);
      sources.push('fts');
    }
    const vecRank = vecRankMap.get(id);
    if (vecRank !== undefined) {
      score += 1 / (60 + vecRank);
      sources.push('vector');
    }
    rrfScores.set(id, { score, sources });
  }

  const topIds = [...rrfScores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, topK)
    .map(([id]) => id);

  const rows = await db('rag_chunks')
    .whereIn('id', topIds)
    .select('id', 'source_type', 'source_id', 'title', 'page_number', 'section_title', 'content');

  const rowMap = new Map(rows.map((r) => [Number(r.id), r]));

  return topIds
    .map((id) => {
      const r = rowMap.get(id);
      const meta = rrfScores.get(id)!;
      if (!r) return null;
      return {
        chunk_id: Number(r.id),
        source_type: r.source_type,
        source_id: Number(r.source_id),
        title: r.title,
        page_number: r.page_number ? Number(r.page_number) : null,
        section_title: r.section_title || null,
        content: r.content,
        score: Number(meta.score.toFixed(6)),
        match_sources: meta.sources,
      };
    })
    .filter((x): x is HybridSearchHit => x !== null);
}
