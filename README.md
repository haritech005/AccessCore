# AccessCore — Permission-Aware Enterprise Knowledge System

AccessCore is a permission-aware, multi-tenant enterprise Retrieval-Augmented Generation (RAG) system built for customer support operations. It ingests internal documentation, product guides, and sensitive support tickets, transforming them into grounded, citation-backed answers with strict factual boundaries and auditability.

---

## System Architecture

AccessCore is structured as a decoupled full-stack application operating entirely on a local development environment without external cloud dependencies or paid APIs:

```
┌────────────────────────────────────────────────────────┐
│                   Next.js 16 Web UI                    │
│   (Document Upload, Grounded Chat, Citation Drawer)    │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP / JSON
┌──────────────────────────▼─────────────────────────────┐
│                 Express TypeScript API                 │
│  (Multer Parsing, Vector Search, LangChain Grounding)  │
└──────────────┬──────────────────────────┬──────────────┘
               │                          │
┌──────────────▼─────────────┐   ┌────────▼─────────────┐
│   PostgreSQL 17 + pgvector │   │    Ollama (Local)    │
│  (Documents, Versions,     │   │  - nomic-embed-text  │
│   Chunks, Vector Embeddings│   │  - qwen2.5:3b (LLM)  │
└────────────────────────────┘   └──────────────────────┘
```

- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Vanilla CSS design tokens.
- **Backend:** Node.js 22 LTS, Express, TypeScript, LangChain (`@langchain/ollama`, `@langchain/core`).
- **Vector Database:** PostgreSQL 17 with `pgvector 0.8.6` (768-dimensional cosine distance indices).
- **Local AI Models (Ollama):**
  - Embeddings: `nomic-embed-text` (768 dimensions, 8192 context window).
  - Generation: `qwen2.5:3b` (default verified instruction model) or `gemma3:4b`.

---

## Prerequisites

Before starting the application, ensure the following software is installed on your development machine:

1. **Node.js & npm:**
   - Node.js `v20+` or `v22+` LTS (`v22.22.1` verified)
   - npm `v10+` (`10.9.4` verified)
2. **PostgreSQL with pgvector:**
   - PostgreSQL 16 or 17 (`17.11` verified on port 5433 or 5432)
   - `pgvector` extension installed (`CREATE EXTENSION IF NOT EXISTS vector;`)
3. **Ollama:**
   - Ollama `v0.40+` running locally on `http://localhost:11434`
4. **Git:**
   - Git `v2.40+`

---

## 1. Local Model Setup (Ollama)

Ensure Ollama is running, then pull the required embedding and chat models:

```bash
# Start Ollama service (if not already running as a daemon)
ollama serve

# Pull 768-dim embedding model
ollama pull nomic-embed-text

# Pull local instruction LLM
ollama pull qwen2.5:3b
```

Verify models are available:
```bash
ollama list
```

---

## 2. Database Configuration & Migrations

1. Create the `accesscore` PostgreSQL database:
```sql
CREATE DATABASE accesscore;
```

2. Enable the `vector` extension in PostgreSQL:
```sql
\c accesscore;
CREATE EXTENSION IF NOT EXISTS vector;
```

3. Configure Backend Environment:
Copy the example environment configuration in `backend/`:
```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` with your PostgreSQL credentials:
```env
# PostgreSQL connection string (adjust port and credentials as needed)
DATABASE_URL="postgresql://postgres:password@localhost:5433/accesscore"

# Ollama local endpoints
OLLAMA_BASE_URL="http://localhost:11434"
OLLAMA_CHAT_MODEL="qwen2.5:3b"
OLLAMA_EMBEDDING_MODEL="nomic-embed-text"

# Server configuration
PORT=4000
NODE_ENV="development"
FRONTEND_URL="http://localhost:3000"
```

4. Run Database Migrations:
```bash
cd backend
npm install
npm run migrate
```

This sets up:
- `documents`: Document registry, formats, SHA-256 hashes, current active version pointers.
- `document_versions`: Version history, lifecycle states (`staged`, `active`, `archived`, `failed`), diagnostic error logs.
- `document_chunks`: Chunk content, chunk hashes, metadata, section headings, and 768-dim `vector(768)` embeddings with `ivfflat` cosine similarity index.

---

## 3. Ingestion & Synthetic Dataset Setup

AccessCore includes a synthetic blueprint dataset of CloudDesk documentation and support tickets in `assets/`:
- **Product Docs:** `PDOC-0001` (Webhooks Troubleshooting), `PDOC-0002` (Webhooks Overview), `PDOC-0003` (API Rate Limits), `PDOC-0004` (Flow Loop Limits).
- **Support Tickets:** `TKT-10421` (Brightwave 504s), `TKT-10467` (Lumenfield 429s), `TKT-10533` (Harborpine SAML).

To parse, chunk, embed, and store the entire dataset:
```bash
cd backend
npm run chunks:test
```

This populates 7 active document records and 72 vector chunks into PostgreSQL.

---

## 4. Frontend Configuration & Setup

1. Copy the frontend environment configuration:
```bash
cp frontend/.env.example frontend/.env
```

`frontend/.env` contains:
```env
# Backend API URL accessed from browser/client
NEXT_PUBLIC_API_URL="http://localhost:4000"
```

2. Install dependencies:
```bash
cd frontend
npm install
```

---

## 5. Starting the Application

Run the backend and frontend concurrently in separate terminal windows:

### Terminal 1: Backend API Server
```bash
cd backend
npm run dev
```
- Server: `http://localhost:4000`
- Health check: `http://localhost:4000/health` (returns database and Ollama status)

### Terminal 2: Frontend Client
```bash
cd frontend
npm run dev
```
- Web Application: `http://localhost:3000`

---

## 6. End-to-End Workflows

### Document Upload Workflow
1. Navigate to `http://localhost:3000`.
2. Click **Upload Document** or drag and drop a file (`.md`, `.json`, or `.pdf`).
3. Fill in required metadata:
   - **Document ID:** Stable business identifier (e.g. `PDOC-0005`, `TKT-10600`).
   - **Title:** Descriptive title.
   - **Tenant ID:** `global` for public guides, or tenant-scoped (e.g., `ten_brightwave`, `ten_lumenfield`).
   - **Sensitivity:** `public`, `internal`, `confidential`, or `restricted`.
   - **Disclosure Policy:** `customer_shareable`, `internal_only`, or `approved_summary_only`.
4. Click **Ingest Document**. The system calculates a SHA-256 hash, stages a new version, chunks text, computes 768-dim embeddings, and atomically activates the new version.
5. If re-uploading identical content, the system safely detects the hash and reuses existing embeddings without creating duplicate versions.

### Grounded Chat & Citations
1. Enter a question into the chat input (e.g. *"What causes webhook error CD-WHK-504?"* or *"What is causing Lumenfield's API rate-limit errors?"*).
2. The system executes vector similarity search against active chunks in PostgreSQL.
3. If no relevant evidence exists, the system states:
   > *"I do not have sufficient evidence in the provided documents to answer this question."*
4. If relevant evidence exists, the local LLM generates a grounded answer strictly citing source document IDs:
   - Displays inline clickable citation tags `[PDOC-0001]`, `[TKT-10467]`.
   - Displays a collapsible **Verified Evidence Sources** drawer showing document titles, snippets, sensitivity badges, and disclosure policies.
   - Accurately distinguishes confirmed facts from unconfirmed hypotheses.

---

## 7. Running Test Suites

Execute any of the test suites from `backend/`:

| Suite | Command | What It Verifies |
|---|---|---|
| **Dataset Validation** | `npm run contracts:validate` | Validates schema conformance against CloudDesk company blueprint. |
| **Document Parsers** | `npm run parsers:test` | Markdown, JSON, PDF parsing, boundary checks, and security validation (52 tests). |
| **Ingestion & Versioning** | `npm run ingestion:test` | Version staging, atomic publication, rollback on error, and deduplication (40 tests). |
| **Chunking & Embeddings** | `npm run chunks:test` | Text splitting, offset preservation, Ollama embeddings, and pgvector persistence (35 tests). |
| **Vector Retrieval** | `npm run retrieval:test` | Cosine similarity search, top-k ranking, threshold filtering, and inactive version exclusion (26 tests). |
| **RAG Grounded Pipeline** | `npm run rag:test` | Grounded answers, citation extraction, provenance tracking, and insufficient-evidence handling (23 tests). |
| **Resilience & Failure Modes** | `npm run resilience:test` | Controlled error handling when database or Ollama services are unreachable (4 tests). |
| **Frontend Production Build** | `cd frontend && npm run build` | Next.js Turbopack compilation and TypeScript validation. |

---

## 8. Security Boundaries & Scope Notes

### Foundation Scope
AccessCore Foundation is a local development implementation designed to establish reliable end-to-end RAG workflows on synthetic data:
- **Authentication & RBAC:** User session management and server-side document-level authorization are scheduled for Phase 2. Document sensitivity labels and tenant IDs are stored in metadata and validated in schemas, but strict multi-tenant authorization gates will be enforced in Phase 2.
- **Customer Disclosure Policies:** `approved_summary_only` boundaries and redaction engines are scheduled for Phase 3.
- **Hybrid Search:** Full-text BM25 + dense vector hybrid search and reranking are scheduled for Phase 4.
- **Secrets Management:** No live credentials or production keys are present in the repository. All environment variables use local addresses (`localhost`, `127.0.0.1`).
