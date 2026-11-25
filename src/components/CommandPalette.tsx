import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { EntityType, RouteTarget } from '../types';

interface SearchResult {
  entity: EntityType;
  id: number;
  name: string;
  subtitle: string;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (target: RouteTarget) => void;
}

export function CommandPalette({ open, onClose, onNavigate }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await apiFetch<{ items: SearchResult[] }>(
          `/api/search/global?q=${encodeURIComponent(query.trim())}`
        );
        if (active) setResults(res.items || []);
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 150);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-20"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to formula, ingredient, material (CAS/FEMA), supplier, upload..."
            className="w-full bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70">
          {loading ? (
            <div className="px-4 py-6 text-xs text-slate-500 dark:text-slate-400">
              Searching catalog...
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-6 text-xs text-slate-500 dark:text-slate-400">
              No matching records found.
            </div>
          ) : (
            results.map((item) => (
              <button
                key={`${item.entity}:${item.id}`}
                type="button"
                onClick={() => {
                  onNavigate({ entity: item.entity, id: item.id });
                  onClose();
                }}
                className="w-full px-4 py-2.5 text-left flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
              >
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                  {item.name}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">
                  {item.subtitle}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
