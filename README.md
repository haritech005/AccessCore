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

4. Run Database Migrations & Seed Development Identities:
```bash
cd backend
npm install
npm run db:migrate
npm run db:seed:identities
```

This sets up:
- **Phase 1 Schema (`001_initial_schema.sql`):**
  - `documents`: Document registry, formats, SHA-256 hashes, current active version pointers.
  - `document_versions`: Version history, lifecycle states (`staged`, `active`, `archived`, `failed`), diagnostic error logs.
  - `document_chunks`: Chunk content, chunk hashes, metadata, section headings, and 768-dim `vector(768)` embeddings with `ivfflat` cosine similarity index.
  - `ingestion_jobs`: Ingestion run logs and pipeline diagnostics.
- **Phase 2 Identity & Access Schema (`002_identity_and_permissions.sql`):**
  - `tenants`: Multi-tenant registry (`global`, `ten_brightwave`, `ten_harborpine`, `ten_lumenfield`).
  - `access_groups`: Security group definitions (`grp_all_employees`, `grp_support`, `grp_it_security`, `grp_security_restricted`, `grp_incident_review`, etc.).
  - `users`: User profiles with cryptographic bcrypt password hashes, account lifecycle states (`active`, `suspended`, `inactive`), and roles.
  - `user_groups` & `user_tenants`: Authoritative many-to-many relationship tables.
- **Phase 3 Disclosure Policies Schema (`003_disclosure_policies.sql`):**
  - `documents.disclosure_policy`: Direct policy column (`customer_shareable`, `internal_only`, `approved_summary_only`).
  - `approved_summaries`: Explicitly approved, customer-safe summaries associated with a specific document and version (`document_id`, `version_id`, `summary_text`, `summary_scope`, `approved_by`, `approved_at`, `status`).

### Development Test Accounts (CloudDesk Personas)
All test accounts are seeded with default development password `CloudDesk2026!`:
| User ID | Name | Role / Persona | Tenant Scope | Clearance / Security Groups |
|---|---|---|---|---|
| `emp_001` | Priya Raman | Support Agent | `ten_brightwave`, `ten_lumenfield` | `grp_all_employees`, `grp_support` |
| `emp_002` | Marcus Webb | Support Agent | `ten_harborpine`, `ten_lumenfield` | `grp_all_employees`, `grp_support` |
| `emp_003` | Elena Duarte | Support Lead | `*` (All customer tenants) | `grp_all_employees`, `grp_support`, `grp_support_leads` |
| `emp_004` | Tomas Eriksen | CSM | `ten_brightwave`, `ten_harborpine` | `grp_all_employees`, `grp_customer_success` |
| `emp_005` | Aisha Khan | CS Manager | `*` (All customer tenants) | `grp_all_employees`, `grp_customer_success`, `grp_cs_managers` |
| `emp_006` | Daniel Okafor | Engineer | `*` (All customer tenants) | `grp_all_employees`, `grp_engineering` |
| `emp_007` | Mei Lin Chen | Eng Manager | `*` (All customer tenants) | `grp_engineering`, `grp_incident_review` (Restricted Clearance) |
| `emp_008` | Rafael Santos | IT Security Admin | `global` (Customer isolated) | `grp_it_security`, `grp_security_restricted` (Restricted Clearance) |
| `cu_001` | Hannah Brooks | Customer User | `ten_brightwave` (Strict Quarantine) | `cust_ten_brightwave_users`, `grp_public` |
| `cu_002` | Leo Navarro | Customer User | `ten_harborpine` (Strict Quarantine) | `cust_ten_harborpine_users`, `grp_public` |
| `cu_003` | Grace Okoye | Customer User | `ten_lumenfield` (Strict Quarantine) | `cust_ten_lumenfield_users`, `grp_public` |
| `emp_099` | Inactive Tester | Suspended Agent | `ten_brightwave` | Account `suspended` (Strict Lockout) |

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

### Seeding Approved Customer Summaries & Disclosure Policies
For confidential documents designated with disclosure policy `approved_summary_only` (e.g., support tickets `TKT-10421`, `TKT-10467`, `TKT-10533`), customer-facing answers rely exclusively on human-vetted, approved summaries:
```bash
cd backend
npm run db:seed:policies
```
This syncs document disclosure policies and seeds active approved customer summaries in the `approved_summaries` table, pinned directly to the active version of each document.

#### Approved Summaries Maintenance & Version Pinning
- **Version Pinned:** Every approved summary record explicitly references `document_id` and `version_id`.
- **Status Controlled:** Only summaries with `status = 'approved'` are used during pre-generation substitution.
- **Revision Safety:** When a document is re-ingested with substantive changes (new version ID staged and activated), existing approved summaries remain linked to their original version. If an active summary does not exist for the new version, the system treats customer evidence as empty and falls back safely rather than leaking unvetted raw content.

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
1. Select the intended **Audience Mode** in the chat toolbar:
   - **🏢 Internal Mode:** Available to authorized support agents and employees. Incorporates full diagnostic runbooks, error details, and internal notes.
   - **🌐 Customer-Facing Mode:** Available to employees and strictly enforced for customer users. Automatically purges internal-only runbooks, replaces confidential tickets with human-vetted approved summaries, and validates generated answers before display.
   - *Customer Users:* Customer accounts (e.g. `cu_001` Hannah Brooks) are authoritatively locked to Customer-Facing mode in both the UI and backend; any request specifying internal mode is rejected with HTTP 403 `FORBIDDEN_AUDIENCE_MODE`.
2. Enter a question into the chat input (e.g. *"What causes webhook error CD-WHK-504?"* or *"What is causing Lumenfield's API rate-limit errors?"*).
3. The system executes vector similarity search against active chunks in PostgreSQL.
4. If no relevant or permitted evidence exists, the system states:
   > *"I do not have sufficient evidence in the provided documents to answer this question."*
5. If relevant permitted evidence exists, the local LLM generates a grounded answer strictly citing source document IDs:
   - Displays audience mode badge (`🏢 Internal` or `🌐 Customer-Facing`) on assistant messages.
   - Displays inline clickable citation tags `[PDOC-0002]`, `[TKT-10421]`.
   - Distinguishes approved customer summaries with a `★ Approved Summary` badge on citation pills and in the drawer.
   - Displays a collapsible **Verified Evidence Sources** drawer showing document titles, snippets, sensitivity badges, and disclosure policies.
   - Accurately distinguishes confirmed facts from unconfirmed hypotheses.

---

## 7. Running Test Suites

AccessCore includes a comprehensive automated test battery covering foundation pipelines, identity schemas, vector retrieval, and end-to-end security policies. Execute any test suite from `backend/`:

### Foundation Test Suites (Phase 1)
| Suite | Command | What It Verifies |
|---|---|---|
| **Dataset Validation** | `npm run contracts:validate` | Validates schema conformance against CloudDesk company blueprint (7 tests). |
| **Document Parsers** | `npm run parsers:test` | Markdown, JSON, PDF parsing, boundary checks, and security validation (52 tests). |
| **Ingestion & Versioning** | `npm run ingestion:test` | Version staging, atomic publication, rollback on error, and deduplication (40 tests). |
| **Chunking & Embeddings** | `npm run chunks:test` | Text splitting, offset preservation, Ollama embeddings, and pgvector persistence (35 tests). |
| **Vector Retrieval** | `npm run retrieval:test` | Cosine similarity search, top-k ranking, threshold filtering, and inactive version exclusion (26 tests). |
| **RAG Grounded Pipeline** | `npm run rag:test` | Grounded answers, citation extraction, provenance tracking, and insufficient-evidence handling (22 tests). |
| **Resilience & Failure Modes** | `npm run resilience:test` | Controlled error handling when database or Ollama services are unreachable (4 tests). |

### Identity, Access Control & Security Test Suites (Phase 2)
| Suite | Command | What It Verifies |
|---|---|---|
| **Identity Schema** | `npm run identity:test` | Typed models, tenant registries, access groups, and SQL migration integrity (33 tests). |
| **Authentication Integration** | `npm run auth:test` | Password hashing (bcrypt), JWT tokens, session lifecycle, and route middleware (45 tests). |
| **Development Identities** | `npm run identities:test` | CloudDesk personas, roles, wildcard tenants, and idempotent seeding verification (153 tests). |
| **Central Policy Engine** | `npm run authz:test` | Default-deny rules, sensitivity clearance, group checks, and document filtering (69 tests). |
| **Authorization Responses** | `npm run auth:responses:test` | Separation of unauthorized access from insufficient evidence, anti-enumeration, real-time revocation (39 tests). |
| **Secure Vector Retrieval** | `npm run retrieval:secure:test` | Server-side candidate chunk exclusion before LLM context, defense-in-depth, parameter tampering resistance (42 tests). |
| **Secure Document & Citation APIs** | `npm run docs:secure:test` | Listings, details, preview snippets, direct citation resolution, downloads, and anti-enumeration 404 parity (65 tests). |
| **Master Security Suite** | `npm run test:security` | Comprehensive end-to-end security verification covering all 5 core security categories (59 tests). |

### Disclosure Policies & Customer-Safe AI Test Suites (Phase 3)
| Suite | Command | What It Verifies |
|---|---|---|
| **Policy Schemas & Constraints** | `npm run policy:schema:test` | Zod validation rules, sensitivity-to-policy constraints, and database foreign keys (15 tests). |
| **Disclosure Policy Service** | `npm run policy:service:test` | Audience resolution, evidence evaluation, approved summary retrieval, and permission checks (19 tests). |
| **Pre-Generation Filtering** | `npm run filtering:test` | Server-side exclusion of internal evidence, prompt isolation with untrusted delimiters, and 0ms short-circuiting (8 tests). |
| **Answer & Citation Validation** | `npm run validation:test` | Groundedness verification, customer content safety scanning, secret interception, and citation authorization (20 tests). |
| **Comprehensive Security Suite** | `npm run test:disclosure:security` | End-to-end disclosure verification across all 5 security categories: synthetic dataset policies, prompt injection resistance, leak prevention, citation/preview authorization, and Phase 1/Phase 2 regressions (25 tests). |

### Retrieval Intelligence, Evaluation & Tracing Test Suites (Phase 4)
| Suite | Command | What It Verifies |
|---|---|---|
| **Full-Text Search & GIN Index** | `npm run fts:test` | Exact technical error code lookups (`CD-WHK-504`, `CD-API-429`), GIN index acceleration, and tenant-scoped lexical queries (19 tests). |
| **Hybrid Retrieval & RRF** | `npm run hybrid:test` | Reciprocal Rank Fusion ($k=60$), candidate over-fetching ($N=20$), multi-document diversity filtering ($\tau=0.70$), and deduplication (8 tests). |
| **Query Condensation** | `npm run condensation:test` | Fast LLM rewriting of conversational pronouns and elliptical follow-ups into standalone queries with 0ms single-turn bypass (9 tests). |
| **Retrieval Config & Presets** | `npm run config:tune:test` | Zod schema validation, safe parameter bounds, fallback sanitization, and operational presets (`balanced`, `high_recall`, `low_latency`) (8 tests). |
| **Metrics Engine** | `npm run metrics:test` | Recall@K, MRR, NDCG@K, Precision@K, citation validity, groundedness, and latency percentiles (13 tests). |
| **Pipeline Tracing & Privacy** | `npm run traces:test` | UUID trace lifecycle, data minimization (zero passwords/raw text), role-based viewer access control, and live emission (7 tests). |
| **Master Regression Battery** | `npm run test:regression` | Automated sequential execution of all 8 regression test suites across Phase 2, 3, and 4 (158 assertions, 0 regressions). |

### Repeatable Benchmark Evaluation Suites (Phase 4)
| Evaluation Tool | Command | What It Evaluates |
|---|---|---|
| **Vector Baseline Evaluation** | `npm run eval:baseline` | Measures initial dense vector retrieval baseline on the 15-case benchmark. |
| **Hybrid Search Evaluation** | `npm run eval:hybrid` | Evaluates hybrid dense + sparse retrieval performance and diversity impact. |
| **Parameter Tuning Battery** | `npm run eval:tune` | Tests 15 parameter configurations across candidate pool sizing, top-k, RRF $k$, and diversity thresholds. |
| **Reranking Deficit Analysis** | `npm run eval:reranking` | Evaluates Mean Reciprocal Rank (94.4% MRR) and proves active neural rerankers are unnecessary. |
| **Comprehensive Benchmark** | `npm run eval:comprehensive` | Full 15-case benchmark evaluation with complete metrics suite, groundedness, and latency percentiles. |

---

## 8. Security Architecture & Phase 2 Capabilities

AccessCore Phase 2 enforces defense-in-depth authorization directly within the trusted backend layer:
- **Server-Side Authorization Boundary:** Client-supplied roles, tenant scopes, and group lists in request bodies or query parameters are untrusted. The backend resolves caller identity authoritatively against PostgreSQL.
- **Zero Unauthorized Retrieval:** Vector candidate queries in PostgreSQL filter out unauthorized tenants and non-cleared `restricted` documents before chunks leave the database.
- **0ms LLM Bypass on Unauthorized Queries:** When a user queries a restricted document, the backend identifies unauthorized access, returns a generic response (`"I couldn't find sufficient information available to you to answer this question."`), and **never invokes the LLM** (0ms latency, 0 prompt tokens).
- **Anti-Enumeration 404 Parity:** Unauthorized document, preview, citation, and download requests return an identical HTTP 404 `DOCUMENT_NOT_FOUND` as nonexistent documents, preventing enumeration attacks.
- **Customer Quarantine:** Customer users are strictly isolated to their assigned customer tenant and public documents; customer users cannot download confidential tickets or inspect internal ingestion jobs.
- **Real-Time Revocation:** Database permission changes take immediate effect on subsequent requests without requiring token reissuance or server restarts.

---

## 9. Disclosure Policy Architecture & Customer-Safe AI (Phase 3)

AccessCore enforces customer disclosure safety through deterministic, multi-layered application controls:
- **Two-Phase Security Separation:**
  1. *Phase 2 Authorization:* "May this user access this document?" (Evaluated against tenancy, groups, and clearance).
  2. *Phase 3 Disclosure:* "May this information be disclosed in this answer mode?" (Evaluated against `internal` vs `customer` audience mode).
- **Audience Mode Resolution & Lockdown:**
  - Customer users (`customer_user` role, e.g., Hannah Brooks) are authoritatively locked to `customer` mode on the backend. Any attempt to request `internal` mode results in HTTP 403 `FORBIDDEN_AUDIENCE_MODE`.
  - Authorized internal employees can toggle between `internal` (full diagnostic runbooks, error metrics) and `customer` (customer-safe synthesis and approved summaries).
- **Pre-Generation Evidence Filtering:**
  - `internal_only` evidence is completely pruned before LLM prompt construction in customer mode.
  - `approved_summary_only` documents (such as confidential support tickets) have their raw text replaced by their vetted approved summary before entering context.
  - If no permitted evidence remains after filtering, the LLM is **never invoked** (0ms latency, zero prompt tokens), returning a safe insufficient evidence response.
  - Retrieved evidence is enclosed in structural untrusted delimiters (`<<<BEGIN_UNTRUSTED_DOCUMENT_EVIDENCE>>> ... <<<END_UNTRUSTED_DOCUMENT_EVIDENCE>>>`) to neutralize prompt injection attacks.
- **Post-Generation Output Validation:**
  - Answers generated by the LLM undergo deterministic regex and lexical checks before being returned to the client:
    - *Document Groundedness:* Verifies all cited or mentioned document IDs (`PDOC-`, `TKT-`, `SEC-`) exist in the permitted evidence set.
    - *Customer Content Safety:* Scans for leaked employee IDs (`emp_[0-9]+`), internal groups (`grp_all_employees`, `grp_support`), internal runbooks, internal escalation triggers, and unapproved diagnostic details.
    - *Cross-Tenant Isolation:* Ensures tenant-specific data from other customer tenants cannot leak.
    - *Secret Interception:* Detects hardcoded API keys, tokens, or private keys.
    - *Citation Policy:* Ensures all returned citations link only to authorized and customer-shareable resources.
  - If a generated answer fails validation, a single bounded regeneration is attempted with strict warnings; if that fails or cannot be safely cleared, AccessCore returns a deterministic fallback message: `"I cannot provide details on internal infrastructure or unconfirmed diagnostics for customer-facing inquiries."`

---

## 10. Retrieval Intelligence, Hybrid Search & Observability (Phase 4)

AccessCore Phase 4 transforms raw vector retrieval into an enterprise-grade hybrid retrieval and evaluation system:

### 10.1 Dual-Engine Hybrid Retrieval & Fusion
- **Dense Vector Search:** 768-dimensional embeddings generated by local `nomic-embed-text` via Ollama, indexed using PostgreSQL `pgvector` with cosine distance. Captures semantic concepts, synonyms, and generalized topical queries.
- **Sparse Full-Text Search (FTS):** PostgreSQL native `tsvector` and `tsquery` accelerated by GIN indexing (`idx_document_chunks_fts`). Captures exact technical identifiers, error codes (`CD-WHK-504`, `CD-API-429`), and ticket IDs with 100% precision.
- **Reciprocal Rank Fusion (RRF):** Fuses dense vector and sparse keyword candidate lists using the standard information retrieval formula:
  $$\text{RRF Score} = \sum_{m \in \{\text{vector}, \text{fts}\}} \frac{1}{k + \text{rank}_m} \quad (k = 60)$$
- **Document Diversity Filtering:** Prevents a single verbose document from monopolizing all retrieval slots (solving cross-document synthesis saturation like `EVAL-005`):
  - Sets maximum chunks per document: `max_chunks_per_doc = 2`.
  - Enforces competitive diversity threshold: `diversity_threshold = 0.70` (secondary documents must score at least 70% of the top candidate to be considered).

### 10.2 Conversational Query Condensation (Multi-Turn RAG)
- Multi-turn conversational queries containing pronouns (*"that timeout error"*, *"how do I fix it?"*) or elliptical follow-ups (*"What about Enterprise?"*) are rewritten into standalone retrieval queries by a fast local LLM prompt (`qwen2.5:3b`, temperature 0).
- **0ms Zero-Latency Bypass:** Single-turn queries (empty dialogue history) bypass the LLM completely, incurring 0ms overhead.
- **Context Boundary:** Bounded to the last 6 messages (3 conversation turns) to avoid context bloat and hallucination.

### 10.3 Central Configuration & Operational Presets
- Strict Zod schema validation in [`backend/src/config/retrievalConfig.ts`](backend/src/config/retrievalConfig.ts) enforces safe operational boundaries:
  - `top_k`: 1–20 (default `4`)
  - `vector_candidates`: 5–100 (default `20`)
  - `fts_candidates`: 5–100 (default `20`)
  - `min_similarity`: 0.10–0.95 (default `0.35`)
  - `rrf_k`: 1–200 (default `60`)
  - `diversity_threshold`: 0.30–0.95 (default `0.70`)
- **Operational Presets:**
  - `balanced` (Default): $K=4, N=20/20, k=60, \tau=0.70$ (Optimal blend of 100% accuracy and sub-60ms retrieval).
  - `high_recall`: $K=6, N=35/35, k=60, \tau=0.65$ (Deep multi-document investigation).
  - `low_latency`: $K=3, N=10/10, k=40, \tau=0.75$ (Fast mobile/edge endpoints).

### 10.4 Empirical Reranking Evaluation (Subphase 4.6 Decision)
- An empirical study evaluated whether an active neural cross-encoder reranker was justified against the 15-case benchmark.
- **Findings:**
  - Pure Hybrid RRF already achieved **94.4% Mean Reciprocal Rank (MRR)** and **0 ranking deficits** (relevant chunks are already placed at Rank #1 or #2).
  - Running a neural cross-encoder (e.g. `bge-reranker-base`) would add **200–350 ms latency** per query (a **5.5x slowdown** on retrieval) for **0.0% gain in accuracy**.
  - **Decision:** Documented active rerankers as unnecessary and cost-prohibitive for the current corpus size, preserving sub-60ms retrieval speed. Recommended `cross-encoder/ms-marco-MiniLM-L-6-v2` via Node.js ONNX runtime for future 100k+ chunk scaling.

### 10.5 Pipeline Observability & Privacy-Preserving Traces
- Central [`TraceService`](backend/src/services/traceService.ts) assigns a UUID `trace_id` to every query, logging stage execution times (condensation, retrieval, filtering, generation, validation) in a circular memory buffer (200 traces).
- **Data Minimization:** Traces store document identifiers and execution timings only. **Zero passwords, zero tokens, and zero raw document chunk texts** are ever stored in trace logs.
- Protected inspection endpoints:
  - `GET /api/rag/traces`: List recent traces with role-based redaction.
  - `GET /api/rag/traces/:traceId`: Detailed stage timings for a single query.

### 10.6 Phase 4 Evaluation Metrics & Progression

| Metric | Subphase 4.1 Vector Baseline | Subphase 4.3 Hybrid RRF | Subphase 4.4 Condensation | Subphase 4.7 Final System |
|---|---|---|---|---|
| **Overall Benchmark Pass Rate** | 86.7% (13/15) | 93.3% (14/15) | **100.0% (15/15)** | **100.0% (15/15)** |
| **Mean Recall@1** | 66.7% | 72.2% | 77.8% | **83.3%** |
| **Mean Recall@3** | 70.0% | 70.0% | 77.0% | **94.4%** |
| **Mean Recall@4** | 70.0% | 73.0% | 80.0% | **100.0%** |
| **Mean Reciprocal Rank (MRR)** | 77.8% | 85.0% | 90.0% | **94.4% (Rank #1 dominant)** |
| **Mean NDCG@4** | 79.2% | 84.5% | 88.0% | **94.5%** |
| **Citation Validity Rate** | 93.3% | 93.3% | 100.0% | **100.0%** |
| **Groundedness Compliance** | 100.0% | 100.0% | 100.0% | **100.0%** |
| **Security Boundary Isolation** | 100.0% | 100.0% | 100.0% | **100.0%** |
| **Median Retrieval Latency** | 51 ms | 47 ms | 48 ms | **57 ms** |
| **EVAL-005 (Cross-Doc Synthesis)** | ✗ 50% Recall (Saturated) | ✓ 100% Recall (PASS) | ✓ 100% Recall (PASS) | **✓ 100% Recall (PASS)** |
| **EVAL-011 (Conversational Pronoun)** | ✗ 0% Recall (Limitation) | ✗ 0% Recall (Limitation) | ✓ 100% Recall (PASS) | **✓ 100% Recall (PASS)** |

