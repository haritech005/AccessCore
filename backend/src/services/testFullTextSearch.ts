import assert from 'assert';
import { fullTextSearchService } from './fullTextSearchService';
import { authService } from './authService';
import { closePool } from '../db';
import { AuthenticatedUser } from '../types/identity';

async function runFullTextSearchTests(): Promise<void> {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 4.2 — PostgreSQL Full-Text Search Test Suite ');
  console.log('==================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
    try {
      await fn();
      console.log(`  ✓ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ [FAIL] ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  // Resolve test users
  const priya = await authService.resolveAuthenticatedUser('emp_001'); // Support agent (Brightwave, Lumenfield)
  const marcus = await authService.resolveAuthenticatedUser('emp_002'); // Support agent (Harborpine, Lumenfield)
  const hannah = await authService.resolveAuthenticatedUser('cu_001'); // Customer user (Brightwave)
  const rafael = await authService.resolveAuthenticatedUser('emp_008'); // IT Security Admin (grp_security_restricted)
  const suspended = await authService.resolveAuthenticatedUser('emp_099'); // Inactive/suspended

  assert(priya, 'Priya must exist');
  assert(marcus, 'Marcus must exist');
  assert(hannah, 'Hannah must exist');

  // --- GROUP 1: Exact Technical Identifiers & Error Codes ---
  console.log('--- TEST GROUP 1: Technical Error Codes & Identifiers ---');

  await test('Exact error code CD-API-429 matches PDOC-0003 at rank #1', async () => {
    const res = await fullTextSearchService.searchChunks({
      query: 'CD-API-429',
      top_k: 3,
      user: priya!,
    });

    assert(res.chunks.length > 0, 'Should find matching chunks');
    assert.strictEqual(res.chunks[0].document_id, 'PDOC-0003');
    assert(res.chunks[0].content.includes('CD-API-429'));
    assert(res.chunks[0].rank > 0);
  });

  await test('Exact error code CD-WHK-504 matches PDOC-0002 or PDOC-0001', async () => {
    const res = await fullTextSearchService.searchChunks({
      query: 'CD-WHK-504',
      top_k: 3,
      user: priya!,
    });

    assert(res.chunks.length > 0, 'Should find matching chunks');
    const docIds = res.chunks.map((c) => c.document_id);
    assert(docIds.includes('PDOC-0002') || docIds.includes('PDOC-0001'));
    assert(res.chunks[0].content.includes('CD-WHK-504'));
  });

  await test('Exact error code CD-FLW-310 matches PDOC-0004 at rank #1', async () => {
    const res = await fullTextSearchService.searchChunks({
      query: 'CD-FLW-310',
      top_k: 3,
      user: priya!,
    });

    assert(res.chunks.length > 0, 'Should find matching chunks');
    assert.strictEqual(res.chunks[0].document_id, 'PDOC-0004');
    assert(res.chunks[0].content.includes('CD-FLW-310'));
  });

  await test('Ticket identifier TKT-10467 matches Lumenfield ticket for authorized agent Priya', async () => {
    const res = await fullTextSearchService.searchChunks({
      query: 'TKT-10467',
      top_k: 3,
      user: priya!,
    });

    assert(res.chunks.length > 0, 'Should find matching chunks');
    assert.strictEqual(res.chunks[0].document_id, 'TKT-10467');
  });

  await test('Case-insensivity: lowercase "cd-api-429" matches uppercase identifier', async () => {
    const res = await fullTextSearchService.searchChunks({
      query: 'cd-api-429',
      top_k: 3,
      user: priya!,
    });

    assert(res.chunks.length > 0, 'Should find matching chunks');
    assert.strictEqual(res.chunks[0].document_id, 'PDOC-0003');
  });

  // --- GROUP 2: Natural Language Technical Search ---
  console.log('\n--- TEST GROUP 2: Natural Language Technical Queries ---');

  await test('Natural language query "How many requests per minute does the Starter plan allow?" ranks PDOC-0003 #1', async () => {
    const res = await fullTextSearchService.searchChunks({
      query: 'How many requests per minute does the Starter plan allow?',
      top_k: 3,
      user: priya!,
    });

    assert(res.chunks.length > 0, 'Should find matching chunks');
    assert.strictEqual(res.chunks[0].document_id, 'PDOC-0003');
    assert(res.chunks[0].content.includes('60 requests per minute'));
  });

  await test('Query "flow nesting depth limit 10" ranks PDOC-0004 #1', async () => {
    const res = await fullTextSearchService.searchChunks({
      query: 'flow nesting depth limit 10',
      top_k: 3,
      user: priya!,
    });

    assert(res.chunks.length > 0, 'Should find matching chunks');
    assert.strictEqual(res.chunks[0].document_id, 'PDOC-0004');
    assert(res.chunks[0].content.includes('10'));
  });

  await test('Query with headline generation returns highlighted terms', async () => {
    const res = await fullTextSearchService.searchChunks({
      query: 'Starter plan rate limit 60 requests',
      top_k: 1,
      user: priya!,
    });

    assert(res.chunks.length > 0);
    assert(res.chunks[0].headline);
    assert(res.chunks[0].headline.includes('<b>'));
  });

  // --- GROUP 3: Tenant Boundary & Permission Isolation ---
  console.log('\n--- TEST GROUP 3: Cross-Tenant Isolation ---');

  await test('Marcus Webb (Harborpine & Lumenfield) querying Brightwave ticket TKT-10421 returns 0 chunks', async () => {
    const res = await fullTextSearchService.searchChunks({
      query: 'What was reported in ticket TKT-10421?',
      top_k: 5,
      user: marcus!,
    });

    assert.strictEqual(res.chunks.length, 0, 'Marcus must not retrieve Brightwave ticket chunks');
  });

  await test('Customer Hannah Brooks (Brightwave) querying Harborpine ticket TKT-10533 returns 0 chunks', async () => {
    const res = await fullTextSearchService.searchChunks({
      query: 'TKT-10533 SAML sign-in failure',
      top_k: 5,
      user: hannah!,
    });

    assert.strictEqual(res.chunks.length, 0, 'Hannah must not retrieve Harborpine ticket chunks');
  });

  // --- GROUP 4: Security Clearance & Sensitivity Filtering ---
  console.log('\n--- TEST GROUP 4: Restricted Sensitivity Clearance ---');

  await test('Employee Priya without grp_security_restricted cannot retrieve restricted security audit chunks', async () => {
    const res = await fullTextSearchService.searchChunks({
      query: 'security penetration test vulnerability audit findings',
      top_k: 5,
      user: priya!,
    });

    for (const chunk of res.chunks) {
      assert.notStrictEqual(chunk.metadata.sensitivity, 'restricted', 'Priya must not receive restricted chunks');
    }
  });

  // --- GROUP 5: Customer Persona Document Access & Ticket Boundary ---
  console.log('\n--- TEST GROUP 5: Customer Persona Document Access & Ticket Boundary ---');

  await test('Customer Hannah Brooks can search public customer-shareable documents (PDOC-0003)', async () => {
    const res = await fullTextSearchService.searchChunks({
      query: 'Starter plan rate limits 60 requests',
      top_k: 3,
      user: hannah!,
    });

    assert(res.chunks.length > 0, 'Customer should retrieve public customer-shareable documents');
    assert.strictEqual(res.chunks[0].document_id, 'PDOC-0003');
  });

  await test('Customer Hannah Brooks searching for raw ticket TKT-10421 returns 0 chunks (excluded by grp_support boundary)', async () => {
    const res = await fullTextSearchService.searchChunks({
      query: 'TKT-10421 webhook delivery delay',
      top_k: 3,
      user: hannah!,
    });

    assert.strictEqual(res.chunks.length, 0, 'Customer must not retrieve raw ticket chunks');
  });

  await test('Authorized support agent Priya can search and retrieve raw ticket TKT-10421 chunks', async () => {
    const res = await fullTextSearchService.searchChunks({
      query: 'TKT-10421 webhook delivery delay',
      top_k: 3,
      user: priya!,
    });

    assert(res.chunks.length > 0, 'Authorized agent Priya must retrieve ticket chunks');
    assert.strictEqual(res.chunks[0].document_id, 'TKT-10421');
  });

  // --- GROUP 6: Edge Cases & Query Resilience ---
  console.log('\n--- TEST GROUP 6: Edge Cases & Resilience ---');

  await test('Query with stop words only ("what is the") returns 0 chunks without database error', async () => {
    const res = await fullTextSearchService.searchChunks({
      query: 'what is the',
      top_k: 3,
      user: priya!,
    });

    assert.strictEqual(res.chunks.length, 0);
    assert(res.latency_ms >= 0);
  });

  await test('Query with punctuation only ("???") returns 0 chunks without database error', async () => {
    const res = await fullTextSearchService.searchChunks({
      query: '???',
      top_k: 3,
      user: priya!,
    });

    assert.strictEqual(res.chunks.length, 0);
  });

  await test('Suspended user account (emp_099) returns 0 chunks immediately', async () => {
    const res = await fullTextSearchService.searchChunks({
      query: 'CD-API-429',
      top_k: 3,
      user: suspended || undefined,
    });

    assert.strictEqual(res.chunks.length, 0);
  });

  await test('Query exceeding 2000 characters is rejected with HTTP 400 AppError', async () => {
    let errorCaught = false;
    try {
      await fullTextSearchService.searchChunks({
        query: 'a'.repeat(2001),
        user: priya!,
      });
    } catch (err: any) {
      errorCaught = true;
      assert.strictEqual(err.statusCode, 400);
      assert.strictEqual(err.code, 'QUERY_TOO_LONG');
    }
    assert(errorCaught, 'Should throw AppError for query > 2000 chars');
  });

  await test('Empty string query is rejected with HTTP 400 AppError', async () => {
    let errorCaught = false;
    try {
      await fullTextSearchService.searchChunks({
        query: '   ',
        user: priya!,
      });
    } catch (err: any) {
      errorCaught = true;
      assert.strictEqual(err.statusCode, 400);
      assert.strictEqual(err.code, 'INVALID_QUERY');
    }
    assert(errorCaught, 'Should throw AppError for whitespace query');
  });

  console.log('\n==================================================================');
  console.log(` RESULTS: ${passed} passed, ${failed} failed across ${passed + failed} tests`);
  console.log('==================================================================\n');

  if (failed > 0) {
    throw new Error(`${failed} full-text search test(s) failed.`);
  }
}

if (require.main === module) {
  runFullTextSearchTests()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('\n[Full-Text Search Tests] Fatal error:', err);
      await closePool();
      process.exit(1);
    });
}
