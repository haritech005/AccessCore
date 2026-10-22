import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import YAML from 'yaml';
import { DocumentMetadataSchema, ParsedDocument } from '../types/document';

interface ValidationSummary {
  documentId: string;
  title: string;
  format: string;
  tenantId: string;
  sensitivity: string;
  disclosurePolicy: string;
  allowedGroups: string[];
  contentHash: string;
  valid: boolean;
}

export function extractMarkdownFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error('Markdown file does not contain valid YAML frontmatter delimiters (---).');
  }

  const frontmatter = YAML.parse(match[1]);
  const body = match[2];
  return { frontmatter, body };
}

export function validateAllDatasetFiles(): {
  success: boolean;
  documents: ParsedDocument[];
  summaries: ValidationSummary[];
} {
  const assetsDir = path.resolve(__dirname, '../../../assets');
  const blueprintPath = path.join(assetsDir, 'clouddesk-company-blueprint.md');

  console.log('[Dataset Validation] Checking CloudDesk blueprint...');
  if (!fs.existsSync(blueprintPath)) {
    throw new Error(`CloudDesk Blueprint not found at: ${blueprintPath}`);
  }
  console.log(`[Dataset Validation] Found blueprint: ${blueprintPath}`);

  const productDocsDir = path.join(assetsDir, 'product-documents');
  const supportTicketsDir = path.join(assetsDir, 'support-tickets');

  const productDocFiles = fs
    .readdirSync(productDocsDir)
    .filter((f) => f.startsWith('PDOC-') && f.endsWith('.md'))
    .sort();

  const ticketFiles = fs
    .readdirSync(supportTicketsDir)
    .filter((f) => f.startsWith('TKT-') && f.endsWith('.json'))
    .sort();

  console.log(
    `[Dataset Validation] Found ${productDocFiles.length} product documents and ${ticketFiles.length} support tickets.`
  );

  const parsedDocuments: ParsedDocument[] = [];
  const summaries: ValidationSummary[] = [];

  // 1. Validate Product Documents (Markdown)
  for (const filename of productDocFiles) {
    const filePath = path.join(productDocsDir, filename);
    const rawContent = fs.readFileSync(filePath, 'utf-8');

    const { frontmatter, body } = extractMarkdownFrontmatter(rawContent);

    // Validate with Zod schema
    const metadata = DocumentMetadataSchema.parse(frontmatter);

    const hash = crypto.createHash('sha256').update(rawContent).digest('hex');

    parsedDocuments.push({
      document_id: metadata.document_id,
      title: metadata.title,
      filename,
      format: 'markdown',
      content: body.trim(),
      metadata,
      content_hash: hash,
    });

    summaries.push({
      documentId: metadata.document_id,
      title: metadata.title,
      format: 'markdown',
      tenantId: metadata.tenant_id,
      sensitivity: metadata.sensitivity,
      disclosurePolicy: metadata.disclosure_policy,
      allowedGroups: metadata.allowed_groups,
      contentHash: hash.substring(0, 12),
      valid: true,
    });
  }

  // 2. Validate Support Tickets (JSON)
  for (const filename of ticketFiles) {
    const filePath = path.join(supportTicketsDir, filename);
    const rawContent = fs.readFileSync(filePath, 'utf-8');

    const json = JSON.parse(rawContent);
    if (!json.metadata || !json.content) {
      throw new Error(`Ticket JSON ${filename} must contain 'metadata' and 'content' objects.`);
    }

    const metadata = DocumentMetadataSchema.parse(json.metadata);

    const hash = crypto.createHash('sha256').update(rawContent).digest('hex');

    // Build plain text representation of ticket for RAG indexing
    const contentText = [
      `# Support Ticket: ${metadata.document_id} — ${metadata.title}`,
      `Customer: ${json.content.customer_name} (Plan: ${json.content.plan}, Priority: ${json.content.priority})`,
      `Reported By: ${json.content.reported_by.name} (${json.content.reported_by.email})`,
      `Issue Summary: ${json.content.issue_summary}`,
      `Customer Report: ${json.content.customer_report}`,
      `Error Codes: ${(json.content.error_codes || []).join(', ')}`,
      `Investigation Notes:`,
      `Confirmed Observations:\n${(json.content.investigation_notes?.confirmed_observations || [])
        .map((o: string) => `- ${o}`)
        .join('\n')}`,
      `Hypotheses Not Confirmed:\n${(json.content.investigation_notes?.hypotheses_not_confirmed || [])
        .map((h: string) => `- ${h}`)
        .join('\n')}`,
      `Actions Taken:\n${(json.content.investigation_notes?.actions_taken || [])
        .map((a: string) => `- ${a}`)
        .join('\n')}`,
    ].join('\n\n');

    parsedDocuments.push({
      document_id: metadata.document_id,
      title: metadata.title,
      filename,
      format: 'json',
      content: contentText,
      metadata,
      content_hash: hash,
      raw_data: json.content,
    });

    summaries.push({
      documentId: metadata.document_id,
      title: metadata.title,
      format: 'json',
      tenantId: metadata.tenant_id,
      sensitivity: metadata.sensitivity,
      disclosurePolicy: metadata.disclosure_policy,
      allowedGroups: metadata.allowed_groups,
      contentHash: hash.substring(0, 12),
      valid: true,
    });
  }

  return {
    success: true,
    documents: parsedDocuments,
    summaries,
  };
}

if (require.main === module) {
  try {
    const { summaries } = validateAllDatasetFiles();
    console.log('\n[Dataset Validation] Contract Verification Summary:');
    console.table(
      summaries.map((s) => ({
        ID: s.documentId,
        Format: s.format,
        Tenant: s.tenantId,
        Sensitivity: s.sensitivity,
        Policy: s.disclosurePolicy,
        Groups: s.allowedGroups.join(', '),
        SHA256: s.contentHash,
        Valid: s.valid ? '✓ PASS' : '✗ FAIL',
      }))
    );
    console.log(`\n[Dataset Validation] All ${summaries.length} sample dataset records PASSED schema and blueprint validation.\n`);
    process.exit(0);
  } catch (err) {
    console.error('\n[Dataset Validation] FAILED:', err);
    process.exit(1);
  }
}
