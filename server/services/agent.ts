import Decimal from 'decimal.js';
import { db } from '../db.js';
import {
  type ChatMessageParam,
  type OpenAiToolDef,
  callChatCompletion,
  getLlmSetting,
} from './llmClient.js';
import { hybridSearch } from './rag.js';

export interface ToolTrace {
  name: string;
  arguments: Record<string, unknown>;
  summary: string;
}

export interface CitationRef {
  entity: 'formulas' | 'ingredients' | 'materials' | 'suppliers' | 'uploads';
  id: number;
  label: string;
}

const AGENT_TOOLS: OpenAiToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'hybrid_search_documents',
      description:
        'Search uploaded SDS, COA, Markdown, TXT documents and indexed catalog records using hybrid keyword + semantic search.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query text' },
          source_type: {
            type: 'string',
            enum: ['upload', 'material', 'ingredient', 'formula', 'supplier'],
            description: 'Optional filter by record type',
          },
          upload_ids: {
            type: 'array',
            items: { type: 'integer' },
            description: 'Optional list of specific upload IDs to search inside',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_catalog',
      description:
        'Search structured database tables for formulas, ingredients, materials (by name, CAS, or FEMA), or suppliers.',
      parameters: {
        type: 'object',
        properties: {
          entity: {
            type: 'string',
            enum: ['formulas', 'ingredients', 'materials', 'suppliers'],
          },
          query: { type: 'string', description: 'Name, CAS, FEMA, or keyword to match' },
        },
        required: ['entity', 'query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_formula_details',
      description:
        'Get the full breakdown of a formula including all ingredients, quantities, units, kg weights, % weights, max % warnings, USD costs, and directions.',
      parameters: {
        type: 'object',
        properties: {
          formula_id: { type: 'integer', description: 'ID of the formula' },
        },
        required: ['formula_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_attached_documents',
      description:
        'List all uploaded files (PDFs, Markdown, TXT, photos) attached to a material, ingredient, supplier, or formula.',
      parameters: {
        type: 'object',
        properties: {
          entity: {
            type: 'string',
            enum: ['material', 'ingredient', 'supplier', 'formula'],
          },
          id: { type: 'integer' },
        },
        required: ['entity', 'id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate_scaled_batch',
      description:
        'Deterministically scale a formula to a target total batch weight in kg using exact decimal arithmetic.',
      parameters: {
        type: 'object',
        properties: {
          formula_id: { type: 'integer' },
          target_weight_kg: { type: 'number', description: 'Target total weight in kilograms' },
        },
        required: ['formula_id', 'target_weight_kg'],
      },
    },
  },
];

async function executeAgentTool(
  name: string,
  args: Record<string, unknown>,
  citationsMap: Map<string, CitationRef>
): Promise<{ result: unknown; summary: string }> {
  const addCitation = (entity: CitationRef['entity'], id: number, label: string) => {
    citationsMap.set(`${entity}:${id}`, { entity, id, label });
  };

  if (name === 'hybrid_search_documents') {
    const query = String(args.query || '');
    const sourceType = typeof args.source_type === 'string' ? args.source_type : undefined;
    const uploadIds = Array.isArray(args.upload_ids)
      ? args.upload_ids.map(Number).filter((n) => n > 0)
      : undefined;

    const setting = await getLlmSetting('chat');
    const hits = await hybridSearch(query, {
      topK: Number(setting.top_k_rag) || 8,
      sourceType,
      uploadIds,
    });

    const entityMap: Record<string, CitationRef['entity']> = {
      upload: 'uploads',
      material: 'materials',
      ingredient: 'ingredients',
      formula: 'formulas',
      supplier: 'suppliers',
    };

    for (const h of hits) {
      const mapped = entityMap[h.source_type];
      if (mapped) addCitation(mapped, h.source_id, h.title);
    }

    return {
      result: hits,
      summary: `Found ${hits.length} hybrid search snippet(s) for "${query}"`,
    };
  }

  if (name === 'search_catalog') {
    const entity = String(args.entity || 'ingredients');
    const q = String(args.query || '').trim();

    if (entity === 'materials') {
      let query = db('materials as m')
        .leftJoin('categories as c', 'm.category', 'c.id')
        .select('m.id', 'm.name', 'm.CAS', 'm.FEMA', 'm.max_percent', 'm.info', 'c.name as category');
      if (q) {
        query = query.where((qb) =>
          qb
            .where('m.name', 'like', `%${q}%`)
            .orWhere('m.CAS', 'like', `%${q}%`)
            .orWhere('m.FEMA', 'like', `%${q}%`)
        );
      }
      const rows = await query.limit(15);
      rows.forEach((r) => addCitation('materials', r.id, r.name));
      return { result: rows, summary: `Matched ${rows.length} material(s)` };
    }

    if (entity === 'suppliers') {
      let query = db('suppliers').select('id', 'name', 'info');
      if (q) query = query.where('name', 'like', `%${q}%`).orWhere('info', 'like', `%${q}%`);
      const rows = await query.limit(15);
      rows.forEach((r) => addCitation('suppliers', r.id, r.name));
      return { result: rows, summary: `Matched ${rows.length} supplier(s)` };
    }

    if (entity === 'formulas') {
      let query = db('formulas as f')
        .leftJoin('categories as c', 'f.category', 'c.id')
        .select('f.id', 'f.name', 'f.calculated_usd_cost', 'f.info', 'c.name as category');
      if (q) query = query.where('f.name', 'like', `%${q}%`).orWhere('f.info', 'like', `%${q}%`);
      const rows = await query.limit(15);
      rows.forEach((r) => addCitation('formulas', r.id, r.name));
      return { result: rows, summary: `Matched ${rows.length} formula(s)` };
    }

    let query = db('ingredients as i')
      .leftJoin('suppliers as s', 'i.supplier', 's.id')
      .leftJoin('materials as m', 'i.material', 'm.id')
      .leftJoin('units as u', 'i.unit', 'u.id')
      .leftJoin('currencies as cur', 'i.currency', 'cur.id')
      .select(
        'i.id',
        'i.name',
        'i.cost',
        'i.max_percent',
        'u.name as unit',
        'u.equal_in_kg',
        'cur.name as currency',
        'cur.in_usd',
        's.name as supplier',
        'm.name as material'
      );
    if (q) {
      query = query.where((qb) =>
        qb
          .where('i.name', 'like', `%${q}%`)
          .orWhere('m.name', 'like', `%${q}%`)
          .orWhere('s.name', 'like', `%${q}%`)
      );
    }
    const rows = await query.limit(15);
    rows.forEach((r) => addCitation('ingredients', r.id, r.name));
    return { result: rows, summary: `Matched ${rows.length} ingredient(s)` };
  }

  if (name === 'get_formula_details') {
    const formulaId = Number(args.formula_id);
    const formula = await db('formulas as f')
      .leftJoin('categories as c', 'f.category', 'c.id')
      .where('f.id', formulaId)
      .select('f.*', 'c.name as category_name')
      .first();
    if (!formula) return { result: { error: 'Formula not found' }, summary: 'Formula not found' };

    addCitation('formulas', formula.id, formula.name);

    const rows = await db('formulas_ingredients as fi')
      .join('ingredients as i', 'fi.ingredient', 'i.id')
      .leftJoin('materials as m', 'i.material', 'm.id')
      .leftJoin('units as un', 'i.unit', 'un.id')
      .leftJoin('currencies as cur', 'i.currency', 'cur.id')
      .leftJoin('suppliers as s', 'i.supplier', 's.id')
      .where('fi.formula', formulaId)
      .select(
        'i.id as ingredient_id',
        'i.name as ingredient_name',
        'fi.quantity',
        'un.name as unit_name',
        'un.equal_in_kg',
        'i.cost',
        'cur.name as currency_name',
        'cur.in_usd',
        's.name as supplier_name',
        'i.max_percent as ingredient_max_percent',
        'm.max_percent as material_max_percent'
      );

    let totalKg = new Decimal(0);
    const items = rows.map((r) => {
      const qty = new Decimal(r.quantity ?? 0);
      const wKg = qty.times(r.equal_in_kg ?? 1);
      const lineUsd = qty.times(r.cost ?? 0).times(r.in_usd ?? 0);
      totalKg = totalKg.plus(wKg);
      addCitation('ingredients', r.ingredient_id, r.ingredient_name);
      return {
        ...r,
        weight_kg: wKg.toDecimalPlaces(6).toNumber(),
        line_usd_cost: lineUsd.toDecimalPlaces(4).toNumber(),
      };
    });

    const withPercent = items.map((item) => {
      const pct = totalKg.gt(0)
        ? new Decimal(item.weight_kg).div(totalKg).times(100).toDecimalPlaces(2).toNumber()
        : 0;
      const limits = [item.ingredient_max_percent, item.material_max_percent]
        .filter((v) => v !== null && v !== undefined)
        .map(Number);
      const maxPct = limits.length > 0 ? Math.min(...limits) : null;
      return {
        ...item,
        weight_percent: pct,
        effective_max_percent: maxPct,
        exceeds_limit: maxPct !== null && pct > maxPct,
      };
    });

    return {
      result: {
        formula,
        total_weight_kg: totalKg.toDecimalPlaces(6).toNumber(),
        ingredients: withPercent,
      },
      summary: `Loaded formula "${formula.name}" (${withPercent.length} ingredients)`,
    };
  }

  if (name === 'get_attached_documents') {
    const entity = String(args.entity || '');
    const id = Number(args.id);
    let rows: any[] = [];

    if (entity === 'material') {
      rows = await db('materials_uploads as mu')
        .join('uploads as u', 'mu.upload', 'u.id')
        .where('mu.material', id)
        .select('u.id', 'u.original_name', 'u.mimetype', 'u.ingested', 'u.notes');
    } else if (entity === 'ingredient') {
      rows = await db('ingredients_uploads as iu')
        .join('uploads as u', 'iu.upload', 'u.id')
        .where('iu.ingredient', id)
        .select('u.id', 'u.original_name', 'u.mimetype', 'u.ingested', 'u.notes');
    } else if (entity === 'supplier') {
      rows = await db('suppliers_uploads as su')
        .join('uploads as u', 'su.upload', 'u.id')
        .where('su.supplier', id)
        .select('u.id', 'u.original_name', 'u.mimetype', 'u.ingested', 'u.notes');
    } else if (entity === 'formula') {
      rows = await db('formulas_uploads as fu')
        .join('uploads as u', 'fu.upload', 'u.id')
        .where('fu.formula', id)
        .select('u.id', 'u.original_name', 'u.mimetype', 'u.ingested', 'u.notes');
    }

    rows.forEach((r) => addCitation('uploads', r.id, r.original_name));
    return {
      result: rows,
      summary: `Found ${rows.length} attached document(s) on ${entity} #${id}`,
    };
  }

  if (name === 'calculate_scaled_batch') {
    const formulaId = Number(args.formula_id);
    const targetKg = new Decimal(Number(args.target_weight_kg || 0));
    if (targetKg.lte(0)) {
      return { result: { error: 'target_weight_kg must be > 0' }, summary: 'Invalid batch target' };
    }

    const formula = await db('formulas').where('id', formulaId).first();
    if (!formula) return { result: { error: 'Formula not found' }, summary: 'Formula not found' };
    addCitation('formulas', formula.id, formula.name);

    const rows = await db('formulas_ingredients as fi')
      .join('ingredients as i', 'fi.ingredient', 'i.id')
      .leftJoin('units as un', 'i.unit', 'un.id')
      .leftJoin('currencies as cur', 'i.currency', 'cur.id')
      .where('fi.formula', formulaId)
      .select(
        'i.id as ingredient_id',
        'i.name as ingredient_name',
        'fi.quantity',
        'un.name as unit_name',
        'un.equal_in_kg',
        'i.cost',
        'cur.in_usd'
      );

    let currentTotalKg = new Decimal(0);
    for (const r of rows) {
      currentTotalKg = currentTotalKg.plus(new Decimal(r.quantity ?? 0).times(r.equal_in_kg ?? 1));
    }

    if (currentTotalKg.lte(0)) {
      return {
        result: { error: 'Formula has zero base weight and cannot be scaled.' },
        summary: 'Cannot scale empty formula',
      };
    }

    const factor = targetKg.div(currentTotalKg);
    let scaledUsdTotal = new Decimal(0);

    const scaledItems = rows.map((r) => {
      const scaledQty = new Decimal(r.quantity ?? 0).times(factor);
      const scaledKg = scaledQty.times(r.equal_in_kg ?? 1);
      const scaledCostUsd = scaledQty.times(r.cost ?? 0).times(r.in_usd ?? 0);
      scaledUsdTotal = scaledUsdTotal.plus(scaledCostUsd);
      addCitation('ingredients', r.ingredient_id, r.ingredient_name);
      return {
        ingredient_id: r.ingredient_id,
        ingredient_name: r.ingredient_name,
        unit: r.unit_name,
        original_quantity: Number(r.quantity),
        scaled_quantity: scaledQty.toDecimalPlaces(4).toNumber(),
        scaled_weight_kg: scaledKg.toDecimalPlaces(4).toNumber(),
        scaled_usd_cost: scaledCostUsd.toDecimalPlaces(4).toNumber(),
      };
    });

    return {
      result: {
        formula_name: formula.name,
        base_weight_kg: currentTotalKg.toDecimalPlaces(4).toNumber(),
        target_weight_kg: targetKg.toDecimalPlaces(4).toNumber(),
        scale_factor: factor.toDecimalPlaces(6).toNumber(),
        scaled_total_usd_cost: scaledUsdTotal.toDecimalPlaces(4).toNumber(),
        ingredients: scaledItems,
      },
      summary: `Scaled "${formula.name}" to ${targetKg.toNumber()} kg ($${scaledUsdTotal.toDecimalPlaces(4).toNumber()} USD)`,
    };
  }

  return { result: { error: `Unknown tool: ${name}` }, summary: `Unknown tool ${name}` };
}

function tryParseFallbackToolCall(
  text: string
): { name: string; arguments: Record<string, unknown> } | null {
  const match = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/(\{[\s\S]*"tool"[\s\S]*\})/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as { tool?: string; arguments?: Record<string, unknown> };
    if (parsed.tool && typeof parsed.tool === 'string') {
      return { name: parsed.tool, arguments: parsed.arguments || {} };
    }
  } catch {
    return null;
  }
  return null;
}

export async function runAgentTurn(params: {
  sessionId: number;
  userMessage: string;
  onEvent: (event: { type: string; data: unknown }) => void;
}): Promise<{
  assistantText: string;
  toolTraces: ToolTrace[];
  citations: CitationRef[];
}> {
  const session = await db('chat_sessions').where('id', params.sessionId).first();
  if (!session) throw new Error('Chat session not found');

  const history = await db('chat_messages')
    .where('session_id', params.sessionId)
    .orderBy('id', 'asc')
    .limit(20);

  let scopeNote = '';
  if (session.scope_entity && session.scope_id) {
    scopeNote = `\nActive Focus Record: ${session.scope_entity} #${session.scope_id}. Prioritize inspecting this record and its attached documents when relevant.`;
  }

  const systemPrompt = `You are FormuLab Assistant, an expert formulation chemist and catalog analyst helping a single user query their local SQLite formulation database and uploaded documents (SDS, COA, Markdown, TXT).

Rules:
1. Always rely on the provided tools to inspect real database values and document snippets. Never fabricate CAS numbers, costs, weights, or safety notes.
2. Always use calculate_scaled_batch for batch scaling math rather than doing mental arithmetic.
3. Cite records using clickable wiki-style tokens when mentioning specific records:
   [[formulas:ID|Name]], [[ingredients:ID|Name]], [[materials:ID|Name]], [[suppliers:ID|Name]], [[uploads:ID|Filename]]
   Only cite IDs returned by your tools.
4. Keep answers clear, structured, and concise.${scopeNote}`;

  const messages: ChatMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: params.userMessage },
  ];

  const toolTraces: ToolTrace[] = [];
  const citationsMap = new Map<string, CitationRef>();

  // Up to 5 tool-calling iterations before final streamed answer
  for (let step = 0; step < 5; step++) {
    let response;
    try {
      response = await callChatCompletion({
        messages,
        tools: AGENT_TOOLS,
        stream: false,
      });
    } catch (err) {
      // If a local server rejects `tools` parameter, retry once without `tools` using ReAct instructions
      if (step === 0) {
        messages[0] = {
          role: 'system',
          content:
            systemPrompt +
            `\n\nIf you need to call a tool, respond ONLY with a JSON block:\n\`\`\`json\n{"tool": "hybrid_search_documents", "arguments": {"query": "..."}}\n\`\`\`\nAvailable tools: hybrid_search_documents, search_catalog, get_formula_details, get_attached_documents, calculate_scaled_batch.`,
        };
        response = await callChatCompletion({ messages, stream: false });
      } else {
        throw err;
      }
    }

    if (response.tool_calls && response.tool_calls.length > 0) {
      messages.push({
        role: 'assistant',
        content: response.content || null,
        tool_calls: response.tool_calls,
      });

      for (const tc of response.tool_calls) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments || '{}');
        } catch {
          parsedArgs = {};
        }
        const { result, summary } = await executeAgentTool(
          tc.function.name,
          parsedArgs,
          citationsMap
        );
        const trace: ToolTrace = { name: tc.function.name, arguments: parsedArgs, summary };
        toolTraces.push(trace);
        params.onEvent({ type: 'tool', data: trace });

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: JSON.stringify(result),
        });
      }
      continue;
    }

    // Check JSON fallback tool call
    const fallback = tryParseFallbackToolCall(response.content);
    if (fallback && step < 4) {
      const { result, summary } = await executeAgentTool(
        fallback.name,
        fallback.arguments,
        citationsMap
      );
      const trace: ToolTrace = { name: fallback.name, arguments: fallback.arguments, summary };
      toolTraces.push(trace);
      params.onEvent({ type: 'tool', data: trace });

      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: `Tool ${fallback.name} result:\n${JSON.stringify(result)}\nNow continue or provide the final answer.`,
      });
      continue;
    }

    // Final text ready — stream or emit directly
    const finalText = response.content || '';
    for (const chunk of finalText.match(/.{1,40}/gs) || [finalText]) {
      params.onEvent({ type: 'token', data: chunk });
    }

    return {
      assistantText: finalText,
      toolTraces,
      citations: [...citationsMap.values()],
    };
  }

  // After max tool steps, stream final synthesis without tools
  let streamedText = '';
  await callChatCompletion({
    messages,
    stream: true,
    onToken: (tok) => {
      streamedText += tok;
      params.onEvent({ type: 'token', data: tok });
    },
  });

  return {
    assistantText: streamedText,
    toolTraces,
    citations: [...citationsMap.values()],
  };
}
