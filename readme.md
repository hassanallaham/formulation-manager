# FormuLab — Formulation, Ingredient, Material & Supplier Manager

A lightweight, single-user, offline-first desktop application for managing raw materials, suppliers, ingredients, units, multi-currency pricing, file uploads, hierarchical categories, tags, and formulations.

Built with **Node.js**, **Express**, **Knex.js**, **SQLite (`better-sqlite3`)**, **React + Tailwind CSS**, and packaged as a Linux **`.deb`** desktop application using **Tauri v2** (OS WebKitGTK WebView + system Node.js sidecar).

---

## Key Features

* **Single-User Local Authentication:**
  * First-run onboarding screen creates your local admin account (no hardcoded default password).
  * Passwords are salted and hashed with Node's built-in `crypto.scrypt` (`salt:hash`), verified with `crypto.timingSafeEqual`.
  * Signed session cookies + `Authorization: Bearer` support, plus in-app **Change Password**.
* **Hierarchical Categories Tree:**
  * Enforces `parent <> id` (`CHECK` constraint) and includes a SQLite `BEFORE UPDATE` recursive CTE trigger that blocks circular branch loops.
  * Seeded with `id = 1` (`uncategorized`, protected from deletion).
  * Interactive **Tree View** and **List View** with option to filter entities by a category *including all subcategories*.
* **Materials, Suppliers, Units & Currencies:**
  * **Materials:** Tracks `CAS`, `FEMA`, `info`, `category`, `photo`, tags, and attached document uploads.
  * **Suppliers:** Seeded with `id = 1` (`virtual supplier`, protected from deletion) and supports attached document uploads (`suppliers_uploads`).
  * **Currencies:** Tracks `in_usd` exchange rate; seeded with `id = 1` (`USD`, `in_usd = 1`, protected from deletion).
  * **Units:** Tracks `equal_in_kg` (`> 0`); seeded with `id = 1` (`kg`, `equal_in_kg = 1`, protected from deletion). For example, a `5 kg` container unit has `equal_in_kg = 5`, so `0.3` units equals `1.5 kg`.
* **Ingredients & Transactional Formula Costing:**
  * Ingredients link to `category`, `material`, `supplier`, `photo`, `unit`, `currency`, `cost` (per 1 unit), tags, and document uploads.
  * **Formulas** automatically compute `calculated_usd_cost` in **USD** using **`decimal.js`** fixed-precision arithmetic inside the same database transaction whenever:
    * Formula ingredients/quantities are added, edited, or deleted.
    * An ingredient's `cost` or `currency` is updated.
    * A currency's `in_usd` exchange rate is updated.
  * **Formula Detail View** displays all ingredients **without pagination**, showing Quantity, Unit, Weight (kg), Weight %, Line Cost (USD), Total Batch Weight (kg), **Clone Formula**, and **CSV / Markdown export**.
* **Uploads & Deduplication:**
  * Supports images, PDF, Markdown, and TXT files.
  * Streams uploads while computing a **SHA-256 `hash`**. If an identical file already exists, the newly uploaded temporary file is immediately deleted and the UI notifies the user with a direct link to the existing record.
  * Automatically generates `200×200` WebP thumbnails for image uploads via `sharp`, and displays clean file-type icons for PDF, Markdown, and TXT.
  * Includes an `ingested` boolean flag reserved for future RAG pipelines.
* **Fast, Resource-Light UX:**
  * Server-side pagination (`page_size = 10`) on all entity list views and detail tabs (except formula ingredients).
  * Every foreign key renders as a clickable link showing the related record's `name`.
  * Single-record detail views render lazy-loaded tabs underneath—only the active tab is fetched and mounted.
  * Searchable typeahead dropdowns (`AsyncCombobox`) for all relation fields—no numeric IDs to memorize.
  * **Dark** (default) and **Light** theme toggle persisted across sessions.
  * One-click SQLite `VACUUM INTO` database backup download.

---

## Project Structure

```text
├── srs.md                        # Finalized Software Requirements Specification
├── readme.md                     # Documentation & build instructions
├── server.ts                     # Express server + Vite dev / static production host
├── server/
│   ├── config.ts                 # Data directory paths & confined file path helpers
│   ├── db.ts                     # Knex + better-sqlite3 pool (PRAGMA foreign_keys = ON, WAL)
│   ├── migrations.ts             # Idempotent schema, indexes, triggers & seeds
│   ├── middleware/auth.ts        # scrypt password hashing & HMAC session tokens
│   ├── services/costing.ts       # Transactional decimal.js USD cost recalculation
│   ├── utils/
│   │   ├── errors.ts             # SQLite constraint & trigger error mapping
│   │   └── queryHelpers.ts       # Pagination & recursive category subtree queries
│   └── routes/
│       ├── auth.ts               # Setup, login, logout, status, change-password
│       ├── taxonomy.ts           # Categories (tree + CRUD) & Tags
│       ├── uploads.ts            # Streaming SHA-256 dedupe, Sharp thumbnails, file serving
│       ├── catalog.ts            # Materials, Suppliers, Currencies, Units
│       ├── ingredients.ts        # Ingredients CRUD & cost cascade
│       ├── formulas.ts           # Formulas CRUD, all-row ingredients, clone, CSV/MD export
│       └── system.ts             # Health check, stats, and SQLite backup
├── src/
│   ├── App.tsx                   # App shell, navigation sidebar, theme toggle, routing
│   ├── types.ts                  # TypeScript entity interfaces
│   ├── lib/api.ts                # Fetch client with Bearer/cookie auth & error parsing
│   ├── components/
│   │   ├── AsyncCombobox.tsx     # Typeahead relation picker
│   │   ├── AuthGate.tsx          # First-run setup, login & change-password modal
│   │   ├── CategoryTree.tsx      # Collapsible category hierarchy view
│   │   ├── DetailTabs.tsx        # Lazy-loaded paginated tabs for detail views
│   │   ├── EntityLink.tsx        # Clickable relation link
│   │   ├── EntityModal.tsx       # Create/Edit modal for all 9 entities
│   │   ├── PaginationBar.tsx     # Page size 10 pagination controls
│   │   └── UploadPreview.tsx     # WebP thumbnail / file-type icon renderer
│   └── views/
│       ├── ListView.tsx          # Paginated list view with search & filters
│       └── DetailView.tsx        # Single-record detail view + Formula Ingredients table
└── src-tauri/                    # Tauri v2 Linux desktop shell (.deb target)
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── capabilities/default.json
    └── src/
        ├── main.rs
        └── lib.rs                # Spawns system `node` on ephemeral port & cleans up on exit
```

---

## Development Setup (Web / Local Server)

### Prerequisites
* **Node.js** `v22+` or **`v24.22.3`**

### Install & Run
```bash
npm install
npm run dev
```
Open `http://localhost:3000` in your browser. Data is stored in `./data/` (`app.db`, `uploads/`, `thumbs/`), or override with `DATA_DIR=/path/to/data`.

### Build Production Bundles
```bash
npm run build         # Builds React frontend into dist/
npm run build:server  # Bundles Express/Knex backend into dist-server/server.mjs
```

---

## Building the Linux `.deb` Package (Tauri v2 + System Node.js `v24.22.3`)

This project uses **Tauri v2** configured to build **only a `.deb` package** without bundling a redundant Node.js binary (`nodejs (>= 24.0.0)` is declared as a Debian package dependency).

### 1. Install Linux Build Prerequisites (Ubuntu / Debian)
```bash
sudo apt update
sudo apt install -y \
  build-essential curl wget file libssl-dev libayatana-appindicator3-dev \
  librsvg2-dev libwebkit2gtk-4.1-dev libgtk-3-dev patchelf
```
Install Rust and Tauri CLI:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install tauri-cli --version "^2"
```

### 2. Verify Native Addon ABI for Node.js `v24.22.3`
Because `better-sqlite3` and `sharp` include native bindings, run `npm install` (or `npm rebuild`) **using Node.js `v24.22.3`** on the build machine before packaging so the bundled `node_modules` native `.node` binaries match the target user's Node.js ABI:
```bash
node -v   # Should print v24.22.3
npm ci
```

### 3. Build the `.deb` Installer
```bash
cargo tauri build
```
Tauri will automatically run `npm run build && npm run build:server`, package the frontend, `dist-server/server.mjs`, and `node_modules` into `/usr/lib/FormuLab/server/`, and output the `.deb` file at:
```text
src-tauri/target/release/bundle/deb/FormuLab_1.0.0_amd64.deb
```

### 4. Install & Run on Target Laptop
```bash
sudo apt install ./src-tauri/target/release/bundle/deb/FormuLab_1.0.0_amd64.deb
```
At runtime, user data (`app.db`, `uploads/`, `thumbs/`) is stored safely in:
```text
~/.local/share/app.formulab.desktop/
```

---

## Database Notes & Integrity Rules

* **Foreign Keys & WAL Mode:** Enabled on every SQLite connection in `server/db.ts` via `pool.afterCreate`.
* **Protected Defaults (`id = 1`):**
  * `categories`: `uncategorized`
  * `suppliers`: `virtual supplier`
  * `currencies`: `USD` (`in_usd = 1`)
  * `units`: `kg` (`equal_in_kg = 1`)
* **Backups:** Click **Backup Database** in the sidebar at any time to download a consistent `VACUUM INTO` SQLite snapshot (`formulab-YYYY-MM-DD.db`). Remember to back up your `uploads/` and `thumbs/` directories alongside the `.db` file if migrating machines.
