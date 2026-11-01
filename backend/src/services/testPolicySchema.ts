import assert from 'assert';
import { query, closePool } from '../db';
import { runMigrations } from '../db/migrate';
import {
  runDisclosurePolicySeed,
  syncDocumentPermissions,
  seedApprovedSummaries,
  CLOUDDESK_APPROVED_SUMMARIES,
} from '../db/seedDisclosurePolicies';
import {
  PolicyMetadataSchema,
  sanitizePolicyMetadata,
  canDiscloseToAudience,
  isAudienceAllowedForUser,
  SensitivityLevelEnum,
  DisclosurePolicyEnum,
  AudienceModeEnum,
} from '../types/policy';

async function runPolicySchemaTests(): Promise<void> {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 3.2 — Disclosure Policy Schema & Contracts Tests');
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

  // --- GROUP 1: Database Migration 003 Execution & Idempotency ---
  console.log('--- TEST GROUP 1: Migration 003 & Table Verification ---');

  await test('Applies migration 003 successfully', async () => {
    await runMigrations();
    const res = await query<{ name: string }>(
      "SELECT name FROM schema_migrations WHERE name = '003_disclosure_policies.sql'"
    );
    assert.strictEqual(res.rows.length, 1, 'Migration 003 should be recorded in schema_migrations');
  });

  await test('Migration is idempotent when executed again', async () => {
    await runMigrations(); // Should skip without throwing
    const res = await query<{ count: string }>(
      "SELECT COUNT(*) as count FROM schema_migrations WHERE name = '003_disclosure_policies.sql'"
    );
    assert.strictEqual(parseInt(res.rows[0].count, 10), 1, 'Migration should only be recorded once');
  });

  await test('document_permissions table has disclosure_policy column with default internal_only', async () => {
    const colRes = await query<{ column_name: string; column_default: string }>(
      `SELECT column_name, column_default FROM information_schema.columns 
       WHERE table_name = 'document_permissions' AND column_name = 'disclosure_policy'`
    );
    assert.strictEqual(colRes.rows.length, 1, 'Column disclosure_policy should exist');
    assert(
      colRes.rows[0].column_default.includes('internal_only'),
      `Expected default internal_only, got: ${colRes.rows[0].column_default}`
    );
  });

  await test('approved_summaries table exists with expected schema and constraints', async () => {
    const tableRes = await query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'approved_summaries'"
    );
    assert.strictEqual(tableRes.rows.length, 1, 'Table approved_summaries should exist');

    const colsRes = await query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns 
       WHERE table_name = 'approved_summaries'`
    );
    const colNames = new Set(colsRes.rows.map((r) => r.column_name));
    assert(colNames.has('id'), 'Missing id column');
    assert(colNames.has('document_id'), 'Missing document_id column');
    assert(colNames.has('version_id'), 'Missing version_id column');
    assert(colNames.has('audience'), 'Missing audience column');
    assert(colNames.has('summary_text'), 'Missing summary_text column');
    assert(colNames.has('status'), 'Missing status column');
    assert(colNames.has('approved_by'), 'Missing approved_by column');
    assert(colNames.has('approved_at'), 'Missing approved_at column');
  });

  // --- GROUP 2: Database Constraints (Deny Invalid Enums) ---
  console.log('\n--- TEST GROUP 2: SQL Check Constraints ---');

  await test('Rejects invalid sensitivity in document_permissions table', async () => {
    // Find an existing document id
    const docRes = await query<{ id: string }>('SELECT id FROM documents LIMIT 1');
    if (docRes.rows.length === 0) return;
    const docId = docRes.rows[0].id;

    let rejected = false;
    try {
      await query(
        `INSERT INTO document_permissions (document_id, tenant_id, allowed_groups, sensitivity, disclosure_policy)
         VALUES ($1, 'global', '{"grp_all_employees"}', 'top_secret', 'internal_only')
         ON CONFLICT (document_id) DO UPDATE SET sensitivity = 'top_secret'`,
        [docId]
      );
    } catch {
      rejected = true;
    }
    assert.strictEqual(rejected, true, 'Database should reject non-enum sensitivity value');
  });

  await test('Rejects invalid disclosure_policy in document_permissions table', async () => {
    const docRes = await query<{ id: string }>('SELECT id FROM documents LIMIT 1');
    if (docRes.rows.length === 0) return;
    const docId = docRes.rows[0].id;

    let rejected = false;
    try {
      await query(
        `INSERT INTO document_permissions (document_id, tenant_id, allowed_groups, sensitivity, disclosure_policy)
         VALUES ($1, 'global', '{"grp_all_employees"}', 'internal', 'leak_everything')
         ON CONFLICT (document_id) DO UPDATE SET disclosure_policy = 'leak_everything'`,
        [docId]
      );
    } catch {
      rejected = true;
    }
    assert.strictEqual(rejected, true, 'Database should reject non-enum disclosure_policy value');
  });

  await test('Rejects invalid audience in approved_summaries table', async () => {
    const docRes = await query<{ id: string }>('SELECT id FROM documents LIMIT 1');
    if (docRes.rows.length === 0) return;
    const docId = docRes.rows[0].id;

    let rejected = false;
    try {
      await query(
        `INSERT INTO approved_summaries (document_id, audience, summary_text, status)
         VALUES ($1, 'arbitrary_audience', 'Sample summary', 'approved')`,
        [docId]
      );
    } catch {
      rejected = true;
    }
    assert.strictEqual(rejected, true, 'Database should reject invalid audience string');
  });

  // --- GROUP 3: Zod Validation Contracts & Blueprint Rules ---
  console.log('\n--- TEST GROUP 3: Zod Policy Validation & Combinations ---');

  await test('Validates permitted policy combinations per Blueprint Section 6.3', () => {
    // Public + customer_shareable / direct
    assert.strictEqual(
      PolicyMetadataSchema.safeParse({ sensitivity: 'public', disclosure_policy: 'customer_shareable' }).success,
      true
    );
    assert.strictEqual(
      PolicyMetadataSchema.safeParse({ sensitivity: 'public', disclosure_policy: 'direct' }).success,
      true
    );

    // Internal + any valid policy
    assert.strictEqual(
      PolicyMetadataSchema.safeParse({ sensitivity: 'internal', disclosure_policy: 'internal_only' }).success,
      true
    );
    assert.strictEqual(
      PolicyMetadataSchema.safeParse({ sensitivity: 'internal', disclosure_policy: 'approved_summary_only' }).success,
      true
    );
    assert.strictEqual(
      PolicyMetadataSchema.safeParse({ sensitivity: 'internal', disclosure_policy: 'customer_shareable' }).success,
      true
    );

    // Confidential + internal_only or approved_summary_only
    assert.strictEqual(
      PolicyMetadataSchema.safeParse({ sensitivity: 'confidential', disclosure_policy: 'approved_summary_only' }).success,
      true
    );
    assert.strictEqual(
      PolicyMetadataSchema.safeParse({ sensitivity: 'confidential', disclosure_policy: 'internal_only' }).success,
      true
    );

    // Restricted + internal_only, approved_summary_only, or restricted
    assert.strictEqual(
      PolicyMetadataSchema.safeParse({ sensitivity: 'restricted', disclosure_policy: 'internal_only' }).success,
      true
    );
    assert.strictEqual(
      PolicyMetadataSchema.safeParse({ sensitivity: 'restricted', disclosure_policy: 'restricted' }).success,
      true
    );
  });

  await test('Rejects prohibited policy combinations per Blueprint Section 6.3', () => {
    // Confidential CANNOT be customer_shareable
    const confRes = PolicyMetadataSchema.safeParse({
      sensitivity: 'confidential',
      disclosure_policy: 'customer_shareable',
    });
    assert.strictEqual(confRes.success, false, 'Confidential + customer_shareable must fail validation');

    // Restricted CANNOT be customer_shareable
    const restrRes = PolicyMetadataSchema.safeParse({
      sensitivity: 'restricted',
      disclosure_policy: 'customer_shareable',
    });
    assert.strictEqual(restrRes.success, false, 'Restricted + customer_shareable must fail validation');

    // Public CANNOT be internal_only
    const pubRes = PolicyMetadataSchema.safeParse({
      sensitivity: 'public',
      disclosure_policy: 'internal_only',
    });
    assert.strictEqual(pubRes.success, false, 'Public + internal_only must fail validation');
  });

  // --- GROUP 4: Deny-by-Default Sanitization Behavior ---
  console.log('\n--- TEST GROUP 4: Deny-by-Default Behavioral Security ---');

  await test('Null or undefined metadata sanitizes to restricted / restricted', () => {
    const resNull = sanitizePolicyMetadata(null);
    assert.strictEqual(resNull.sensitivity, 'restricted');
    assert.strictEqual(resNull.disclosure_policy, 'restricted');

    const resUndef = sanitizePolicyMetadata(undefined);
    assert.strictEqual(resUndef.sensitivity, 'restricted');
    assert.strictEqual(resUndef.disclosure_policy, 'restricted');
  });

  await test('Corrupted or invalid metadata cannot grant disclosure permission', () => {
    // Malicious attempt to bypass disclosure check with invalid strings
    const malicious = sanitizePolicyMetadata({
      sensitivity: 'bypass_security',
      disclosure_policy: 'disclose_everything',
    });
    assert.strictEqual(malicious.sensitivity, 'restricted');
    assert.strictEqual(malicious.disclosure_policy, 'restricted');

    // Illegal combination attempt
    const illegalCombo = sanitizePolicyMetadata({
      sensitivity: 'confidential',
      disclosure_policy: 'customer_shareable',
    });
    assert.strictEqual(illegalCombo.sensitivity, 'restricted');
    assert.strictEqual(illegalCombo.disclosure_policy, 'restricted');
  });

  await test('canDiscloseToAudience strictly enforces disclosure boundaries', () => {
    // Customer mode tests
    assert.strictEqual(canDiscloseToAudience('customer_shareable', 'public', 'customer'), true);
    assert.strictEqual(canDiscloseToAudience('direct', 'public', 'customer'), true);
    assert.strictEqual(canDiscloseToAudience('internal_only', 'internal', 'customer'), false);
    assert.strictEqual(canDiscloseToAudience('internal_only', 'confidential', 'customer'), false);
    assert.strictEqual(canDiscloseToAudience('restricted', 'restricted', 'customer'), false);
    assert.strictEqual(canDiscloseToAudience('approved_summary_only', 'confidential', 'customer'), true);

    // Internal mode tests (allowed internally, authorization handled in Phase 2)
    assert.strictEqual(canDiscloseToAudience('internal_only', 'internal', 'internal'), true);
    assert.strictEqual(canDiscloseToAudience('approved_summary_only', 'confidential', 'internal'), true);
    assert.strictEqual(canDiscloseToAudience('customer_shareable', 'public', 'internal'), true);
  });

  await test('isAudienceAllowedForUser prevents customer privilege escalation', () => {
    // Customer user trying to request internal mode must be blocked
    assert.strictEqual(isAudienceAllowedForUser('customer_user', 'internal'), false);
    // Customer user in customer mode is allowed
    assert.strictEqual(isAudienceAllowedForUser('customer_user', 'customer'), true);
    // Employee can request internal or customer mode
    assert.strictEqual(isAudienceAllowedForUser('employee', 'internal'), true);
    assert.strictEqual(isAudienceAllowedForUser('employee', 'customer'), true);
  });

  // --- GROUP 5: Database Seeding & Data Integrity ---
  console.log('\n--- TEST GROUP 5: Seeding & Synchronization ---');

  await test('Seeds approved summaries and synchronizes document_permissions', async () => {
    await runDisclosurePolicySeed();

    // Verify document_permissions count
    const permRes = await query<{ count: string }>('SELECT COUNT(*) as count FROM document_permissions');
    const permCount = parseInt(permRes.rows[0].count, 10);
    assert(permCount >= 7, `Expected at least 7 document permissions, got ${permCount}`);

    // Verify approved_summaries table has all 3 CloudDesk support tickets
    const summaryRes = await query<{ document_id: string; summary_text: string; status: string }>(
      `SELECT d.document_id, s.summary_text, s.status 
       FROM approved_summaries s 
       JOIN documents d ON s.document_id = d.id 
       ORDER BY d.document_id`
    );
    assert.strictEqual(summaryRes.rows.length, 3, 'Expected 3 seeded customer approved summaries');

    const summaryMap = new Map(summaryRes.rows.map((r) => [r.document_id, r]));

    // Check TKT-10421 Brightwave
    const bwSummary = summaryMap.get('TKT-10421');
    assert(bwSummary, 'Missing approved summary for TKT-10421');
    assert.strictEqual(bwSummary.status, 'approved');
    assert(bwSummary.summary_text.includes('intermittent webhook delivery timeouts'));
    assert(bwSummary.summary_text.includes('CD-WHK-504'));

    // Check TKT-10467 Lumenfield
    const lfSummary = summaryMap.get('TKT-10467');
    assert(lfSummary, 'Missing approved summary for TKT-10467');
    assert.strictEqual(lfSummary.status, 'approved');
    assert(lfSummary.summary_text.includes('API rate-limit errors'));
    assert(lfSummary.summary_text.includes('CD-API-429'));

    // Check TKT-10533 Harborpine
    const hpSummary = summaryMap.get('TKT-10533');
    assert(hpSummary, 'Missing approved summary for TKT-10533');
    assert.strictEqual(hpSummary.status, 'approved');
    assert(hpSummary.summary_text.includes('SAML single sign-on failures'));
    assert(hpSummary.summary_text.includes('CD-SSO-403'));
  });

  await test('Unique constraint prevents duplicate summaries for same document and audience', async () => {
    const docRes = await query<{ id: string }>(
      "SELECT id FROM documents WHERE document_id = 'TKT-10421'"
    );
    const docUuid = docRes.rows[0].id;

    let rejected = false;
    try {
      await query(
        `INSERT INTO approved_summaries (document_id, audience, summary_text, status)
         VALUES ($1, 'customer', 'Duplicate summary', 'draft')`,
        [docUuid]
      );
    } catch {
      rejected = true;
    }
    assert.strictEqual(rejected, true, 'Unique constraint (document_id, audience) should reject duplicate insert');
  });

  console.log('\n==================================================================');
  console.log(` RESULTS: ${passed}/${passed + failed} Policy Schema Tests PASSED!`);
  console.log('==================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runPolicySchemaTests()
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

