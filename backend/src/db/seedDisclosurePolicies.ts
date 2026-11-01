import { query } from './index';
import { runMigrations } from './migrate';

export interface SeedSummaryDef {
  document_id: string;
  audience: 'customer' | 'internal';
  summary_text: string;
  status: 'approved' | 'draft' | 'deprecated' | 'rejected';
  approved_by: string; // e.g. emp_002
}

export const CLOUDDESK_APPROVED_SUMMARIES: SeedSummaryDef[] = [
  {
    document_id: 'TKT-10421',
    audience: 'customer',
    summary_text:
      'We are investigating intermittent webhook delivery timeouts reported for your workspace. CloudDesk expects your endpoint to respond within 10 seconds, and a delivery with no response in that time fails with error CD-WHK-504. Failed deliveries are retried up to 5 times over approximately one hour, so some events may arrive late. Your webhook endpoint is currently enabled. To help us continue, please check your server logs and response times for the periods when failures occurred, and let us know about any recent server, hosting, network, or security changes. We will update you as our investigation continues.',
    status: 'approved',
    approved_by: 'emp_002',
  },
  {
    document_id: 'TKT-10467',
    audience: 'customer',
    summary_text:
      'We are investigating the API rate-limit errors reported for your workspace. Error CD-API-429 means the API rate limit for your plan has been exceeded, and the Starter plan allows 60 requests per minute. We have not yet determined what is causing the errors in your case. To help us continue, please let us know roughly how often your tool contacts the CloudDesk API, how many lookups it makes for each ticket, whether more than one tool or script uses the API at the same time, and the approximate UTC times of some recent errors. Reviewing how often your tool polls and whether any requests are repeated or unnecessary are recommended places to start, though they are not guaranteed to resolve the errors. We will update you as our investigation continues.',
    status: 'approved',
    approved_by: 'emp_002',
  },
  {
    document_id: 'TKT-10533',
    audience: 'customer',
    summary_text:
      'We are investigating the SAML single sign-on failures reported for your workspace. Error CD-SSO-403 means a SAML assertion was rejected, which can happen because of an audience mismatch or clock skew. CloudDesk allows up to 5 minutes of clock skew for SAML assertions. We have not yet determined the cause of the rejections in your case. To help us continue, please send the approximate UTC times of some failed sign-in attempts, let us know how many users are affected and whether any can still sign in, and tell us whether any SAML or identity configuration changes were made recently. It would also help to confirm that the clock on the system issuing your SAML assertions is correctly synchronized. We will update you as our investigation continues.',
    status: 'approved',
    approved_by: 'emp_002',
  },
];

export async function syncDocumentPermissions(): Promise<number> {
  // Query all active documents
  const docsRes = await query<{
    id: string;
    document_id: string;
    metadata: Record<string, any>;
  }>('SELECT id, document_id, metadata FROM documents');

  let synced = 0;
  for (const doc of docsRes.rows) {
    const meta = doc.metadata || {};
    const tenantId = meta.tenant_id || 'global';
    const allowedGroups = Array.isArray(meta.allowed_groups) ? meta.allowed_groups : ['grp_all_employees'];
    const sensitivity = meta.sensitivity || 'internal';
    const disclosurePolicy = meta.disclosure_policy || 'internal_only';

    await query(
      `INSERT INTO document_permissions (
        document_id, tenant_id, allowed_groups, sensitivity, disclosure_policy, is_active
      ) VALUES ($1, $2, $3, $4, $5, true)
      ON CONFLICT (document_id) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        allowed_groups = EXCLUDED.allowed_groups,
        sensitivity = EXCLUDED.sensitivity,
        disclosure_policy = EXCLUDED.disclosure_policy,
        updated_at = NOW()`,
      [doc.id, tenantId, allowedGroups, sensitivity, disclosurePolicy]
    );
    synced++;
  }
  return synced;
}

export async function seedApprovedSummaries(): Promise<number> {
  let seeded = 0;

  for (const item of CLOUDDESK_APPROVED_SUMMARIES) {
    const docRes = await query<{ id: string; current_version: number }>(
      'SELECT id, current_version FROM documents WHERE document_id = $1',
      [item.document_id]
    );

    if (docRes.rows.length === 0) {
      continue;
    }

    const docUuid = docRes.rows[0].id;

    const verRes = await query<{ id: string }>(
      'SELECT id FROM document_versions WHERE document_id = $1 AND status = $2 ORDER BY version DESC LIMIT 1',
      [docUuid, 'active']
    );
    const verUuid = verRes.rows.length > 0 ? verRes.rows[0].id : null;

    await query(
      `INSERT INTO approved_summaries (
        document_id, version_id, audience, summary_text, status, approved_by, approved_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (document_id, audience) DO UPDATE SET
        version_id = EXCLUDED.version_id,
        summary_text = EXCLUDED.summary_text,
        status = EXCLUDED.status,
        approved_by = EXCLUDED.approved_by,
        approved_at = NOW(),
        updated_at = NOW()`,
      [docUuid, verUuid, item.audience, item.summary_text, item.status, item.approved_by]
    );
    seeded++;
  }

  return seeded;
}

export async function runDisclosurePolicySeed(): Promise<void> {
  console.log('[AccessCore Policies] Running database migrations...');
  await runMigrations();

  console.log('[AccessCore Policies] Synchronizing document permissions...');
  const permCount = await syncDocumentPermissions();
  console.log(`[AccessCore Policies] Synchronized ${permCount} document permission records.`);

  console.log('[AccessCore Policies] Seeding approved customer summaries...');
  const summaryCount = await seedApprovedSummaries();
  console.log(`[AccessCore Policies] Seeded ${summaryCount} approved customer summaries.`);
}

if (require.main === module) {
  runDisclosurePolicySeed()
    .then(() => {
      console.log('[AccessCore Policies] Seed process completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[AccessCore Policies] Seed process failed:', err);
      process.exit(1);
    });
}

