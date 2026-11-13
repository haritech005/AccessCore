# AccessCore — Permission-Aware Enterprise Knowledge System

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16.4-black.svg)](https://nextjs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%2B-blue.svg)](https://www.postgresql.org/)
[![pgvector](https://img.shields.io/badge/pgvector-0.8%2B-green.svg)](https://github.com/pgvector/pgvector)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg)](https://www.docker.com/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

AccessCore is a production-grade, permission-aware multi-tenant enterprise Retrieval-Augmented Generation (RAG) platform. It ingests internal documentation, product runbooks, and sensitive customer support tickets, transforming them into grounded, citation-backed answers with strict tenant isolation, audience disclosure policies, and administrative governance.

---

## Architecture Overview

AccessCore is architected as an isolated, local-first enterprise platform with zero external cloud dependencies or paid APIs:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Docker Bridge Network (accesscore_network)           │
│                                                                        │
│  ┌───────────────────────┐   HTTP   ┌───────────────────────────────┐  │
│  │  accesscore-frontend  │ ───────> │      accesscore-backend       │  │
│  │   (Next.js 16 UI)     │          │    (Express API Service)      │  │
│  │      Port 3000        │          │          Port 4000            │  │
│  └───────────────────────┘          └───────────────┬───────────────┘  │
│                                                     │                  │
│                                            Postgres │                  │
│                                            Protocol │                  │
│                                                     ▼                  │
│                                     ┌───────────────────────────────┐  │
│                                     │      accesscore-postgres      │  │
│                                     │     (PostgreSQL + pgvector)   │  │
│                                     │          Port 5432            │  │
│                                     └───────────────┬───────────────┘  │
└─────────────────────────────────────────────────────┼──────────────────┘
                                                      │
                       Host Ollama Engine             ▼
                 (http://host.docker.internal:11434)  Named Docker Volume
                 - nomic-embed-text (768-dim)         (accesscore_postgres_data)
                 - qwen2.5:3b (LLM)                   *Data persists safely*
```

### Core Technology Stack

| Component | Technology | Role & Key Responsibilities |
|---|---|---|
| **Frontend** | Next.js 16 (App Router), React 19, TypeScript, Tailwind | Responsive knowledge assistant UI, audience switcher, admin portal. |
| **Backend API** | Node.js 22 LTS, Express, TypeScript, LangChain | REST API, auth middleware, request correlation, query condensation. |
| **Database & Search** | PostgreSQL 16 + `pgvector` 0.8.6 | Relational ACL tables, 768-dim vector embeddings, and GIN full-text search. |
| **Local AI Engine** | Ollama (`nomic-embed-text`, `qwen2.5:3b`) | Local inference for dense embeddings and grounded answer generation. |
| **Containerization** | Docker, Docker Compose | Turnkey multi-container deployment with healthchecks and persistent volumes. |

---

## Quickstart (Docker Compose)

The fastest and most reproducible way to run AccessCore is via Docker Compose.

### 1. Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running.
- [Ollama](https://ollama.com/) running on your host machine with the verified models:
  ```bash
  ollama pull nomic-embed-text
  ollama pull qwen2.5:3b
  ```

### 2. Launch Stack
```bash
# Clone the repository
git clone https://github.com/haritech005/AccessCore.git
cd AccessCore

# Initialize environment configuration
cp .env.example .env

# Build and start all services in detached mode
docker compose up -d --build
```

### 3. Access Services
- **Web Interface:** [http://localhost:3000](http://localhost:3000)
- **Backend API:** [http://localhost:4000](http://localhost:4000)
- **Health Check & Diagnostics:** [http://localhost:4000/health](http://localhost:4000/health)

*(Note: On initial startup, the backend automatically runs all schema migrations `001` through `007` and seeds synthetic identities and documents when `AUTO_SEED=true` is enabled in `.env`.)*

---

## Development Test Personas

All development accounts are pre-seeded with the default password: **`CloudDesk2026!`**

| User ID | Email | Role | Tenant Scope | Security Clearance | Purpose |
|---|---|---|---|---|---|
| `emp_008` | `rafael.santos@clouddesk.example.com` | **IT Security Admin** | `global` | `grp_it_security`, `grp_security_restricted` | Full administrative access to `/admin`, identity management, audit logs, and restricted docs. |
| `emp_003` | `elena.duarte@clouddesk.example.com` | **Support Lead** | `*` (Wildcard) | `grp_support_leads`, `grp_support` | Accesses all customer tickets; blocked from restricted internal security audits. |
| `emp_001` | `priya.raman@clouddesk.example.com` | **Support Agent** | `ten_brightwave`, `ten_lumenfield` | `grp_support` | Multi-tenant agent. Permitted for Brightwave and Lumenfield; strictly denied Harborpine tickets. |
| `emp_002` | `marcus.webb@clouddesk.example.com` | **Support Agent** | `ten_harborpine`, `ten_lumenfield` | `grp_support` | Multi-tenant agent. Permitted for Harborpine and Lumenfield; strictly denied Brightwave tickets. |
| `cu_001` | `hannah.brooks@brightwave.example.com` | **Customer User** | `ten_brightwave` | `cust_ten_brightwave_users` | Quarantined customer user. Authoritatively restricted to customer mode and approved summaries. |
| `cu_002` | `leo.navarro@harborpine.example.com` | **Customer User** | `ten_harborpine` | `cust_ten_harborpine_users` | Quarantined customer user for Harborpine; strictly blocked from Brightwave resources. |

---

## Local Development (Without Docker)

To run the application natively on your development machine:

### 1. Prerequisites
- Node.js 20+ or 22+ LTS
- PostgreSQL 16+ with `pgvector` enabled (`CREATE EXTENSION IF NOT EXISTS vector;`)
- Ollama running on `http://localhost:11434`

### 2. Backend Setup
```bash
cd backend
cp .env.example .env
npm install
npm run db:migrate        # Executes migrations 001 through 007
npm run db:seed           # Seeds tenants, groups, identities, docs, and policies
npm run dev               # Starts API server on http://localhost:4000
```

### 3. Frontend Setup
```bash
cd frontend
cp .env.example .env
npm install
npm run dev               # Starts Next.js development server on http://localhost:3000
```

---

## Key Enterprise Capabilities

### 1. Multi-Tenant SQL & Vector Isolation
AccessCore enforces authorization at the database query layer:
- **Zero Unauthorized Retrieval:** Vector similarity search filters candidates by `tenant_id` and security `access_groups` before chunks leave PostgreSQL.
- **0ms LLM Bypass:** If a user queries an unauthorized document, the request is flagged at the retrieval stage, returning a standard refusal without invoking the LLM (0ms generation latency, 0 prompt tokens).
- **Anti-Enumeration 404 Parity:** Unauthorized direct document lookups, citation previews, and downloads return HTTP 404 `DOCUMENT_NOT_FOUND` identical to nonexistent files, preventing ID enumeration.

### 2. Dual-Phase Disclosure Policy Engine
AccessCore decouples authorization ("Who can access?") from disclosure ("What may be revealed?"):
- **Audience Mode Enforcement:** Internal employees can toggle between `internal` and `customer` mode. Customer accounts are locked to `customer` mode; any attempt to request internal context returns HTTP 403.
- **Approved Customer Summaries:** Confidential support tickets designated `approved_summary_only` have their raw engineering notes replaced by vetted, version-pinned customer summaries before reaching the LLM prompt.
- **Post-Generation Validator:** Scans generated answers for leaked employee IDs, internal group names, confidential runbook titles, or foreign tenant metadata before displaying the response.

### 3. Dual-Engine Hybrid Retrieval & Reciprocal Rank Fusion (RRF)
Combines semantic understanding with exact lexical matching:
- **Dense Vector Search:** 768-dim embeddings (`nomic-embed-text`) over cosine distance.
- **Sparse Keyword Search:** Native PostgreSQL `tsvector` with GIN indexing for exact error codes (`CD-WHK-504`, `CD-API-429`) and ticket identifiers.
- **RRF Candidate Fusion:** Merges ranked candidate lists using standard reciprocal rank scoring ($k=60$).
- **Diversity Filtering:** Caps chunks per document (`max_chunks_per_doc = 2`, `diversity_threshold = 0.70`), preventing single verbose documents from dominating the retrieval context.

### 4. Conversational Query Condensation
Handles multi-turn dialogue containing pronouns or elliptical follow-ups:
- When a user asks *"How do I fix that timeout error?"*, a lightweight local prompt rewrites the dialogue history into a self-contained search query: *"How to fix CD-WHK-504 Gateway Timeout error"*.
- **0ms Heuristic Bypass:** Single-turn queries skip condensation entirely, avoiding unnecessary latency on first questions.

### 5. Administrative Governance & Operational Recovery
Available in the `/admin` portal (accessible to `emp_008`):
- **Document Governance (`/admin/documents`):** Admin-only file upload, classification assignment, and an **Effective Access Simulator** that verifies whether specific users can view a document before publishing.
- **Identity & Role Management (`/admin/users`, `/admin/roles-groups`):** Dynamic tenant scoping, group management, and lockout protection preventing accidental demotion of the last active administrator.
- **Ingestion Operations (`/admin/ingestion`):** Health monitoring, safe retries (monotonic version increments, 3-attempt limit), atomic re-indexing, and stale chunk cleanups.
- **Audit Telemetry (`/admin/audit-logs`):** Request correlation (`x-request-id`, `x-correlation-id`), sensitive credential scrubbing, and streaming compliance exports (CSV/JSON).

---

## Retrieval Evaluation Benchmarks

Evaluated against the authoritative 15-case synthetic benchmark dataset under live production conditions:

| Metric | Measured Value | Production Target | Status |
|---|---|---|---|
| **Recall@4 (Primary Cutoff)** | **100.0%** | &ge; 75.0% | **PASSED** |
| **Recall@1** | **83.3%** | &ge; 60.0% | **PASSED** |
| **Recall@3** | **94.4%** | &ge; 75.0% | **PASSED** |
| **Mean Reciprocal Rank (MRR)** | **94.4%** | &ge; 80.0% | **PASSED** (Rank #1 dominant) |
| **Mean NDCG@4** | **94.5%** | &ge; 85.0% | **PASSED** |
| **Security Boundary Isolation** | **100.0%** | 100.0% | **PASSED** (0 cross-tenant leaks) |
| **Groundedness Compliance** | **93.3%** | &ge; 90.0% | **PASSED** |
| **Refusal Accuracy Rate** | **93.3%** | &ge; 90.0% | **PASSED** |
| **Citation Validity Rate** | **86.7%** | &ge; 85.0% | **PASSED** |
| **Median Retrieval Latency** | **123 ms** | < 250 ms | **PASSED** |

---

## Test & Verification Battery

The codebase includes comprehensive automated verification suites across all layers:

```bash
# Execute within backend directory (or via 'docker compose exec backend <command>'):

# 1. Master Regression Suite (14 Suites, 225 Tests, 100% Pass Rate)
npm run test:regression

# 2. Comprehensive Security & Access Control Suite (59 Tests)
npm run test:security

# 3. Disclosure Policy & Prompt Injection Defense Suite (25 Tests)
npm run test:disclosure:security

# 4. Full Retrieval Benchmark Evaluation Suite (15 Test Cases)
npm run eval:comprehensive

# 5. End-to-End Portfolio Demonstration Walkthrough (8 Steps)
npm run demo:portfolio
```

---

## Project Structure

```
AccessCore/
├── docker-compose.yml           # Turnkey multi-container orchestration
├── .env.example                 # Root environment configuration template
├── assets/                      # Synthetic CloudDesk documentation & tickets
│   ├── product-documents/       # Markdown runbooks & guides (PDOC-0001..0004)
│   └── support-tickets/         # JSON tickets (TKT-10421, TKT-10467, TKT-10533)
├── backend/                     # Express TypeScript API Service
│   ├── Dockerfile               # Multi-stage production backend image
│   ├── docker-entrypoint.sh     # Auto-migration & auto-seed boot script
│   ├── migrations/              # PostgreSQL SQL migrations (001 through 007)
│   └── src/
│       ├── config/              # Central configuration & Zod validation
│       ├── db/                  # Database connection & seed scripts (seedAll.ts)
│       ├── evaluation/          # Evaluation metrics engine & benchmark datasets
│       ├── middleware/          # Auth, CSRF, error handling, correlation ID
│       ├── routes/              # Chat, Documents, Citations, Admin, Health
│       └── services/            # Retrieval, Ingestion, Logging, Audit, Security
└── frontend/                    # Next.js 16 Web Application
    ├── Dockerfile               # Multi-stage production frontend image
    └── src/
        ├── app/                 # Next.js App Router (/chat, /admin)
        ├── components/          # Admin consoles, Chat, Citations, Modals
        └── lib/                 # Typed API client & session hooks
```

---

## License

AccessCore is released under the [ISC License](LICENSE).
