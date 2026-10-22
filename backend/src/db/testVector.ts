import { getPool, closePool } from './index';

// Helper to create a 768-dimensional normalized test vector
function createNormalizedVector(dim = 768, seed = 1): number[] {
  const vec: number[] = [];
  let sumSq = 0;
  for (let i = 0; i < dim; i++) {
    const val = Math.sin(seed * (i + 1));
    vec.push(val);
    sumSq += val * val;
  }
  const norm = Math.sqrt(sumSq);
  return vec.map((v) => v / norm);
}

function vectorToSql(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

export async function testVectorStorageAndRetrieval(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  console.log('[AccessCore Vector Test] Starting vector similarity test...');

  try {
    // 1. Verify pgvector extension
    const extRes = await client.query<{ extversion: string }>(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'"
    );
    if (!extRes.rows[0]) {
      throw new Error('pgvector extension is not installed in the database.');
    }
    console.log(`[AccessCore Vector Test] pgvector extension active: v${extRes.rows[0].extversion}`);

    // 2. Insert test document
    const docRes = await client.query<{ id: string }>(
      `INSERT INTO documents (document_id, title, filename, format, status, metadata)
       VALUES ('TEST-DOC-001', 'Test Vector Storage', 'test.md', 'markdown', 'processing', '{"test": true}'::jsonb)
       RETURNING id`
    );
    const docId = docRes.rows[0].id;

    // 3. Insert test document version
    const verRes = await client.query<{ id: string }>(
      `INSERT INTO document_versions (document_id, version, content_hash, status)
       VALUES ($1, 1, 'dummy_hash_123', 'active')
       RETURNING id`,
      [docId]
    );
    const verId = verRes.rows[0].id;

    // 4. Create 3 distinct 768-dimensional test vectors
    const v1 = createNormalizedVector(768, 1); // Document chunk 1
    const v2 = createNormalizedVector(768, 5); // Document chunk 2
    const v3 = createNormalizedVector(768, 9); // Document chunk 3

    await client.query(
      `INSERT INTO document_chunks (document_id, version_id, chunk_index, content, embedding, is_active)
       VALUES 
         ($1, $2, 0, 'CloudDesk webhook delivery troubleshooting details', $3::vector, true),
         ($1, $2, 1, 'Rate limits and API quotas for the Starter plan', $4::vector, true),
         ($1, $2, 2, 'SAML Single Sign-On setup instructions', $5::vector, true)`,
      [docId, verId, vectorToSql(v1), vectorToSql(v2), vectorToSql(v3)]
    );
    console.log('[AccessCore Vector Test] Inserted 3 sample chunks with 768-dimensional vectors.');

    // 5. Query using a vector very close to v1 (seed 1 with slight perturbation)
    const queryVec = createNormalizedVector(768, 1.05);
    const searchRes = await client.query<{
      chunk_index: number;
      content: string;
      cosine_distance: number;
      similarity: number;
    }>(
      `SELECT 
         chunk_index,
         content,
         (embedding <=> $1::vector) AS cosine_distance,
         1 - (embedding <=> $1::vector) AS similarity
       FROM document_chunks
       WHERE version_id = $2 AND is_active = true
       ORDER BY embedding <=> $1::vector ASC
       LIMIT 3`,
      [vectorToSql(queryVec), verId]
    );

    console.log('[AccessCore Vector Test] Vector similarity search results:');
    searchRes.rows.forEach((row, i) => {
      console.log(
        `  #${i + 1} Chunk [${row.chunk_index}]: "${row.content}" | Cosine Dist: ${Number(
          row.cosine_distance
        ).toFixed(4)} | Similarity: ${Number(row.similarity).toFixed(4)}`
      );
    });

    if (searchRes.rows.length !== 3) {
      throw new Error(`Expected 3 chunks returned, got ${searchRes.rows.length}`);
    }

    // Verify chunk 0 (seed 1) is closest to query (seed 1.05)
    if (searchRes.rows[0].chunk_index !== 0) {
      throw new Error(
        `Expected closest chunk to be chunk_index 0, got ${searchRes.rows[0].chunk_index}`
      );
    }
    console.log('[AccessCore Vector Test] Correct chunk ranked #1 by cosine similarity!');

    // 6. Clean up test document (cascades to versions and chunks)
    await client.query('DELETE FROM documents WHERE id = $1', [docId]);
    console.log('[AccessCore Vector Test] Test data cleaned up successfully.');
  } finally {
    client.release();
    await closePool();
  }
}

if (require.main === module) {
  testVectorStorageAndRetrieval()
    .then(() => {
      console.log('[AccessCore Vector Test] All vector operations PASSED successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[AccessCore Vector Test] FAILED:', err);
      process.exit(1);
    });
}
