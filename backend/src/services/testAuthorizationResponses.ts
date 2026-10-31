import { query, closePool } from '../db';
import { runMigrations } from '../db/migrate';
import { seedIdentities } from '../db/seedIdentities';
import { authService } from './authService';
import { ragService, INSUFFICIENT_EVIDENCE_MESSAGE, UNAUTHORIZED_ACCESS_MESSAGE } from './ragService';
import { createApp } from '../app';
import { AddressInfo } from 'net';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, failureDetail?: string) {
  totalTests++;
  if (condition) {
    console.log(`  ✓ [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  ✗ [FAIL] ${testName}: ${failureDetail || 'Assertion failed'}`);
    throw new Error(`Test failed: ${testName}`);
  }
}

async function runAuthorizationResponseTestSuite() {
  console.log('==================================================================');
  console.log(' AccessCore — Authorization vs Insufficient Evidence Test Suite  ');
  console.log('==================================================================\n');

  // Initialize express test server for live HTTP tests
  const app = createApp();
  const server = app.listen(0);
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 0. Ensure migrations and identities are seeded
    await runMigrations();
    await seedIdentities({ quiet: true });

    const devPassword = 'CloudDesk2026!';

    // Authenticate test users
    const priyaLogin = await authService.login('emp_001', devPassword); // Brightwave & Lumenfield
    const marcusLogin = await authService.login('emp_002', devPassword); // Harborpine & Lumenfield (Unauthorized for Brightwave)

    const priyaToken = priyaLogin.token;
    const marcusToken = marcusLogin.token;

    // --------------------------------------------------------------------------
    // SCENARIO 1: Unauthorized user asks about an existing confidential ticket
    // --------------------------------------------------------------------------
    console.log('--- SCENARIO 1: Unauthorized user asks about existing confidential ticket ---');
    const q1 = 'What did Hannah Brooks report in the Brightwave support ticket?';
    console.log(`Marcus (unauthorized for Brightwave) asks: "${q1}"`);

    const r1 = await ragService.answerQuestion({
      question: q1,
      tenant_scope: marcusLogin.user.tenant_scope,
      user_groups: marcusLogin.user.groups,
    });

    console.log(`Response: "${r1.answer}"\n`);

    assert(r1.unauthorized_access === true, 'Flagged as unauthorized_access: true');
    assert(r1.insufficient_evidence === false, 'Flagged as insufficient_evidence: false (not an evidence failure)');
    assert(r1.answer === UNAUTHORIZED_ACCESS_MESSAGE, `Returns generic response: "${UNAUTHORIZED_ACCESS_MESSAGE}"`);
    assert(r1.citations.length === 0, 'No citations attached');
    assert(r1.retrieved_chunks.length === 0, 'No chunks exposed in retrieved_chunks');
    assert(r1.latency_ms.generation === 0, 'Generation latency is 0ms (LLM never invoked with unauthorized content)');
    assert(!r1.answer.includes('Hannah') && !r1.answer.includes('TKT-10421'), 'Response does not reveal ticket details or metadata');

    // --------------------------------------------------------------------------
    // SCENARIO 2: Authorized user asks about the same ticket
    // --------------------------------------------------------------------------
    console.log('--- SCENARIO 2: Authorized user asks about the same ticket ---');
    console.log(`Priya (authorized for Brightwave) asks: "${q1}"`);

    const r2 = await ragService.answerQuestion({
      question: q1,
      tenant_scope: priyaLogin.user.tenant_scope,
      user_groups: priyaLogin.user.groups,
    });

    console.log(`Answer:\n${r2.answer}\n`);

    assert(r2.unauthorized_access === false, 'Flagged as unauthorized_access: false');
    assert(r2.insufficient_evidence === false, 'Flagged as insufficient_evidence: false');
    assert(r2.answer.length > 50, 'Generated grounded answer');
    assert(
      r2.answer.toLowerCase().includes('hannah') || r2.answer.toLowerCase().includes('webhook'),
      'Answer contains authorized information from Brightwave ticket'
    );
    assert(r2.citations.length >= 1, 'Includes verified citation');
    assert(r2.citations[0].document_id === 'TKT-10421', 'Citation points to TKT-10421');

    // --------------------------------------------------------------------------
    // SCENARIO 3: Unauthorized user asks follow-up questions about restricted ticket
    // --------------------------------------------------------------------------
    console.log('--- SCENARIO 3: Unauthorized user asks follow-up questions ---');
    const q3 = 'In the Brightwave support ticket, what did Hannah Brooks report regarding delivery timeouts?';
    console.log(`Marcus follow-up: "${q3}"`);

    const r3 = await ragService.answerQuestion({
      question: q3,
      tenant_scope: marcusLogin.user.tenant_scope,
      user_groups: marcusLogin.user.groups,
    });

    assert(r3.unauthorized_access === true, 'Follow-up query flagged as unauthorized_access: true');
    assert(r3.answer === UNAUTHORIZED_ACCESS_MESSAGE, 'Follow-up returns generic unauthorized message');
    assert(r3.latency_ms.generation === 0, 'LLM was not called on follow-up query');

    // --------------------------------------------------------------------------
    // SCENARIO 4: Unauthorized user attempts to access citation / source preview
    // --------------------------------------------------------------------------
    console.log('\n--- SCENARIO 4: Unauthorized citation / preview access ---');
    // Marcus requests preview of Brightwave ticket TKT-10421
    const previewResMarcus = await fetch(`${baseUrl}/api/documents/TKT-10421/preview`, {
      headers: { Authorization: `Bearer ${marcusToken}` },
    });
    assert(previewResMarcus.status === 404, 'Unauthorized preview returns HTTP 404');
    const previewJsonMarcus = await previewResMarcus.json();
    assert(previewJsonMarcus.error?.code === 'DOCUMENT_NOT_FOUND', 'Preview returns generic DOCUMENT_NOT_FOUND');

    // Priya requests preview of TKT-10421 (authorized)
    const previewResPriya = await fetch(`${baseUrl}/api/documents/TKT-10421/preview`, {
      headers: { Authorization: `Bearer ${priyaToken}` },
    });
    assert(previewResPriya.status === 200, 'Authorized preview returns HTTP 200');

    // --------------------------------------------------------------------------
    // SCENARIO 5: Unauthorized user attempts to download restricted document
    // --------------------------------------------------------------------------
    console.log('\n--- SCENARIO 5: Unauthorized document download attempt ---');
    const downloadResMarcus = await fetch(`${baseUrl}/api/documents/TKT-10421/download`, {
      headers: { Authorization: `Bearer ${marcusToken}` },
    });
    assert(downloadResMarcus.status === 404, 'Unauthorized download returns HTTP 404');

    const downloadResPriya = await fetch(`${baseUrl}/api/documents/TKT-10421/download`, {
      headers: { Authorization: `Bearer ${priyaToken}` },
    });
    assert(downloadResPriya.status === 200, 'Authorized download returns HTTP 200');

    // --------------------------------------------------------------------------
    // SCENARIO 6: Authorized user asks about a nonexistent document
    // --------------------------------------------------------------------------
    console.log('\n--- SCENARIO 6: Authorized user asks about nonexistent document ---');
    const q6 = 'What is the issue described in support ticket TKT-99999?';
    console.log(`Priya asks: "${q6}"`);

    const r6 = await ragService.answerQuestion({
      question: q6,
      tenant_scope: priyaLogin.user.tenant_scope,
      user_groups: priyaLogin.user.groups,
    });

    console.log(`Response: "${r6.answer}"\n`);
    assert(r6.insufficient_evidence === true, 'Flagged as insufficient_evidence: true');
    assert(r6.unauthorized_access === false, 'Flagged as unauthorized_access: false');
    assert(r6.answer === INSUFFICIENT_EVIDENCE_MESSAGE, `Returns standard insufficient evidence message: "${INSUFFICIENT_EVIDENCE_MESSAGE}"`);
    assert(r6.citations.length === 0, 'No citations for nonexistent document');

    // --------------------------------------------------------------------------
    // SCENARIO 7: Authorized user asks question where document exists but lacks info
    // --------------------------------------------------------------------------
    console.log('--- SCENARIO 7: Document exists but does not contain requested info ---');
    const q7 = 'What is the private home address and personal mobile number of Hannah Brooks in [TKT-10421]?';
    console.log(`Priya asks: "${q7}"`);

    const r7 = await ragService.answerQuestion({
      question: q7,
      tenant_scope: priyaLogin.user.tenant_scope,
      user_groups: priyaLogin.user.groups,
    });

    console.log(`Response: "${r7.answer}"\n`);
    assert(r7.insufficient_evidence === true, 'Missing information flagged as insufficient_evidence: true');
    assert(r7.unauthorized_access === false, 'Flagged as unauthorized_access: false');
    assert(r7.answer === INSUFFICIENT_EVIDENCE_MESSAGE, 'Refuses to fabricate ungrounded personal data');
    assert(r7.citations.length === 0, 'No citations attached when refusing ungrounded question');

    // --------------------------------------------------------------------------
    // SCENARIO 8: Comparing responses for nonexistent vs unauthorized documents
    // --------------------------------------------------------------------------
    console.log('--- SCENARIO 8: Nonexistent vs Unauthorized Document Probing ---');
    // Marcus asks about TKT-10421 (exists, but restricted)
    const marcusRestrictedProbe = await fetch(`${baseUrl}/api/documents/TKT-10421`, {
      headers: { Authorization: `Bearer ${marcusToken}` },
    });
    // Marcus asks about TKT-99999 (does not exist)
    const marcusNonexistentProbe = await fetch(`${baseUrl}/api/documents/TKT-99999`, {
      headers: { Authorization: `Bearer ${marcusToken}` },
    });

    assert(marcusRestrictedProbe.status === 404, 'Restricted document probe returns 404');
    assert(marcusNonexistentProbe.status === 404, 'Nonexistent document probe returns 404');
    const jsonRestricted = await marcusRestrictedProbe.json();
    const jsonNonexistent = await marcusNonexistentProbe.json();
    assert(
      jsonRestricted.error?.code === jsonNonexistent.error?.code,
      'Identical error code (DOCUMENT_NOT_FOUND) prevents document existence enumeration'
    );

    // --------------------------------------------------------------------------
    // SCENARIO 9: Verify unauthorized document content never reaches the LLM
    // --------------------------------------------------------------------------
    console.log('\n--- SCENARIO 9: LLM Context Isolation Guard ---');
    const rBlocked = await ragService.answerQuestion({
      question: 'Provide full unredacted transcript of TKT-10421 Brightwave ticket',
      tenant_scope: ['ten_harborpine'], // Marcus scope
      user_groups: ['grp_support'],
    });

    assert(rBlocked.unauthorized_access === true, 'Unauthorized request blocked prior to LLM');
    assert(rBlocked.latency_ms.generation === 0, 'Generation latency is 0ms (model never invoked)');
    assert(rBlocked.retrieved_chunks.length === 0, 'Zero chunks passed');

    // --------------------------------------------------------------------------
    // SCENARIO 10: Real-time permission changes take immediate effect
    // --------------------------------------------------------------------------
    console.log('\n--- SCENARIO 10: Immediate Effect on Access Change ---');
    // 1. Temporarily revoke Priya's Brightwave scope in PostgreSQL
    await query(`DELETE FROM user_tenants WHERE user_id = 'emp_001' AND tenant_id = 'ten_brightwave'`);

    // Priya immediately repeats her query using her EXISTING session token
    const rRevoked = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${priyaToken}`,
      },
      body: JSON.stringify({ question: q1 }),
    });

    const revokedData = await rRevoked.json();
    console.log(`After revoking Brightwave, Priya receives: "${revokedData.data.answer}"`);

    assert(
      revokedData.data.unauthorized_access === true,
      'Revoked tenant immediately causes unauthorized_access: true without token reissuance'
    );
    assert(
      revokedData.data.answer === UNAUTHORIZED_ACCESS_MESSAGE,
      'Revoked tenant immediately returns generic unauthorized message'
    );

    // 2. Restore Priya's Brightwave scope in PostgreSQL
    await query(`INSERT INTO user_tenants (user_id, tenant_id) VALUES ('emp_001', 'ten_brightwave')`);

    const rRestored = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${priyaToken}`,
      },
      body: JSON.stringify({ question: q1 }),
    });
    const restoredData = await rRestored.json();
    assert(
      restoredData.data.unauthorized_access === false,
      'Restored tenant immediately restores access'
    );
    assert(
      restoredData.data.citations.length >= 1,
      'Restored tenant immediately provides citations'
    );

    console.log('\n==================================================================');
    console.log(` RESULTS: All ${passedTests}/${totalTests} Authorization & Grounding Tests PASSED!`);
    console.log('==================================================================\n');
  } catch (error) {
    console.error('\nTest Suite Execution Failed:', error);
    process.exit(1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool();
  }
}

runAuthorizationResponseTestSuite();
