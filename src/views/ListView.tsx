import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clock,
  FolderTree,
  List,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react';
import { AsyncCombobox, type ComboboxOption } from '../components/AsyncCombobox';
import { CategoryTree } from '../components/CategoryTree';
import { EntityLink } from '../components/EntityLink';
import { PaginationBar } from '../components/PaginationBar';
import { UploadPreview } from '../components/UploadPreview';
import { apiFetch, formatBytes, formatMoney } from '../lib/api';
import type { Category, EntityType, PaginatedResponse, RouteTarget } from '../types';

interface ListViewProps {
  entity: EntityType;
  refreshKey: number;
  onNavigate: (target: RouteTarget) => void;
  onCreate: (defaultParentCategory?: Category) => void;
}

const ENTITY_TITLES: Record<EntityType, string> = {
  formulas: 'Formulas',
  ingredients: 'Ingredients',
  materials: 'Materials',
  suppliers: 'Suppliers',
  categories: 'Categories',
  tags: 'Tags',
  uploads: 'Uploads & Media',
  units: 'Units',
  currencies: 'Currencies',
};

const HAS_CATEGORY_FILTER = new Set<EntityType>([
  'formulas',
  'ingredients',
  'materials',
  'uploads',
]);

const HAS_TAG_FILTER = new Set<EntityType>([
  'formulas',
  'ingredients',
  'materials',
  'uploads',
]);

export function ListView({ entity, refreshKey, onNavigate, onCreate }: ListViewProps) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<ComboboxOption | null>(null);
  const [includeSubcategories, setIncludeSubcategories] = useState(true);
  const [tagFilter, setTagFilter] = useState<ComboboxOption | null>(null);
  const [sortBy, setSortBy] = useState<string>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [categoryViewMode, setCategoryViewMode] = useState<'list' | 'tree'>('list');

  const [data, setData] = useState<PaginatedResponse<any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ingestingPending, setIngestingPending] = useState(false);
  const [ingestBanner, setIngestBanner] = useState<string | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);

  // Reset filters/page on entity switch
  useEffect(() => {
    setPage(1);
    setQ('');
    setDebouncedQ('');
    setCategoryFilter(null);
    setTagFilter(null);
    setIngestBanner(null);
    setSortBy(entity === 'uploads' ? 'created_at' : 'name');
    setSortDir(entity === 'uploads' ? 'desc' : 'asc');
  }, [entity]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (entity === 'categories' && categoryViewMode === 'tree') return;
    let active = true;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    params.set('page', String(page));
    if (debouncedQ) params.set('q', debouncedQ);
    if (categoryFilter) {
      params.set('categoryId', String(categoryFilter.id));
      params.set('includeSubcategories', String(includeSubcategories));
    }
    if (tagFilter) params.set('tagId', String(tagFilter.id));
    params.set('sortBy', sortBy);
    params.set('sortDir', sortDir);

    apiFetch<PaginatedResponse<any>>(`/api/${entity}?${params.toString()}`)
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load records');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    entity,
    page,
    debouncedQ,
    categoryFilter,
    includeSubcategories,
    tagFilter,
    sortBy,
    sortDir,
    refreshKey,
    localRefresh,
    categoryViewMode,
  ]);

  const handleIngestPending = async () => {
    setIngestingPending(true);
    setIngestBanner(null);
    try {
      const res = await apiFetch<{ processed: number; catalog: { indexed: number } }>(
        '/api/rag/ingest-pending',
        { method: 'POST' }
      );
      setIngestBanner(
        `Processed ${res.processed} pending upload(s) and indexed ${res.catalog?.indexed ?? 0} catalog record(s).`
      );
      setLocalRefresh((k) => k + 1);
    } catch (err) {
      setIngestBanner(err instanceof Error ? err.message : 'Ingestion failed');
    } finally {
      setIngestingPending(false);
    }
  };

  const toggleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
  };

  const renderSortIcon = (col: string) => {
    if (sortBy !== col) return null;
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3 h-3 inline ml-1" />
    ) : (
      <ArrowDown className="w-3 h-3 inline ml-1" />
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {ENTITY_TITLES[entity]}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {data ? `${data.pagination.total} total records · 10 per page` : 'Catalog records'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {entity === 'categories' && (
            <div className="flex items-center p-0.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setCategoryViewMode('list')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  categoryViewMode === 'list'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                <span>List</span>
              </button>
              <button
                type="button"
                onClick={() => setCategoryViewMode('tree')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  categoryViewMode === 'tree'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <FolderTree className="w-3.5 h-3.5" />
                <span>Tree</span>
              </button>
            </div>
          )}

          {entity === 'uploads' && (
            <button
              type="button"
              disabled={ingestingPending}
              onClick={handleIngestPending}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
              <span>{ingestingPending ? 'Ingesting...' : 'Ingest Pending'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onCreate()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md bg-teal-600 hover:bg-teal-500 text-white transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{entity === 'uploads' ? 'Upload File' : 'Create New'}</span>
          </button>
        </div>
      </div>

      {ingestBanner && (
        <div className="p-3 rounded-md border border-teal-300 dark:border-teal-800 bg-teal-50/70 dark:bg-teal-950/40 text-xs text-teal-800 dark:text-teal-300">
          {ingestBanner}
        </div>
      )}

      {!(entity === 'categories' && categoryViewMode === 'tree') && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="md:col-span-4 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${ENTITY_TITLES[entity].toLowerCase()}...`}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          {HAS_CATEGORY_FILTER.has(entity) && (
            <div className="md:col-span-4 flex flex-col gap-1.5">
              <AsyncCombobox
                endpoint="/api/categories/lookup"
                placeholder="Filter by category..."
                nullable
                value={categoryFilter}
                onChangeSingle={(v) => {
                  setCategoryFilter(v);
                  setPage(1);
                }}
              />
              {categoryFilter && (
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                  <input
                    type="checkbox"
                    checked={includeSubcategories}
                    onChange={(e) => {
                      setIncludeSubcategories(e.target.checked);
                      setPage(1);
                    }}
                    className="rounded border-slate-300 dark:border-slate-700 text-teal-600"
                  />
                  <span>Include subcategories</span>
                </label>
              )}
            </div>
          )}

          {HAS_TAG_FILTER.has(entity) && (
            <div className="md:col-span-4">
              <AsyncCombobox
                endpoint="/api/tags/lookup"
                placeholder="Filter by tag..."
                nullable
                value={tagFilter}
                onChangeSingle={(v) => {
                  setTagFilter(v);
                  setPage(1);
                }}
              />
            </div>
          )}
        </div>
      )}

      {entity === 'categories' && categoryViewMode === 'tree' ? (
        <CategoryTree
          onNavigate={onNavigate}
          onCreateSubcategory={(parent) => onCreate(parent)}
          refreshKey={refreshKey}
        />
      ) : (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
          {error ? (
            <div className="py-8 text-center text-sm text-rose-600 dark:text-rose-400">
              {error}
            </div>
          ) : loading ? (
            <div className="space-y-2.5 py-2">
              {Array.from({ length: 5 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-10 rounded bg-slate-100 dark:bg-slate-800/70 animate-pulse"
                />
              ))}
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No {ENTITY_TITLES[entity].toLowerCase()} matched your criteria.
              </p>
              <button
                type="button"
                onClick={() => onCreate()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add First Record</span>
              </button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                      <th className="py-2.5 pr-4 font-medium">
                        <button
                          type="button"
                          onClick={() =>
                            toggleSort(entity === 'uploads' ? 'original_name' : 'name')
                          }
                          className="hover:text-slate-900 dark:hover:text-slate-100"
                        >
                          Name {renderSortIcon(entity === 'uploads' ? 'original_name' : 'name')}
                        </button>
                      </th>

                      {entity === 'formulas' && (
                        <>
                          <th className="py-2.5 pr-4 font-medium">Category</th>
                          <th className="py-2.5 pr-4 font-medium text-right">
                            <button
                              type="button"
                              onClick={() => toggleSort('calculated_usd_cost')}
                              className="hover:text-slate-900 dark:hover:text-slate-100"
                            >
                              Calculated Cost (USD) {renderSortIcon('calculated_usd_cost')}
                            </button>
                          </th>
                        </>
                      )}

                      {entity === 'ingredients' && (
                        <>
                          <th className="py-2.5 pr-4 font-medium">Category</th>
                          <th className="py-2.5 pr-4 font-medium">Material</th>
                          <th className="py-2.5 pr-4 font-medium">Supplier</th>
                          <th className="py-2.5 pr-4 font-medium text-right">
                            <button
                              type="button"
                              onClick={() => toggleSort('cost')}
                              className="hover:text-slate-900 dark:hover:text-slate-100"
                            >
                              Cost / Unit {renderSortIcon('cost')}
                            </button>
                          </th>
                        </>
                      )}

                      {entity === 'materials' && (
                        <>
                          <th className="py-2.5 pr-4 font-medium">Category</th>
                          <th className="py-2.5 pr-4 font-medium">
                            <button
                              type="button"
                              onClick={() => toggleSort('CAS')}
                              className="hover:text-slate-900 dark:hover:text-slate-100"
                            >
                              CAS {renderSortIcon('CAS')}
                            </button>
                          </th>
                          <th className="py-2.5 pr-4 font-medium">
                            <button
                              type="button"
                              onClick={() => toggleSort('FEMA')}
                              className="hover:text-slate-900 dark:hover:text-slate-100"
                            >
                              FEMA {renderSortIcon('FEMA')}
                            </button>
                          </th>
                        </>
                      )}

                      {entity === 'suppliers' && (
                        <th className="py-2.5 pr-4 font-medium">Info</th>
                      )}

                      {entity === 'categories' && (
                        <>
                          <th className="py-2.5 pr-4 font-medium">Parent</th>
                          <th className="py-2.5 pr-4 font-medium">Description</th>
                        </>
                      )}

                      {entity === 'tags' && (
                        <th className="py-2.5 pr-4 font-medium">Description</th>
                      )}

                      {entity === 'uploads' && (
                        <>
                          <th className="py-2.5 pr-4 font-medium">Category</th>
                          <th className="py-2.5 pr-4 font-medium">
                            <button
                              type="button"
                              onClick={() => toggleSort('mimetype')}
                              className="hover:text-slate-900 dark:hover:text-slate-100"
                            >
                              MIME Type {renderSortIcon('mimetype')}
                            </button>
                          </th>
                          <th className="py-2.5 pr-4 font-medium text-right">
                            <button
                              type="button"
                              onClick={() => toggleSort('size')}
                              className="hover:text-slate-900 dark:hover:text-slate-100"
                            >
                              Size {renderSortIcon('size')}
                            </button>
                          </th>
                          <th className="py-2.5 pr-4 font-medium">RAG Status</th>
                        </>
                      )}

                      {entity === 'units' && (
                        <th className="py-2.5 pr-4 font-medium text-right">Equal in kg</th>
                      )}

                      {entity === 'currencies' && (
                        <th className="py-2.5 pr-4 font-medium text-right">In USD</th>
                      )}
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                    {data.items.map((row: any) => (
                      <tr
                        key={row.id}
                        onClick={() => onNavigate({ entity, id: row.id })}
                        className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2.5">
                            {entity === 'uploads' && (
                              <UploadPreview
                                uploadId={row.id}
                                thumbnailPath={row.thumbnail_path}
                                mimetype={row.mimetype}
                                name={row.original_name}
                                size="sm"
                              />
                            )}
                            {(entity === 'materials' || entity === 'ingredients') && row.photo && (
                              <UploadPreview
                                uploadId={row.photo}
                                thumbnailPath={row.photo_thumbnail}
                                mimetype="image/*"
                                name={row.photo_name || row.name}
                                size="sm"
                              />
                            )}
                            <span className="font-medium text-slate-900 dark:text-slate-100 hover:text-teal-600 dark:hover:text-teal-400">
                              {row.name || row.original_name}
                            </span>
                          </div>
                        </td>

                        {entity === 'formulas' && (
                          <>
                            <td className="py-2.5 pr-4 text-xs">
                              <EntityLink
                                entity="categories"
                                id={row.category}
                                name={row.category_name}
                                onNavigate={onNavigate}
                              />
                            </td>
                            <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                              ${formatMoney(row.calculated_usd_cost)}
                            </td>
                          </>
                        )}

                        {entity === 'ingredients' && (
                          <>
                            <td className="py-2.5 pr-4 text-xs">
                              <EntityLink
                                entity="categories"
                                id={row.category}
                                name={row.category_name}
                                onNavigate={onNavigate}
                              />
                            </td>
                            <td className="py-2.5 pr-4 text-xs">
                              <EntityLink
                                entity="materials"
                                id={row.material}
                                name={row.material_name}
                                onNavigate={onNavigate}
                              />
                            </td>
                            <td className="py-2.5 pr-4 text-xs">
                              <EntityLink
                                entity="suppliers"
                                id={row.supplier}
                                name={row.supplier_name}
                                onNavigate={onNavigate}
                              />
                            </td>
                            <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-xs text-slate-800 dark:text-slate-200">
                              {formatMoney(row.cost)} {row.currency_name} / {row.unit_name}
                            </td>
                          </>
                        )}

                        {entity === 'materials' && (
                          <>
                            <td className="py-2.5 pr-4 text-xs">
                              <EntityLink
                                entity="categories"
                                id={row.category}
                                name={row.category_name}
                                onNavigate={onNavigate}
                              />
                            </td>
                            <td className="py-2.5 pr-4 font-mono text-xs text-slate-600 dark:text-slate-400">
                              {row.CAS || '—'}
                            </td>
                            <td className="py-2.5 pr-4 font-mono text-xs text-slate-600 dark:text-slate-400">
                              {row.FEMA || '—'}
                            </td>
                          </>
                        )}

                        {entity === 'suppliers' && (
                          <td className="py-2.5 pr-4 text-xs text-slate-600 dark:text-slate-400 truncate max-w-md">
                            {row.info || '—'}
                          </td>
                        )}

                        {entity === 'categories' && (
                          <>
                            <td className="py-2.5 pr-4 text-xs">
                              <EntityLink
                                entity="categories"
                                id={row.parent}
                                name={row.parent_name}
                                onNavigate={onNavigate}
                              />
                            </td>
                            <td className="py-2.5 pr-4 text-xs text-slate-600 dark:text-slate-400 truncate max-w-md">
                              {row.description || '—'}
                            </td>
                          </>
                        )}

                        {entity === 'tags' && (
                          <td className="py-2.5 pr-4 text-xs text-slate-600 dark:text-slate-400 truncate max-w-md">
                            {row.description || '—'}
                          </td>
                        )}

                        {entity === 'uploads' && (
                          <>
                            <td className="py-2.5 pr-4 text-xs">
                              <EntityLink
                                entity="categories"
                                id={row.category}
                                name={row.category_name}
                                onNavigate={onNavigate}
                              />
                            </td>
                            <td className="py-2.5 pr-4 font-mono text-xs text-slate-600 dark:text-slate-400">
                              {row.mimetype}
                            </td>
                            <td className="py-2.5 pr-4 font-mono tabular-nums text-xs text-right text-slate-600 dark:text-slate-400">
                              {formatBytes(row.size)}
                            </td>
                            <td className="py-2.5 pr-4 text-xs">
                              {row.ingestion_status === 'indexed' || row.ingested ? (
                                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                  <span>Indexed</span>
                                </span>
                              ) : row.ingestion_status === 'error' ? (
                                <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400">
                                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                  <span>Error</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                                  <Clock className="w-3.5 h-3.5 shrink-0" />
                                  <span>Pending</span>
                                </span>
                              )}
                            </td>
                          </>
                        )}

                        {entity === 'units' && (
                          <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-xs text-slate-800 dark:text-slate-200">
                            {row.equal_in_kg} kg
                          </td>
                        )}

                        {entity === 'currencies' && (
                          <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-xs text-slate-800 dark:text-slate-200">
                            ${row.in_usd}
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
      )}
    </div>
  );
}
