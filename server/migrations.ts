import { db } from './db.js';

export async function initDatabase(): Promise<void> {
  // 1. users (single-user local auth)
  if (!(await db.schema.hasTable('users'))) {
    await db.schema.createTable('users', (t) => {
      t.increments('id').primary();
      t.string('username').notNullable().unique();
      t.string('password_hash').notNullable();
      t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
    });
  }

  // 2. categories (hierarchical tree)
  if (!(await db.schema.hasTable('categories'))) {
    await db.raw(`
      CREATE TABLE categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT DEFAULT NULL,
        parent INTEGER DEFAULT NULL REFERENCES categories(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (parent IS NULL OR parent <> id)
      )
    `);
    await db.raw(`CREATE INDEX idx_categories_parent ON categories(parent)`);
  }

  // Circular loop prevention trigger on categories + protect seeded id = 1
  await db.raw(`
    CREATE TRIGGER IF NOT EXISTS trg_categories_prevent_cycle_update
    BEFORE UPDATE OF parent, id ON categories
    WHEN NEW.parent IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'Circular category loop is not allowed')
      WHERE EXISTS (
        WITH RECURSIVE ancestors(id) AS (
          SELECT NEW.parent
          UNION ALL
          SELECT c.parent
          FROM categories c
          JOIN ancestors a ON c.id = a.id
          WHERE c.parent IS NOT NULL
        )
        SELECT 1 FROM ancestors WHERE id = NEW.id OR id = OLD.id
      );
    END;
  `);

  await db.raw(`
    CREATE TRIGGER IF NOT EXISTS trg_categories_protect_seeded
    BEFORE DELETE ON categories
    WHEN OLD.id = 1
    BEGIN
      SELECT RAISE(ABORT, 'Cannot delete default uncategorized category');
    END;
  `);

  // Seed id = 1 uncategorized
  await db('categories')
    .insert({ id: 1, name: 'uncategorized', description: 'Default root category', parent: null })
    .onConflict('id')
    .ignore();

  // 3. tags
  if (!(await db.schema.hasTable('tags'))) {
    await db.schema.createTable('tags', (t) => {
      t.increments('id').primary();
      t.string('name').notNullable().unique();
      t.text('description').nullable().defaultTo(null);
      t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
    });
  }

  // 4. uploads
  if (!(await db.schema.hasTable('uploads'))) {
    await db.schema.createTable('uploads', (t) => {
      t.increments('id').primary();
      t.string('original_name').notNullable();
      t.string('extension').notNullable();
      t.string('stored_path').notNullable().unique();
      t.string('thumbnail_path').nullable().defaultTo(null);
      t.string('hash').notNullable().unique();
      t.integer('size').notNullable();
      t.string('mimetype').notNullable().index();
      t.text('notes').nullable().defaultTo(null);
      t.boolean('ingested').notNullable().defaultTo(false);
      t.integer('category')
        .notNullable()
        .defaultTo(1)
        .references('id')
        .inTable('categories')
        .onUpdate('CASCADE')
        .onDelete('RESTRICT')
        .index();
      t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
    });
  }

  // 5. uploads_tags
  if (!(await db.schema.hasTable('uploads_tags'))) {
    await db.schema.createTable('uploads_tags', (t) => {
      t.integer('upload')
        .notNullable()
        .references('id')
        .inTable('uploads')
        .onUpdate('CASCADE')
        .onDelete('CASCADE')
        .index();
      t.integer('tag')
        .notNullable()
        .references('id')
        .inTable('tags')
        .onUpdate('CASCADE')
        .onDelete('CASCADE')
        .index();
      t.primary(['upload', 'tag']);
    });
  }

  // 6. materials
  if (!(await db.schema.hasTable('materials'))) {
    await db.schema.createTable('materials', (t) => {
      t.increments('id').primary();
      t.string('name').notNullable().unique();
      t.string('CAS').nullable().defaultTo(null).index();
      t.string('FEMA').nullable().defaultTo(null).index();
      t.text('info').nullable().defaultTo(null);
      t.integer('category')
        .notNullable()
        .defaultTo(1)
        .references('id')
        .inTable('categories')
        .onUpdate('CASCADE')
        .onDelete('RESTRICT')
        .index();
      t.integer('photo')
        .nullable()
        .defaultTo(null)
        .references('id')
        .inTable('uploads')
        .onUpdate('CASCADE')
        .onDelete('SET NULL');
      t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
    });
  }

  // 7. materials_tags
  if (!(await db.schema.hasTable('materials_tags'))) {
    await db.schema.createTable('materials_tags', (t) => {
      t.integer('material')
        .notNullable()
        .references('id')
        .inTable('materials')
        .onUpdate('CASCADE')
        .onDelete('CASCADE')
        .index();
      t.integer('tag')
        .notNullable()
        .references('id')
        .inTable('tags')
        .onUpdate('CASCADE')
        .onDelete('CASCADE')
        .index();
      t.primary(['material', 'tag']);
    });
  }

  // 8. materials_uploads
  if (!(await db.schema.hasTable('materials_uploads'))) {
    await db.schema.createTable('materials_uploads', (t) => {
      t.integer('material')
        .notNullable()
        .references('id')
        .inTable('materials')
        .onUpdate('CASCADE')
        .onDelete('CASCADE')
        .index();
      t.integer('upload')
        .notNullable()
        .references('id')
        .inTable('uploads')
        .onUpdate('CASCADE')
        .onDelete('CASCADE')
        .index();
      t.primary(['material', 'upload']);
    });
  }

  // 9. suppliers
  if (!(await db.schema.hasTable('suppliers'))) {
    await db.schema.createTable('suppliers', (t) => {
      t.increments('id').primary();
      t.string('name').notNullable().unique();
      t.text('info').nullable().defaultTo(null);
      t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
    });
  }

  await db.raw(`
    CREATE TRIGGER IF NOT EXISTS trg_suppliers_protect_seeded
    BEFORE DELETE ON suppliers
    WHEN OLD.id = 1
    BEGIN
      SELECT RAISE(ABORT, 'Cannot delete default virtual supplier');
    END;
  `);

  await db('suppliers')
    .insert({ id: 1, name: 'virtual supplier', info: 'Default placeholder supplier' })
    .onConflict('id')
    .ignore();

  // 10. suppliers_uploads
  if (!(await db.schema.hasTable('suppliers_uploads'))) {
    await db.schema.createTable('suppliers_uploads', (t) => {
      t.integer('supplier')
        .notNullable()
        .references('id')
        .inTable('suppliers')
        .onUpdate('CASCADE')
        .onDelete('CASCADE')
        .index();
      t.integer('upload')
        .notNullable()
        .references('id')
        .inTable('uploads')
        .onUpdate('CASCADE')
        .onDelete('CASCADE')
        .index();
      t.primary(['supplier', 'upload']);
    });
  }

  // 11. currencies
  if (!(await db.schema.hasTable('currencies'))) {
    await db.schema.createTable('currencies', (t) => {
      t.increments('id').primary();
      t.string('name').notNullable().unique();
      t.decimal('in_usd', 12, 6).notNullable().defaultTo(0);
      t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
    });
  }

  await db.raw(`
    CREATE TRIGGER IF NOT EXISTS trg_currencies_protect_seeded
    BEFORE DELETE ON currencies
    WHEN OLD.id = 1
    BEGIN
      SELECT RAISE(ABORT, 'Cannot delete default USD currency');
    END;
  `);

  await db('currencies')
    .insert({ id: 1, name: 'USD', in_usd: 1 })
    .onConflict('id')
    .ignore();

  // 12. units
  if (!(await db.schema.hasTable('units'))) {
    await db.raw(`
      CREATE TABLE units (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        equal_in_kg DECIMAL(12, 6) NOT NULL DEFAULT 1 CHECK (equal_in_kg > 0),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  await db.raw(`
    CREATE TRIGGER IF NOT EXISTS trg_units_protect_seeded
    BEFORE DELETE ON units
    WHEN OLD.id = 1
    BEGIN
      SELECT RAISE(ABORT, 'Cannot delete default kg unit');
    END;
  `);

  await db('units')
    .insert({ id: 1, name: 'kg', equal_in_kg: 1 })
    .onConflict('id')
    .ignore();

  // 13. ingredients
  if (!(await db.schema.hasTable('ingredients'))) {
    await db.schema.createTable('ingredients', (t) => {
      t.increments('id').primary();
      t.string('name').notNullable().unique();
      t.integer('category')
        .notNullable()
        .defaultTo(1)
        .references('id')
        .inTable('categories')
        .onUpdate('CASCADE')
        .onDelete('RESTRICT')
        .index();
      t.integer('material')
        .nullable()
        .defaultTo(null)
        .references('id')
        .inTable('materials')
        .onUpdate('CASCADE')
        .onDelete('SET NULL')
        .index();
      t.text('info').nullable().defaultTo(null);
      t.integer('supplier')
        .nullable()
        .defaultTo(1)
        .references('id')
        .inTable('suppliers')
        .onUpdate('CASCADE')
        .onDelete('SET NULL')
        .index();
      t.integer('photo')
        .nullable()
        .defaultTo(null)
        .references('id')
        .inTable('uploads')
        .onUpdate('CASCADE')
        .onDelete('SET NULL');
      t.decimal('cost', 12, 4).notNullable().defaultTo(0);
      t.integer('unit')
        .notNullable()
        .defaultTo(1)
        .references('id')
        .inTable('units')
        .onUpdate('CASCADE')
        .onDelete('RESTRICT')
        .index();
      t.integer('currency')
        .notNullable()
        .defaultTo(1)
        .references('id')
        .inTable('currencies')
        .onUpdate('CASCADE')
        .onDelete('RESTRICT')
        .index();
      t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
    });
  }

  // 14. ingredients_tags
  if (!(await db.schema.hasTable('ingredients_tags'))) {
    await db.schema.createTable('ingredients_tags', (t) => {
      t.integer('ingredient')
        .notNullable()
        .references('id')
        .inTable('ingredients')
        .onUpdate('CASCADE')
        .onDelete('CASCADE')
        .index();
      t.integer('tag')
        .notNullable()
        .references('id')
        .inTable('tags')
        .onUpdate('CASCADE')
        .onDelete('CASCADE')
        .index();
      t.primary(['ingredient', 'tag']);
    });
  }

  // 15. ingredients_uploads
  if (!(await db.schema.hasTable('ingredients_uploads'))) {
    await db.schema.createTable('ingredients_uploads', (t) => {
      t.integer('ingredient')
        .notNullable()
        .references('id')
        .inTable('ingredients')
        .onUpdate('CASCADE')
        .onDelete('CASCADE')
        .index();
      t.integer('upload')
        .notNullable()
        .references('id')
        .inTable('uploads')
        .onUpdate('CASCADE')
        .onDelete('CASCADE')
        .index();
      t.primary(['ingredient', 'upload']);
    });
  }

  // 16. formulas
  if (!(await db.schema.hasTable('formulas'))) {
    await db.schema.createTable('formulas', (t) => {
      t.increments('id').primary();
      t.string('name').notNullable().unique();
      t.integer('category')
        .notNullable()
        .defaultTo(1)
        .references('id')
        .inTable('categories')
        .onUpdate('CASCADE')
        .onDelete('RESTRICT')
        .index();
      t.text('info').nullable().defaultTo(null);
      t.text('directions').nullable().defaultTo(null);
      t.decimal('calculated_usd_cost', 14, 4).notNullable().defaultTo(0);
      t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
    });
  }

  // 17. formulas_tags
  if (!(await db.schema.hasTable('formulas_tags'))) {
    await db.schema.createTable('formulas_tags', (t) => {
      t.integer('formula')
        .notNullable()
        .references('id')
        .inTable('formulas')
        .onUpdate('CASCADE')
        .onDelete('CASCADE')
        .index();
      t.integer('tag')
        .notNullable()
        .references('id')
        .inTable('tags')
        .onUpdate('CASCADE')
        .onDelete('CASCADE')
        .index();
      t.primary(['formula', 'tag']);
    });
  }

  // 18. formulas_uploads
  if (!(await db.schema.hasTable('formulas_uploads'))) {
    await db.schema.createTable('formulas_uploads', (t) => {
      t.integer('formula')
        .notNullable()
        .references('id')
        .inTable('formulas')
        .onUpdate('CASCADE')
        .onDelete('CASCADE')
        .index();
      t.integer('upload')
        .notNullable()
        .references('id')
        .inTable('uploads')
        .onUpdate('CASCADE')
        .onDelete('CASCADE')
        .index();
      t.primary(['formula', 'upload']);
    });
  }

  // 19. formulas_ingredients
  if (!(await db.schema.hasTable('formulas_ingredients'))) {
    await db.schema.createTable('formulas_ingredients', (t) => {
      t.integer('formula')
        .notNullable()
        .references('id')
        .inTable('formulas')
        .onUpdate('CASCADE')
        .onDelete('CASCADE')
        .index();
      t.integer('ingredient')
        .notNullable()
        .references('id')
        .inTable('ingredients')
        .onUpdate('CASCADE')
        .onDelete('RESTRICT')
        .index();
      t.decimal('quantity', 12, 4).notNullable().defaultTo(0);
      t.primary(['formula', 'ingredient']);
    });
  }

  // 20. Column upgrades for regulatory max_percent & upload ingestion status
  if (!(await db.schema.hasColumn('materials', 'max_percent'))) {
    await db.schema.alterTable('materials', (t) => {
      t.decimal('max_percent', 6, 2).nullable().defaultTo(null);
    });
  }
  if (!(await db.schema.hasColumn('ingredients', 'max_percent'))) {
    await db.schema.alterTable('ingredients', (t) => {
      t.decimal('max_percent', 6, 2).nullable().defaultTo(null);
    });
  }
  if (!(await db.schema.hasColumn('uploads', 'ingestion_status'))) {
    await db.schema.alterTable('uploads', (t) => {
      t.string('ingestion_status').notNullable().defaultTo('pending');
      t.text('ingestion_error').nullable().defaultTo(null);
    });
  }

  // 21. Cost history tables
  if (!(await db.schema.hasTable('formula_cost_snapshots'))) {
    await db.schema.createTable('formula_cost_snapshots', (t) => {
      t.increments('id').primary();
      t.integer('formula')
        .notNullable()
        .references('id')
        .inTable('formulas')
        .onUpdate('CASCADE')
        .onDelete('CASCADE')
        .index();
      t.decimal('calculated_usd_cost', 14, 4).notNullable().defaultTo(0);
      t.string('reason').notNullable().defaultTo('recalculation');
      t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
    });
  }

  if (!(await db.schema.hasTable('ingredient_cost_history'))) {
    await db.schema.createTable('ingredient_cost_history', (t) => {
      t.increments('id').primary();
      t.integer('ingredient')
        .notNullable()
        .references('id')
        .inTable('ingredients')
        .onUpdate('CASCADE')
        .onDelete('CASCADE')
        .index();
      t.decimal('cost', 12, 4).notNullable().defaultTo(0);
      t.integer('currency')
        .notNullable()
        .references('id')
        .inTable('currencies')
        .onUpdate('CASCADE')
        .onDelete('RESTRICT');
      t.decimal('in_usd', 12, 6).notNullable().defaultTo(1);
      t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
    });
  }

  // 22. LLM Settings (separate Chat & Embedding providers)
  if (!(await db.schema.hasTable('llm_settings'))) {
    await db.schema.createTable('llm_settings', (t) => {
      t.string('role').primary(); // 'chat' | 'embedding'
      t.string('provider_preset').notNullable().defaultTo('lmstudio');
      t.string('base_url').notNullable().defaultTo('http://127.0.0.1:1234/v1');
      t.text('api_key_encrypted').nullable().defaultTo(null);
      t.string('model').notNullable().defaultTo('');
      t.integer('dimensions').nullable().defaultTo(null);
      t.decimal('temperature', 4, 2).notNullable().defaultTo(0.2);
      t.integer('max_tokens').notNullable().defaultTo(2048);
      t.integer('top_k_rag').notNullable().defaultTo(8);
      t.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
    });
  }

  await db('llm_settings')
    .insert([
      {
        role: 'chat',
        provider_preset: 'lmstudio',
        base_url: 'http://127.0.0.1:1234/v1',
        model: '',
        dimensions: null,
        temperature: 0.2,
        max_tokens: 2048,
        top_k_rag: 8,
      },
      {
        role: 'embedding',
        provider_preset: 'llamacpp',
        base_url: 'http://127.0.0.1:8080/v1',
        model: '',
        dimensions: 768,
        temperature: 0,
        max_tokens: 512,
        top_k_rag: 8,
      },
    ])
    .onConflict('role')
    .ignore();

  // 23. RAG Index Metadata & Hybrid Chunks (SQLite FTS5 + Float32 Vector BLOBs)
  if (!(await db.schema.hasTable('rag_index_meta'))) {
    await db.raw(`
      CREATE TABLE rag_index_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        provider_preset TEXT DEFAULT NULL,
        base_url TEXT DEFAULT NULL,
        model TEXT DEFAULT NULL,
        dimensions INTEGER DEFAULT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  if (!(await db.schema.hasTable('rag_chunks'))) {
    await db.schema.createTable('rag_chunks', (t) => {
      t.increments('id').primary();
      t.string('source_type').notNullable(); // 'upload' | 'material' | 'ingredient' | 'formula' | 'supplier'
      t.integer('source_id').notNullable();
      t.integer('chunk_index').notNullable().defaultTo(0);
      t.string('title').notNullable();
      t.text('metadata_text').notNullable().defaultTo('');
      t.integer('page_number').nullable().defaultTo(null);
      t.string('section_title').nullable().defaultTo(null);
      t.text('content').notNullable();
      t.integer('token_count').notNullable().defaultTo(0);
      t.integer('dimensions').nullable().defaultTo(null);
      t.binary('embedding').nullable().defaultTo(null);
      t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
      t.index(['source_type', 'source_id']);
    });
  }

  await db.raw(`
    CREATE VIRTUAL TABLE IF NOT EXISTS rag_fts USING fts5(
      chunk_id UNINDEXED,
      title,
      metadata_text,
      content,
      tokenize='porter unicode61'
    )
  `);

  // 24. Agentic Chat Sessions & Messages
  if (!(await db.schema.hasTable('chat_sessions'))) {
    await db.schema.createTable('chat_sessions', (t) => {
      t.increments('id').primary();
      t.string('title').notNullable().defaultTo('New Formulation Chat');
      t.string('scope_entity').nullable().defaultTo(null);
      t.integer('scope_id').nullable().defaultTo(null);
      t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
    });
  }

  if (!(await db.schema.hasTable('chat_messages'))) {
    await db.schema.createTable('chat_messages', (t) => {
      t.increments('id').primary();
      t.integer('session_id')
        .notNullable()
        .references('id')
        .inTable('chat_sessions')
        .onUpdate('CASCADE')
        .onDelete('CASCADE')
        .index();
      t.string('role').notNullable(); // 'user' | 'assistant'
      t.text('content').notNullable();
      t.text('tool_calls_json').nullable().defaultTo(null);
      t.text('citations_json').nullable().defaultTo(null);
      t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
    });
  }
}
