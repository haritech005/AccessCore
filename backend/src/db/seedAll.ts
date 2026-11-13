import fs from 'fs';
import path from 'path';
import { runMigrations } from './migrate';
import { seedIdentities } from './seedIdentities';
import { syncDocumentPermissions, seedApprovedSummaries } from './seedDisclosurePolicies';
import { ingestionService } from '../services/ingestionService';
import { closePool, query } from './index';

function findAssetsDirectory(): string {
  const candidates = [
    path.resolve(__dirname, '../../../assets'),
    path.resolve(__dirname, '../../assets'),
    path.resolve(process.cwd(), 'assets'),
    path.resolve(process.cwd(), '../assets'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.existsSync(path.join(c, 'product-documents'))) {
      return c;
    }
  }
  throw new Error(`Could not find AccessCore assets directory in candidates: ${candidates.join(', ')}`);
}

export async function seedAll(options?: { quiet?: boolean }): Promise<void> {
  const log = options?.quiet ? () => {} : console.log;

  log('================================================================================');
  log(' AccessCore — Comprehensive Database Migration & Synthetic Seed Pipeline');
  log('================================================================================\n');

  // Step 1: Run All Migrations
  log('[SeedAll Step 1/4] Running schema migrations (001 through 007)...');
  await runMigrations();

  // Step 2: Seed Identities (Tenants, Groups, User Accounts)
  log('\n[SeedAll Step 2/4] Seeding enterprise identities, tenants, and security groups...');
  process.env.ALLOW_PROD_SEED = 'true';
  await seedIdentities({ quiet: options?.quiet });

  // Step 3: Ingest Synthetic Knowledge Base Documents
  log('\n[SeedAll Step 3/4] Ingesting synthetic CloudDesk product documents and tickets...');
  const assetsDir = findAssetsDirectory();
  const productDocsDir = path.join(assetsDir, 'product-documents');
  const supportTicketsDir = path.join(assetsDir, 'support-tickets');

  const mdFiles = [
    'PDOC-0001-webhook-delivery-troubleshooting.md',
    'PDOC-0002-webhooks-overview.md',
    'PDOC-0003-api-rate-limits.md',
    'PDOC-0004-flow-loop-limits.md',
  ];

  for (const file of mdFiles) {
    const filePath = path.join(productDocsDir, file);
    if (!fs.existsSync(filePath)) {
      log(`  ⚠️ Skipping missing file: ${file}`);
      continue;
    }
    const buffer = fs.readFileSync(filePath);
    const res = await ingestionService.ingestDocument({ filename: file, buffer });
    log(`  ✓ Ingested ${res.document_id} (${res.chunks_count} chunks, v${res.version})`);
  }

  const ticketFiles = [
    'TKT-10421-brightwave-webhook-timeouts.json',
    'TKT-10467-lumenfield-api-rate-limit.json',
    'TKT-10533-harborpine-saml-failure.json',
  ];

  for (const file of ticketFiles) {
    const filePath = path.join(supportTicketsDir, file);
    if (!fs.existsSync(filePath)) {
      log(`  ⚠️ Skipping missing file: ${file}`);
      continue;
    }
    const buffer = fs.readFileSync(filePath);
    const res = await ingestionService.ingestDocument({ filename: file, buffer });
    log(`  ✓ Ingested ${res.document_id} (${res.chunks_count} chunks, v${res.version})`);
  }

  // Step 4: Synchronize Permissions & Seed Customer Summaries
  log('\n[SeedAll Step 4/4] Synchronizing document permissions and customer summaries...');
  const permCount = await syncDocumentPermissions();
  log(`  ✓ Synchronized ${permCount} document permission records.`);
  const summaryCount = await seedApprovedSummaries();
  log(`  ✓ Seeded ${summaryCount} approved customer summaries.`);

  // Validation Summary
  const userCountRes = await query<{ count: string }>('SELECT count(*) FROM users');
  const docCountRes = await query<{ count: string }>(
    "SELECT count(*) FROM documents WHERE status = 'completed' AND (metadata->>'is_active')::boolean IS NOT FALSE"
  );
  const chunkCountRes = await query<{ count: string }>('SELECT count(*) FROM document_chunks WHERE is_active = true');

  log('\n================================================================================');
  log(' SEED PIPELINE COMPLETED SUCCESSFULLY!');
  log('================================================================================');
  log(`  - Active Users           : ${userCountRes.rows[0].count}`);
  log(`  - Active Documents       : ${docCountRes.rows[0].count}`);
  log(`  - Active Vector Chunks   : ${chunkCountRes.rows[0].count}`);
  log(`  - Approved Summaries     : ${summaryCount}`);
  log('================================================================================\n');
}

if (require.main === module) {
  seedAll()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[SeedAll] Error during seeding:', err);
      await closePool();
      process.exit(1);
    });
}
