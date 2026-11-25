import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  RefreshCw,
  Save,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { apiFetch } from '../lib/api';

interface LlmConfig {
  role: 'chat' | 'embedding';
  provider_preset: string;
  base_url: string;
  has_api_key: boolean;
  model: string;
  dimensions: number | null;
  temperature: number;
  max_tokens: number;
  top_k_rag: number;
}

interface RagStatus {
  totalUploads: number;
  ingestedUploads: number;
  totalChunks: number;
  vectorChunks: number;
  dimensionMismatch: boolean;
  indexMeta: {
    provider_preset: string | null;
    model: string | null;
    dimensions: number | null;
    updated_at: string;
  } | null;
}

const PRESETS: Record<string, { label: string; chatUrl: string; embUrl: string }> = {
  lmstudio: {
    label: 'LM Studio',
    chatUrl: 'http://127.0.0.1:1234/v1',
    embUrl: 'http://127.0.0.1:1234/v1',
  },
  llamacpp: {
    label: 'llama.cpp (llama-server)',
    chatUrl: 'http://127.0.0.1:8080/v1',
    embUrl: 'http://127.0.0.1:8080/v1',
  },
  ollama: {
    label: 'Ollama',
    chatUrl: 'http://127.0.0.1:11434/v1',
    embUrl: 'http://127.0.0.1:11434/v1',
  },
  openai: {
    label: 'OpenAI',
    chatUrl: 'https://api.openai.com/v1',
    embUrl: 'https://api.openai.com/v1',
  },
  custom: {
    label: 'Custom OpenAI-Compatible',
    chatUrl: 'http://127.0.0.1:8000/v1',
    embUrl: 'http://127.0.0.1:8000/v1',
  },
};

function ProviderCard({
  role,
  config,
  onSaved,
}: {
  role: 'chat' | 'embedding';
  config: LlmConfig;
  onSaved: () => void;
}) {
  const [preset, setPreset] = useState(config.provider_preset);
  const [baseUrl, setBaseUrl] = useState(config.base_url);
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [model, setModel] = useState(config.model);
  const [dimensions, setDimensions] = useState<string>(
    config.dimensions ? String(config.dimensions) : '768'
  );
  const [temperature, setTemperature] = useState(String(config.temperature ?? 0.2));
  const [maxTokens, setMaxTokens] = useState(String(config.max_tokens ?? 2048));
  const [topK, setTopK] = useState(String(config.top_k_rag ?? 8));

  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setPreset(config.provider_preset);
    setBaseUrl(config.base_url);
    setModel(config.model);
    if (config.dimensions) setDimensions(String(config.dimensions));
    setTemperature(String(config.temperature ?? 0.2));
    setMaxTokens(String(config.max_tokens ?? 2048));
    setTopK(String(config.top_k_rag ?? 8));
  }, [config]);

  const applyPreset = (nextPreset: string) => {
    setPreset(nextPreset);
    const info = PRESETS[nextPreset];
    if (info) {
      setBaseUrl(role === 'chat' ? info.chatUrl : info.embUrl);
    }
  };

  const handleFetchModels = async () => {
    setStatusMsg(null);
    try {
      const res = await apiFetch<{ models: string[] }>('/api/llm/models', {
        method: 'POST',
        body: JSON.stringify({
          role,
          base_url: baseUrl,
          api_key: apiKey.trim() || undefined,
        }),
      });
      setDiscoveredModels(res.models || []);
      if (res.models.length > 0 && !model) {
        setModel(res.models[0]);
      }
      setStatusMsg({
        ok: true,
        text: `Discovered ${res.models.length} model(s) from endpoint.`,
      });
    } catch (err) {
      setStatusMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to fetch models',
      });
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setStatusMsg(null);
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>(`/api/llm/test/${role}`, {
        method: 'POST',
        body: JSON.stringify({
          base_url: baseUrl,
          api_key: apiKey.trim() || undefined,
          model,
          dimensions: role === 'embedding' ? Number(dimensions) : undefined,
        }),
      });
      setStatusMsg({ ok: true, text: res.message });
    } catch (err) {
      setStatusMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Connection test failed',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusMsg(null);
    try {
      const payload: Record<string, unknown> = {
        provider_preset: preset,
        base_url: baseUrl,
        model,
        temperature: Number(temperature),
        max_tokens: Number(maxTokens),
        top_k_rag: Number(topK),
      };
      if (role === 'embedding') {
        payload.dimensions = dimensions ? Number(dimensions) : null;
      }
      if (apiKey.trim()) {
        payload.api_key = apiKey.trim();
      } else if (clearApiKey) {
        payload.clear_api_key = true;
      }

      await apiFetch(`/api/llm/settings/${role}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setApiKey('');
      setClearApiKey(false);
      setStatusMsg({ ok: true, text: 'Settings saved.' });
      onSaved();
    } catch (err) {
      setStatusMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to save settings',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSave}
      className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-4"
    >
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {role === 'chat' ? 'Chat LLM Provider' : 'Embedding LLM Provider'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {role === 'chat'
              ? 'Used by the Agentic Assistant for reasoning, tool calls, and answers'
              : 'Used to generate vector embeddings for uploaded PDFs, Markdown, TXT, and catalog items'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            Provider Preset
          </label>
          <select
            value={preset}
            onChange={(e) => applyPreset(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
          >
            {Object.entries(PRESETS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            OpenAI-Compatible Base URL
          </label>
          <input
            type="url"
            required
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://127.0.0.1:1234/v1"
            className="w-full px-3 py-2 text-sm font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Model ID
            </label>
            <button
              type="button"
              onClick={handleFetchModels}
              className="text-xs text-teal-600 dark:text-teal-400 hover:underline"
            >
              Fetch Models
            </button>
          </div>
          {discoveredModels.length > 0 ? (
            <div className="flex gap-1.5">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="">Select discovered model...</option>
                {discoveredModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={
                role === 'chat' ? 'e.g. qwen2.5-14b-instruct' : 'e.g. nomic-embed-text-v1.5'
              }
              className="w-full px-3 py-2 text-sm font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
              API Key (optional for local servers)
            </label>
            {config.has_api_key && (
              <label className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                <input
                  type="checkbox"
                  checked={clearApiKey}
                  onChange={(e) => setClearApiKey(e.target.checked)}
                />
                <span>Clear saved key</span>
              </label>
            )}
          </div>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              config.has_api_key ? '•••••••• (saved on server — enter to replace)' : 'Optional Bearer key'
            }
            className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
          />
        </div>
      </div>

      {role === 'embedding' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Embedding Dimensions
            </label>
            <input
              type="number"
              min={32}
              max={8192}
              required
              value={dimensions}
              onChange={(e) => setDimensions(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Common values: 384, 768 (Nomic/BGE), 1024, 1536, 3072.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Temperature
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Max Tokens
            </label>
            <input
              type="number"
              min="128"
              max="32768"
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Hybrid RAG Top-K
            </label>
            <input
              type="number"
              min="1"
              max="25"
              value={topK}
              onChange={(e) => setTopK(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
        </div>
      )}

      {statusMsg && (
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-md border text-xs ${
            statusMsg.ok
              ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
              : 'border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300'
          }`}
        >
          {statusMsg.ok ? (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          )}
          <span>{statusMsg.text}</span>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
        <button
          type="button"
          disabled={testing}
          onClick={handleTest}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
        >
          <Wrench className="w-3.5 h-3.5" />
          <span>{testing ? 'Testing...' : 'Test Connection'}</span>
        </button>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" />
          <span>{saving ? 'Saving...' : 'Save Settings'}</span>
        </button>
      </div>
    </form>
  );
}

export function LlmSettingsView() {
  const [settings, setSettings] = useState<{ chat: LlmConfig; embedding: LlmConfig } | null>(null);
  const [ragStatus, setRagStatus] = useState<RagStatus | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexNotice, setIndexNotice] = useState<string | null>(null);

  const loadAll = async () => {
    const [llmRes, ragRes] = await Promise.all([
      apiFetch<{ settings: { chat: LlmConfig; embedding: LlmConfig } }>('/api/llm/settings'),
      apiFetch<RagStatus>('/api/rag/status'),
    ]);
    setSettings(llmRes.settings);
    setRagStatus(ragRes);
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleIngestPending = async () => {
    setIndexing(true);
    setIndexNotice(null);
    try {
      const res = await apiFetch<{ processed: number; catalog: { entitiesIndexed: number } }>(
        '/api/rag/ingest-pending',
        { method: 'POST' }
      );
      setIndexNotice(
        `Processed ${res.processed} pending upload(s) and indexed ${res.catalog.entitiesIndexed} catalog records.`
      );
      await loadAll();
    } catch (err) {
      setIndexNotice(err instanceof Error ? err.message : 'Indexing failed');
    } finally {
      setIndexing(false);
    }
  };

  const handleReindexAll = async () => {
    setIndexing(true);
    setIndexNotice(null);
    try {
      const res = await apiFetch<{
        uploadsProcessed: number;
        entitiesIndexed: number;
        vectorsGenerated: number;
      }>('/api/rag/reindex-all', { method: 'POST' });
      setIndexNotice(
        `Re-indexed ${res.uploadsProcessed} upload(s) and ${res.entitiesIndexed} catalog records (${res.vectorsGenerated} vector embeddings generated).`
      );
      await loadAll();
    } catch (err) {
      setIndexNotice(err instanceof Error ? err.message : 'Re-index failed');
    } finally {
      setIndexing(false);
    }
  };

  if (!settings || !ragStatus) {
    return (
      <div className="py-12 text-sm text-slate-500 dark:text-slate-400">
        Loading LLM & Hybrid RAG configuration...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          LLM & Hybrid RAG Settings
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Configure local (LM Studio, llama.cpp, Ollama) or cloud providers for chat and vector embeddings
        </p>
      </div>

      {/* RAG Index Status Panel */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Database className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                SQLite Hybrid Index (FTS5 BM25 + Vector)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                Uploads indexed: {ragStatus.ingestedUploads}/{ragStatus.totalUploads} · Total chunks:{' '}
                {ragStatus.totalChunks} · Vector chunks: {ragStatus.vectorChunks}
                {ragStatus.indexMeta?.dimensions
                  ? ` · Active dims: ${ragStatus.indexMeta.dimensions}`
                  : ''}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={indexing}
              onClick={handleIngestPending}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{indexing ? 'Working...' : 'Ingest Pending & Sync Catalog'}</span>
            </button>
            <button
              type="button"
              disabled={indexing}
              onClick={handleReindexAll}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${indexing ? 'animate-spin' : ''}`} />
              <span>Re-index All</span>
            </button>
          </div>
        </div>

        {ragStatus.dimensionMismatch && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              Embedding dimension mismatch: existing vectors were indexed at{' '}
              {ragStatus.indexMeta?.dimensions} dimensions, while your current setting is{' '}
              {settings.embedding.dimensions}. Click "Re-index All" to rebuild vectors cleanly.
            </span>
          </div>
        )}

        {indexNotice && (
          <div className="px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-700 dark:text-slate-300">
            {indexNotice}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ProviderCard role="chat" config={settings.chat} onSaved={loadAll} />
        <ProviderCard role="embedding" config={settings.embedding} onSaved={loadAll} />
      </div>
    </div>
  );
}
