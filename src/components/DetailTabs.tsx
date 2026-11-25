import { useEffect, useState } from 'react';
import { apiFetch, formatBytes, formatMoney } from '../lib/api';
import type { EntityType, PaginatedResponse, RouteTarget } from '../types';
import { EntityLink } from './EntityLink';
import { PaginationBar } from './PaginationBar';

export interface TabDefinition {
  key: string;
  label: string;
  targetEntity: EntityType;
}

interface DetailTabsProps {
  baseEndpoint: string;
  tabs: TabDefinition[];
  onNavigate: (target: RouteTarget) => void;
  refreshKey: number;
}

export function DetailTabs({
  baseEndpoint,
  tabs,
  onNavigate,
  refreshKey,
}: DetailTabsProps) {
  const [activeKey, setActiveKey] = useState<string>(tabs[0]?.key || '');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaginatedResponse<any> | null>(null);
  const [loading, setLoading] = useState(false);

  // Reset active tab when switching record or entity type
  useEffect(() => {
    setActiveKey(tabs[0]?.key || '');
    setPage(1);
  }, [baseEndpoint]);

  // Fetch only the currently active tab
  useEffect(() => {
    if (!activeKey) return;
    let active = true;
    setLoading(true);
    apiFetch<PaginatedResponse<any>>(`${baseEndpoint}/relations/${activeKey}?page=${page}`)
      .then((res) => {
        if (active) setData(res);
      })
      .catch(() => {
        if (active) setData(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [baseEndpoint, activeKey, page, refreshKey]);

  if (tabs.length === 0) return null;

  const currentTab = tabs.find((t) => t.key === activeKey) || tabs[0];

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800 px-3 pt-2 bg-slate-50/70 dark:bg-slate-950/40">
        {tabs.map((tab) => {
          const isActive = tab.key === currentTab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setActiveKey(tab.key);
                setPage(1);
              }}
              className={`px-3.5 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                isActive
                  ? 'border-teal-600 dark:border-teal-400 text-teal-700 dark:text-teal-300'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="p-4">
        {loading ? (
          <div className="py-6 text-xs text-slate-500 dark:text-slate-400">
            Loading {currentTab.label.toLowerCase()}...
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="py-6 text-xs text-slate-500 dark:text-slate-400">
            No related {currentTab.label.toLowerCase()} found.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-4 font-medium">Name</th>
                    {currentTab.targetEntity === 'uploads' && (
                      <>
                        <th className="py-2 pr-4 font-medium">Type</th>
                        <th className="py-2 pr-4 font-medium text-right">Size</th>
                      </>
                    )}
                    {currentTab.targetEntity === 'materials' && (
                      <>
                        <th className="py-2 pr-4 font-medium">CAS</th>
                        <th className="py-2 pr-4 font-medium">FEMA</th>
                      </>
                    )}
                    {currentTab.targetEntity === 'ingredients' && (
                      <>
                        <th className="py-2 pr-4 font-medium">Supplier</th>
                        <th className="py-2 pr-4 font-medium text-right">Cost</th>
                      </>
                    )}
                    {currentTab.targetEntity === 'formulas' && (
                      <th className="py-2 pr-4 font-medium text-right">Cost (USD)</th>
                    )}
                    {currentTab.targetEntity === 'categories' && (
                      <th className="py-2 pr-4 font-medium">Description</th>
                    )}
                    {currentTab.targetEntity === 'tags' && (
                      <th className="py-2 pr-4 font-medium">Description</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {data.items.map((row: any) => (
                    <tr
                      key={row.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-2.5 pr-4">
                        <EntityLink
                          entity={currentTab.targetEntity}
                          id={row.id}
                          name={row.name || row.original_name}
                          thumbnailPath={row.thumbnail_path}
                          mimetype={row.mimetype}
                          showPreview={currentTab.targetEntity === 'uploads'}
                          onNavigate={onNavigate}
                        />
                      </td>
                      {currentTab.targetEntity === 'uploads' && (
                        <>
                          <td className="py-2.5 pr-4 text-xs font-mono text-slate-600 dark:text-slate-400">
                            {row.mimetype}
                          </td>
                          <td className="py-2.5 pr-4 text-xs font-mono tabular-nums text-right text-slate-600 dark:text-slate-400">
                            {formatBytes(row.size)}
                          </td>
                        </>
                      )}
                      {currentTab.targetEntity === 'materials' && (
                        <>
                          <td className="py-2.5 pr-4 text-xs font-mono text-slate-600 dark:text-slate-400">
                            {row.CAS || '—'}
                          </td>
                          <td className="py-2.5 pr-4 text-xs font-mono text-slate-600 dark:text-slate-400">
                            {row.FEMA || '—'}
                          </td>
                        </>
                      )}
                      {currentTab.targetEntity === 'ingredients' && (
                        <>
                          <td className="py-2.5 pr-4 text-xs">
                            <EntityLink
                              entity="suppliers"
                              id={row.supplier}
                              name={row.supplier_name}
                              onNavigate={onNavigate}
                            />
                          </td>
                          <td className="py-2.5 pr-4 text-xs font-mono tabular-nums text-right text-slate-700 dark:text-slate-300">
                            {formatMoney(row.cost)} {row.currency_name || ''}
                          </td>
                        </>
                      )}
                      {currentTab.targetEntity === 'formulas' && (
                        <td className="py-2.5 pr-4 text-xs font-mono tabular-nums text-right text-slate-700 dark:text-slate-300">
                          ${formatMoney(row.calculated_usd_cost)}
                        </td>
                      )}
                      {(currentTab.targetEntity === 'categories' ||
                        currentTab.targetEntity === 'tags') && (
                        <td className="py-2.5 pr-4 text-xs text-slate-600 dark:text-slate-400 truncate max-w-md">
                          {row.description || '—'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationBar pagination={data.pagination} onPageChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
