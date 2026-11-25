import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { db } from '../db.js';

export type LlmRole = 'chat' | 'embedding';

export interface LlmSettingRow {
  role: LlmRole;
  provider_preset: string;
  base_url: string;
  api_key_encrypted: string | null;
  model: string;
  dimensions: number | null;
  temperature: number;
  max_tokens: number;
  top_k_rag: number;
  updated_at: string;
}

export interface PublicLlmSetting {
  role: LlmRole;
  provider_preset: string;
  base_url: string;
  has_api_key: boolean;
  model: string;
  dimensions: number | null;
  temperature: number;
  max_tokens: number;
  top_k_rag: number;
  updated_at: string;
}

function getLocalSecretKey(): Buffer {
  if (process.env.LLM_SECRET) {
    return crypto.createHash('sha256').update(process.env.LLM_SECRET).digest();
  }
  const keyPath = path.join(DATA_DIR, '.llm_key');
  if (fs.existsSync(keyPath)) {
    const hex = fs.readFileSync(keyPath, 'utf8').trim();
    if (hex.length === 64) {
      return Buffer.from(hex, 'hex');
    }
  }
  const generated = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, generated.toString('hex'), { mode: 0o600 });
  return generated;
}

export function encryptApiKey(plaintext: string): string {
  const key = getLocalSecretKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptApiKey(stored: string | null): string | null {
  if (!stored) return null;
  const parts = stored.split(':');
  if (parts.length !== 3) return null;
  try {
    const key = getLocalSecretKey();
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const encrypted = Buffer.from(parts[2], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

export function validateLlmBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid LLM Base URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('LLM Base URL must use http:// or https://');
  }
  // Block cloud metadata endpoint while allowing local desktop servers (127.0.0.1, localhost, LAN)
  if (parsed.hostname === '169.254.169.254') {
    throw new Error('Forbidden LLM Base URL host');
  }
  return trimmed;
}

export async function getLlmSetting(role: LlmRole): Promise<LlmSettingRow> {
  const row = await db('llm_settings').where('role', role).first();
  if (!row) {
    throw new Error(`Missing LLM settings for role: ${role}`);
  }
  return row as LlmSettingRow;
}

export async function getPublicLlmSettings(): Promise<{
  chat: PublicLlmSetting;
  embedding: PublicLlmSetting;
}> {
  const rows = (await db('llm_settings').select('*')) as LlmSettingRow[];
  const toPublic = (r: LlmSettingRow): PublicLlmSetting => ({
    role: r.role,
    provider_preset: r.provider_preset,
    base_url: r.base_url,
    has_api_key: Boolean(r.api_key_encrypted),
    model: r.model,
    dimensions: r.dimensions,
    temperature: Number(r.temperature),
    max_tokens: Number(r.max_tokens),
    top_k_rag: Number(r.top_k_rag),
    updated_at: r.updated_at,
  });

  const chat = rows.find((r) => r.role === 'chat')!;
  const embedding = rows.find((r) => r.role === 'embedding')!;
  return { chat: toPublic(chat), embedding: toPublic(embedding) };
}

function buildHeaders(apiKey: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

export async function fetchProviderModels(baseUrl: string, apiKey: string | null): Promise<string[]> {
  const safeUrl = validateLlmBaseUrl(baseUrl);
  const res = await fetch(`${safeUrl}/models`, {
    headers: buildHeaders(apiKey),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Provider returned ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  if (Array.isArray(json.data)) {
    return json.data.map((m) => String(m.id || '')).filter(Boolean);
  }
  return [];
}

export async function generateEmbedding(
  input: string,
  override?: { base_url?: string; api_key?: string | null; model?: string; dimensions?: number | null }
): Promise<{ vector: Float32Array; dimensions: number }> {
  const setting = await getLlmSetting('embedding');
  const baseUrl = validateLlmBaseUrl(override?.base_url || setting.base_url);
  const apiKey =
    override?.api_key !== undefined ? override.api_key : decryptApiKey(setting.api_key_encrypted);
  const model = (override?.model !== undefined ? override.model : setting.model).trim();
  const dimensions =
    override?.dimensions !== undefined ? override.dimensions : setting.dimensions;

  const payload: Record<string, unknown> = {
    input,
    model: model || 'default',
  };
  if (dimensions && Number(dimensions) > 0) {
    payload.dimensions = Number(dimensions);
  }

  const res = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Embedding error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const raw = json?.data?.[0]?.embedding;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('Embedding endpoint returned an empty vector');
  }

  const targetDims = dimensions && Number(dimensions) > 0 ? Number(dimensions) : raw.length;
  const sliced = raw.length > targetDims ? raw.slice(0, targetDims) : raw;
  const vector = Float32Array.from(sliced);

  // L2-normalize so cosine similarity reduces to fast dot product
  let normSq = 0;
  for (let i = 0; i < vector.length; i++) {
    normSq += vector[i] * vector[i];
  }
  const norm = Math.sqrt(normSq);
  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] /= norm;
    }
  }

  return { vector, dimensions: vector.length };
}

export interface ChatMessageParam {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface OpenAiToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export async function callChatCompletion(params: {
  messages: ChatMessageParam[];
  tools?: OpenAiToolDef[];
  stream?: boolean;
  onToken?: (token: string) => void;
}): Promise<{
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}> {
  const setting = await getLlmSetting('chat');
  const baseUrl = validateLlmBaseUrl(setting.base_url);
  const apiKey = decryptApiKey(setting.api_key_encrypted);

  const body: Record<string, unknown> = {
    model: setting.model || 'local-model',
    messages: params.messages,
    temperature: Number(setting.temperature ?? 0.2),
    max_tokens: Number(setting.max_tokens ?? 2048),
    stream: Boolean(params.stream),
  };

  if (params.tools && params.tools.length > 0) {
    body.tools = params.tools;
    body.tool_choice = 'auto';
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Chat LLM error (${res.status}): ${errText.slice(0, 300)}`);
  }

  if (!params.stream || !res.body) {
    const json = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            type: 'function';
            function: { name: string; arguments: string };
          }>;
        };
      }>;
    };
    const msg = json.choices?.[0]?.message;
    return {
      content: msg?.content || '',
      tool_calls: msg?.tool_calls,
    };
  }

  // Parse SSE stream
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullContent = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(dataStr) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
          params.onToken?.(delta);
        }
      } catch {
        // ignore partial JSON chunks
      }
    }
  }

  return { content: fullContent };
}
