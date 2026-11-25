import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { apiFetch } from '../lib/api';

export interface ComboboxOption {
  id: number;
  name: string;
  [key: string]: unknown;
}

interface AsyncComboboxProps {
  endpoint: string;
  placeholder?: string;
  value?: ComboboxOption | null;
  values?: ComboboxOption[];
  multiple?: boolean;
  nullable?: boolean;
  extraParams?: Record<string, string | number | boolean | undefined>;
  onChangeSingle?: (item: ComboboxOption | null) => void;
  onChangeMultiple?: (items: ComboboxOption[]) => void;
  formatOption?: (item: ComboboxOption) => string;
}

export function AsyncCombobox({
  endpoint,
  placeholder = 'Type to search...',
  value = null,
  values = [],
  multiple = false,
  nullable = false,
  extraParams,
  onChangeSingle,
  onChangeMultiple,
  formatOption,
}: AsyncComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ComboboxOption[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set('q', query.trim());
        if (extraParams) {
          for (const [k, v] of Object.entries(extraParams)) {
            if (v !== undefined && v !== null) params.set(k, String(v));
          }
        }
        const data = await apiFetch<{ items: ComboboxOption[] }>(
          `${endpoint}?${params.toString()}`
        );
        if (active) setOptions(data.items || []);
      } catch {
        if (active) setOptions([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 150);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, query, endpoint, JSON.stringify(extraParams)]);

  const handleSelect = (opt: ComboboxOption) => {
    if (multiple && onChangeMultiple) {
      if (!values.some((v) => v.id === opt.id)) {
        onChangeMultiple([...values, opt]);
      }
      setQuery('');
    } else if (onChangeSingle) {
      onChangeSingle(opt);
      setOpen(false);
      setQuery('');
    }
  };

  const handleRemoveMulti = (id: number) => {
    if (onChangeMultiple) {
      onChangeMultiple(values.filter((v) => v.id !== id));
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {multiple && values.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-2 text-xs">
          {values.map((v) => (
            <span
              key={v.id}
              className="inline-flex items-center gap-1 text-slate-800 dark:text-slate-200 border-b border-slate-300 dark:border-slate-700 pb-0.5"
            >
              <span>{v.name}</span>
              <button
                type="button"
                onClick={() => handleRemoveMulti(v.id)}
                className="text-slate-400 hover:text-rose-500 transition-colors"
                aria-label={`Remove ${v.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center border border-slate-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 focus-within:ring-2 focus-within:ring-teal-500 focus-within:border-teal-500">
        <Search className="w-3.5 h-3.5 text-slate-400 ml-2.5 shrink-0" />
        <input
          type="text"
          value={open ? query : !multiple && value ? value.name : ''}
          placeholder={placeholder}
          onFocus={() => {
            setOpen(true);
            setQuery('');
          }}
          onChange={(e) => {
            setOpen(true);
            setQuery(e.target.value);
          }}
          className="w-full px-2.5 py-2 text-sm bg-transparent text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none"
        />
        {!multiple && nullable && value && (
          <button
            type="button"
            onClick={() => {
              onChangeSingle?.(null);
              setQuery('');
            }}
            className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors"
            title="Clear selection"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          aria-label="Toggle options"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
          {loading ? (
            <div className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
              Searching...
            </div>
          ) : options.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
              No matching records found
            </div>
          ) : (
            <ul className="py-1 divide-y divide-slate-100 dark:divide-slate-800/60">
              {options.map((opt) => {
                const isSelected = multiple
                  ? values.some((v) => v.id === opt.id)
                  : value?.id === opt.id;
                return (
                  <li key={opt.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(opt)}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between transition-colors ${
                        isSelected
                          ? 'bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300 font-medium'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="truncate">
                        {formatOption ? formatOption(opt) : opt.name}
                      </span>
                      {isSelected && (
                        <span className="text-xs text-teal-600 dark:text-teal-400 ml-2 shrink-0">
                          Selected
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
