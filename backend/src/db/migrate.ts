import fs from 'fs';
import path from 'path';
import { getPool, closePool } from './index';

export async function runMigrations(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    console.log('[AccessCore Migrations] Ensuring schema_migrations table exists...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const migrationsDir = path.join(__dirname, '../../migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.log(`[AccessCore Migrations] No migrations directory found at ${migrationsDir}`);
      return;
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const { rows: appliedRows } = await client.query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY id ASC'
    );
    const appliedSet = new Set(appliedRows.map((r) => r.name));

    let appliedCount = 0;

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`[AccessCore Migrations] Skipping already applied: ${file}`);
        continue;
      }

      console.log(`[AccessCore Migrations] Applying: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[AccessCore Migrations] Successfully applied: ${file}`);
        appliedCount++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[AccessCore Migrations] Error applying ${file}. Rolled back transaction.`);
        throw err;
      }
    }

    console.log(`[AccessCore Migrations] Completed. Total new migrations applied: ${appliedCount}`);
  } finally {
    client.release();
    await closePool();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('[AccessCore Migrations] Migration process finished successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[AccessCore Migrations] Migration failed:', err);
      process.exit(1);
    });
}
