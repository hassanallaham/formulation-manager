import { useState, type FormEvent } from 'react';
import { UploadCloud, X } from 'lucide-react';
import { ApiError, apiFetch } from '../lib/api';
import type { EntityType, RouteTarget, UploadRecord } from '../types';
import { AsyncCombobox, type ComboboxOption } from './AsyncCombobox';
import { UploadPreview } from './UploadPreview';

interface EntityModalProps {
  entity: EntityType;
  initialRecord?: Record<string, any> | null;
  defaultParentCategory?: { id: number; name: string } | null;
  onClose: () => void;
  onSaved: (record?: any) => void;
  onNavigate: (target: RouteTarget) => void;
}

export function EntityModal({
  entity,
  initialRecord,
  defaultParentCategory,
  onClose,
  onSaved,
  onNavigate,
}: EntityModalProps) {
  const isEdit = Boolean(initialRecord?.id);

  // Common fields
  const [name, setName] = useState<string>(initialRecord?.name || initialRecord?.original_name || '');
  const [description, setDescription] = useState<string>(initialRecord?.description || '');
  const [info, setInfo] = useState<string>(initialRecord?.info || '');
  const [directions, setDirections] = useState<string>(initialRecord?.directions || '');
  const [notes, setNotes] = useState<string>(initialRecord?.notes || '');

  // Material fields
  const [cas, setCas] = useState<string>(initialRecord?.CAS || '');
  const [fema, setFema] = useState<string>(initialRecord?.FEMA || '');

  // Numeric fields
  const [inUsd, setInUsd] = useState<string>(
    initialRecord?.in_usd !== undefined ? String(initialRecord.in_usd) : '1'
  );
  const [equalInKg, setEqualInKg] = useState<string>(
    initialRecord?.equal_in_kg !== undefined ? String(initialRecord.equal_in_kg) : '1'
  );
  const [cost, setCost] = useState<string>(
    initialRecord?.cost !== undefined ? String(initialRecord.cost) : '0'
  );

  // Upload specific
  const [file, setFile] = useState<File | null>(null);
  const [ingested, setIngested] = useState<boolean>(Boolean(initialRecord?.ingested));
  const [duplicateUpload, setDuplicateUpload] = useState<UploadRecord | null>(null);

  // Relations via ComboboxOption
  const [category, setCategory] = useState<ComboboxOption | null>(
    initialRecord?.category
      ? { id: initialRecord.category, name: initialRecord.category_name || 'uncategorized' }
      : { id: 1, name: 'uncategorized' }
  );
  const [parentCategory, setParentCategory] = useState<ComboboxOption | null>(
    initialRecord?.parent
      ? { id: initialRecord.parent, name: initialRecord.parent_name || '' }
      : defaultParentCategory || null
  );
  const [material, setMaterial] = useState<ComboboxOption | null>(
    initialRecord?.material
      ? { id: initialRecord.material, name: initialRecord.material_name || '' }
      : null
  );
  const [supplier, setSupplier] = useState<ComboboxOption | null>(
    initialRecord?.supplier
      ? { id: initialRecord.supplier, name: initialRecord.supplier_name || 'virtual supplier' }
      : { id: 1, name: 'virtual supplier' }
  );
  const [photo, setPhoto] = useState<ComboboxOption | null>(
    initialRecord?.photo
      ? { id: initialRecord.photo, name: initialRecord.photo_name || `Upload #${initialRecord.photo}` }
      : null
  );
  const [unit, setUnit] = useState<ComboboxOption | null>(
    initialRecord?.unit
      ? { id: initialRecord.unit, name: initialRecord.unit_name || 'kg' }
      : { id: 1, name: 'kg' }
  );
  const [currency, setCurrency] = useState<ComboboxOption | null>(
    initialRecord?.currency
      ? { id: initialRecord.currency, name: initialRecord.currency_name || 'USD' }
      : { id: 1, name: 'USD' }
  );

  const [tags, setTags] = useState<ComboboxOption[]>(
    Array.isArray(initialRecord?.tags) ? initialRecord.tags : []
  );
  const [uploads, setUploads] = useState<ComboboxOption[]>(
    Array.isArray(initialRecord?.uploads) ? initialRecord.uploads : []
  );

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const singularLabel: Record<EntityType, string> = {
    formulas: 'Formula',
    ingredients: 'Ingredient',
    materials: 'Material',
    suppliers: 'Supplier',
    categories: 'Category',
    tags: 'Tag',
    uploads: 'Upload',
    units: 'Unit',
    currencies: 'Currency',
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDuplicateUpload(null);
    setSaving(true);

    try {
      if (entity === 'uploads' && !isEdit) {
        if (!file) {
          setError('Please select a file to upload.');
          setSaving(false);
          return;
        }
        const formData = new FormData();
        formData.append('file', file);
        formData.append('category', String(category?.id || 1));
        formData.append('notes', notes);
        formData.append('ingested', String(ingested));
        formData.append('tags', JSON.stringify(tags.map((t) => t.id)));

        const created = await apiFetch('/api/uploads', {
          method: 'POST',
          body: formData,
        });
        onSaved(created);
        return;
      }

      let body: Record<string, unknown> = {};
      if (entity === 'categories') {
        body = { name, description: description || null, parent: parentCategory?.id || null };
      } else if (entity === 'tags') {
        body = { name, description: description || null };
      } else if (entity === 'uploads') {
        body = {
          original_name: name,
          category: category?.id || 1,
          notes: notes || null,
          ingested,
          tags: tags.map((t) => t.id),
        };
      } else if (entity === 'materials') {
        body = {
          name,
          CAS: cas || null,
          FEMA: fema || null,
          info: info || null,
          category: category?.id || 1,
          photo: photo?.id || null,
          tags: tags.map((t) => t.id),
          uploads: uploads.map((u) => u.id),
        };
      } else if (entity === 'suppliers') {
        body = {
          name,
          info: info || null,
          uploads: uploads.map((u) => u.id),
        };
      } else if (entity === 'currencies') {
        body = { name, in_usd: Number(inUsd) };
      } else if (entity === 'units') {
        body = { name, equal_in_kg: Number(equalInKg) };
      } else if (entity === 'ingredients') {
        body = {
          name,
          category: category?.id || 1,
          material: material?.id || null,
          supplier: supplier?.id || null,
          photo: photo?.id || null,
          info: info || null,
          cost: Number(cost),
          unit: unit?.id || 1,
          currency: currency?.id || 1,
          tags: tags.map((t) => t.id),
          uploads: uploads.map((u) => u.id),
        };
      } else if (entity === 'formulas') {
        body = {
          name,
          category: category?.id || 1,
          info: info || null,
          directions: directions || null,
          tags: tags.map((t) => t.id),
          uploads: uploads.map((u) => u.id),
        };
      }

      const url = isEdit ? `/api/${entity}/${initialRecord!.id}` : `/api/${entity}`;
      const saved = await apiFetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && err.duplicate && err.existingUpload) {
        setDuplicateUpload(err.existingUpload);
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Save failed');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
      <div className="w-full max-w-xl rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 my-8">
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {isEdit ? `Edit ${singularLabel[entity]}` : `New ${singularLabel[entity]}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-md border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300 space-y-2">
            <p>{error}</p>
            {duplicateUpload && (
              <div className="flex items-center justify-between gap-3 pt-2 border-t border-rose-200 dark:border-rose-800/70">
                <div className="flex items-center gap-2 min-w-0">
                  <UploadPreview
                    uploadId={duplicateUpload.id}
                    thumbnailPath={duplicateUpload.thumbnail_path}
                    mimetype={duplicateUpload.mimetype}
                    name={duplicateUpload.original_name}
                    size="sm"
                  />
                  <span className="truncate font-medium">{duplicateUpload.original_name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onNavigate({ entity: 'uploads', id: duplicateUpload.id });
                  }}
                  className="px-2.5 py-1 rounded bg-rose-600 text-white hover:bg-rose-500 whitespace-nowrap shrink-0"
                >
                  Open Existing File
                </button>
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {entity === 'uploads' && !isEdit ? (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Select File (Image, PDF, Markdown, TXT)
              </label>
              <label className="flex flex-col items-center justify-center p-5 border border-dashed border-slate-300 dark:border-slate-700 rounded-md cursor-pointer hover:border-teal-500 transition-colors bg-slate-50 dark:bg-slate-950">
                <UploadCloud className="w-6 h-6 text-teal-600 dark:text-teal-400 mb-2" />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  {file ? file.name : 'Click to choose a file'}
                </span>
                <input
                  type="file"
                  accept="image/*,.pdf,.md,.markdown,.txt"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </label>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {entity === 'uploads' ? 'File Name' : 'Name'} *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          )}

          {entity === 'categories' && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Parent Category
                </label>
                <AsyncCombobox
                  endpoint="/api/categories/lookup"
                  placeholder="Search parent category..."
                  nullable
                  extraParams={isEdit ? { excludeId: initialRecord!.id } : undefined}
                  value={parentCategory}
                  onChangeSingle={setParentCategory}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </>
          )}

          {entity === 'tags' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Description
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          )}

          {entity === 'currencies' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Value in USD (1 unit = X USD) *
              </label>
              <input
                type="number"
                step="0.000001"
                min="0"
                required
                disabled={isEdit && initialRecord?.id === 1}
                value={inUsd}
                onChange={(e) => setInUsd(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:opacity-60"
              />
            </div>
          )}

          {entity === 'units' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Equivalent Weight in kg (equal_in_kg) *
              </label>
              <input
                type="number"
                step="0.000001"
                min="0.000001"
                required
                disabled={isEdit && initialRecord?.id === 1}
                value={equalInKg}
                onChange={(e) => setEqualInKg(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:opacity-60"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Example: for a 5 kg container unit enter 5; for 1 g enter 0.001.
              </p>
            </div>
          )}

          {(entity === 'uploads' || entity === 'materials' || entity === 'ingredients' || entity === 'formulas') && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Category
              </label>
              <AsyncCombobox
                endpoint="/api/categories/lookup"
                placeholder="Search categories..."
                value={category}
                onChangeSingle={(v) => setCategory(v || { id: 1, name: 'uncategorized' })}
              />
            </div>
          )}

          {entity === 'materials' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  CAS Number
                </label>
                <input
                  type="text"
                  value={cas}
                  onChange={(e) => setCas(e.target.value)}
                  placeholder="e.g. 121-33-5"
                  className="w-full px-3 py-2 text-sm font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  FEMA Number
                </label>
                <input
                  type="text"
                  value={fema}
                  onChange={(e) => setFema(e.target.value)}
                  placeholder="e.g. 3107"
                  className="w-full px-3 py-2 text-sm font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>
          )}

          {entity === 'ingredients' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Material
                  </label>
                  <AsyncCombobox
                    endpoint="/api/materials/lookup"
                    placeholder="Search materials..."
                    nullable
                    value={material}
                    onChangeSingle={setMaterial}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Supplier
                  </label>
                  <AsyncCombobox
                    endpoint="/api/suppliers/lookup"
                    placeholder="Search suppliers..."
                    nullable
                    value={supplier}
                    onChangeSingle={setSupplier}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Cost (per Unit)
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Unit
                  </label>
                  <AsyncCombobox
                    endpoint="/api/units/lookup"
                    placeholder="Select unit..."
                    value={unit}
                    onChangeSingle={(v) => setUnit(v || { id: 1, name: 'kg' })}
                    formatOption={(o) => `${o.name} (${o.equal_in_kg} kg)`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Currency
                  </label>
                  <AsyncCombobox
                    endpoint="/api/currencies/lookup"
                    placeholder="Select currency..."
                    value={currency}
                    onChangeSingle={(v) => setCurrency(v || { id: 1, name: 'USD' })}
                  />
                </div>
              </div>
            </>
          )}

          {(entity === 'materials' || entity === 'ingredients') && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Photo (Image Upload)
              </label>
              <AsyncCombobox
                endpoint="/api/uploads/lookup"
                placeholder="Search image uploads..."
                nullable
                extraParams={{ imagesOnly: true }}
                value={photo}
                onChangeSingle={setPhoto}
              />
            </div>
          )}

          {(entity === 'materials' || entity === 'suppliers' || entity === 'ingredients' || entity === 'formulas') && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Info / Notes
              </label>
              <textarea
                rows={3}
                value={info}
                onChange={(e) => setInfo(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          )}

          {entity === 'formulas' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Compounding Directions
              </label>
              <textarea
                rows={4}
                value={directions}
                onChange={(e) => setDirections(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          )}

          {entity === 'uploads' && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Notes
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={ingested}
                  onChange={(e) => setIngested(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-700 text-teal-600 focus:ring-teal-500"
                />
                <span>Marked as ingested (RAG ready)</span>
              </label>
            </>
          )}

          {(entity === 'uploads' || entity === 'materials' || entity === 'ingredients' || entity === 'formulas') && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Tags
              </label>
              <AsyncCombobox
                endpoint="/api/tags/lookup"
                placeholder="Search & add tags..."
                multiple
                values={tags}
                onChangeMultiple={setTags}
              />
            </div>
          )}

          {(entity === 'materials' || entity === 'suppliers' || entity === 'ingredients' || entity === 'formulas') && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Attached Uploads (Documents / Media)
              </label>
              <AsyncCombobox
                endpoint="/api/uploads/lookup"
                placeholder="Search & attach uploads..."
                multiple
                values={uploads}
                onChangeMultiple={setUploads}
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-medium rounded-md bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-50"
            >
              {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
