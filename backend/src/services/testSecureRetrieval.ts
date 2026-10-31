import { query, closePool } from '../db';
import { runMigrations } from '../db/migrate';
import { seedIdentities } from '../db/seedIdentities';
import { authService } from './authService';
import { retrievalService } from './retrievalService';
import { ragService, UNAUTHORIZED_ACCESS_MESSAGE } from './ragService';
import { authorizationService } from './authorizationService';
import { embeddingService } from './embeddingService';
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

async function runSecureRetrievalTestSuite() {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 2.6 — Secure Retrieval Test Suite            ');
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
    const meiLinLogin = await authService.login('emp_007', devPassword); // Engineering Manager (grp_incident_review)
    const hannahLogin = await authService.login('cu_001', devPassword); // Customer User (Brightwave only)

    const priya = priyaLogin.user;
    const marcus = marcusLogin.user;
    const elena = elenaLogin.user;
    const rafael = rafaelLogin.user;
    const meiLin = meiLinLogin.user;
    const hannah = hannahLogin.user;

    const priyaToken = priyaLogin.token;
    const marcusToken = marcusLogin.token;

    // --------------------------------------------------------------------------
    // TEST GROUP 1: Inactive / Suspended Account Lockout
    // --------------------------------------------------------------------------
    console.log('--- TEST GROUP 1: Inactive / Suspended Account Lockout ---');
    const suspendedUser = (await authService.resolveAuthenticatedUser('emp_099'))!;

    const rSuspended = await retrievalService.retrieveChunks({
      query: 'What causes webhook error CD-WHK-504?',
      user: suspendedUser,
    });
    assert(rSuspended.chunks.length === 0, 'Suspended account retrieves exactly 0 chunks');
    assert(rSuspended.total_retrieved === 0, 'total_retrieved is 0 for suspended user');

    const inactiveUser = { ...priya, status: 'inactive' as const };
    const rInactive = await retrievalService.retrieveChunks({
      query: 'What causes webhook error CD-WHK-504?',
      user: inactiveUser,
    });
    assert(rInactive.chunks.length === 0, 'Inactive account retrieves exactly 0 chunks');

    // --------------------------------------------------------------------------
    // TEST GROUP 2: Cross-Tenant Retrieval Isolation
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 2: Cross-Tenant Retrieval Isolation ---');
    const bwQuery = 'What did Hannah Brooks report in the Brightwave support ticket?';

    // Priya (Brightwave scoped): retrieves TKT-10421
    const rPriyaBW = await retrievalService.retrieveChunks({
      query: bwQuery,
      user: priya,
    });
    assert(rPriyaBW.chunks.length > 0, 'Priya retrieves chunks for Brightwave ticket');
    assert(rPriyaBW.chunks.some((c) => c.document_id === 'TKT-10421'), 'Priya retrieved TKT-10421 chunk');
    assert(
      rPriyaBW.chunks.every((c) => priya.tenant_scope.includes(c.metadata.tenant_id) || c.metadata.tenant_id === 'global'),
      'All chunks are within Priya authorized tenant scope (Brightwave, Lumenfield, or global)'
    );
    assert(!rPriyaBW.chunks.some((c) => c.metadata.tenant_id === 'ten_harborpine'), 'Zero Harborpine chunks returned to Priya');

    // Marcus (Harborpine + Lumenfield, unauthorized for Brightwave): 0 chunks from Brightwave
    const rMarcusBW = await retrievalService.retrieveChunks({
      query: bwQuery,
      user: marcus,
    });
    assert(rMarcusBW.chunks.length === 0, 'Marcus blocked from Brightwave ticket (0 chunks returned)');
    assert(rMarcusBW.has_blocked_top_match === true, 'Flagged has_blocked_top_match: true');
    assert(!rMarcusBW.chunks.some((c) => c.document_id === 'TKT-10421'), 'Zero TKT-10421 chunks leaked to Marcus');

    // Both Priya and Marcus can retrieve shared Lumenfield ticket TKT-10467
    const lumenQuery = 'What issues occurred with inventory synchronization in Lumenfield ticket TKT-10467?';
    const rPriyaLumen = await retrievalService.retrieveChunks({ query: lumenQuery, user: priya });
    const rMarcusLumen = await retrievalService.retrieveChunks({ query: lumenQuery, user: marcus });

    assert(rPriyaLumen.chunks.some((c) => c.document_id === 'TKT-10467'), 'Priya retrieves Lumenfield ticket');
    assert(rMarcusLumen.chunks.some((c) => c.document_id === 'TKT-10467'), 'Marcus retrieves Lumenfield ticket');

    // --------------------------------------------------------------------------
    // TEST GROUP 3: Customer User Strict Quarantine
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 3: Customer User Strict Quarantine ---');
    // Hannah can retrieve global documentation
    const rHannahGlobal = await retrievalService.retrieveChunks({
      query: 'CloudDesk Platform Administration Guide webhook configuration',
      user: hannah,
    });
    assert(rHannahGlobal.chunks.length > 0, 'Customer user retrieves global public documentation');
    assert(rHannahGlobal.chunks.every((c) => c.metadata.tenant_id === 'global' || c.metadata.tenant_id === 'ten_brightwave'), 'Hannah only receives global or Brightwave chunks');

    // Hannah cannot retrieve Lumenfield or Harborpine tickets
    const rHannahLumen = await retrievalService.retrieveChunks({
      query: 'What issues occurred in Lumenfield ticket TKT-10467?',
      user: hannah,
    });
    assert(rHannahLumen.chunks.length === 0, 'Hannah strictly blocked from Lumenfield tenant chunks');
    assert(!rHannahLumen.chunks.some((c) => c.document_id === 'TKT-10467'), 'Zero Lumenfield chunks leaked to Hannah');

    // --------------------------------------------------------------------------
    // TEST GROUP 4: Wildcard User Scope & Requested Tenant Narrowing
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 4: Wildcard Scope & Tenant Narrowing ---');
    // Elena without constraint: retrieves Brightwave ticket
    const rElenaAll = await retrievalService.retrieveChunks({
      query: bwQuery,
      user: elena,
    });
    assert(rElenaAll.chunks.some((c) => c.document_id === 'TKT-10421'), 'Wildcard lead retrieves Brightwave doc unconstrained');

    // Elena with narrow tenant constraint: requests Lumenfield only -> Brightwave ticket excluded
    const rElenaNarrowed = await retrievalService.retrieveChunks({
      query: bwQuery,
      tenant_scope: ['ten_lumenfield'],
      user: elena,
    });
    assert(!rElenaNarrowed.chunks.some((c) => c.document_id === 'TKT-10421'), 'Narrowed scope to Lumenfield excludes Brightwave chunks for wildcard lead');

    // --------------------------------------------------------------------------
    // TEST GROUP 5: Restricted Sensitivity Clearance in Vector Retrieval
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 5: Restricted Sensitivity Clearance ---');
    // Clean up any stale records first
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
        'hash99',
        'active',
        '{"sensitivity": "restricted"}'
      )
    `);

    // Insert chunk with actual real embedding from embeddingService
    const chunkText = 'Unredacted forensic trace of security vulnerability and root key exposure SEC-REST-01';
    const testEmbedding = await embeddingService.generateEmbedding(chunkText);
    await query(`
      INSERT INTO document_chunks (id, document_id, version_id, chunk_index, content, embedding, metadata, is_active)
      VALUES (
        'c0000000-0000-0000-0000-000000000099',
        'd0000000-0000-0000-0000-000000000099',
        'b0000000-0000-0000-0000-000000000099',
        0,
        $1,
        $2::vector,
        '{"tenant_id": "global", "allowed_groups": ["grp_all_employees"], "sensitivity": "restricted", "title": "Confidential Security Audit Incident"}',
        true
      )
    `, [chunkText, `[${testEmbedding.join(',')}]`]);

    const secQuery = 'forensic trace of security vulnerability and root key exposure SEC-REST-01';

    // Priya (normal employee): excluded from restricted chunk
    const rPriyaSec = await retrievalService.retrieveChunks({ query: secQuery, user: priya, min_similarity: 0.0 });
    assert(!rPriyaSec.chunks.some((c) => c.document_id === 'SEC-REST-01'), 'Normal employee excluded from restricted chunk');

    // Elena (Wildcard lead without clearance): excluded from restricted chunk
    const rElenaSec = await retrievalService.retrieveChunks({ query: secQuery, user: elena, min_similarity: 0.0 });
    assert(!rElenaSec.chunks.some((c) => c.document_id === 'SEC-REST-01'), 'Wildcard lead without clearance excluded from restricted chunk');

    // Rafael (IT security admin holding grp_security_restricted): can retrieve
    const rRafaelSec = await retrievalService.retrieveChunks({ query: secQuery, user: rafael, min_similarity: 0.0 });
    assert(rRafaelSec.chunks.some((c) => c.document_id === 'SEC-REST-01'), 'IT security admin with grp_security_restricted retrieves restricted chunk');

    // Mei Lin (Engineering manager holding grp_incident_review): can retrieve
    const rMeiLinSec = await retrievalService.retrieveChunks({ query: secQuery, user: meiLin, min_similarity: 0.0 });
    assert(rMeiLinSec.chunks.some((c) => c.document_id === 'SEC-REST-01'), 'Engineering manager with grp_incident_review retrieves restricted chunk');

    // --------------------------------------------------------------------------
    // TEST GROUP 6: Client Parameter Tampering Resistance
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 6: Client Parameter Tampering Resistance ---');

    // Marcus tries to pass client-supplied tenant_scope: ['ten_brightwave']
    const rTamperedTenant = await retrievalService.retrieveChunks({
      query: bwQuery,
      tenant_scope: ['ten_brightwave'], // Tampered param
      user: marcus,
    });
    assert(rTamperedTenant.chunks.length === 0, 'Tampered tenant_scope strictly neutralized by server-side user resolution');
    assert(!rTamperedTenant.chunks.some((c) => c.document_id === 'TKT-10421'), 'No Brightwave chunks retrieved despite client spoofing tenant_scope');

    // Marcus tries to pass client-supplied user_groups: ['grp_security_restricted']
    const rTamperedGroup = await retrievalService.retrieveChunks({
      query: secQuery,
      user_groups: ['grp_security_restricted'], // Tampered group
      user: marcus,
      min_similarity: 0.0,
    });
    assert(!rTamperedGroup.chunks.some((c) => c.document_id === 'SEC-REST-01'), 'Tampered user_groups strictly neutralized by authoritative server-side principal');

    // --------------------------------------------------------------------------
    // TEST GROUP 7: Defense-in-Depth Post-Retrieval Verification
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 7: Defense-in-Depth Post-Retrieval Verification ---');
    const rAllPriya = await retrievalService.retrieveChunks({
      query: 'CloudDesk platform architecture and webhook troubleshooting',
      user: priya,
      top_k: 10,
    });

    for (const chunk of rAllPriya.chunks) {
      const authz = authorizationService.can(priya, 'search:retrieval', {
        type: 'chunk',
        document_id: chunk.document_id,
        tenant_id: chunk.metadata.tenant_id,
        allowed_groups: chunk.metadata.allowed_groups,
        sensitivity: chunk.metadata.sensitivity,
        is_active: chunk.is_active,
      });
      assert(authz.allowed === true, `Every returned chunk [${chunk.document_id}] independently passes authorization check`);
    }

    // --------------------------------------------------------------------------
    // TEST GROUP 8: Live HTTP API Endpoints Protection
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 8: Live HTTP API Endpoints Protection ---');

    // Marcus requests /api/retrieval with Brightwave query
    const httpMarcusRetrieval = await fetch(`${baseUrl}/api/retrieval`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${marcusToken}`,
      },
      body: JSON.stringify({ query: bwQuery }),
    });
    assert(httpMarcusRetrieval.status === 200, 'HTTP /api/retrieval returns 200');
    const marcusRetData = await httpMarcusRetrieval.json();
    assert(marcusRetData.data.chunks.length === 0, 'HTTP /api/retrieval returns 0 chunks for unauthorized tenant');
    assert(marcusRetData.data.has_blocked_top_match === true, 'HTTP /api/retrieval flags has_blocked_top_match: true');

    // Priya requests /api/retrieval with Brightwave query
    const httpPriyaRetrieval = await fetch(`${baseUrl}/api/retrieval`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${priyaToken}`,
      },
      body: JSON.stringify({ query: bwQuery }),
    });
    const priyaRetData = await httpPriyaRetrieval.json();
    assert(priyaRetData.data.chunks.length > 0, 'HTTP /api/retrieval returns authorized chunks to Priya');
    assert(priyaRetData.data.chunks[0].document_id === 'TKT-10421', 'HTTP /api/retrieval returns TKT-10421 chunk');

    // Aliased /api/retrieval/search endpoint
    const httpSearch = await fetch(`${baseUrl}/api/retrieval/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${marcusToken}`,
      },
      body: JSON.stringify({ query: bwQuery }),
    });
    assert(httpSearch.status === 200, 'HTTP /api/retrieval/search returns 200');
    const searchData = await httpSearch.json();
    assert(searchData.data.chunks.length === 0, 'Aliased /api/retrieval/search returns 0 chunks for unauthorized tenant');

    // Cleanup synthetic test records
    await query(`DELETE FROM document_chunks WHERE id = 'c0000000-0000-0000-0000-000000000099'`);
    await query(`DELETE FROM document_versions WHERE id = 'b0000000-0000-0000-0000-000000000099'`);
    await query(`DELETE FROM documents WHERE id = 'd0000000-0000-0000-0000-000000000099'`);

    console.log('\n==================================================================');
    console.log(` RESULTS: All ${passedTests}/${totalTests} Secure Retrieval Tests PASSED!`);
    console.log('==================================================================\n');
  } catch (error) {
    console.error('\nTest Suite Execution Failed:', error);
    process.exit(1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool();
  }
}

runSecureRetrievalTestSuite();
