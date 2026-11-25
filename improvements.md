# FormuLab Improvements & Agentic Hybrid RAG Specification

## 1. Dual LLM Provider Configuration (Chat & Embedding + Dimensions)

* **Separate Profiles (`llm_settings` table):**
  * Independently configure **Chat LLM** and **Embedding LLM** (`role`: `'chat' | 'embedding'`).
  * Supports local OpenAI-compatible servers (**`llama.cpp` `llama-server`**, **LM Studio**, **Ollama**) as well as cloud OpenAI-compatible endpoints and Gemini's OpenAI-compatible endpoint.
  * Fields per profile:
    * `provider_preset`: `'lmstudio' | 'llamacpp' | 'ollama' | 'openai' | 'custom'`
    * `base_url`: e.g. `http://127.0.0.1:1234/v1` (LM Studio) or `http://127.0.0.1:8080/v1` (`llama.cpp`)
    * `api_key_encrypted`: stored encrypted on server (AES-256-GCM using server key), masked in API responses (`has_api_key: boolean`), never returned to the browser.
    * `model`: selected model identifier (discoverable via `GET <base_url>/models`).
    * `dimensions`: integer embedding dimension (`384`, `768`, `1024`, `1536`, etc.) sent to `/v1/embeddings` when configured and validated against the actual returned vector length.
    * `temperature`, `max_tokens`, `top_k_rag`.
* **Dimension & Model Change Safeguard (`rag_index_meta`):**
  * Tracks the active `(embedding_provider, embedding_model, dimensions)` used to generate stored vectors.
  * When the embedding model or `dimensions` changes, existing vectors become incompatible; the UI warns the user and offers a one-click **Re-index All Documents** action that clears stale chunks, resets `uploads.ingested = 0`, and re-indexes cleanly.
* **Connection Tester:** Tests live connectivity to `base_url` (discovering models or generating a sample embedding and reporting actual vector length + latency).

---

## 2. SQLite-Native Hybrid Search (Zero External Vector DB)

* **Lexical Search (FTS5 BM25):**
  * `rag_fts` FTS5 virtual table indexing `title`, `content`, and `metadata_text` (`CAS`, `FEMA`, `category`, `tags`, `supplier`) for exact keyword, chemical code, and identifier matching.
* **Semantic Vector Search:**
  * `rag_chunks` table storing `embedding BLOB` (`Float32Array` binary buffer) alongside `source_type` (`'upload' | 'material' | 'ingredient' | 'formula' | 'supplier'`), `source_id`, `chunk_index`, `page_number`, `section_title`, `content`, `dimensions`, and `token_count`.
  * Cosine similarity computed directly in V8 over `Float32Array` buffers—zero external processes, minimal RAM/CPU, and zero native-extension `.deb` ABI fragility.
* **Reciprocal Rank Fusion (RRF):**
  * Combines Top-25 FTS5 BM25 results and Top-25 vector cosine results via:
    $$\text{score}(c) = \frac{1}{60 + \text{rank}_{\text{FTS}}(c)} + \frac{1}{60 + \text{rank}_{\text{vec}}(c)}$$
  * Supports metadata pre-filtering by `source_type` and `source_id` (or attached document IDs for a scoped record).
* **Structured Entity Indexing:**
  * Generates searchable text chunks for `materials`, `ingredients`, `suppliers`, and `formulas` in addition to `uploads`, keeping catalog knowledge discoverable even without PDFs.

---

## 3. Document Ingestion Pipeline (`uploads.ingested`)

* **Extractors:**
  * **PDF:** Page-by-page text extraction using `pdfjs-dist`, preserving `page_number` per chunk.
  * **Markdown / TXT:** Heading/paragraph-aware chunking (~1,800 characters / ~450 tokens with 250-character overlap).
* **Queue & Status Tracking:**
  * `uploads.ingestion_status` (`'pending' | 'processing' | 'indexed' | 'error'`) and `uploads.ingestion_error` complement `uploads.ingested`.
  * Sequential background worker processes pending uploads cleanly without saturating laptop CPU/RAM.
  * UI controls in `Uploads` view: **Ingest Pending**, **Re-ingest**, and status visibility.

---

## 4. Agentic RAG Chat Engine

* **Read-Only Deterministic Tools:**
  1. `hybrid_search_documents(query, source_type?, upload_ids?)` — runs Hybrid FTS5 + Vector RRF across uploaded files and indexed catalog text.
  2. `search_catalog(entity, query)` — searches `materials` (`CAS`, `FEMA`), `ingredients` (`cost`, `unit`, `currency`, `supplier`), `suppliers`, and `formulas`.
  3. `get_formula_details(formula_id)` — fetches full ingredients, kg weights, `%` shares, USD costs, and directions.
  4. `get_attached_documents(entity, id)` — retrieves all `uploads` linked to a `material`, `ingredient`, `supplier`, or `formula`.
  5. `calculate_scaled_batch(formula_id, target_weight_kg)` — deterministic `decimal.js` batch scaler returning exact ingredient quantities, weights, and scaled USD cost.
* **Local Model Compatibility:**
  * Uses native OpenAI `tools` function-calling when supported, plus a structured JSON ReAct fallback parser so local `llama.cpp` / LM Studio models without native tool-calling support still execute tools reliably.
* **Persistent Chat History & Streaming:**
  * `chat_sessions` and `chat_messages` tables store threads, tool-call traces, and cited sources.
  * Responses stream via Server-Sent Events (SSE).
* **In-App Clickable Citations & Record Scoping:**
  * Entity references (`[[formula:12|Citrus Base]]`, `[[upload:4|Vanillin_SDS.pdf]]`, etc.) render as clickable in-app navigation links.
  * **"Ask Agent"** button on every single-record detail view opens the AI Assistant drawer pre-scoped to that record.

---

## 5. Complementary Workflow Improvements

1. **Inline Quick-Upload in Modals:** Upload and attach a photo or document directly inside `Material`, `Ingredient`, `Supplier`, and `Formula` modals (reusing SHA-256 deduplication—automatically attaching the existing upload if duplicate).
2. **Regulatory / IFRA Concentration Limits (`max_percent`):** Optional `max_percent` field on `materials` and `ingredients`; the Formula Detail View flags any ingredient whose weight `%` exceeds its configured limit (both its own `max_percent` and its linked material's `max_percent`).
3. **Cost History Snapshots (`formula_cost_snapshots`, `ingredient_cost_history`):** Automatically logs cost changes when formulas recalculate or ingredient costs update, viewable in a **Cost History** tab on Ingredient and Formula detail views.
4. **Global Command Palette (`Ctrl+K` / `Cmd+K`):** Instant cross-entity keyboard search across Formulas, Ingredients, Materials (`CAS`/`FEMA`), Suppliers, Categories, Tags, and Uploads.
