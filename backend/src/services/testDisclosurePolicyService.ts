import assert from 'assert';
import { closePool } from '../db';
import { runDisclosurePolicySeed } from '../db/seedDisclosurePolicies';
import { disclosurePolicyService } from './disclosurePolicyService';
import { AuthenticatedUser } from '../types/identity';
import { RetrievedChunk } from '../types/rag';
import { AppError } from '../middleware/errorHandler';

// Mock Personas based on CloudDesk Identity Catalog
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

const empRafael: AuthenticatedUser = {
  id: 'emp_007',
  email: 'rafael.silva@clouddesk.example.com',
  name: 'Rafael Silva',
  role: 'it_security_admin',
  user_type: 'employee',
  status: 'active',
  groups: ['grp_all_employees', 'grp_it_ops', 'grp_security_restricted'],
  tenant_scope: ['*'],
  has_wildcard_tenant: true,
};

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

const suspendedUser: AuthenticatedUser = {
  id: 'cu_suspended',
  email: 'suspended@example.com',
  name: 'Suspended User',
  role: 'customer_user',
  user_type: 'customer_user',
  status: 'suspended',
  groups: ['grp_public'],
  tenant_scope: ['ten_brightwave'],
  has_wildcard_tenant: false,
};

interface MockChunkInput {
  document_id?: string;
  chunk_index?: number;
  content?: string;
  similarity?: number;
  cosine_distance?: number;
  metadata?: Record<string, any>;
}

// Synthetic Retrieved Chunks for Testing
function makeChunk(overrides: MockChunkInput): RetrievedChunk {
  const meta = {
    document_id: 'DOC-MOCK',
    title: 'Mock Document',
    tenant_id: 'global',
    allowed_groups: ['grp_all_employees'],
    sensitivity: 'internal',
    disclosure_policy: 'internal_only',
    section_heading: 'Mock Section',
    ...(overrides.metadata || {}),
  };

  return {
    document_id: overrides.document_id || meta.document_id,
    chunk_index: overrides.chunk_index ?? 0,
    content: overrides.content || 'Original internal troubleshooting chunk content.',
    similarity: overrides.similarity ?? 0.85,
    cosine_distance: overrides.cosine_distance ?? 0.15,
    is_active: true,
    metadata: meta as any,
  };
}

async function runDisclosurePolicyTests(): Promise<void> {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 3.3 — Disclosure Policy Service Tests        ');
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

  // Ensure database migrations and approved summaries are seeded
  await runDisclosurePolicySeed();

  // --- GROUP 1: Audience Mode Resolution & Privilege Escalation Guard ---
  console.log('--- TEST GROUP 1: Audience Mode Resolution & Privilege Escalation ---');

  await test('Employee defaults to internal audience mode', () => {
    const audience = disclosurePolicyService.resolveAudienceMode(empPriya);
    assert.strictEqual(audience, 'internal');
  });

  await test('Employee can explicitly request customer audience mode', () => {
    const audience = disclosurePolicyService.resolveAudienceMode(empPriya, 'customer');
    assert.strictEqual(audience, 'customer');
  });

  await test('Customer user defaults to customer audience mode', () => {
    const audience = disclosurePolicyService.resolveAudienceMode(cuHannah);
    assert.strictEqual(audience, 'customer');
  });

  await test('Customer user is permitted to use customer audience mode', () => {
    const audience = disclosurePolicyService.resolveAudienceMode(cuHannah, 'customer');
    assert.strictEqual(audience, 'customer');
  });

  await test('Customer user requesting internal mode is BLOCKED (privilege escalation denied)', () => {
    let blocked = false;
    try {
      disclosurePolicyService.resolveAudienceMode(cuHannah, 'internal');
    } catch (err: any) {
      if (err.statusCode === 403 && err.code === 'FORBIDDEN_AUDIENCE_MODE') {
        blocked = true;
      }
    }
    assert.strictEqual(blocked, true, 'Customer user must be strictly forbidden from requesting internal mode');
  });

  await test('Inactive or suspended account rejected with 401', () => {
    let rejected = false;
    try {
      disclosurePolicyService.resolveAudienceMode(suspendedUser);
    } catch (err: any) {
      if (err.statusCode === 401) {
        rejected = true;
      }
    }
    assert.strictEqual(rejected, true, 'Suspended account must be rejected with 401');
  });

  await test('Invalid audience string rejected with 400', () => {
    let rejected = false;
    try {
      disclosurePolicyService.resolveAudienceMode(empPriya, 'partner_portal');
    } catch (err: any) {
      if (err.statusCode === 400 && err.code === 'INVALID_AUDIENCE') {
        rejected = true;
      }
    }
    assert.strictEqual(rejected, true, 'Invalid audience string must be rejected with 400');
  });

  // --- GROUP 2: Customer-Facing Mode Evidence Filtering ---
  console.log('\n--- TEST GROUP 2: Customer-Facing Mode Filtering Rules ---');

  const chunkPublicWebhooks = makeChunk({
    document_id: 'PDOC-0002',
    content: 'CloudDesk outbound webhooks allow your workspace to notify external services.',
    metadata: {
      document_id: 'PDOC-0002',
      title: 'Webhooks Overview',
      tenant_id: 'global',
      sensitivity: 'public',
      disclosure_policy: 'customer_shareable',
    },
  });

  const chunkInternalTroubleshooting = makeChunk({
    document_id: 'PDOC-0001',
    content: 'Internal troubleshooting notes: check internal queue logs and dispatcher state.',
    metadata: {
      document_id: 'PDOC-0001',
      title: 'Webhook Delivery Troubleshooting',
      tenant_id: 'global',
      sensitivity: 'internal',
      disclosure_policy: 'internal_only',
    },
  });

  const chunkBrightwaveTicket1 = makeChunk({
    document_id: 'TKT-10421',
    chunk_index: 0,
    content: 'Ticket TKT-10421: Customer reports CD-WHK-504 timeouts. Internal note: unconfirmed endpoint latency.',
    metadata: {
      document_id: 'TKT-10421',
      title: 'Brightwave webhook delivery timeouts',
      tenant_id: 'ten_brightwave',
      sensitivity: 'confidential',
      disclosure_policy: 'approved_summary_only',
    },
  });

  const chunkBrightwaveTicket2 = makeChunk({
    document_id: 'TKT-10421',
    chunk_index: 1,
    content: 'Ticket TKT-10421: Escalation trigger: Escalate to Engineering if failure repeats.',
    metadata: {
      document_id: 'TKT-10421',
      title: 'Brightwave webhook delivery timeouts',
      tenant_id: 'ten_brightwave',
      sensitivity: 'confidential',
      disclosure_policy: 'approved_summary_only',
    },
  });

  const chunkRestrictedAudit = makeChunk({
    document_id: 'AUD-001',
    content: 'Restricted root cause analysis: internal cryptographic key rotation failure.',
    metadata: {
      document_id: 'AUD-001',
      title: 'Security Audit Log',
      tenant_id: 'global',
      sensitivity: 'restricted',
      disclosure_policy: 'internal_only',
    },
  });

  const chunkForeignCustomerTicket = makeChunk({
    document_id: 'TKT-10467',
    content: 'Lumenfield API rate limit ticket.',
    metadata: {
      document_id: 'TKT-10467',
      title: 'Lumenfield API rate-limit errors',
      tenant_id: 'ten_lumenfield',
      sensitivity: 'confidential',
      disclosure_policy: 'approved_summary_only',
    },
  });

  await test('Public / customer_shareable chunk is permitted directly in customer mode', async () => {
    const result = await disclosurePolicyService.evaluateEvidence({
      chunks: [chunkPublicWebhooks],
      audience: 'customer',
      user: cuHannah,
    });

    assert.strictEqual(result.permitted_evidence.length, 1);
    assert.strictEqual(result.excluded_evidence.length, 0);
    assert.strictEqual(result.permitted_evidence[0].document_id, 'PDOC-0002');
    assert.strictEqual(result.permitted_evidence[0].is_summary, false);
    assert.strictEqual(result.permitted_evidence[0].content, chunkPublicWebhooks.content);
  });

  await test('Internal-only chunk is strictly excluded from customer mode', async () => {
    const result = await disclosurePolicyService.evaluateEvidence({
      chunks: [chunkInternalTroubleshooting],
      audience: 'customer',
      user: cuHannah,
    });

    assert.strictEqual(result.permitted_evidence.length, 0);
    assert.strictEqual(result.excluded_evidence.length, 1);
    assert.strictEqual(result.excluded_evidence[0].document_id, 'PDOC-0001');
    assert(result.excluded_evidence[0].reason.includes('INTERNAL_ONLY_PROHIBITED'));
  });

  await test('Confidential ticket with approved summary substitutes summary text for customer mode', async () => {
    const result = await disclosurePolicyService.evaluateEvidence({
      chunks: [chunkBrightwaveTicket1],
      audience: 'customer',
      user: cuHannah,
    });

    assert.strictEqual(result.permitted_evidence.length, 1);
    const item = result.permitted_evidence[0];
    assert.strictEqual(item.document_id, 'TKT-10421');
    assert.strictEqual(item.is_summary, true);
    assert.strictEqual(item.section_heading, 'Approved Customer Summary');
    // Must contain the approved customer message, NOT internal notes!
    assert(item.content.includes('We are investigating intermittent webhook delivery timeouts'));
    assert(item.content.includes('CD-WHK-504'));
    assert(!item.content.includes('unconfirmed endpoint latency'));
    assert.strictEqual(result.diagnostics.summaries_applied, 1);
  });

  await test('Multiple chunks from same approved_summary_only document emit exactly ONE deduplicated summary', async () => {
    const result = await disclosurePolicyService.evaluateEvidence({
      chunks: [chunkBrightwaveTicket1, chunkBrightwaveTicket2],
      audience: 'customer',
      user: cuHannah,
    });

    assert.strictEqual(result.permitted_evidence.length, 1, 'Should only have 1 approved summary for TKT-10421');
    assert.strictEqual(result.diagnostics.summaries_applied, 1);
  });

  await test('approved_summary_only document with missing summary is excluded', async () => {
    const chunkNoSummary = makeChunk({
      document_id: 'NONEXISTENT-TKT-999',
      metadata: {
        document_id: 'NONEXISTENT-TKT-999',
        tenant_id: 'ten_brightwave',
        sensitivity: 'confidential',
        disclosure_policy: 'approved_summary_only',
      },
    });

    const result = await disclosurePolicyService.evaluateEvidence({
      chunks: [chunkNoSummary],
      audience: 'customer',
      user: cuHannah,
    });

    assert.strictEqual(result.permitted_evidence.length, 0);
    assert.strictEqual(result.excluded_evidence.length, 1);
    assert(result.excluded_evidence[0].reason.includes('APPROVED_SUMMARY_UNAVAILABLE'));
  });

  await test('Restricted document is strictly prohibited from customer mode', async () => {
    const result = await disclosurePolicyService.evaluateEvidence({
      chunks: [chunkRestrictedAudit],
      audience: 'customer',
      user: cuHannah,
    });

    assert.strictEqual(result.permitted_evidence.length, 0);
    assert.strictEqual(result.excluded_evidence.length, 1);
    assert(result.excluded_evidence[0].reason.includes('RESTRICTED_DISCLOSURE_PROHIBITED'));
  });

  await test('Cross-tenant ticket in customer mode is strictly denied', async () => {
    // Hannah is in ten_brightwave; chunk is ten_lumenfield
    const result = await disclosurePolicyService.evaluateEvidence({
      chunks: [chunkForeignCustomerTicket],
      audience: 'customer',
      user: cuHannah,
    });

    assert.strictEqual(result.permitted_evidence.length, 0);
    assert.strictEqual(result.excluded_evidence.length, 1);
    assert(result.excluded_evidence[0].reason.includes('CROSS_TENANT_DISCLOSURE_DENIED'));
  });

  // --- GROUP 3: Internal Mode Evidence Filtering ---
  console.log('\n--- TEST GROUP 3: Internal Mode Filtering Rules ---');

  await test('Internal-only chunk is permitted to employee in internal mode', async () => {
    const result = await disclosurePolicyService.evaluateEvidence({
      chunks: [chunkInternalTroubleshooting],
      audience: 'internal',
      user: empPriya,
    });

    assert.strictEqual(result.permitted_evidence.length, 1);
    assert.strictEqual(result.permitted_evidence[0].document_id, 'PDOC-0001');
    assert.strictEqual(result.permitted_evidence[0].is_summary, false);
    assert.strictEqual(result.permitted_evidence[0].content, chunkInternalTroubleshooting.content);
  });

  await test('Support ticket with internal notes is permitted to authorized employee in internal mode', async () => {
    const result = await disclosurePolicyService.evaluateEvidence({
      chunks: [chunkBrightwaveTicket1],
      audience: 'internal',
      user: empPriya,
    });

    assert.strictEqual(result.permitted_evidence.length, 1);
    assert.strictEqual(result.permitted_evidence[0].document_id, 'TKT-10421');
    assert.strictEqual(result.permitted_evidence[0].is_summary, false);
    // In internal mode, agent gets full original troubleshooting chunk, not summary!
    assert(result.permitted_evidence[0].content.includes('unconfirmed endpoint latency'));
  });

  await test('Restricted document requires security clearance in internal mode', async () => {
    // Regular agent Priya lacks clearance
    const resultPriya = await disclosurePolicyService.evaluateEvidence({
      chunks: [chunkRestrictedAudit],
      audience: 'internal',
      user: empPriya,
    });
    assert.strictEqual(resultPriya.permitted_evidence.length, 0);
    assert.strictEqual(resultPriya.excluded_evidence.length, 1);
    assert(resultPriya.excluded_evidence[0].reason.includes('RESTRICTED_CLEARANCE_REQUIRED'));

    // Cleared admin Rafael Silva has grp_security_restricted
    const resultRafael = await disclosurePolicyService.evaluateEvidence({
      chunks: [chunkRestrictedAudit],
      audience: 'internal',
      user: empRafael,
    });
    assert.strictEqual(resultRafael.permitted_evidence.length, 1);
    assert.strictEqual(resultRafael.permitted_evidence[0].document_id, 'AUD-001');
  });

  // --- GROUP 4: Deny-by-Default Behavioral Security ---
  console.log('\n--- TEST GROUP 4: Deny-by-Default & Mixed Chunks ---');

  await test('Corrupted or invalid metadata in chunk sanitizes to restricted and denies in customer mode', async () => {
    const corruptedChunk = makeChunk({
      document_id: 'CORRUPT-001',
      metadata: {
        document_id: 'CORRUPT-001',
        tenant_id: 'global',
        sensitivity: 'unknown_leak',
        disclosure_policy: 'bypass_filter',
      },
    });

    const result = await disclosurePolicyService.evaluateEvidence({
      chunks: [corruptedChunk],
      audience: 'customer',
      user: cuHannah,
    });

    assert.strictEqual(result.permitted_evidence.length, 0);
    assert.strictEqual(result.excluded_evidence.length, 1);
    assert(result.excluded_evidence[0].reason.includes('RESTRICTED_DISCLOSURE_PROHIBITED'));
  });

  await test('Mixed stream correctly filters permitted and excluded evidence', async () => {
    // Stream of 4 chunks: 1 public, 1 internal, 1 confidential with summary, 1 cross-tenant
    const stream = [
      chunkPublicWebhooks,
      chunkInternalTroubleshooting,
      chunkBrightwaveTicket1,
      chunkForeignCustomerTicket,
    ];

    const result = await disclosurePolicyService.evaluateEvidence({
      chunks: stream,
      audience: 'customer',
      user: cuHannah,
    });

    assert.strictEqual(result.diagnostics.total_evaluated, 4);
    assert.strictEqual(result.diagnostics.permitted_count, 2); // PDOC-0002 + TKT-10421 summary
    assert.strictEqual(result.diagnostics.excluded_count, 2); // PDOC-0001 (internal) + TKT-10467 (cross-tenant)
    assert.strictEqual(result.diagnostics.summaries_applied, 1);

    const permittedIds = result.permitted_evidence.map((p) => p.document_id);
    assert(permittedIds.includes('PDOC-0002'));
    assert(permittedIds.includes('TKT-10421'));
    assert(!permittedIds.includes('PDOC-0001'));
    assert(!permittedIds.includes('TKT-10467'));
  });

  console.log('\n==================================================================');
  console.log(` RESULTS: ${passed}/${passed + failed} Disclosure Policy Service Tests PASSED!`);
  console.log('==================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runDisclosurePolicyTests()
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
