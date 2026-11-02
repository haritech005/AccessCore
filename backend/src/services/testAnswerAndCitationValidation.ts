import assert from 'assert';
import { AddressInfo } from 'net';
import { closePool } from '../db';
import { runDisclosurePolicySeed } from '../db/seedDisclosurePolicies';
import { seedIdentities } from '../db/seedIdentities';
import { authService } from './authService';
import { postGenerationValidator, POLICY_VIOLATION_MESSAGE } from './postGenerationValidator';
import { ragService } from './ragService';
import { createApp } from '../app';
import { AuthenticatedUser } from '../types/identity';
import { PermittedEvidenceItem } from './disclosurePolicyService';
import { Citation } from '../types/rag';

// Mock Personas from CloudDesk Identity Catalog
const cuHannah: AuthenticatedUser = {
  id: 'cu_001',
  email: 'hannah.brooks@brightwave.example.com',
  name: 'Hannah Brooks',
  role: 'customer_user',
  user_type: 'customer_user',
  status: 'active',
  groups: ['grp_brightwave_workspace', 'grp_public'],
  tenant_scope: ['ten_brightwave'],
  has_wildcard_tenant: false,
};

const empPriya: AuthenticatedUser = {
  id: 'emp_001',
  email: 'priya.raman@clouddesk.example.com',
  name: 'Priya Raman',
  role: 'support_agent',
  user_type: 'employee',
  status: 'active',
  groups: ['grp_all_employees', 'grp_support'],
  tenant_scope: ['ten_brightwave', 'ten_lumenfield'],
  has_wildcard_tenant: false,
};

// Mock Permitted Evidence
const permittedPublicDoc: PermittedEvidenceItem = {
  document_id: 'PDOC-0002',
  chunk_index: 0,
  content: 'CloudDesk webhooks deliver real-time notifications to your configured endpoint.',
  is_summary: false,
  title: 'Webhooks Overview',
  tenant_id: 'global',
  sensitivity: 'public',
  disclosure_policy: 'customer_shareable',
  similarity: 0.9,
};

const permittedApprovedSummary: PermittedEvidenceItem = {
  document_id: 'TKT-10421',
  chunk_index: 0,
  content: 'We are investigating intermittent webhook delivery timeouts reported for your workspace. CloudDesk expects your endpoint to respond within 10 seconds, and delivery fails with error CD-WHK-504.',
  is_summary: true,
  summary_id: 'sum_001',
  title: 'Brightwave webhook delivery timeouts',
  tenant_id: 'ten_brightwave',
  sensitivity: 'confidential',
  disclosure_policy: 'approved_summary_only',
  similarity: 0.88,
};

async function runValidationTests(): Promise<void> {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 3.5 — Answer & Citation Validation Tests');
  console.log('==================================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>): Promise<void> {
    return Promise.resolve()
      .then(fn)
      .then(() => {
        console.log(`  ✓ [PASS] ${name}`);
        passed++;
      })
      .catch((err) => {
        console.error(`  ✗ [FAIL] ${name}`);
        console.error(`    ${err instanceof Error ? err.message : String(err)}`);
        failed++;
      });
  }

  // Ensure DB migrations, identities, permissions, and approved summaries are active
  await seedIdentities({ quiet: true });
  await runDisclosurePolicySeed();

  // Initialize test server
  const app = createApp();
  const server = app.listen(0);
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const hannahToken = await authService.createToken(cuHannah.id, cuHannah.email);
  const priyaToken = await authService.createToken(empPriya.id, empPriya.email);

  try {
    // --- GROUP 1: Permitted Evidence Groundedness & Document Citation Validation ---
    console.log('--- TEST GROUP 1: Output Groundedness & Document Citation Validation ---');

    await test('Valid answer citing permitted document is accepted', () => {
      const res = postGenerationValidator.validateAnswer({
        answer: 'According to [PDOC-0002], webhooks deliver automated event notifications.',
        permittedEvidence: [permittedPublicDoc],
        audience: 'customer',
        user: cuHannah,
      });
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.issues.length, 0);
    });

    await test('Answer citing unpermitted document ID in customer mode is rejected', () => {
      const res = postGenerationValidator.validateAnswer({
        answer: 'For webhook recovery, refer to internal runbook [PDOC-0001].',
        permittedEvidence: [permittedPublicDoc],
        audience: 'customer',
        user: cuHannah,
      });
      assert.strictEqual(res.valid, false);
      assert(res.issues.some((i) => i.code === 'UNPERMITTED_DOCUMENT_MENTION'));
      assert(res.issues.some((i) => i.detail === 'PDOC-0001'));
    });

    await test('Answer citing fabricated or hallucinated document ID is rejected', () => {
      const res = postGenerationValidator.validateAnswer({
        answer: 'This is documented in secret doc [SEC-0999].',
        permittedEvidence: [permittedPublicDoc],
        audience: 'internal',
        user: empPriya,
      });
      assert.strictEqual(res.valid, false);
      assert(res.issues.some((i) => i.code === 'UNPERMITTED_DOCUMENT_MENTION'));
    });

    // --- GROUP 2: Prohibited Customer-Facing Content & Secrets Detection ---
    console.log('\n--- TEST GROUP 2: Prohibited Customer Content & Secrets Detection ---');

    await test('Customer-facing answer containing employee ID (emp_001) is rejected', () => {
      const res = postGenerationValidator.validateAnswer({
        answer: 'Ticket TKT-10421 was investigated by support agent emp_001.',
        permittedEvidence: [permittedApprovedSummary],
        audience: 'customer',
        user: cuHannah,
      });
      assert.strictEqual(res.valid, false);
      assert(res.issues.some((i) => i.code === 'EMPLOYEE_ID_LEAK'));
    });

    await test('Customer-facing answer containing internal group identifier is rejected', () => {
      const res = postGenerationValidator.validateAnswer({
        answer: 'This issue is accessible by members of grp_all_employees and grp_support.',
        permittedEvidence: [permittedApprovedSummary],
        audience: 'customer',
        user: cuHannah,
      });
      assert.strictEqual(res.valid, false);
      assert(res.issues.some((i) => i.code === 'INTERNAL_GROUP_LEAK'));
    });

    await test('Customer-facing answer revealing internal diagnostic notes is rejected', () => {
      const res = postGenerationValidator.validateAnswer({
        answer: 'Regarding [TKT-10421], our internal note indicates unconfirmed endpoint latency and queue backlog.',
        permittedEvidence: [permittedApprovedSummary],
        audience: 'customer',
        user: cuHannah,
      });
      assert.strictEqual(res.valid, false);
      assert(res.issues.some((i) => i.code === 'INTERNAL_DIAGNOSTIC_LEAK'));
    });

    await test('Answer revealing security token pattern (SEC-...) is rejected for all audiences', () => {
      const res = postGenerationValidator.validateAnswer({
        answer: 'Use the master key SEC-8821-SECRET-TOKEN to authenticate.',
        permittedEvidence: [permittedPublicDoc],
        audience: 'internal',
        user: empPriya,
      });
      assert.strictEqual(res.valid, false);
      assert(res.issues.some((i) => i.code === 'SECRET_TOKEN_LEAK'));
    });

    await test('Answer leaking raw boundary delimiters is rejected', () => {
      const res = postGenerationValidator.validateAnswer({
        answer: '<<<BEGIN_UNTRUSTED_DOCUMENT_EVIDENCE>>> Document content follows.',
        permittedEvidence: [permittedPublicDoc],
        audience: 'customer',
        user: cuHannah,
      });
      assert.strictEqual(res.valid, false);
      assert(res.issues.some((i) => i.code === 'PROMPT_DELIMITER_LEAK'));
    });

    // --- GROUP 3: Cross-Tenant Isolation Enforcement ---
    console.log('\n--- TEST GROUP 3: Cross-Tenant Isolation Enforcement ---');

    await test('Brightwave customer answer mentioning foreign tenant ID (ten_harborpine) is rejected', () => {
      const res = postGenerationValidator.validateAnswer({
        answer: 'This issue also impacted ten_harborpine in their workspace.',
        permittedEvidence: [permittedApprovedSummary],
        audience: 'customer',
        user: cuHannah,
        tenantScope: ['ten_brightwave'],
      });
      assert.strictEqual(res.valid, false);
      assert(res.issues.some((i) => i.code === 'CROSS_TENANT_ID_LEAK'));
      assert(res.issues.some((i) => i.detail === 'ten_harborpine'));
    });

    await test('Brightwave customer answer mentioning foreign tenant name (Harborpine) is rejected', () => {
      const res = postGenerationValidator.validateAnswer({
        answer: 'Similar webhook timeouts were reported by Harborpine earlier today.',
        permittedEvidence: [permittedApprovedSummary],
        audience: 'customer',
        user: cuHannah,
        tenantScope: ['ten_brightwave'],
      });
      assert.strictEqual(res.valid, false);
      assert(res.issues.some((i) => i.code === 'CROSS_TENANT_NAME_LEAK'));
    });

    await test('Answer mentioning user own authorized tenant (Brightwave) is allowed', () => {
      const res = postGenerationValidator.validateAnswer({
        answer: 'Regarding ticket [TKT-10421] for Brightwave, we are investigating webhook delivery.',
        permittedEvidence: [permittedApprovedSummary],
        audience: 'customer',
        user: cuHannah,
        tenantScope: ['ten_brightwave'],
      });
      assert.strictEqual(res.valid, true);
    });

    // --- GROUP 4: Citation Validation Rules ---
    console.log('\n--- TEST GROUP 4: Citation Validation & Approved Summary Masking ---');

    await test('Public / customer_shareable citation is validated for customer mode', () => {
      const citation: Citation = {
        document_id: 'PDOC-0002',
        title: 'Webhooks Overview',
        chunk_index: 0,
        snippet: 'Webhooks deliver notifications...',
        tenant_id: 'global',
        sensitivity: 'public',
        disclosure_policy: 'customer_shareable',
      };
      const res = postGenerationValidator.validateCitations([citation], [permittedPublicDoc], 'customer');
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.validCitations.length, 1);
    });

    await test('Internal-only citation is rejected in customer mode', () => {
      const citation: Citation = {
        document_id: 'PDOC-0001',
        title: 'Webhook Troubleshooting',
        chunk_index: 0,
        snippet: 'Dispatcher queue check...',
        tenant_id: 'global',
        sensitivity: 'internal',
        disclosure_policy: 'internal_only',
      };
      const internalDoc: PermittedEvidenceItem = {
        ...permittedPublicDoc,
        document_id: 'PDOC-0001',
        disclosure_policy: 'internal_only',
        sensitivity: 'internal',
      };
      const res = postGenerationValidator.validateCitations([citation], [internalDoc], 'customer');
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.rejectedCitations.length, 1);
      assert.strictEqual(res.validCitations.length, 0);
    });

    await test('Approved summary citation receives is_summary: true and approved summary snippet', () => {
      const citation: Citation = {
        document_id: 'TKT-10421',
        title: 'Brightwave timeouts',
        chunk_index: 0,
        snippet: 'Raw internal chunk content...',
        tenant_id: 'ten_brightwave',
        sensitivity: 'confidential',
        disclosure_policy: 'approved_summary_only',
      };
      const res = postGenerationValidator.validateCitations([citation], [permittedApprovedSummary], 'customer');
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.validCitations.length, 1);
      assert.strictEqual(res.validCitations[0].is_summary, true);
      assert(res.validCitations[0].snippet.includes('intermittent webhook delivery timeouts'));
    });

    // --- GROUP 5: Protected Citation & Preview Endpoint Hardening ---
    console.log('\n--- TEST GROUP 5: Citation & Preview Endpoint Hardening ---');

    await test('Customer user resolving citation for internal runbook (PDOC-0001) receives 404', async () => {
      const res = await fetch(`${baseUrl}/api/citations/PDOC-0001/0`, {
        headers: { Authorization: `Bearer ${hannahToken}` },
      });
      assert.strictEqual(res.status, 404);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, 'DOCUMENT_NOT_FOUND');
    });

    await test('Customer user resolving preview for internal runbook (PDOC-0001) receives 404', async () => {
      const res = await fetch(`${baseUrl}/api/documents/PDOC-0001/preview?chunk_index=0`, {
        headers: { Authorization: `Bearer ${hannahToken}` },
      });
      assert.strictEqual(res.status, 404);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, 'DOCUMENT_NOT_FOUND');
    });

    await test('Customer user resolving citation for TKT-10421 receives Approved Summary snippet (NO internal notes)', async () => {
      const res = await fetch(`${baseUrl}/api/citations/TKT-10421/0`, {
        headers: { Authorization: `Bearer ${hannahToken}` },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.is_summary, true);
      assert(body.data.snippet.includes('intermittent webhook delivery timeouts'));
      // CRITICAL: Must not leak internal notes
      assert(!body.data.snippet.includes('unconfirmed endpoint latency'));
      assert(!body.data.snippet.includes('queue backlog'));
    });

    await test('Customer user preview for TKT-10421 returns Approved Summary (NO internal notes)', async () => {
      const res = await fetch(`${baseUrl}/api/documents/TKT-10421/preview?chunk_index=0`, {
        headers: { Authorization: `Bearer ${hannahToken}` },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.is_summary, true);
      assert(body.data.snippet.includes('intermittent webhook delivery timeouts'));
      assert(!body.data.snippet.includes('unconfirmed endpoint latency'));
    });

    await test('Employee resolving preview for TKT-10421 in internal mode receives full troubleshooting chunk', async () => {
      const res = await fetch(`${baseUrl}/api/documents/TKT-10421/preview?chunk_index=0`, {
        headers: { Authorization: `Bearer ${priyaToken}` },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert(body.data.snippet.includes('CD-WHK-504'));
      assert(body.data.snippet.includes('Brightwave') || body.data.snippet.includes('webhook'));
    });

    // --- GROUP 6: End-to-End Generation & Bounded Regeneration Enforcement ---
    console.log('\n--- TEST GROUP 6: End-to-End Generation & Post-Generation Validation ---');

    await test('Safe customer query for TKT-10421 passes validation with policy_violated: false', async () => {
      const result = await ragService.answerQuestion({
        question: 'What is the current status of Brightwave ticket TKT-10421?',
        audience: 'customer',
        user: empPriya,
      });

      assert.strictEqual(result.policy_violated, false);
      assert.strictEqual(result.insufficient_evidence, false);
      assert(result.citations.length > 0);
      assert.strictEqual(result.citations[0].is_summary, true);
      assert(!result.answer.toLowerCase().includes('unconfirmed endpoint latency'));
      assert(!result.answer.toLowerCase().includes('emp_001'));
    });

    console.log('\n==================================================================');
    console.log(` RESULTS: ${passed}/${passed + failed} Answer & Citation Validation Tests PASSED!`);
    console.log('==================================================================\n');
  } finally {
    server.close();
  }

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runValidationTests()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Test runner failure:', err);
      await closePool();
      process.exit(1);
    });
}
