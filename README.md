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

---

## 8. Security Architecture & Phase 2 Capabilities

AccessCore Phase 2 enforces defense-in-depth authorization directly within the trusted backend layer:
- **Server-Side Authorization Boundary:** Client-supplied roles, tenant scopes, and group lists in request bodies or query parameters are untrusted. The backend resolves caller identity authoritatively against PostgreSQL.
- **Zero Unauthorized Retrieval:** Vector candidate queries in PostgreSQL filter out unauthorized tenants and non-cleared `restricted` documents before chunks leave the database.
- **0ms LLM Bypass on Unauthorized Queries:** When a user queries a restricted document, the backend identifies unauthorized access, returns a generic response (`"I couldn't find sufficient information available to you to answer this question."`), and **never invokes the LLM** (0ms latency, 0 prompt tokens).
- **Anti-Enumeration 404 Parity:** Unauthorized document, preview, citation, and download requests return an identical HTTP 404 `DOCUMENT_NOT_FOUND` as nonexistent documents, preventing enumeration attacks.
- **Customer Quarantine:** Customer users are strictly isolated to their assigned customer tenant and public documents; customer users cannot download confidential tickets or inspect internal ingestion jobs.
- **Real-Time Revocation:** Database permission changes take immediate effect on subsequent requests without requiring token reissuance or server restarts.
