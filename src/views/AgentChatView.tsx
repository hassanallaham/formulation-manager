import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bot, Plus, Send, Settings, Trash2, User, Wrench } from 'lucide-react';
import { apiFetch, getAuthToken } from '../lib/api';
import type { EntityType, RouteTarget } from '../types';

interface ChatSession {
  id: number;
  title: string;
  scope_entity: string | null;
  scope_id: number | null;
  updated_at: string;
}

interface Citation {
  entity: EntityType;
  id: number;
  label: string;
}

interface ToolTrace {
  name: string;
  arguments: Record<string, unknown>;
  summary: string;
}

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  toolTraces?: ToolTrace[];
  citations?: Citation[];
}

interface AgentChatViewProps {
  initialScope?: { entity: EntityType; id: number; name: string } | null;
  onClearInitialScope: () => void;
  onNavigate: (target: RouteTarget) => void;
}

function renderMessageWithCitations(
  text: string,
  onNavigate: (target: RouteTarget) => void
) {
  const regex = /\[\[(formulas|ingredients|materials|suppliers|uploads):(\d+)\|([^\]]+)\]\]/g;
  const parts: Array<string | { entity: EntityType; id: number; label: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push({
      entity: match[1] as EntityType,
      id: Number(match[2]),
      label: match[3],
    });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.map((part, idx) => {
    if (typeof part === 'string') {
      return <span key={idx}>{part}</span>;
    }
    return (
      <button
        key={idx}
        type="button"
        onClick={() => onNavigate({ entity: part.entity, id: part.id })}
        className="inline font-medium text-teal-600 dark:text-teal-400 hover:underline underline-offset-2 mx-0.5"
      >
        {part.label}
      </button>
    );
  });
}

export function AgentChatView({
  initialScope,
  onClearInitialScope,
  onNavigate,
}: AgentChatViewProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [liveTools, setLiveTools] = useState<ToolTrace[]>([]);
  const [liveStreamText, setLiveStreamText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadSessions = async () => {
    const res = await apiFetch<{ items: ChatSession[] }>('/api/chat/sessions');
    setSessions(res.items || []);
    return res.items || [];
  };

  const loadMessages = async (sessionId: number) => {
    const res = await apiFetch<{
      session: ChatSession;
      messages: Array<{
        id: number;
        role: 'user' | 'assistant';
        content: string;
        tool_calls_json: string | null;
        citations_json: string | null;
      }>;
    }>(`/api/chat/sessions/${sessionId}`);

    setActiveSession(res.session);
    setMessages(
      res.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        toolTraces: m.tool_calls_json ? JSON.parse(m.tool_calls_json) : [],
        citations: m.citations_json ? JSON.parse(m.citations_json) : [],
      }))
    );
  };

  useEffect(() => {
    (async () => {
      const list = await loadSessions();
      if (initialScope) {
        const created = await apiFetch<ChatSession>('/api/chat/sessions', {
          method: 'POST',
          body: JSON.stringify({
            title: `About: ${initialScope.name}`,
            scope_entity: initialScope.entity,
            scope_id: initialScope.id,
          }),
        });
        onClearInitialScope();
        await loadSessions();
        setActiveSessionId(created.id);
        await loadMessages(created.id);
      } else if (list.length > 0 && !activeSessionId) {
        setActiveSessionId(list[0].id);
        await loadMessages(list[0].id);
      }
    })();
  }, [initialScope]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, liveStreamText, liveTools]);

  const handleNewChat = async () => {
    const created = await apiFetch<ChatSession>('/api/chat/sessions', {
      method: 'POST',
      body: JSON.stringify({ title: 'New Formulation Chat' }),
    });
    await loadSessions();
    setActiveSessionId(created.id);
    await loadMessages(created.id);
  };

  const handleDeleteSession = async (id: number) => {
    await apiFetch(`/api/chat/sessions/${id}`, { method: 'DELETE' });
    const remaining = await loadSessions();
    if (activeSessionId === id) {
      if (remaining.length > 0) {
        setActiveSessionId(remaining[0].id);
        await loadMessages(remaining[0].id);
      } else {
        setActiveSessionId(null);
        setActiveSession(null);
        setMessages([]);
      }
    }
  };

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || streaming) return;

    setError(null);
    let sessionId = activeSessionId;
    if (!sessionId) {
      const created = await apiFetch<ChatSession>('/api/chat/sessions', {
        method: 'POST',
        body: JSON.stringify({ title: input.trim().slice(0, 60) }),
      });
      sessionId = created.id;
      setActiveSessionId(sessionId);
      setActiveSession(created);
    }

    const userText = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { id: Date.now(), role: 'user', content: userText }]);
    setStreaming(true);
    setLiveTools([]);
    setLiveStreamText('');

    try {
      const token = getAuthToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Requested-With': 'FormuLab',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ content: userText }),
      });

      if (!res.ok || !res.body) {
        throw new Error('Failed to start agent stream');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';

        for (const block of blocks) {
          const lines = block.split('\n');
          let eventType = 'message';
          let dataLine = '';
          for (const l of lines) {
            if (l.startsWith('event:')) eventType = l.slice(6).trim();
            if (l.startsWith('data:')) dataLine += l.slice(5).trim();
          }
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine);

          if (eventType === 'tool') {
            setLiveTools((prev) => [...prev, payload]);
          } else if (eventType === 'token') {
            setLiveStreamText((prev) => prev + String(payload));
          } else if (eventType === 'error') {
            setError(payload.error || 'Agent error');
          }
        }
      }

      await loadSessions();
      await loadMessages(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to communicate with agent');
    } finally {
      setStreaming(false);
      setLiveTools([]);
      setLiveStreamText('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Agentic Formulation Assistant
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Queries SQLite catalog records, attached SDS/Markdown documents (FTS5 + Vector), and runs exact batch scaling
          </p>
        </div>

        <button
          type="button"
          onClick={() => onNavigate({ entity: 'llm-settings' })}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <Settings className="w-3.5 h-3.5" />
          <span>LLM & Embedding Settings</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-[620px]">
        {/* Session List */}
        <div className="lg:col-span-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={handleNewChat}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md bg-teal-600 hover:bg-teal-500 text-white"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Chat</span>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70">
            {sessions.length === 0 ? (
              <div className="p-4 text-xs text-slate-500 dark:text-slate-400">
                No conversations yet.
              </div>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => {
                    setActiveSessionId(s.id);
                    loadMessages(s.id);
                  }}
                  className={`flex items-center justify-between gap-2 px-3 py-2.5 cursor-pointer transition-colors ${
                    activeSessionId === s.id
                      ? 'bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{s.title}</div>
                    {s.scope_entity && s.scope_id && (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                        {s.scope_entity} #{s.scope_id}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSession(s.id);
                    }}
                    className="p-1 text-slate-400 hover:text-rose-500 shrink-0"
                    title="Delete chat"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Chat Area */}
        <div className="lg:col-span-9 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 flex flex-col overflow-hidden">
          {activeSession?.scope_entity && activeSession?.scope_id && (
            <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex items-center justify-between text-xs">
              <span className="text-slate-600 dark:text-slate-400">
                Scoped to{' '}
                <button
                  type="button"
                  onClick={() =>
                    onNavigate({
                      entity: activeSession.scope_entity as EntityType,
                      id: activeSession.scope_id!,
                    })
                  }
                  className="font-medium text-teal-600 dark:text-teal-400 hover:underline"
                >
                  {activeSession.scope_entity} #{activeSession.scope_id}
                </button>
              </span>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && !streaming ? (
              <div className="py-12 text-center max-w-lg mx-auto space-y-2">
                <Bot className="w-8 h-8 text-teal-600 dark:text-teal-400 mx-auto" />
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  Ask about formulas, ingredients, supplier prices, or uploaded SDS/Markdown docs
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Examples: &ldquo;Scale Formula #1 to 25 kg&rdquo; · &ldquo;Which ingredients use Vanillin?&rdquo; · &ldquo;Check safety notes in attached PDFs&rdquo;
                </p>
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="space-y-2">
                  <div className="flex items-start gap-2.5">
                    <div className="w-6 h-6 rounded border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0 mt-0.5 bg-slate-50 dark:bg-slate-950">
                      {m.role === 'user' ? (
                        <User className="w-3.5 h-3.5 text-slate-500" />
                      ) : (
                        <Bot className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 space-y-2">
                      {m.toolTraces && m.toolTraces.length > 0 && (
                        <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-2">
                          {m.toolTraces.map((t, idx) => (
                            <div key={idx} className="flex items-center gap-1.5 font-mono text-[11px]">
                              <Wrench className="w-3 h-3 shrink-0" />
                              <span>{t.summary}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                        {renderMessageWithCitations(m.content, onNavigate)}
                      </div>
                      {m.citations && m.citations.length > 0 && (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs text-slate-500 dark:text-slate-400">
                          <span>Sources:</span>
                          {m.citations.map((c, idx) => (
                            <span key={`${c.entity}:${c.id}`} className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => onNavigate({ entity: c.entity, id: c.id })}
                                className="text-teal-600 dark:text-teal-400 hover:underline font-medium"
                              >
                                {c.label}
                              </button>
                              {idx < m.citations!.length - 1 && <span aria-hidden="true">·</span>}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}

            {streaming && (
              <div className="flex items-start gap-2.5">
                <div className="w-6 h-6 rounded border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0 mt-0.5 bg-slate-50 dark:bg-slate-950">
                  <Bot className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                </div>
                <div className="flex-1 space-y-2">
                  {liveTools.map((t, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-1.5 font-mono text-[11px] text-slate-500 dark:text-slate-400"
                    >
                      <Wrench className="w-3 h-3 shrink-0" />
                      <span>{t.summary}</span>
                    </div>
                  ))}
                  <div className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                    {liveStreamText ? renderMessageWithCitations(liveStreamText, onNavigate) : 'Thinking...'}
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 rounded-md border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
                {error}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={handleSend}
            className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2 bg-slate-50/70 dark:bg-slate-950/40"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask your local or cloud LLM agent..."
              disabled={streaming}
              className="flex-1 px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
