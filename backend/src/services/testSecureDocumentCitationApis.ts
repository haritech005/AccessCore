import { query, closePool } from '../db';
import { runMigrations } from '../db/migrate';
import { seedIdentities } from '../db/seedIdentities';
import { authService } from './authService';
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

async function runSecureDocumentCitationApisTestSuite() {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 2.7 — Secure Document & Citation APIs Tests  ');
  console.log('==================================================================\n');

  // Initialize express test server for live HTTP tests
  const app = createApp();
  const server = app.listen(0);
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 0. Ensure migrations and identities are initialized
    await runMigrations();
    await seedIdentities({ quiet: true });

    const devPassword = 'CloudDesk2026!';

    // Authenticate test personas
    const priyaLogin = await authService.login('emp_001', devPassword); // Support Agent (Brightwave, Lumenfield)
    const marcusLogin = await authService.login('emp_002', devPassword); // Support Agent (Harborpine, Lumenfield)
    const elenaLogin = await authService.login('emp_003', devPassword); // Support Lead (Wildcard '*')
    const rafaelLogin = await authService.login('emp_008', devPassword); // IT Security Admin (grp_security_restricted)
    const hannahLogin = await authService.login('cu_001', devPassword); // Customer User (Brightwave only)

    const priyaToken = priyaLogin.token;
    const marcusToken = marcusLogin.token;
    const elenaToken = elenaLogin.token;
    const rafaelToken = rafaelLogin.token;
    const hannahToken = hannahLogin.token;

    // Clean up and insert test restricted document SEC-REST-01
    await query(`DELETE FROM document_chunks WHERE id = 'c0000000-0000-0000-0000-000000000099'`);
    await query(`DELETE FROM document_versions WHERE id = 'b0000000-0000-0000-0000-000000000099'`);
    await query(`DELETE FROM documents WHERE id = 'd0000000-0000-0000-0000-000000000099'`);

    await query(`
      INSERT INTO documents (id, document_id, title, filename, format, current_version, status, metadata)
      VALUES (
        'd0000000-0000-0000-0000-000000000099',
        'SEC-REST-01',
        'Confidential Security Audit Incident',
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
        'b0000000-0000-0000-0000-000000000099',
        'd0000000-0000-0000-0000-000000000099',
        1,
        'hash999restricted',
        'active',
        '{"sensitivity": "restricted"}'
      )
    `);

    await query(`
      INSERT INTO document_chunks (id, document_id, version_id, chunk_index, content, metadata, is_active)
      VALUES (
        'c0000000-0000-0000-0000-000000000099',
        'd0000000-0000-0000-0000-000000000099',
        'b0000000-0000-0000-0000-000000000099',
        0,
        'Forensic audit trace of root cryptographic key exposure incident SEC-REST-01.',
        '{"tenant_id": "global", "allowed_groups": ["grp_all_employees"], "sensitivity": "restricted", "title": "Confidential Security Audit Incident", "section_heading": "Root Key Exposure"}',
        true
      )
    `);

    // --------------------------------------------------------------------------
    // TEST GROUP 1: Authentication & Session Verification on Document Endpoints
    // --------------------------------------------------------------------------
    console.log('--- TEST GROUP 1: Authentication & Session Enforcement ---');

    // 1.1 Unauthenticated request rejected
    const unauthRes = await fetch(`${baseUrl}/api/documents`);
    assert(unauthRes.status === 401, 'Unauthenticated GET /api/documents rejected with HTTP 401');

    // 1.2 Tampered token rejected
    const tamperedRes = await fetch(`${baseUrl}/api/documents`, {
      headers: { Authorization: `Bearer ${priyaToken}tampered` },
    });
    assert(tamperedRes.status === 401, 'Tampered token rejected with HTTP 401');

    // 1.3 Suspended account rejected immediately with 403
    const suspendedRes = await query<{ id: string }>(
      `SELECT id FROM users WHERE status = 'suspended' LIMIT 1`
    );
    if (suspendedRes.rows.length > 0) {
      const suspendedToken = await authService.createToken('emp_099', 'suspended.agent@clouddesk.internal');
      const suspendedApiRes = await fetch(`${baseUrl}/api/documents`, {
        headers: { Authorization: `Bearer ${suspendedToken}` },
      });
      assert(suspendedApiRes.status === 403, 'Suspended user rejected with HTTP 403 ACCOUNT_INACTIVE');
      const suspendedBody = await suspendedApiRes.json();
      assert(suspendedBody.error?.code === 'ACCOUNT_INACTIVE', 'Suspended response contains ACCOUNT_INACTIVE code');
    }

    // --------------------------------------------------------------------------
    // TEST GROUP 2: Secure Document Listing (GET /api/documents)
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 2: Secure Document Listing (GET /api/documents) ---');

    // 2.1 Customer User (Hannah - Brightwave) listing
    const hannahDocsRes = await fetch(`${baseUrl}/api/documents`, {
      headers: { Authorization: `Bearer ${hannahToken}` },
    });
    assert(hannahDocsRes.status === 200, 'Customer user GET /api/documents returns HTTP 200');
    const hannahDocs = (await hannahDocsRes.json()).data as any[];

    // Must see Brightwave docs and public global docs only
    assert(
      hannahDocs.every(
        (d) =>
          d.metadata?.tenant_id === 'ten_brightwave' ||
          (d.metadata?.tenant_id === 'global' && d.metadata?.allowed_groups?.includes('grp_public'))
      ),
      'Customer user only receives assigned tenant or public global documents'
    );
    assert(
      !hannahDocs.some((d) => d.metadata?.tenant_id === 'ten_harborpine'),
      'Zero Harborpine documents returned to Brightwave customer'
    );
    assert(
      !hannahDocs.some((d) => d.metadata?.tenant_id === 'ten_lumenfield'),
      'Zero Lumenfield documents returned to Brightwave customer'
    );
    assert(
      !hannahDocs.some((d) => d.metadata?.sensitivity === 'restricted'),
      'Zero restricted documents returned to customer user'
    );

    // 2.2 Support Agent Priya (Brightwave, Lumenfield) listing
    const priyaDocsRes = await fetch(`${baseUrl}/api/documents`, {
      headers: { Authorization: `Bearer ${priyaToken}` },
    });
    assert(priyaDocsRes.status === 200, 'Priya GET /api/documents returns HTTP 200');
    const priyaDocs = (await priyaDocsRes.json()).data as any[];

    assert(
      priyaDocs.some((d) => d.document_id === 'TKT-10421'),
      'Priya sees authorized Brightwave ticket TKT-10421'
    );
    assert(
      !priyaDocs.some((d) => d.metadata?.tenant_id === 'ten_harborpine'),
      'Zero Harborpine documents returned to Priya'
    );
    assert(
      !priyaDocs.some((d) => d.metadata?.sensitivity === 'restricted'),
      'Priya (without clearance) sees zero restricted documents'
    );

    // 2.3 Support Agent Marcus (Harborpine, Lumenfield) listing
    const marcusDocsRes = await fetch(`${baseUrl}/api/documents`, {
      headers: { Authorization: `Bearer ${marcusToken}` },
    });
    assert(marcusDocsRes.status === 200, 'Marcus GET /api/documents returns HTTP 200');
    const marcusDocs = (await marcusDocsRes.json()).data as any[];

    assert(
      marcusDocs.some((d) => d.document_id === 'TKT-10467'),
      'Marcus sees authorized Harborpine ticket TKT-10467'
    );
    assert(
      !marcusDocs.some((d) => d.metadata?.tenant_id === 'ten_brightwave'),
      'Zero Brightwave documents returned to Marcus'
    );

    // 2.4 IT Security Admin Rafael (with grp_security_restricted) sees restricted document
    const rafaelDocsRes = await fetch(`${baseUrl}/api/documents`, {
      headers: { Authorization: `Bearer ${rafaelToken}` },
    });
    assert(rafaelDocsRes.status === 200, 'Rafael GET /api/documents returns HTTP 200');
    const rafaelDocs = (await rafaelDocsRes.json()).data as any[];
    assert(
      rafaelDocs.some((d) => d.metadata?.sensitivity === 'restricted'),
      'Rafael with security clearance sees restricted documents'
    );

    // 2.5 Tenant parameter spoofing resistance
    // Marcus requests ?tenant_id=ten_brightwave (which he is not authorized for)
    const marcusSpoofRes = await fetch(`${baseUrl}/api/documents?tenant_id=ten_brightwave`, {
      headers: { Authorization: `Bearer ${marcusToken}` },
    });
    assert(marcusSpoofRes.status === 200, 'Tenant filter query returns 200');
    const marcusSpoofData = (await marcusSpoofRes.json()).data as any[];
    assert(marcusSpoofData.length === 0, 'Spoofed tenant query safely returns 0 documents');

    // --------------------------------------------------------------------------
    // TEST GROUP 3: Secure Document Details (GET /api/documents/:documentId)
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 3: Secure Document Details (GET /api/documents/:documentId) ---');

    // 3.1 Authorized document lookup
    const priyaTicketRes = await fetch(`${baseUrl}/api/documents/TKT-10421`, {
      headers: { Authorization: `Bearer ${priyaToken}` },
    });
    assert(priyaTicketRes.status === 200, 'Authorized document lookup returns HTTP 200');
    const priyaTicketJson = await priyaTicketRes.json();
    assert(priyaTicketJson.data?.document?.document_id === 'TKT-10421', 'Returns valid document record');
    assert(Array.isArray(priyaTicketJson.data?.versions), 'Returns document versions array');

    // 3.2 Cross-tenant unauthorized document lookup -> 404 DOCUMENT_NOT_FOUND
    const marcusTicketRes = await fetch(`${baseUrl}/api/documents/TKT-10421`, {
      headers: { Authorization: `Bearer ${marcusToken}` },
    });
    assert(marcusTicketRes.status === 404, 'Unauthorized document lookup returns HTTP 404');
    const marcusTicketJson = await marcusTicketRes.json();
    assert(
      marcusTicketJson.error?.code === 'DOCUMENT_NOT_FOUND',
      'Unauthorized access returns generic DOCUMENT_NOT_FOUND code'
    );

    // 3.3 Customer user cross-tenant document lookup -> 404
    const hannahForeignRes = await fetch(`${baseUrl}/api/documents/TKT-10533`, {
      headers: { Authorization: `Bearer ${hannahToken}` },
    });
    assert(hannahForeignRes.status === 404, 'Customer user foreign document lookup returns HTTP 404');

    // 3.4 Non-cleared employee accessing restricted document -> 404
    const priyaRestrictedRes = await fetch(`${baseUrl}/api/documents/SEC-REST-01`, {
      headers: { Authorization: `Bearer ${priyaToken}` },
    });
    assert(priyaRestrictedRes.status === 404, 'Employee without clearance receives HTTP 404 for restricted document');

    // 3.5 Cleared IT admin accessing restricted document -> 200
    const rafaelRestrictedRes = await fetch(`${baseUrl}/api/documents/SEC-REST-01`, {
      headers: { Authorization: `Bearer ${rafaelToken}` },
    });
    assert(rafaelRestrictedRes.status === 200, 'Cleared admin receives HTTP 200 for restricted document');

    // 3.6 Nonexistent document -> 404 (identical to unauthorized)
    const nonexistentRes = await fetch(`${baseUrl}/api/documents/TKT-99999`, {
      headers: { Authorization: `Bearer ${priyaToken}` },
    });
    assert(nonexistentRes.status === 404, 'Nonexistent document returns HTTP 404');
    const nonexistentJson = await nonexistentRes.json();
    assert(
      nonexistentJson.error?.code === marcusTicketJson.error?.code,
      'Unauthorized and nonexistent document errors are indistinguishable (anti-enumeration)'
    );

    // --------------------------------------------------------------------------
    // TEST GROUP 4: Secure Document & Citation Preview (GET /api/documents/:documentId/preview)
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 4: Secure Document & Citation Preview ---');

    // 4.1 Authorized document preview
    const priyaPreviewRes = await fetch(`${baseUrl}/api/documents/TKT-10421/preview`, {
      headers: { Authorization: `Bearer ${priyaToken}` },
    });
    assert(priyaPreviewRes.status === 200, 'Authorized preview returns HTTP 200');
    const priyaPreviewJson = await priyaPreviewRes.json();
    assert(priyaPreviewJson.data?.document_id === 'TKT-10421', 'Preview contains document_id');
    assert(priyaPreviewJson.data?.tenant_id === 'ten_brightwave', 'Preview contains tenant_id');

    // 4.2 Authorized preview with chunk_index (citation passage)
    const priyaChunkPreviewRes = await fetch(`${baseUrl}/api/documents/TKT-10421/preview?chunk_index=0`, {
      headers: { Authorization: `Bearer ${priyaToken}` },
    });
    assert(priyaChunkPreviewRes.status === 200, 'Authorized chunk preview returns HTTP 200');
    const priyaChunkJson = await priyaChunkPreviewRes.json();
    assert(priyaChunkJson.data?.chunk_index === 0, 'Chunk preview returns chunk_index 0');
    assert(typeof priyaChunkJson.data?.snippet === 'string', 'Chunk preview returns passage snippet');
    assert(priyaChunkJson.data?.snippet.length > 20, 'Passage snippet is non-empty');

    // 4.3 Unauthorized preview -> 404
    const marcusPreviewRes = await fetch(`${baseUrl}/api/documents/TKT-10421/preview`, {
      headers: { Authorization: `Bearer ${marcusToken}` },
    });
    assert(marcusPreviewRes.status === 404, 'Unauthorized preview returns HTTP 404');

    // 4.4 Unauthorized chunk preview -> 404
    const marcusChunkPreviewRes = await fetch(`${baseUrl}/api/documents/TKT-10421/preview?chunk_index=0`, {
      headers: { Authorization: `Bearer ${marcusToken}` },
    });
    assert(marcusChunkPreviewRes.status === 404, 'Unauthorized chunk preview returns HTTP 404');

    // 4.5 Restricted chunk preview: employee without clearance -> 404
    const priyaRestrictedChunkRes = await fetch(`${baseUrl}/api/documents/SEC-REST-01/preview?chunk_index=0`, {
      headers: { Authorization: `Bearer ${priyaToken}` },
    });
    assert(priyaRestrictedChunkRes.status === 404, 'Non-cleared employee receives HTTP 404 on restricted preview');

    // 4.6 Restricted chunk preview: cleared admin -> 200
    const rafaelRestrictedChunkRes = await fetch(`${baseUrl}/api/documents/SEC-REST-01/preview?chunk_index=0`, {
      headers: { Authorization: `Bearer ${rafaelToken}` },
    });
    assert(rafaelRestrictedChunkRes.status === 200, 'Cleared admin receives HTTP 200 on restricted preview');

    // --------------------------------------------------------------------------
    // TEST GROUP 5: Direct Evidence Citation Resolution
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 5: Direct Citation Resolution Endpoints ---');

    // 5.1 Authorized citation resolution
    const priyaCitationRes = await fetch(`${baseUrl}/api/documents/TKT-10421/citations/0`, {
      headers: { Authorization: `Bearer ${priyaToken}` },
    });
    assert(priyaCitationRes.status === 200, 'Authorized citation resolution returns HTTP 200');
    const priyaCitationJson = await priyaCitationRes.json();
    assert(priyaCitationJson.data?.document_id === 'TKT-10421', 'Citation document_id is TKT-10421');
    assert(priyaCitationJson.data?.chunk_index === 0, 'Citation chunk_index is 0');
    assert(priyaCitationJson.data?.snippet.length > 20, 'Citation includes non-empty evidence passage');
    assert(priyaCitationJson.data?.tenant_id === 'ten_brightwave', 'Citation includes tenant_id');

    // 5.2 Unauthorized citation resolution -> 404
    const marcusCitationRes = await fetch(`${baseUrl}/api/documents/TKT-10421/citations/0`, {
      headers: { Authorization: `Bearer ${marcusToken}` },
    });
    assert(marcusCitationRes.status === 404, 'Unauthorized citation resolution returns HTTP 404');

    // 5.3 Customer user unauthorized citation resolution -> 404
    const hannahCitationRes = await fetch(`${baseUrl}/api/documents/TKT-10467/citations/0`, {
      headers: { Authorization: `Bearer ${hannahToken}` },
    });
    assert(hannahCitationRes.status === 404, 'Customer user foreign citation resolution returns HTTP 404');

    // 5.4 Restricted document citation: non-cleared employee -> 404
    const priyaRestrictedCitationRes = await fetch(`${baseUrl}/api/documents/SEC-REST-01/citations/0`, {
      headers: { Authorization: `Bearer ${priyaToken}` },
    });
    assert(
      priyaRestrictedCitationRes.status === 404,
      'Non-cleared employee receiving restricted citation returns HTTP 404'
    );

    // 5.5 Restricted document citation: cleared admin -> 200
    const rafaelRestrictedCitationRes = await fetch(`${baseUrl}/api/documents/SEC-REST-01/citations/0`, {
      headers: { Authorization: `Bearer ${rafaelToken}` },
    });
    assert(rafaelRestrictedCitationRes.status === 200, 'Cleared admin resolving restricted citation returns HTTP 200');

    // 5.6 Nonexistent citation document -> 404
    const nonexistentCitationRes = await fetch(`${baseUrl}/api/documents/TKT-99999/citations/0`, {
      headers: { Authorization: `Bearer ${priyaToken}` },
    });
    assert(nonexistentCitationRes.status === 404, 'Nonexistent citation document returns HTTP 404');

    // 5.7 Out-of-bounds chunk index -> 404
    const outOfBoundsCitationRes = await fetch(`${baseUrl}/api/documents/PDOC-0001/citations/999`, {
      headers: { Authorization: `Bearer ${priyaToken}` },
    });
    assert(outOfBoundsCitationRes.status === 404, 'Out-of-bounds chunk index returns HTTP 404');

    // 5.8 REST alias: GET /api/citations/:documentId/:chunkIndex
    const aliasAuthRes = await fetch(`${baseUrl}/api/citations/TKT-10421/0`, {
      headers: { Authorization: `Bearer ${priyaToken}` },
    });
    assert(aliasAuthRes.status === 200, 'Alias /api/citations/TKT-10421/0 returns HTTP 200');

    const aliasUnauthRes = await fetch(`${baseUrl}/api/citations/TKT-10421/0`, {
      headers: { Authorization: `Bearer ${marcusToken}` },
    });
    assert(aliasUnauthRes.status === 404, 'Alias /api/citations/TKT-10421/0 for unauthorized caller returns HTTP 404');

    // --------------------------------------------------------------------------
    // TEST GROUP 6: Secure Document Download (GET /api/documents/:documentId/download)
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 6: Secure Document Download ---');

    // 6.1 Authorized download for support agent
    const priyaDownloadRes = await fetch(`${baseUrl}/api/documents/TKT-10421/download`, {
      headers: { Authorization: `Bearer ${priyaToken}` },
    });
    assert(priyaDownloadRes.status === 200, 'Authorized download returns HTTP 200');
    const priyaDownloadJson = await priyaDownloadRes.json();
    assert(priyaDownloadJson.success === true, 'Download response success is true');
    assert(priyaDownloadJson.data?.document_id === 'TKT-10421', 'Download response contains document_id');

    // 6.2 Unauthorized download for support agent -> 404
    const marcusDownloadRes = await fetch(`${baseUrl}/api/documents/TKT-10421/download`, {
      headers: { Authorization: `Bearer ${marcusToken}` },
    });
    assert(marcusDownloadRes.status === 404, 'Unauthorized download returns HTTP 404');

    // 6.3 Customer user blocked from downloading confidential tickets
    const hannahTicketDownloadRes = await fetch(`${baseUrl}/api/documents/TKT-10421/download`, {
      headers: { Authorization: `Bearer ${hannahToken}` },
    });
    assert(
      hannahTicketDownloadRes.status === 404,
      'Customer user blocked from downloading confidential ticket (HTTP 404)'
    );

    // 6.4 Customer user permitted to download public document
    const hannahPublicDownloadRes = await fetch(`${baseUrl}/api/documents/PDOC-0002/download`, {
      headers: { Authorization: `Bearer ${hannahToken}` },
    });
    assert(hannahPublicDownloadRes.status === 200, 'Customer user downloads public document with HTTP 200');

    // 6.5 Employee without clearance blocked from downloading restricted document
    const priyaRestrictedDownloadRes = await fetch(`${baseUrl}/api/documents/SEC-REST-01/download`, {
      headers: { Authorization: `Bearer ${priyaToken}` },
    });
    assert(
      priyaRestrictedDownloadRes.status === 404,
      'Non-cleared employee blocked from downloading restricted document (HTTP 404)'
    );

    // 6.6 Cleared admin permitted to download restricted document
    const rafaelRestrictedDownloadRes = await fetch(`${baseUrl}/api/documents/SEC-REST-01/download`, {
      headers: { Authorization: `Bearer ${rafaelToken}` },
    });
    assert(rafaelRestrictedDownloadRes.status === 200, 'Cleared admin downloads restricted document with HTTP 200');

    // --------------------------------------------------------------------------
    // TEST GROUP 7: Ingestion Jobs Protection (GET /api/documents/jobs/:jobId)
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 7: Ingestion Jobs Diagnostic Protection ---');

    // 7.1 Customer user blocked from probing ingestion jobs
    const hannahJobRes = await fetch(`${baseUrl}/api/documents/jobs/00000000-0000-0000-0000-000000000001`, {
      headers: { Authorization: `Bearer ${hannahToken}` },
    });
    assert(hannahJobRes.status === 404, 'Customer user blocked from inspecting ingestion jobs (HTTP 404)');

    // 7.2 Internal employee can access ingestion jobs endpoint
    const priyaJobRes = await fetch(`${baseUrl}/api/documents/jobs/00000000-0000-0000-0000-000000000001`, {
      headers: { Authorization: `Bearer ${priyaToken}` },
    });
    // Job doesn't exist, but employee receives JOB_NOT_FOUND rather than forbidden/blocked
    assert(priyaJobRes.status === 404, 'Employee receives 404 for nonexistent job');
    const priyaJobJson = await priyaJobRes.json();
    assert(priyaJobJson.error?.code === 'JOB_NOT_FOUND', 'Employee receives standard JOB_NOT_FOUND code');

    console.log('\n==================================================================');
    console.log(` RESULTS: All ${passedTests}/${totalTests} Secure Document & Citation API Tests PASSED!`);
    console.log('==================================================================\n');
  } catch (error) {
    console.error('\nTest Suite Execution Failed:', error);
    process.exit(1);
  } finally {
    await query(`DELETE FROM document_chunks WHERE id = 'c0000000-0000-0000-0000-000000000099'`);
    await query(`DELETE FROM document_versions WHERE id = 'b0000000-0000-0000-0000-000000000099'`);
    await query(`DELETE FROM documents WHERE id = 'd0000000-0000-0000-0000-000000000099'`);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool();
  }
}

runSecureDocumentCitationApisTestSuite();
