import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Plus,
  Trash2,
} from 'lucide-react';
import { AsyncCombobox, type ComboboxOption } from '../components/AsyncCombobox';
import { DetailTabs, type TabDefinition } from '../components/DetailTabs';
import { EntityLink } from '../components/EntityLink';
import { UploadPreview } from '../components/UploadPreview';
import { apiFetch, formatBytes, formatMoney } from '../lib/api';
import type { EntityType, FormulaIngredientRow, FormulaTotals, RouteTarget } from '../types';

interface DetailViewProps {
  entity: EntityType;
  id: number;
  refreshKey: number;
  onNavigate: (target: RouteTarget) => void;
  onEdit: (record: any) => void;
  onDeleted: (entity: EntityType) => void;
}

const TABS_BY_ENTITY: Record<EntityType, TabDefinition[]> = {
  categories: [
    { key: 'children', label: 'Subcategories', targetEntity: 'categories' },
    { key: 'formulas', label: 'Formulas', targetEntity: 'formulas' },
    { key: 'ingredients', label: 'Ingredients', targetEntity: 'ingredients' },
    { key: 'materials', label: 'Materials', targetEntity: 'materials' },
    { key: 'uploads', label: 'Uploads', targetEntity: 'uploads' },
  ],
  tags: [
    { key: 'formulas', label: 'Formulas', targetEntity: 'formulas' },
    { key: 'ingredients', label: 'Ingredients', targetEntity: 'ingredients' },
    { key: 'materials', label: 'Materials', targetEntity: 'materials' },
    { key: 'uploads', label: 'Uploads', targetEntity: 'uploads' },
  ],
  uploads: [
    { key: 'materials', label: 'Materials', targetEntity: 'materials' },
    { key: 'ingredients', label: 'Ingredients', targetEntity: 'ingredients' },
    { key: 'suppliers', label: 'Suppliers', targetEntity: 'suppliers' },
    { key: 'formulas', label: 'Formulas', targetEntity: 'formulas' },
    { key: 'tags', label: 'Tags', targetEntity: 'tags' },
  ],
  materials: [
    { key: 'ingredients', label: 'Ingredients', targetEntity: 'ingredients' },
    { key: 'uploads', label: 'Uploads', targetEntity: 'uploads' },
    { key: 'tags', label: 'Tags', targetEntity: 'tags' },
  ],
  suppliers: [
    { key: 'ingredients', label: 'Ingredients', targetEntity: 'ingredients' },
    { key: 'uploads', label: 'Uploads', targetEntity: 'uploads' },
  ],
  currencies: [{ key: 'ingredients', label: 'Ingredients', targetEntity: 'ingredients' }],
  units: [{ key: 'ingredients', label: 'Ingredients', targetEntity: 'ingredients' }],
  ingredients: [
    { key: 'formulas', label: 'Formulas Using This', targetEntity: 'formulas' },
    { key: 'uploads', label: 'Uploads', targetEntity: 'uploads' },
    { key: 'tags', label: 'Tags', targetEntity: 'tags' },
  ],
  formulas: [
    { key: 'uploads', label: 'Uploads', targetEntity: 'uploads' },
    { key: 'tags', label: 'Tags', targetEntity: 'tags' },
  ],
};

export function DetailView({
  entity,
  id,
  refreshKey,
  onNavigate,
  onEdit,
  onDeleted,
}: DetailViewProps) {
  const [record, setRecord] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Formula ingredients inline state (all rows loaded, no pagination)
  const [formulaIngredients, setFormulaIngredients] = useState<FormulaIngredientRow[]>([]);
  const [formulaTotals, setFormulaTotals] = useState<FormulaTotals | null>(null);
  const [newIngredient, setNewIngredient] = useState<ComboboxOption | null>(null);
  const [newQuantity, setNewQuantity] = useState<string>('1');
  const [editingQty, setEditingQty] = useState<Record<number, string>>({});
  const [savingLine, setSavingLine] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setConfirmDelete(false);
    setActionError(null);

    apiFetch<any>(`/api/${entity}/${id}`)
      .then((res) => {
        if (!active) return;
        setRecord(res);
        if (entity === 'formulas') {
          setFormulaIngredients(res.ingredients || []);
          setFormulaTotals(res.totals || null);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load record');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [entity, id, refreshKey]);

  const handleDelete = async () => {
    setActionError(null);
    try {
      await apiFetch(`/api/${entity}/${id}`, { method: 'DELETE' });
      onDeleted(entity);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Cannot delete record');
      setConfirmDelete(false);
    }
  };

  const handleAddOrUpdateIngredient = async (ingredientId: number, qtyStr: string) => {
    const qty = Number(qtyStr);
    if (!ingredientId || Number.isNaN(qty) || qty < 0) return;
    setSavingLine(true);
    setActionError(null);
    try {
      const res = await apiFetch<{ items: FormulaIngredientRow[]; totals: FormulaTotals }>(
        `/api/formulas/${id}/ingredients`,
        {
          method: 'POST',
          body: JSON.stringify({ ingredient: ingredientId, quantity: qty }),
        }
      );
      setFormulaIngredients(res.items);
      setFormulaTotals(res.totals);
      setRecord((prev: any) =>
        prev ? { ...prev, calculated_usd_cost: res.totals.calculated_usd_cost } : prev
      );
      setNewIngredient(null);
      setNewQuantity('1');
      setEditingQty((prev) => {
        const next = { ...prev };
        delete next[ingredientId];
        return next;
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update ingredient');
    } finally {
      setSavingLine(false);
    }
  };

  const handleRemoveFormulaIngredient = async (ingredientId: number) => {
    setSavingLine(true);
    setActionError(null);
    try {
      const res = await apiFetch<{ items: FormulaIngredientRow[]; totals: FormulaTotals }>(
        `/api/formulas/${id}/ingredients/${ingredientId}`,
        { method: 'DELETE' }
      );
      setFormulaIngredients(res.items);
      setFormulaTotals(res.totals);
      setRecord((prev: any) =>
        prev ? { ...prev, calculated_usd_cost: res.totals.calculated_usd_cost } : prev
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to remove ingredient');
    } finally {
      setSavingLine(false);
    }
  };

  const handleCloneFormula = async () => {
    setActionError(null);
    try {
      const cloned = await apiFetch<{ id: number }>(`/api/formulas/${id}/clone`, {
        method: 'POST',
      });
      onNavigate({ entity: 'formulas', id: cloned.id });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Clone failed');
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-sm text-slate-500 dark:text-slate-400">
        Loading record details...
      </div>
    );
  }

  if (error || !record) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => onNavigate({ entity })}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to list</span>
        </button>
        <div className="p-6 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-sm text-rose-700 dark:text-rose-300">
          {error || 'Record not found.'}
        </div>
      </div>
    );
  }

  const displayName = record.name || record.original_name;

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => onNavigate({ entity })}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to {entity}</span>
          </button>
          <div className="flex items-center gap-3">
            {entity === 'uploads' && (
              <UploadPreview
                uploadId={record.id}
                thumbnailPath={record.thumbnail_path}
                mimetype={record.mimetype}
                name={record.original_name}
                size="md"
              />
            )}
            {(entity === 'materials' || entity === 'ingredients') && record.photo && (
              <UploadPreview
                uploadId={record.photo}
                thumbnailPath={record.photo_thumbnail}
                mimetype="image/*"
                name={record.photo_name || displayName}
                size="md"
              />
            )}
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              {displayName}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {entity === 'uploads' && (
            <>
              <a
                href={`/api/uploads/${record.id}/file`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open</span>
              </a>
              <a
                href={`/api/uploads/${record.id}/file?download=1`}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </a>
            </>
          )}

          {entity === 'formulas' && (
            <>
              <button
                type="button"
                onClick={handleCloneFormula}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Clone</span>
              </button>
              <a
                href={`/api/formulas/${record.id}/export?format=csv`}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV</span>
              </a>
              <a
                href={`/api/formulas/${record.id}/export?format=md`}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Markdown</span>
              </a>
            </>
          )}

          <button
            type="button"
            onClick={() => onEdit(record)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md bg-teal-600 hover:bg-teal-500 text-white whitespace-nowrap shrink-0"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Edit</span>
          </button>

          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete</span>
            </button>
          ) : (
            <div className="inline-flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleDelete}
                className="px-3 py-2 text-xs font-medium rounded-md bg-rose-600 hover:bg-rose-500 text-white whitespace-nowrap shrink-0"
              >
                Confirm Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-2.5 py-2 text-xs rounded-md border border-slate-200 dark:border-slate-700"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {actionError && (
        <div className="p-3 rounded-md border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
          {actionError}
        </div>
      )}

      {/* Record Fields Panel */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5">
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4 text-sm">
          {record.category !== undefined && (
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400 mb-1">Category</dt>
              <dd>
                <EntityLink
                  entity="categories"
                  id={record.category}
                  name={record.category_name}
                  onNavigate={onNavigate}
                />
              </dd>
            </div>
          )}

          {entity === 'categories' && (
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400 mb-1">Parent Category</dt>
              <dd>
                <EntityLink
                  entity="categories"
                  id={record.parent}
                  name={record.parent_name}
                  onNavigate={onNavigate}
                />
              </dd>
            </div>
          )}

          {entity === 'materials' && (
            <>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400 mb-1">CAS</dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100">
                  {record.CAS || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400 mb-1">FEMA</dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100">
                  {record.FEMA || '—'}
                </dd>
              </div>
            </>
          )}

          {entity === 'ingredients' && (
            <>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400 mb-1">Material</dt>
                <dd>
                  <EntityLink
                    entity="materials"
                    id={record.material}
                    name={record.material_name}
                    onNavigate={onNavigate}
                  />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400 mb-1">Supplier</dt>
                <dd>
                  <EntityLink
                    entity="suppliers"
                    id={record.supplier}
                    name={record.supplier_name}
                    onNavigate={onNavigate}
                  />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400 mb-1">Cost</dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {formatMoney(record.cost)}{' '}
                  <EntityLink
                    entity="currencies"
                    id={record.currency}
                    name={record.currency_name}
                    onNavigate={onNavigate}
                  />{' '}
                  per{' '}
                  <EntityLink
                    entity="units"
                    id={record.unit}
                    name={record.unit_name}
                    onNavigate={onNavigate}
                  />
                </dd>
              </div>
            </>
          )}

          {(entity === 'materials' || entity === 'ingredients') && (
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400 mb-1">Photo</dt>
              <dd>
                <EntityLink
                  entity="uploads"
                  id={record.photo}
                  name={record.photo_name}
                  thumbnailPath={record.photo_thumbnail}
                  mimetype="image/*"
                  showPreview
                  onNavigate={onNavigate}
                />
              </dd>
            </div>
          )}

          {entity === 'currencies' && (
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400 mb-1">Equivalent in USD</dt>
              <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                ${record.in_usd}
              </dd>
            </div>
          )}

          {entity === 'units' && (
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400 mb-1">Equivalent in kg</dt>
              <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {record.equal_in_kg} kg
              </dd>
            </div>
          )}

          {entity === 'formulas' && (
            <>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                  Calculated Cost (USD)
                </dt>
                <dd className="text-lg font-semibold font-mono tabular-nums text-teal-700 dark:text-teal-400">
                  ${formatMoney(record.calculated_usd_cost)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                  Total Batch Weight
                </dt>
                <dd className="text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {formulaTotals ? `${formulaTotals.total_weight_kg} kg` : '0 kg'}
                </dd>
              </div>
            </>
          )}

          {entity === 'uploads' && (
            <>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400 mb-1">MIME Type</dt>
                <dd className="font-mono text-xs text-slate-900 dark:text-slate-100">
                  {record.mimetype}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400 mb-1">Size</dt>
                <dd className="font-mono tabular-nums text-xs text-slate-900 dark:text-slate-100">
                  {formatBytes(record.size)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400 mb-1">Ingested (RAG)</dt>
                <dd className="text-xs text-slate-900 dark:text-slate-100">
                  {record.ingested ? 'Yes' : 'No'}
                </dd>
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-xs text-slate-500 dark:text-slate-400 mb-1">SHA-256 Hash</dt>
                <dd className="font-mono text-xs text-slate-600 dark:text-slate-400 break-all">
                  {record.hash}
                </dd>
              </div>
            </>
          )}

          {Array.isArray(record.tags) && record.tags.length > 0 && (
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-xs text-slate-500 dark:text-slate-400 mb-1">Tags</dt>
              <dd className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                {record.tags.map((t: any, idx: number) => (
                  <span key={t.id} className="inline-flex items-center gap-2">
                    <EntityLink
                      entity="tags"
                      id={t.id}
                      name={t.name}
                      onNavigate={onNavigate}
                    />
                    {idx < record.tags.length - 1 && (
                      <span className="text-slate-400" aria-hidden="true">
                        ·
                      </span>
                    )}
                  </span>
                ))}
              </dd>
            </div>
          )}

          {(record.description || record.info || record.notes) && (
            <div className="sm:col-span-2 lg:col-span-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <dt className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                {record.description ? 'Description' : record.notes ? 'Notes' : 'Info'}
              </dt>
              <dd className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                {record.description || record.notes || record.info}
              </dd>
            </div>
          )}

          {record.directions && (
            <div className="sm:col-span-2 lg:col-span-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <dt className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                Compounding Directions
              </dt>
              <dd className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                {record.directions}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Special Formula Ingredients Table (ALL listed without pagination) */}
      {entity === 'formulas' && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Formula Ingredients & Quantities
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                All {formulaIngredients.length} ingredients listed · USD cost updates transactionally
              </p>
            </div>
          </div>

          {/* Inline Add Ingredient Row */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 p-3 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
            <div className="md:col-span-7">
              <AsyncCombobox
                endpoint="/api/ingredients/lookup"
                placeholder="Search ingredient by name to add..."
                value={newIngredient}
                onChangeSingle={setNewIngredient}
                formatOption={(o) =>
                  `${o.name} (${formatMoney(o.cost as number)} ${o.currency_name} / ${o.unit_name})`
                }
              />
            </div>
            <div className="md:col-span-3">
              <input
                type="number"
                step="0.0001"
                min="0"
                value={newQuantity}
                onChange={(e) => setNewQuantity(e.target.value)}
                placeholder="Quantity (units)"
                className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>
            <div className="md:col-span-2">
              <button
                type="button"
                disabled={!newIngredient || savingLine}
                onClick={() =>
                  newIngredient && handleAddOrUpdateIngredient(newIngredient.id, newQuantity)
                }
                className="w-full h-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </div>
          </div>

          {formulaIngredients.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No ingredients added to this formula yet. Use the picker above to add ingredients.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-3 font-medium">Ingredient</th>
                    <th className="py-2 pr-3 font-medium">Supplier</th>
                    <th className="py-2 pr-3 font-medium text-right">Quantity</th>
                    <th className="py-2 pr-3 font-medium">Unit</th>
                    <th className="py-2 pr-3 font-medium text-right">Weight (kg)</th>
                    <th className="py-2 pr-3 font-medium text-right">Weight %</th>
                    <th className="py-2 pr-3 font-medium text-right">Line Cost (USD)</th>
                    <th className="py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {formulaIngredients.map((row) => {
                    const draft = editingQty[row.ingredient];
                    const isDirty = draft !== undefined && draft !== String(row.quantity);
                    return (
                      <tr
                        key={row.ingredient}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      >
                        <td className="py-2.5 pr-3">
                          <EntityLink
                            entity="ingredients"
                            id={row.ingredient}
                            name={row.ingredient_name}
                            onNavigate={onNavigate}
                          />
                        </td>
                        <td className="py-2.5 pr-3 text-xs">
                          <EntityLink
                            entity="suppliers"
                            id={row.supplier}
                            name={row.supplier_name}
                            onNavigate={onNavigate}
                          />
                        </td>
                        <td className="py-2.5 pr-3 text-right">
                          <input
                            type="number"
                            step="0.0001"
                            min="0"
                            value={draft !== undefined ? draft : String(row.quantity)}
                            onChange={(e) =>
                              setEditingQty((prev) => ({
                                ...prev,
                                [row.ingredient]: e.target.value,
                              }))
                            }
                            className="w-24 px-2 py-1 text-right text-xs font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                          />
                        </td>
                        <td className="py-2.5 pr-3 text-xs">
                          <EntityLink
                            entity="units"
                            id={row.unit}
                            name={`${row.unit_name} (${row.equal_in_kg} kg)`}
                            onNavigate={onNavigate}
                          />
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300">
                          {row.weight_kg}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300">
                          {row.weight_percent}%
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-xs font-medium text-slate-900 dark:text-slate-100">
                          ${formatMoney(row.line_usd_cost)}
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap space-x-2">
                          {isDirty && (
                            <button
                              type="button"
                              disabled={savingLine}
                              onClick={() => handleAddOrUpdateIngredient(row.ingredient, draft)}
                              className="px-2 py-1 text-xs font-medium rounded bg-teal-600 hover:bg-teal-500 text-white"
                            >
                              Save
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={savingLine}
                            onClick={() => handleRemoveFormulaIngredient(row.ingredient)}
                            className="p-1 text-slate-400 hover:text-rose-500 transition-colors"
                            title="Remove ingredient"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {formulaTotals && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-slate-100">
                      <td colSpan={4} className="py-2.5 pr-3">
                        Totals ({formulaTotals.ingredient_count} ingredients)
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                        {formulaTotals.total_weight_kg} kg
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums">100%</td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-teal-700 dark:text-teal-400">
                        ${formatMoney(formulaTotals.calculated_usd_cost)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      )}

      {/* Lazy-Loaded Related Entity Tabs */}
      <DetailTabs
        baseEndpoint={`/api/${entity}/${id}`}
        tabs={TABS_BY_ENTITY[entity]}
        onNavigate={onNavigate}
        refreshKey={refreshKey}
      />
    </div>
  );
}
