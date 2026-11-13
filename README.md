# AccessCore — Permission-Aware Enterprise Knowledge System

AccessCore is a production-grade, permission-aware multi-tenant enterprise Retrieval-Augmented Generation (RAG) platform. It ingests internal documentation, product runbooks, and sensitive customer support tickets, transforming them into grounded, citation-backed answers with strict tenant isolation, audience disclosure policies, and administrative governance.

---

## 🚀 Quickstart with Docker (Recommended)

Running AccessCore with **Docker Compose** is the fastest and most reproducible way to run the entire stack. Everything runs in isolated containers with zero manual database or dependency configuration.

### Prerequisites
1. **Docker Desktop** installed and running on your system ([Download Docker](https://www.docker.com/products/docker-desktop/)).
2. **Ollama** installed on your host machine ([Download Ollama](https://ollama.com/)):
   ```bash
   # Pull the required models on your host:
   ollama pull nomic-embed-text
   ollama pull qwen2.5:3b
   ```

### 3-Step Launch
```bash
# 1. Clone repository and create local environment file
cp .env.example .env

# 2. Build and launch all containers in background
docker compose up -d --build

# 3. Check service health
docker compose ps
```

Once running:
- **Web Application (UI):** [http://localhost:3000](http://localhost:3000)
- **Backend API Server:** [http://localhost:4000](http://localhost:4000)
- **Startup Diagnostics & Health:** [http://localhost:4000/health](http://localhost:4000/health)

*(Note: On first startup, the backend automatically runs all database migrations and seeds initial synthetic data when `AUTO_SEED=true` is set in `.env`.)*

---

## 🐳 Understanding Docker for Beginners

If you are new to Docker, here is a simple breakdown of what is happening under the hood:

### 1. What is a Container?
Think of a **container** as a lightweight, isolated software box. It packages your code, runtime (Node.js, PostgreSQL), libraries, and settings together so the application runs **identically** on any machine (Windows, Mac, Linux, or Cloud), eliminating *"it works on my machine"* bugs.

### 2. The 3 Containers in AccessCore
When you run `docker compose up`, Docker spins up three interconnected services:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Docker Bridge Network (accesscore_network)           │
│                                                                         │
│  ┌───────────────────────┐   HTTP   ┌────────────────────────────────┐  │
│  │  accesscore-frontend  │ ───────> │      accesscore-backend        │  │
│  │   (Next.js 16 UI)     │          │    (Express API Service)       │  │
│  │     Port 3000         │          │          Port 4000             │  │
│  └───────────────────────┘          └───────────────┬────────────────┘  │
│                                                     │                   │
│                                            Postgres │                   │
│                                            Protocol │                   │
│                                                     ▼                   │
│                                     ┌────────────────────────────────┐  │
│                                     │      accesscore-postgres       │  │
│                                     │     (PostgreSQL + pgvector)    │  │
│                                     │          Port 5432             │  │
│                                     └───────────────┬────────────────┘  │
└─────────────────────────────────────────────────────┼───────────────────┘
                                                      │
                       Host Ollama Engine             ▼
                 (http://host.docker.internal:11434)  Named Docker Volume
                 - nomic-embed-text (768-dim)         (accesscore_postgres_data)
                 - qwen2.5:3b (LLM)                   *Persists data on disk*
```

- **`accesscore-postgres` (Database):** Runs PostgreSQL 16 bundled with the `pgvector` extension. All vector embeddings, identity accounts, documents, and audit logs are safely stored in a Docker **named volume** (`accesscore_postgres_data`), so your data survives container restarts.
- **`accesscore-backend` (API Engine):** Builds and runs the Express TypeScript server. On boot, it automatically applies schema migrations (`001` through `007`), validates Ollama connectivity, and serves API endpoints on port `4000`.
- **`accesscore-frontend` (Web App):** Builds an optimized production Next.js 16 container running on port `3000`.
- **Connecting to Ollama (`host.docker.internal`):** By default, Docker containers connect to Ollama running directly on your host machine. This gives you **native GPU acceleration** without complicated Docker GPU pass-through drivers.

---

## 🛠️ Essential Docker Commands

| What You Want To Do | Command | Description |
|---|---|---|
| **Start everything** | `docker compose up -d` | Starts all services in the background (detached mode). |
| **Rebuild after edits** | `docker compose up -d --build` | Rebuilds container images with latest code changes. |
| **Check container health** | `docker compose ps` | Displays status (`healthy`, `running`, `exit`). |
| **View live logs** | `docker compose logs -f` | Streams real-time operational logs across all services. |
| **View backend logs only** | `docker compose logs -f backend` | Streams only backend API and error logs. |
| **Manually seed data** | `docker compose exec backend npm run db:seed` | Runs full migration and synthetic dataset seed. |
| **Run master regression** | `docker compose exec backend npm run test:regression` | Executes all 14 automated test suites in Docker. |
| **Stop containers** | `docker compose down` | Stops containers safely. **Keeps your database data intact.** |
| **Clean reset (Wipe DB)** | `docker compose down -v` | Stops containers and **deletes volumes** for a clean reset. |

---

## 🔑 Development Test Personas (Pre-Seeded)

All development accounts are seeded with default password: **`CloudDesk2026!`**

| User ID | Name | Role / Persona | Tenant Scope | Clearance Groups | Use Case to Test |
|---|---|---|---|---|---|
| `emp_008` | Rafael Santos | **IT Security Admin** | `global` | `grp_it_security`, `grp_security_restricted` | Full access to `/admin`, identity management, audit logs, and confidential docs. |
| `emp_003` | Elena Duarte | **Support Lead** | `*` (Wildcard) | `grp_support_leads`, `grp_support` | Accesses all customer tickets, but blocked from restricted security audits. |
| `emp_001` | Priya Raman | **Support Agent** | `ten_brightwave`, `ten_lumenfield` | `grp_support` | Accesses Brightwave & Lumenfield; blocked from Harborpine tickets. |
| `emp_002` | Marcus Webb | **Support Agent** | `ten_harborpine`, `ten_lumenfield` | `grp_support` | Accesses Harborpine & Lumenfield; blocked from Brightwave tickets. |
| `cu_001` | Hannah Brooks | **Customer User** | `ten_brightwave` | `cust_ten_brightwave_users` | Strict customer quarantine; sees only customer-safe approved summaries. |
| `cu_002` | Leo Navarro | **Customer User** | `ten_harborpine` | `cust_ten_harborpine_users` | Quarantined to Harborpine; blocked from Brightwave tickets. |

---

## 💻 Alternative: Running Locally Without Docker

If you prefer running services directly on your host machine without Docker:

### 1. Prerequisites
- **Node.js:** v20+ or v22+ LTS
- **PostgreSQL:** v16 or v17 with `pgvector` enabled (`CREATE EXTENSION vector;`)
- **Ollama:** Running on `http://localhost:11434` with `nomic-embed-text` and `qwen2.5:3b`

### 2. Backend Setup
```bash
cd backend
cp .env.example .env
npm install
npm run db:migrate        # Applies SQL migrations 001 through 007
npm run db:seed           # Seeds tenants, users, documents, and policies
npm run dev               # Starts API on http://localhost:4000
```

### 3. Frontend Setup
```bash
cd frontend
cp .env.example .env
npm install
npm run dev               # Starts Next.js on http://localhost:3000
```

---

## 🛡️ Enterprise Architecture & Features

### 1. Document Governance & Effective Access Simulator (`/admin/documents`)
- **Admin-Only Uploads:** Enforces server-side validation against empty files, >10MB, and unsupported extensions.
- **Granular Classification:** Assigns Tenant ID, Sensitivity (`public`, `internal`, `confidential`, `restricted`), Disclosure Policy, and Security Groups.
- **Effective Access Simulator:** Allows compliance officers to select any user persona and verify real-time whether that user is permitted to retrieve, preview, or download a document before publishing.

### 2. Identity, Role & Tenant Scoping (`/admin/users`, `/admin/roles-groups`)
- **Multi-Tenant Scoping:** Assigns users to specific customer organizations or wildcard scopes.
- **Role-Based Access Control:** Distinguishes between normal employees, customer users, and admin roles (`super_admin`, `security_admin`, `compliance_officer`).
- **Safety Lockout Protection:** The system programmatically prevents disabling or demoting the last active administrator.

### 3. Ingestion Recovery & Self-Healing Pipeline (`/admin/ingestion`)
- **Pipeline Health Dashboard:** Real-time visibility into active, completed, and failed chunking jobs.
- **Safe Retries:** Automatic error sanitization and monotonic version increments preventing collision.
- **Atomic Re-indexing:** Old vector embeddings remain online and searchable while fresh embeddings generate.
- **Stale Index Cleanup:** One-click operational recovery to purge orphan chunks and resynchronize drifted ACL metadata.

### 4. Structured Logging & Compliance Audit Telemetry (`/admin/audit-logs`)
- **Request Correlation:** End-to-end `x-request-id` and `x-correlation-id` propagation across all API calls and logs.
- **Data Scrubbing:** Recursive redaction of sensitive credentials (`password`, `token`, `authorization`, `cookie`, `apiKey`, `prompt`).
- **Masked Errors:** Internal 500 errors display generic messages with correlation IDs to users while recording diagnostics server-side.
- **Compliance Export:** Streaming export of audit trails in CSV and JSON formats for SOC2/ISO27001 readiness.

### 5. Multi-Turn Conversational Query Condensation
- Uses a lightweight local model (`qwen2.5:3b`) to resolve pronoun references (*"How do I fix that timeout error?"* -> *"How to fix CD-WHK-504 Gateway Timeout error"*).
- **0ms Heuristic Bypass:** Single-turn queries bypass LLM rewrite with zero added latency.

---

## 🧪 Testing & Verification Suites

AccessCore includes comprehensive automated verification suites covering security, ingestion, and search quality:

```bash
# In backend directory (or via docker compose exec backend <command>):

# 1. Run Master Regression Suite (14 Suites, 225 Tests, 100% Pass Rate)
npm run test:regression

# 2. Run Comprehensive Security & Access Control Suite (59 Tests)
npm run test:security

# 3. Run Disclosure Policy & Customer Summary Suite (25 Tests)
npm run test:disclosure:security

# 4. Run Retrieval Benchmark Evaluation (15 Benchmark Cases)
npm run eval:comprehensive
```

### Retrieval Evaluation Benchmark Results

| Metric | Measured Value | Standard Target | Status |
|---|---|---|---|
| **Recall@4 (Primary Cutoff)** | **100.0%** | &ge; 75% | **PASSED** |
| **Recall@1** | 83.3% | &ge; 60% | **PASSED** |
| **Recall@3** | 94.4% | &ge; 75% | **PASSED** |
| **Mean Reciprocal Rank (MRR)** | **94.4%** | &ge; 80% | **PASSED** |
| **Mean NDCG@4** | **94.5%** | &ge; 85% | **PASSED** |
| **Security Isolation Rate** | **100.0%** | 100% | **PASSED** |
| **Groundedness Compliance** | **93.3%** | &ge; 90% | **PASSED** |
| **Median Retrieval Latency** | **123 ms** | < 250 ms | **PASSED** |

---

## 📂 Project Structure

```
AccessCore/
├── docker-compose.yml           # Turnkey multi-container orchestration
├── .env.example                 # Root environment configuration template
├── assets/                      # Synthetic CloudDesk documentation & tickets
│   ├── product-documents/       # Markdown runbooks & guides (PDOC-0001..0004)
│   └── support-tickets/         # JSON tickets (TKT-10421, TKT-10467, TKT-10533)
├── backend/                     # Express TypeScript Backend
│   ├── Dockerfile               # Multi-stage production backend image
│   ├── docker-entrypoint.sh     # Auto-migration & auto-seed boot script
│   ├── migrations/              # PostgreSQL SQL migrations (001 through 007)
│   └── src/
│       ├── config/              # Central configuration & Zod schemas
│       ├── db/                  # Database connection & seed scripts (seedAll.ts)
│       ├── middleware/          # Auth, CSRF, error handling, correlation ID
│       ├── routes/              # Chat, Documents, Citations, Admin, Health
│       └── services/            # Retrieval, Ingestion, Logging, Audit, Security
└── frontend/                    # Next.js 16 Web Application
    ├── Dockerfile               # Multi-stage production frontend image
    └── src/
        ├── app/                 # Next.js App Router (/chat, /admin)
        ├── components/          # Admin consoles, Chat, Citations, Modals
        └── lib/                 # API client & authentication session hooks
```

---

## 📄 License
ISC License — AccessCore Project.
