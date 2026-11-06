# AccessCore — Comprehensive Retrieval & RAG Evaluation Report

**Evaluation Date:** 2026-11-06T10:03:35.154Z  
**Dataset Version:** 1.0 (15 Authoritative Synthetic Cases)  
**Total Evaluation Cases:** 15  
**Overall Benchmark Pass Rate:** **100.0%** (15 / 15 Passed)  

---

## 1. Executive Summary & Progression

| Evaluation Milestone | Overall Pass Rate | Mean Recall@4 | Median Retrieval Latency | Key Observations |
|---|---|---|---|---|
| **Subphase 4.1: Vector Baseline** | 86.7% (13/15) | 70.0% | 51 ms | Saturated on multi-doc synthesis (EVAL-005) and conversational pronoun (EVAL-011). |
| **Subphase 4.3: Hybrid RRF + Diversity** | 93.3% (14/15) | 73.0% | 47 ms | Resolved EVAL-005 multi-doc saturation via RRF and document diversity capping. |
| **Subphase 4.4: Conversational Condensation** | 100.0% (15/15) | 80.0% | 48 ms | Resolved EVAL-011 pronoun resolution via fast LLM condensation. |
| **Subphase 4.7: Comprehensive Final Evaluation** | 100.0% | 100.0% | 57 ms | Verified 100% pass rate, 94.4% MRR, 100% citation validity, and full latency percentiles. |

---

## 2. Core Retrieval & Ranking Metrics

| Metric | Measured Value | Standard Target | Status |
|---|---|---|---|
| **Recall@1** | 83.3% | &ge; 60% | **PASSED** |
| **Recall@3** | 94.4% | &ge; 75% | **PASSED** |
| **Recall@4 (Primary Production Cutoff)** | **100.0%** | **&ge; 75%** | **PASSED** |
| **Recall@5** | 100.0% | &ge; 80% | **PASSED** |
| **Recall@10** | 100.0% | &ge; 85% | **PASSED** |
| **Mean Reciprocal Rank (MRR)** | **94.4%** | &ge; 80% | **PASSED (Rank #1 dominant)** |
| **Precision@4** | 27.8% | &ge; 25% | **PASSED** |
| **NDCG@4** | **94.5%** | &ge; 85% | **PASSED** |

---

## 3. Answer Grounding, Citations & Security Isolation

| Metric | Measured Value | Definition & Verification |
|---|---|---|
| **Citation Validity Rate** | **100.0%** | Inline citations reference real documents permitted for the user. |
| **Citation Support Rate** | **94.4%** | Fraction of expected reference documents cited in answer. |
| **Groundedness Compliance** | **100.0%** | Answers contain verified facts and 0 fabricated claims. |
| **Refusal Accuracy Rate** | **100.0%** | Unsupported or out-of-scope queries return canonical refusal without hallucination. |
| **Security Isolation Rate** | **100.0%** | 100% boundary isolation across cross-tenant, sensitivity, and disclosure levels. |

---

## 4. Latency Distribution & Profiling

| Pipeline Stage | Min (ms) | Median / p50 (ms) | Mean (ms) | p90 (ms) | p95 (ms) | Max (ms) |
|---|---|---|---|---|---|---|
| **Retrieval Stage** | 40 | **57** | 67 | 128 | 159 | 159 |
| **LLM Generation Stage** | 0 | **10987** | 10295 | 21986 | 22083 | 22083 |
| **End-to-End Response** | 40 | **11316** | 10478 | 22070 | 22157 | 22157 |

---

## 5. Case-by-Case Breakdown (All 15 Cases)

| Case ID | Category | Status | Recall@4 | Citations | Groundedness | Retrieval (ms) | Total (ms) |
|---|---|---|---|---|---|---|---|
| **EVAL-001** | direct_factual_error_code | ✓ PASS | 100% | Valid | Grounded | 67 ms | 22157 ms |
| **EVAL-002** | direct_factual_plan_limit | ✓ PASS | 100% | Valid | Grounded | 42 ms | 16244 ms |
| **EVAL-003** | ticket_specific | ✓ PASS | 100% | Valid | Grounded | 50 ms | 11316 ms |
| **EVAL-004** | customer_facing_disclosure | ✓ PASS | 100% | Valid | Grounded | 46 ms | 11039 ms |
| **EVAL-005** | cross_document_synthesis | ✓ PASS | 100% | Valid | Grounded | 76 ms | 22070 ms |
| **EVAL-006** | semantic_alternate_phrasing | ✓ PASS | 100% | Valid | Grounded | 43 ms | 10836 ms |
| **EVAL-007** | permission_restricted_tenant | ✓ PASS | 100% | Valid | Grounded | 40 ms | 40 ms |
| **EVAL-008** | permission_restricted_sensitivity | ✓ PASS | 0% | Valid | Grounded | 60 ms | 1841 ms |
| **EVAL-009** | customer_blocked_internal_only | ✓ PASS | 0% | Valid | Grounded | 92 ms | 15279 ms |
| **EVAL-010** | insufficient_evidence_unsupported | ✓ PASS | 0% | Valid | Grounded | 159 ms | 11813 ms |
| **EVAL-011** | conversational_followup | ✓ PASS | 100% | Valid | Grounded | 58 ms | 12223 ms |
| **EVAL-012** | direct_factual_flow_limits | ✓ PASS | 100% | Valid | Grounded | 128 ms | 5556 ms |
| **EVAL-013** | cross_tenant_customer_isolation | ✓ PASS | 100% | Valid | Grounded | 46 ms | 47 ms |
| **EVAL-014** | direct_factual_enterprise_quota | ✓ PASS | 100% | Valid | Grounded | 57 ms | 16667 ms |
| **EVAL-015** | customer_persona_ticket_boundary | ✓ PASS | 100% | Valid | Grounded | 42 ms | 42 ms |
