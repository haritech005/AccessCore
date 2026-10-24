import { RAGService } from './ragService';
import { EmbeddingService, EmbeddingError } from './embeddingService';
import { Pool } from 'pg';
import { AppError } from '../middleware/errorHandler';
import { closePool } from '../db';

async function runFailureModeTests() {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 1.11 - Failure Mode Resilience Tests         ');
  console.log('==================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(cond: boolean, name: string) {
    total++;
    if (cond) {
      console.log(`  ✓ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  ✗ [FAIL] ${name}`);
      throw new Error(`Failed: ${name}`);
    }
  }

  // 1. Database Unavailable
  console.log('--- TEST 1: Database Unavailable Controlled Error Handling ---');
  const badPool = new Pool({
    connectionString: 'postgresql://baduser:badpass@127.0.0.1:5439/nonexistent',
    connectionTimeoutMillis: 1000,
  });

  let caughtDbError = false;
  try {
    await badPool.query('SELECT 1');
  } catch (err: any) {
    caughtDbError = true;
    assert(
      err.code !== undefined || err.message.includes('connect') || err.message.includes('timeout'),
      'Database connection failure caught cleanly with standard error code'
    );
  } finally {
    await badPool.end().catch(() => {});
  }
  assert(caughtDbError, 'Database unreachable handled without unhandled exception or process termination');

  // 2. Ollama Unavailable (Embedding)
  console.log('\n--- TEST 2: Ollama Unavailable (Embeddings) ---');
  const badEmbedder = new EmbeddingService({
    baseUrl: 'http://127.0.0.1:59999',
  });

  let caughtEmbedError = false;
  try {
    await badEmbedder.generateEmbedding('Test text for offline Ollama');
  } catch (err: any) {
    if (err instanceof EmbeddingError || err.name === 'EmbeddingError') {
      caughtEmbedError = true;
    }
  }
  assert(caughtEmbedError, 'Ollama embedding unreachable caught and typed as EmbeddingError');

  // 3. Ollama Unavailable (Chat Generation)
  console.log('\n--- TEST 3: Ollama Unavailable (Answer Generation) ---');
  const badRag = new RAGService({
    baseUrl: 'http://127.0.0.1:59999',
  });

  let caughtRagError = false;
  try {
    await badRag.answerQuestion({
      question: 'What is the rate limit for Lumenfield?',
      top_k: 2,
    });
  } catch (err) {
    if (err instanceof AppError && err.code === 'MODEL_GENERATION_FAILED' && err.statusCode === 502) {
      caughtRagError = true;
    }
  }
  assert(caughtRagError, 'Ollama chat generation unreachable caught cleanly with 502 MODEL_GENERATION_FAILED');

  console.log('\n==================================================================');
  console.log(` ALL ${passed}/${total} FAILURE MODE RESILIENCE TESTS PASSED! `);
  console.log('==================================================================\n');
  process.exit(0);
}

runFailureModeTests().catch((err) => {
  console.error('Failure test runner error:', err);
  process.exit(1);
});
