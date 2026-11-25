export type EntityType =
  | 'formulas'
  | 'ingredients'
  | 'materials'
  | 'suppliers'
  | 'categories'
  | 'tags'
  | 'uploads'
  | 'units'
  | 'currencies';

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationMeta;
}

export interface NamedRef {
  id: number;
  name: string;
}

export interface UploadRef {
  id: number;
  name: string;
  mimetype: string;
  thumbnail_path?: string | null;
}

export interface Category {
  id: number;
  name: string;
  description: string | null;
  parent: number | null;
  parent_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface UploadRecord {
  id: number;
  original_name: string;
  extension: string;
  stored_path: string;
  thumbnail_path: string | null;
  hash: string;
  size: number;
  mimetype: string;
  notes: string | null;
  ingested: number | boolean;
  category: number;
  category_name?: string | null;
  tags?: NamedRef[];
  created_at: string;
  updated_at: string;
}

export interface Material {
  id: number;
  name: string;
  CAS: string | null;
  FEMA: string | null;
  info: string | null;
  category: number;
  category_name?: string | null;
  photo: number | null;
  photo_name?: string | null;
  photo_thumbnail?: string | null;
  tags?: NamedRef[];
  uploads?: UploadRef[];
  created_at: string;
  updated_at: string;
}

export interface Supplier {
  id: number;
  name: string;
  info: string | null;
  uploads?: UploadRef[];
  created_at: string;
  updated_at: string;
}

export interface Currency {
  id: number;
  name: string;
  in_usd: number;
  created_at: string;
  updated_at: string;
}

export interface Unit {
  id: number;
  name: string;
  equal_in_kg: number;
  created_at: string;
  updated_at: string;
}

export interface Ingredient {
  id: number;
  name: string;
  category: number;
  category_name?: string | null;
  material: number | null;
  material_name?: string | null;
  supplier: number | null;
  supplier_name?: string | null;
  photo: number | null;
  photo_name?: string | null;
  photo_thumbnail?: string | null;
  info: string | null;
  cost: number;
  unit: number;
  unit_name?: string | null;
  equal_in_kg?: number;
  currency: number;
  currency_name?: string | null;
  in_usd?: number;
  tags?: NamedRef[];
  uploads?: UploadRef[];
  created_at: string;
  updated_at: string;
}

export interface FormulaIngredientRow {
  formula: number;
  ingredient: number;
  quantity: number;
  ingredient_name: string;
  cost: number;
  unit: number;
  unit_name: string;
  equal_in_kg: number;
  currency: number;
  currency_name: string;
  in_usd: number;
  supplier: number | null;
  supplier_name: string | null;
  weight_kg: number;
  line_usd_cost: number;
  weight_percent: number;
}

export interface FormulaTotals {
  total_weight_kg: number;
  calculated_usd_cost: number;
  ingredient_count: number;
}

export interface Formula {
  id: number;
  name: string;
  category: number;
  category_name?: string | null;
  info: string | null;
  directions: string | null;
  calculated_usd_cost: number;
  tags?: NamedRef[];
  uploads?: UploadRef[];
  ingredients?: FormulaIngredientRow[];
  totals?: FormulaTotals;
  created_at: string;
  updated_at: string;
}

export interface RouteTarget {
  entity: EntityType;
  id?: number;
}
