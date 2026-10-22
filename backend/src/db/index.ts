import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from '../config';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    if (!config.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not defined.');
    }

    pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      console.error('[PostgreSQL Pool Error]', err);
    });
  }

  return pool;
}

export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const p = getPool();
  return p.query<T>(text, params);
}

export async function getClient(): Promise<PoolClient> {
  const p = getPool();
  return p.connect();
}

export interface DbHealthResult {
  status: 'connected' | 'disconnected' | 'unconfigured';
  message?: string;
  pgvectorVersion?: string;
  tablesReady?: boolean;
}

export async function checkDatabaseHealth(): Promise<DbHealthResult> {
  if (!config.DATABASE_URL) {
    return {
      status: 'unconfigured',
      message: 'DATABASE_URL is not configured',
    };
  }

  try {
    const p = getPool();
    // Test basic connection
    await p.query('SELECT 1 AS ping');

    // Check pgvector extension
    const extRes = await p.query(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'"
    );
    const pgvectorVersion = extRes.rows[0]?.extversion;

    // Check if documents table exists
    const tblRes = await p.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'documents') AS exists"
    );
    const tablesReady = tblRes.rows[0]?.exists === true;

    return {
      status: 'connected',
      pgvectorVersion: pgvectorVersion || 'not installed',
      tablesReady,
    };
  } catch (err) {
    return {
      status: 'disconnected',
      message: err instanceof Error ? err.message : 'Database query failed',
    };
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
