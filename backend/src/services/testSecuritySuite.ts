import { query, closePool } from '../db';
import { runMigrations } from '../db/migrate';
import { seedIdentities } from '../db/seedIdentities';
import { authService } from './authService';
import { authorizationService } from './authorizationService';
import { retrievalService } from './retrievalService';
import { ragService, UNAUTHORIZED_ACCESS_MESSAGE, INSUFFICIENT_EVIDENCE_MESSAGE } from './ragService';
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

async function runSecurityTestSuite() {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 2.8 — Comprehensive Security Test Suite      ');
  console.log('==================================================================\n');

  // Initialize express test server for live HTTP tests
  const app = createApp();
  const server = app.listen(0);
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 0. Ensure schema migrations and identities are initialized
    await runMigrations();
    await seedIdentities({ quiet: true });

    const devPassword = 'CloudDesk2026!';

    // Authenticate test personas
    const priyaLogin = await authService.login('emp_001', devPassword); // Support Agent (Brightwave, Lumenfield)
    const marcusLogin = await authService.login('emp_002', devPassword); // Support Agent (Harborpine, Lumenfield)
    const elenaLogin = await authService.login('emp_003', devPassword); // Support Lead (Wildcard '*')
    const danielLogin = await authService.login('emp_006', devPassword); // Engineer (grp_engineering, '*')
    const meiLinLogin = await authService.login('emp_007', devPassword); // Eng Manager (grp_incident_review, '*')
    const rafaelLogin = await authService.login('emp_008', devPassword); // IT Security Admin (grp_security_restricted)
    const hannahLogin = await authService.login('cu_001', devPassword); // Customer User (Brightwave)
    const leoLogin = await authService.login('cu_002', devPassword); // Customer User (Harborpine)

    const priya = priyaLogin.user;
    const marcus = marcusLogin.user;
    const elena = elenaLogin.user;
    const daniel = danielLogin.user;
    const meiLin = meiLinLogin.user;
    const rafael = rafaelLogin.user;
    const hannah = hannahLogin.user;
    const leo = leoLogin.user;

    const priyaToken = priyaLogin.token;
    const marcusToken = marcusLogin.token;
    const elenaToken = elenaLogin.token;
    const danielToken = danielLogin.token;
    const meiLinToken = meiLinLogin.token;
    const rafaelToken = rafaelLogin.token;
    const hannahToken = hannahLogin.token;
    const leoToken = leoLogin.token;

    // Clean up and insert test restricted document SEC-AUDIT-01
    await query(`DELETE FROM document_chunks WHERE id = 'c0000000-0000-0000-0000-000000000088'`);
    await query(`DELETE FROM document_versions WHERE id = 'b0000000-0000-0000-0000-000000000088'`);
    await query(`DELETE FROM documents WHERE id = 'd0000000-0000-0000-0000-000000000088'`);

    await query(`
      INSERT INTO documents (id, document_id, title, filename, format, current_version, status, metadata)
      VALUES (
        'd0000000-0000-0000-0000-000000000088',
        'SEC-AUDIT-01',
        'Restricted Forensic Incident Analysis',
        'sec-audit.md',
        'markdown',
        1,
        'completed',
        '{"tenant_id": "global", "allowed_groups": ["grp_all_employees"], "sensitivity": "restricted", "disclosure_policy": "internal_only"}'
      )
    `);

    await query(`
      INSERT INTO document_versions (id, document_id, version, content_hash, status, metadata)
      VALUES (
        'b0000000-0000-0000-0000-000000000088',
        'd0000000-0000-0000-0000-000000000088',
        1,
        'hash888restricted',
        'active',
        '{"sensitivity": "restricted"}'
      )
    `);

    await query(`
      INSERT INTO document_chunks (id, document_id, version_id, chunk_index, content, metadata, is_active)
      VALUES (
        'c0000000-0000-0000-0000-000000000088',
        'd0000000-0000-0000-0000-000000000088',
        'b0000000-0000-0000-0000-000000000088',
        0,
        'Unredacted cryptographic key exposure incident forensics SEC-AUDIT-01.',
        '{"tenant_id": "global", "allowed_groups": ["grp_all_employees"], "sensitivity": "restricted", "title": "Restricted Forensic Incident Analysis", "section_heading": "Forensic Trace"}',
        true
      )
    `);

    // ==========================================================================
    // 1. AUTHENTICATION & SESSION SECURITY TESTS
    // ==========================================================================
    console.log('--- CATEGORY 1: Authentication & Session Security ---');

    // 1.1 Anonymous requests rejected across protected endpoints
    const endpoints = [
      { method: 'GET', path: '/api/documents' },
      { method: 'GET', path: '/api/documents/TKT-10421' },
      { method: 'GET', path: '/api/documents/TKT-10421/preview' },
      { method: 'GET', path: '/api/documents/TKT-10421/citations/0' },
      { method: 'GET', path: '/api/citations/TKT-10421/0' },
      { method: 'GET', path: '/api/documents/TKT-10421/download' },
      { method: 'POST', path: '/api/retrieval', body: { query: 'test' } },
      { method: 'POST', path: '/api/retrieval/search', body: { query: 'test' } },
      { method: 'POST', path: '/api/rag/query', body: { question: 'test' } },
      { method: 'POST', path: '/api/chat', body: { question: 'test' } },
    ];

    for (const ep of endpoints) {
      const res = await fetch(`${baseUrl}${ep.path}`, {
        method: ep.method,
        headers: { 'Content-Type': 'application/json' },
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });
      assert(res.status === 401, `Anonymous ${ep.method} ${ep.path} rejected with HTTP 401`);
    }

    // 1.2 Invalid / Malformed / Expired sessions rejected
    const expiredToken = await authService.createToken('emp_001', 'priya.raman@clouddesk.internal', '-1s');
    const expiredRes = await fetch(`${baseUrl}/api/documents`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    assert(expiredRes.status === 401, 'Expired session token rejected with HTTP 401');

    const tamperedTokenRes = await fetch(`${baseUrl}/api/documents`, {
      headers: { Authorization: `Bearer ${priyaToken.slice(0, -6)}tamper` },
    });
    assert(tamperedTokenRes.status === 401, 'Cryptographically tampered token rejected with HTTP 401');

    // 1.3 Inactive & Suspended accounts strictly locked out
    const suspendedToken = await authService.createToken('emp_099', 'inactive.tester@clouddesk.internal');
    const suspendedRes = await fetch(`${baseUrl}/api/documents`, {
      headers: { Authorization: `Bearer ${suspendedToken}` },
    });
    assert(suspendedRes.status === 403, 'Suspended account rejected with HTTP 403 ACCOUNT_INACTIVE');
    const suspendedJson = await suspendedRes.json();
    assert(suspendedJson.error?.code === 'ACCOUNT_INACTIVE', 'Suspended response contains ACCOUNT_INACTIVE code');

    // 1.4 Browser-supplied role or tenant values cannot elevate privileges
    const spoofedChatRes = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${marcusToken}`, // Marcus is not authorized for Brightwave
      },
      body: JSON.stringify({
        question: 'What did Hannah Brooks report in the Brightwave support ticket?',
        tenant_scope: ['ten_brightwave', 'ten_harborpine', 'ten_lumenfield'], // Client attempted spoof
        user_groups: ['grp_security_restricted', 'grp_support_leads'], // Client attempted spoof
        role: 'it_security_admin', // Client attempted spoof
      }),
    });
    assert(spoofedChatRes.status === 200, 'Chat request with spoofed payload handled safely');
    const spoofedChatJson = await spoofedChatRes.json();
    assert(
      spoofedChatJson.data.unauthorized_access === true,
      'Spoofed client parameters completely ignored; unauthorized access blocked'
    );
    assert(
      spoofedChatJson.data.answer === UNAUTHORIZED_ACCESS_MESSAGE,
      'Returns generic unauthorized message despite client privilege escalation attempts'
    );

    // ==========================================================================
    // 2. TENANT ISOLATION TESTS
    // ==========================================================================
    console.log('\n--- CATEGORY 2: Tenant Isolation & Scope Rules ---');

    // 2.1 Cross-tenant isolation (Brightwave vs Harborpine)
    // Priya (Brightwave, Lumenfield) cannot access Harborpine ticket TKT-10533
    const priyaHarborpineRes = await fetch(`${baseUrl}/api/documents/TKT-10533`, {
      headers: { Authorization: `Bearer ${priyaToken}` },
    });
    assert(priyaHarborpineRes.status === 404, 'Brightwave agent denied access to Harborpine ticket (HTTP 404)');

    // Marcus (Harborpine, Lumenfield) cannot access Brightwave ticket TKT-10421
    const marcusBrightwaveRes = await fetch(`${baseUrl}/api/documents/TKT-10421`, {
      headers: { Authorization: `Bearer ${marcusToken}` },
    });
    assert(marcusBrightwaveRes.status === 404, 'Harborpine agent denied access to Brightwave ticket (HTTP 404)');

    // 2.2 Multi-tenant access: both can access shared Lumenfield tenant (TKT-10467)
    const priyaLumenfieldRes = await fetch(`${baseUrl}/api/documents/TKT-10467`, {
      headers: { Authorization: `Bearer ${priyaToken}` },
    });
    assert(priyaLumenfieldRes.status === 200, 'Multi-tenant agent Priya accesses Lumenfield ticket (HTTP 200)');

    const marcusLumenfieldRes = await fetch(`${baseUrl}/api/documents/TKT-10467`, {
      headers: { Authorization: `Bearer ${marcusToken}` },
    });
    assert(marcusLumenfieldRes.status === 200, 'Multi-tenant agent Marcus accesses Lumenfield ticket (HTTP 200)');

    // 2.3 Customer user strict quarantine
    // Customer user Hannah (Brightwave) cannot access Harborpine (TKT-10533) or Lumenfield (TKT-10467)
    const hannahHarborpineRes = await fetch(`${baseUrl}/api/documents/TKT-10533`, {
      headers: { Authorization: `Bearer ${hannahToken}` },
    });
    assert(hannahHarborpineRes.status === 404, 'Customer user quarantined from Harborpine (HTTP 404)');

    const hannahLumenfieldRes = await fetch(`${baseUrl}/api/documents/TKT-10467`, {
      headers: { Authorization: `Bearer ${hannahToken}` },
    });
    assert(hannahLumenfieldRes.status === 404, 'Customer user quarantined from Lumenfield (HTTP 404)');

    // Customer user Leo (Harborpine) cannot access Brightwave (TKT-10421)
    const leoBrightwaveRes = await fetch(`${baseUrl}/api/documents/TKT-10421`, {
      headers: { Authorization: `Bearer ${leoToken}` },
    });
    assert(leoBrightwaveRes.status === 404, 'Customer user Leo quarantined from Brightwave (HTTP 404)');

    // 2.4 Wildcard scope does NOT bypass sensitivity or group restrictions
    // Elena Duarte has wildcard tenant scope ('*'), but lacks grp_security_restricted
    const elenaRestrictedDocRes = await fetch(`${baseUrl}/api/documents/SEC-AUDIT-01`, {
      headers: { Authorization: `Bearer ${elenaToken}` },
    });
    assert(
      elenaRestrictedDocRes.status === 404,
      'Wildcard tenant lead without security clearance strictly denied restricted document (HTTP 404)'
    );

    // ==========================================================================
    // 3. RETRIEVAL AND LLM ISOLATION TESTS
    // ==========================================================================
    console.log('\n--- CATEGORY 3: Retrieval & LLM Isolation ---');

    // 3.1 Unauthorized chunks excluded before context reaches LLM
    const marcusRetrieval = await retrievalService.retrieveChunks({
      query: 'Hannah Brooks Brightwave webhook timeouts CD-WHK-504',
      user: marcus,
    });
    assert(
      !marcusRetrieval.chunks.some((c) => c.document_id === 'TKT-10421'),
      'Zero Brightwave chunks returned in vector retrieval for Marcus'
    );
    assert(marcusRetrieval.has_blocked_top_match === true, 'Flagged has_blocked_top_match: true');

    // 3.2 Unauthorized document content never reaches LLM (Generation latency is 0ms)
    const marcusChat = await ragService.answerQuestion({
      question: 'What did Hannah Brooks report in the Brightwave support ticket?',
      user: marcus,
    });
    assert(marcusChat.unauthorized_access === true, 'Flagged unauthorized_access: true');
    assert(marcusChat.latency_ms.generation === 0, 'Generation latency is 0ms (LLM never invoked)');
    assert(marcusChat.retrieved_chunks.length === 0, 'Zero chunks returned in response');
    assert(marcusChat.citations.length === 0, 'Zero citations attached');
    assert(!marcusChat.answer.includes('Hannah'), 'Response does not reveal author name');
    assert(!marcusChat.answer.includes('CD-WHK-504'), 'Response does not reveal error codes');

    // 3.3 Authorized retrieval generates grounded answer with verified citations
    const priyaChat = await ragService.answerQuestion({
      question: 'What did Hannah Brooks report in the Brightwave support ticket?',
      user: priya,
    });
    assert(priyaChat.unauthorized_access === false, 'Authorized question flagged unauthorized_access: false');
    assert(priyaChat.citations.length >= 1, 'Authorized answer contains verified citations');
    assert(priyaChat.citations[0].document_id === 'TKT-10421', 'Citation points to TKT-10421');

    // 3.4 Empty authorized retrieval returns standard insufficient evidence response
    const priyaMissingChat = await ragService.answerQuestion({
      question: 'What is the issue described in support ticket TKT-99999?',
      user: priya,
    });
    assert(priyaMissingChat.insufficient_evidence === true, 'Flagged insufficient_evidence: true');
    assert(priyaMissingChat.unauthorized_access === false, 'Flagged unauthorized_access: false');
    assert(
      priyaMissingChat.answer === INSUFFICIENT_EVIDENCE_MESSAGE,
      'Returns standard insufficient evidence message'
    );
    assert(priyaMissingChat.citations.length === 0, 'No citations attached for empty retrieval');

    // 3.5 Real-time database permission change takes immediate effect
    // 1. Revoke Priya's Brightwave scope
    await query(`DELETE FROM user_tenants WHERE user_id = 'emp_001' AND tenant_id = 'ten_brightwave'`);

    const priyaRevokedChat = await ragService.answerQuestion({
      question: 'What did Hannah Brooks report in the Brightwave support ticket?',
      user: await authService.resolveAuthenticatedUser('emp_001') as any,
    });
    assert(
      priyaRevokedChat.unauthorized_access === true,
      'Dynamic permission revocation immediately blocks access without token reissuance'
    );
    assert(
      priyaRevokedChat.answer === UNAUTHORIZED_ACCESS_MESSAGE,
      'Dynamic revocation immediately returns generic unauthorized message'
    );

    // 2. Restore Priya's Brightwave scope
    await query(`INSERT INTO user_tenants (user_id, tenant_id) VALUES ('emp_001', 'ten_brightwave')`);
    const priyaRestoredChat = await ragService.answerQuestion({
      question: 'What did Hannah Brooks report in the Brightwave support ticket?',
      user: await authService.resolveAuthenticatedUser('emp_001') as any,
    });
    assert(
      priyaRestoredChat.unauthorized_access === false,
      'Dynamic permission restoration immediately restores access'
    );

    // ==========================================================================
    // 4. CITATIONS & DOWNLOADS HARDENING TESTS
    // ==========================================================================
    console.log('\n--- CATEGORY 4: Citations & Downloads Hardening ---');

    // 4.1 Unauthorized citation resolution blocked
    const marcusCitationRes = await fetch(`${baseUrl}/api/documents/TKT-10421/citations/0`, {
      headers: { Authorization: `Bearer ${marcusToken}` },
    });
    assert(marcusCitationRes.status === 404, 'Unauthorized citation resolution returns HTTP 404');

    // 4.2 Unauthorized document download blocked
    const marcusDownloadRes = await fetch(`${baseUrl}/api/documents/TKT-10421/download`, {
      headers: { Authorization: `Bearer ${marcusToken}` },
    });
    assert(marcusDownloadRes.status === 404, 'Unauthorized download returns HTTP 404');

    // 4.3 Guessing another document ID does NOT grant access (Anti-enumeration)
    const nonexistentProbeRes = await fetch(`${baseUrl}/api/documents/TKT-77777`, {
      headers: { Authorization: `Bearer ${marcusToken}` },
    });
    assert(nonexistentProbeRes.status === 404, 'Nonexistent document probe returns HTTP 404');

    const unauthorizedProbeRes = await fetch(`${baseUrl}/api/documents/TKT-10421`, {
      headers: { Authorization: `Bearer ${marcusToken}` },
    });
    assert(unauthorizedProbeRes.status === 404, 'Unauthorized document probe returns HTTP 404');

    const nonexistentProbeJson = await nonexistentProbeRes.json();
    const unauthorizedProbeJson = await unauthorizedProbeRes.json();
    assert(
      nonexistentProbeJson.error?.code === unauthorizedProbeJson.error?.code,
      'Nonexistent and unauthorized errors return identical DOCUMENT_NOT_FOUND code'
    );

    // 4.4 Customer users blocked from downloading confidential tickets
    const hannahTicketDownloadRes = await fetch(`${baseUrl}/api/documents/TKT-10421/download`, {
      headers: { Authorization: `Bearer ${hannahToken}` },
    });
    assert(
      hannahTicketDownloadRes.status === 404,
      'Customer user blocked from downloading confidential ticket (HTTP 404)'
    );

    // 4.5 Customer users permitted to download authorized public documents
    const hannahPublicDownloadRes = await fetch(`${baseUrl}/api/documents/PDOC-0002/download`, {
      headers: { Authorization: `Bearer ${hannahToken}` },
    });
    assert(hannahPublicDownloadRes.status === 200, 'Customer user downloads public document with HTTP 200');

    // 4.6 Restricted document access: Cleared admin vs Non-cleared employees
    // Non-cleared employee (Priya) -> 404
    const priyaRestrictedDownload = await fetch(`${baseUrl}/api/documents/SEC-AUDIT-01/download`, {
      headers: { Authorization: `Bearer ${priyaToken}` },
    });
    assert(priyaRestrictedDownload.status === 404, 'Non-cleared employee denied restricted download (HTTP 404)');

    // Cleared IT Security Admin (Rafael) -> 200
    const rafaelRestrictedDownload = await fetch(`${baseUrl}/api/documents/SEC-AUDIT-01/download`, {
      headers: { Authorization: `Bearer ${rafaelToken}` },
    });
    assert(rafaelRestrictedDownload.status === 200, 'Cleared admin allowed restricted download (HTTP 200)');

    // Cleared Engineering Manager (Mei Lin with grp_incident_review) -> 200
    const meiLinRestrictedDownload = await fetch(`${baseUrl}/api/documents/SEC-AUDIT-01/download`, {
      headers: { Authorization: `Bearer ${meiLinToken}` },
    });
    assert(meiLinRestrictedDownload.status === 200, 'Incident reviewer allowed restricted download (HTTP 200)');

    // ==========================================================================
    // 5. REGRESSION & PIPELINE INTEGRITY TESTS
    // ==========================================================================
    console.log('\n--- CATEGORY 5: Regression & Pipeline Integrity ---');

    // 5.1 Document listings enforce full permissions
    const priyaListing = await fetch(`${baseUrl}/api/documents`, {
      headers: { Authorization: `Bearer ${priyaToken}` },
    });
    const priyaListingData = (await priyaListing.json()).data as any[];
    assert(priyaListingData.length >= 3, 'Priya sees authorized documents');
    assert(!priyaListingData.some((d) => d.document_id === 'SEC-AUDIT-01'), 'Restricted audit excluded from Priya');
    assert(!priyaListingData.some((d) => d.metadata?.tenant_id === 'ten_harborpine'), 'Harborpine excluded from Priya');

    // 5.2 Rafael (IT Security Admin) sees restricted documents
    const rafaelListing = await fetch(`${baseUrl}/api/documents`, {
      headers: { Authorization: `Bearer ${rafaelToken}` },
    });
    const rafaelListingData = (await rafaelListing.json()).data as any[];
    assert(rafaelListingData.some((d) => d.document_id === 'SEC-AUDIT-01'), 'Restricted audit visible to Rafael');

    // 5.3 Health check remains operational and unauthenticated
    const healthRes = await fetch(`${baseUrl}/health`);
    assert(healthRes.status === 200, 'Health check returns HTTP 200 without authentication');
    const healthJson = await healthRes.json();
    assert(healthJson.data?.services?.database?.status === 'connected', 'Database reported connected');

    console.log('\n==================================================================');
    console.log(` RESULTS: All ${passedTests}/${totalTests} Security Suite Tests PASSED!`);
    console.log('==================================================================\n');
  } catch (error) {
    console.error('\nTest Suite Execution Failed:', error);
    process.exit(1);
  } finally {
    await query(`DELETE FROM document_chunks WHERE id = 'c0000000-0000-0000-0000-000000000088'`);
    await query(`DELETE FROM document_versions WHERE id = 'b0000000-0000-0000-0000-000000000088'`);
    await query(`DELETE FROM documents WHERE id = 'd0000000-0000-0000-0000-000000000088'`);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool();
  }
}

runSecurityTestSuite();
