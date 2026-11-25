# Software Requirements Specification (SRS)
## FormuLab — Single-User Formulation, Ingredient & Supplier Desktop Manager

**Version:** 1.0  
**Date:** 2026-11-24  
**Target Platform:** Linux Desktop (`.deb` via Tauri v2 + OS WebView + System Node.js `v24.22.3`)

---

## 1. Purpose & Scope

FormuLab is a lightweight, offline-first, single-user desktop application for managing raw **materials**, **suppliers**, **ingredients**, **units**, **currencies**, **uploads/documents**, **categories**, **tags**, and **formulations** (formulas). It automates USD cost rollups across multi-currency and multi-unit ingredient catalogs while keeping RAM and CPU usage minimal.

---

## 2. System Architecture & Packaging

1. **Desktop Shell (Tauri v2):**
   * Uses the Linux OS WebKitGTK WebView to avoid bundling Chromium.
   * Configured to build a **`.deb` package only** (`bundle.targets = ["deb"]`), declaring a system dependency on `nodejs (>= 24.0.0)`.
   * Because **Node.js `v24.22.3`** is pre-installed on the user's laptop, Tauri does **not** bundle a Node.js binary as an `externalBin` sidecar; instead, Tauri's Rust layer spawns the system `node` executable running the packaged server bundle on `127.0.0.1` using an ephemeral free port, and terminates the child process cleanly on window/app exit.
2. **Backend (Node.js + Express + Knex.js + SQLite):**
   * Uses **Knex.js** with the **`better-sqlite3`** driver.
   * Database file (`app.db`) and uploaded assets (`uploads/`, `thumbs/`) reside in the user's XDG data directory (`~/.local/share/formulab/`).
   * Knex `pool.afterCreate` executes on every SQLite connection:
     ```sql
     PRAGMA foreign_keys = ON;
     PRAGMA journal_mode = WAL;
     PRAGMA busy_timeout = 5000;
     ```
3. **Numerical Precision:**
   * All monetary, currency conversion, unit conversion, and formula cost calculations use **`decimal.js`** in Node.js with fixed-precision rounding (4–6 decimal places) to prevent floating-point drift.

---

## 3. Authentication & Security

1. **Single-User Account (`users` table):**
   * `id` (`INTEGER PRIMARY KEY AUTOINCREMENT`)
   * `username` (`TEXT UNIQUE NOT NULL`)
   * `password_hash` (`TEXT NOT NULL`)
   * `created_at`, `updated_at`
2. **First-Run Onboarding:**
   * When `users` has zero records on startup, the UI presents a one-time **Create Admin Account** screen.
3. **Password Hashing & Session Management:**
   * Passwords are hashed using Node.js built-in `crypto.scrypt` with a random 16-byte salt (`salt:hash`).
   * Authenticated sessions use an HMAC-SHA256 signed token stored in an `HttpOnly` cookie (and/or `Authorization: Bearer` header).
   * Supports Login, Logout, and Change Password. All data and file routes require authentication.

---

## 4. Database Schema, Constraints & Seeds

All primary tables include `created_at` and `updated_at` (`DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`).

### 4.1 `categories` (Hierarchical Tree)
* `id`: `INTEGER PRIMARY KEY AUTOINCREMENT`
* `name`: `TEXT UNIQUE NOT NULL`
* `description`: `TEXT DEFAULT NULL`
* `parent`: `INTEGER DEFAULT NULL REFERENCES categories(id) ON UPDATE CASCADE ON DELETE RESTRICT`
* **Constraints & Triggers:**
  * `CHECK (parent IS NULL OR parent <> id)`
  * `BEFORE UPDATE OF parent, id ON categories` trigger using a recursive CTE (`WITH RECURSIVE`) traversing ancestors of `NEW.parent`; invokes `SELECT RAISE(ABORT, 'Circular category loop not allowed')` if `NEW.id` is encountered.
  * `BEFORE DELETE ON categories` trigger preventing deletion of `id = 1`.
* **Seed:** `{ id: 1, name: 'uncategorized', parent: null }`

### 4.2 `tags`
* `id`: `INTEGER PRIMARY KEY AUTOINCREMENT`
* `name`: `TEXT UNIQUE NOT NULL`
* `description`: `TEXT DEFAULT NULL`

### 4.3 `uploads` (Images, PDF, Markdown, TXT)
* `id`: `INTEGER PRIMARY KEY AUTOINCREMENT`
* `original_name`: `TEXT NOT NULL`
* `extension`: `TEXT NOT NULL`
* `stored_path`: `TEXT UNIQUE NOT NULL`
* `thumbnail_path`: `TEXT DEFAULT NULL`
* `hash`: `TEXT UNIQUE NOT NULL` (SHA-256 hex digest)
* `size`: `INTEGER NOT NULL` (bytes)
* `mimetype`: `TEXT NOT NULL` (indexed)
* `notes`: `TEXT DEFAULT NULL`
* `ingested`: `BOOLEAN NOT NULL DEFAULT 0` (reserved for future RAG pipeline)
* `category`: `INTEGER NOT NULL DEFAULT 1 REFERENCES categories(id) ON UPDATE CASCADE ON DELETE RESTRICT`
* **Upload Behavior:**
  * Stream uploaded files to a temporary file while computing SHA-256 `hash`.
  * If `hash` already exists in `uploads`, immediately delete the newly uploaded temporary file, do not insert a duplicate row, and return `409` with the existing upload record so the UI notifies the user and links to the existing file.
  * Automatically generate a `200×200` WebP thumbnail for image mimetypes; display fixed type-specific icons for PDF, Markdown, and TXT files.
  * Deleting an `uploads` row removes its stored file and thumbnail from disk after DB commit.

### 4.4 `uploads_tags`
* `upload`: `INTEGER NOT NULL REFERENCES uploads(id) ON UPDATE CASCADE ON DELETE CASCADE` (indexed)
* `tag`: `INTEGER NOT NULL REFERENCES tags(id) ON UPDATE CASCADE ON DELETE CASCADE` (indexed)
* `PRIMARY KEY (upload, tag)`

### 4.5 `materials`
* `id`: `INTEGER PRIMARY KEY AUTOINCREMENT`
* `name`: `TEXT UNIQUE NOT NULL`
* `CAS`: `TEXT DEFAULT NULL` (indexed)
* `FEMA`: `TEXT DEFAULT NULL` (indexed)
* `info`: `TEXT DEFAULT NULL`
* `category`: `INTEGER NOT NULL DEFAULT 1 REFERENCES categories(id) ON UPDATE CASCADE ON DELETE RESTRICT`
* `photo`: `INTEGER DEFAULT NULL REFERENCES uploads(id) ON UPDATE CASCADE ON DELETE SET NULL`

### 4.6 `materials_tags`
* `material`: `INTEGER NOT NULL REFERENCES materials(id) ON UPDATE CASCADE ON DELETE CASCADE` (indexed)
* `tag`: `INTEGER NOT NULL REFERENCES tags(id) ON UPDATE CASCADE ON DELETE CASCADE` (indexed)
* `PRIMARY KEY (material, tag)`

### 4.7 `materials_uploads`
* `material`: `INTEGER NOT NULL REFERENCES materials(id) ON UPDATE CASCADE ON DELETE CASCADE` (indexed)
* `upload`: `INTEGER NOT NULL REFERENCES uploads(id) ON UPDATE CASCADE ON DELETE CASCADE` (indexed)
* `PRIMARY KEY (material, upload)`

### 4.8 `suppliers`
* `id`: `INTEGER PRIMARY KEY AUTOINCREMENT`
* `name`: `TEXT UNIQUE NOT NULL`
* `info`: `TEXT DEFAULT NULL`
* **Seed:** `{ id: 1, name: 'virtual supplier' }` (protected from deletion)

### 4.9 `suppliers_uploads`
* `supplier`: `INTEGER NOT NULL REFERENCES suppliers(id) ON UPDATE CASCADE ON DELETE CASCADE` (indexed)
* `upload`: `INTEGER NOT NULL REFERENCES uploads(id) ON UPDATE CASCADE ON DELETE CASCADE` (indexed)
* `PRIMARY KEY (supplier, upload)`

### 4.10 `currencies`
* `id`: `INTEGER PRIMARY KEY AUTOINCREMENT`
* `name`: `TEXT UNIQUE NOT NULL`
* `in_usd`: `DECIMAL(12, 6) NOT NULL DEFAULT 0` (value of 1 unit of currency in USD)
* **Seed:** `{ id: 1, name: 'USD', in_usd: 1 }` (protected from deletion)

### 4.11 `units`
* `id`: `INTEGER PRIMARY KEY AUTOINCREMENT`
* `name`: `TEXT UNIQUE NOT NULL`
* `equal_in_kg`: `DECIMAL(12, 6) NOT NULL CHECK (equal_in_kg > 0)` (kg equivalent of 1 unit; e.g., `5 kg` -> `5`, `g` -> `0.001`)
* **Seed:** `{ id: 1, name: 'kg', equal_in_kg: 1 }` (protected from deletion)

### 4.12 `ingredients`
* `id`: `INTEGER PRIMARY KEY AUTOINCREMENT`
* `name`: `TEXT UNIQUE NOT NULL`
* `category`: `INTEGER NOT NULL DEFAULT 1 REFERENCES categories(id) ON UPDATE CASCADE ON DELETE RESTRICT`
* `material`: `INTEGER DEFAULT NULL REFERENCES materials(id) ON UPDATE CASCADE ON DELETE SET NULL`
* `supplier`: `INTEGER DEFAULT 1 REFERENCES suppliers(id) ON UPDATE CASCADE ON DELETE SET NULL`
* `photo`: `INTEGER DEFAULT NULL REFERENCES uploads(id) ON UPDATE CASCADE ON DELETE SET NULL`
* `info`: `TEXT DEFAULT NULL`
* `cost`: `DECIMAL(12, 4) NOT NULL DEFAULT 0` (cost per 1 `unit` in `currency`)
* `unit`: `INTEGER NOT NULL DEFAULT 1 REFERENCES units(id) ON UPDATE CASCADE ON DELETE RESTRICT`
* `currency`: `INTEGER NOT NULL DEFAULT 1 REFERENCES currencies(id) ON UPDATE CASCADE ON DELETE RESTRICT`

### 4.13 `ingredients_tags`
* `ingredient`: `INTEGER NOT NULL REFERENCES ingredients(id) ON UPDATE CASCADE ON DELETE CASCADE` (indexed)
* `tag`: `INTEGER NOT NULL REFERENCES tags(id) ON UPDATE CASCADE ON DELETE CASCADE` (indexed)
* `PRIMARY KEY (ingredient, tag)`

### 4.14 `ingredients_uploads`
* `ingredient`: `INTEGER NOT NULL REFERENCES ingredients(id) ON UPDATE CASCADE ON DELETE CASCADE` (indexed)
* `upload`: `INTEGER NOT NULL REFERENCES uploads(id) ON UPDATE CASCADE ON DELETE CASCADE` (indexed)
* `PRIMARY KEY (ingredient, upload)`

### 4.15 `formulas`
* `id`: `INTEGER PRIMARY KEY AUTOINCREMENT`
* `name`: `TEXT UNIQUE NOT NULL`
* `category`: `INTEGER NOT NULL DEFAULT 1 REFERENCES categories(id) ON UPDATE CASCADE ON DELETE RESTRICT`
* `info`: `TEXT DEFAULT NULL`
* `directions`: `TEXT DEFAULT NULL`
* `calculated_usd_cost`: `DECIMAL(14, 4) NOT NULL DEFAULT 0` (always in USD)

### 4.16 `formulas_tags`
* `formula`: `INTEGER NOT NULL REFERENCES formulas(id) ON UPDATE CASCADE ON DELETE CASCADE` (indexed)
* `tag`: `INTEGER NOT NULL REFERENCES tags(id) ON UPDATE CASCADE ON DELETE CASCADE` (indexed)
* `PRIMARY KEY (formula, tag)`

### 4.17 `formulas_uploads`
* `formula`: `INTEGER NOT NULL REFERENCES formulas(id) ON UPDATE CASCADE ON DELETE CASCADE` (indexed)
* `upload`: `INTEGER NOT NULL REFERENCES uploads(id) ON UPDATE CASCADE ON DELETE CASCADE` (indexed)
* `PRIMARY KEY (formula, upload)`

### 4.18 `formulas_ingredients`
* `formula`: `INTEGER NOT NULL REFERENCES formulas(id) ON UPDATE CASCADE ON DELETE CASCADE` (indexed)
* `ingredient`: `INTEGER NOT NULL REFERENCES ingredients(id) ON UPDATE CASCADE ON DELETE RESTRICT` (indexed)
* `quantity`: `DECIMAL(12, 4) NOT NULL DEFAULT 0` (number of the ingredient's `unit`s)
* `PRIMARY KEY (formula, ingredient)`

---

## 5. Transactional Cost & Weight Calculations

* `formulas.calculated_usd_cost` is **always stored in USD**, calculated as:
  $$\text{calculated\_usd\_cost} = \sum \big(\text{quantity} \times \text{ingredient.cost} \times \text{currency.in\_usd}\big)$$
  using `decimal.js` rounded to 4 decimal places.
* **Transactional Cascade:** `calculated_usd_cost` is automatically recalculated **inside the same database transaction** whenever:
  1. `formulas_ingredients` rows are added, updated, or deleted.
  2. An `ingredient`'s `cost` or `currency` is updated (all referencing formulas are recalculated).
  3. A `currency`'s `in_usd` exchange rate is updated (all formulas using ingredients with that currency are recalculated).
* **Weight & Percentage Calculation:**
  * Row weight (kg) $= \text{quantity} \times \text{unit.equal\_in\_kg}$ (e.g., $0.3 \times 5\text{ kg} = 1.5\text{ kg}$).
  * Total batch weight (kg) $= \sum \text{row weight (kg)}$.
  * Row weight percentage $= \frac{\text{row weight (kg)}}{\text{total batch weight (kg)}} \times 100$.

---

## 6. UI, UX & Functional Requirements

1. **Entity Management & Productivity Features:**
   * Full Create, Read, Update, Delete (CRUD) for all entities.
   * Expandable tree view for `categories`, plus option to filter entity lists by category **including subcategories**.
   * Server-side search (`name`, plus `CAS`/`FEMA` for materials), tag filtering, and column sorting.
   * **Clone Formula** button to duplicate a formula along with its ingredients, tags, and attached uploads.
   * **Export Formula** to CSV or Markdown, plus **One-Click SQLite Backup** download.
2. **Pagination Rules:**
   * Every list view and every related-entity tab uses server-side pagination with **`page_size = 10`**.
   * **Exception:** On a single **Formula** detail view, the **Ingredients & Quantities** table lists **all** ingredients in that formula without pagination.
3. **Relation Links:**
   * Every foreign-key field renders the related record's `name` (and thumbnail for `photo`) as a clickable link opening that record's detail view.
4. **Tabbed Single-Record Views:**
   * Every single-record view displays record details at the top and a tabbed section underneath containing one tab per related entity list.
   * Only the currently selected tab is rendered and fetched; clicking a tab header switches the active tab.
5. **Typeahead Relation Pickers:**
   * Users never enter numeric IDs. All relation inputs use a searchable dropdown/combobox filtering records by `name` as characters are typed.
6. **Theming:**
   * Supports **Dark** and **Light** themes with a persistent header toggle; **Dark** is the default.
