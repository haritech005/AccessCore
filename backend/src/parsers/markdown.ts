import YAML from 'yaml';
import { DocumentMetadata, DocumentMetadataSchema, ParsedDocument } from '../types/document';
import {
  computeSha256,
  MalformedDocumentError,
  validateFileBasics,
} from './base';

export function parseMarkdown(
  buffer: Buffer,
  filename: string,
  overrideMetadata?: Partial<DocumentMetadata>
): ParsedDocument {
  validateFileBasics(buffer, filename, ['.md', '.markdown']);
  const contentHash = computeSha256(buffer);
  const rawText = buffer.toString('utf-8');

  // Match YAML frontmatter enclosed in --- delimiters
  const frontmatterMatch = rawText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

  let rawMetadata: Record<string, unknown> = {};
  let body = rawText;

  if (frontmatterMatch) {
    try {
      rawMetadata = (YAML.parse(frontmatterMatch[1]) as Record<string, unknown>) || {};
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new MalformedDocumentError(`Failed to parse YAML frontmatter in '${filename}': ${message}`);
    }
    body = frontmatterMatch[2];
  } else if (!overrideMetadata || Object.keys(overrideMetadata).length === 0) {
    throw new MalformedDocumentError(
      `Markdown file '${filename}' is missing required YAML frontmatter metadata delimiters (---).`
    );
  }

  const basename = filename.replace(/\.[^/.]+$/, '');
  const idMatch = basename.match(/^([A-Z]{2,4}-[0-9]{3,5})/);
  const derivedId = idMatch ? idMatch[1] : undefined;
  const nowIso = new Date().toISOString();

  // Extract first # heading as title if available
  const headingMatch = body.match(/^#\s+(.+)$/m);
  const derivedTitle = headingMatch
    ? headingMatch[1].trim()
    : basename.replace(/^[A-Z]{2,4}-[0-9]{3,5}[-_ ]*/, '').replace(/[-_]/g, ' ').trim() || 'Untitled Document';

  const defaultMetadata: Record<string, unknown> = {
    document_id: derivedId,
    title: derivedTitle,
    document_type: 'product_doc',
    tenant_id: 'global',
    owner_team: 'engineering',
    allowed_groups: ['grp_engineering'],
    sensitivity: 'internal',
    disclosure_policy: 'internal_only',
    created_at: nowIso,
    updated_at: nowIso,
    version: '1.0',
  };

  // Merge defaults, extracted frontmatter, and explicit caller overrides
  const mergedMetadata = {
    ...defaultMetadata,
    ...rawMetadata,
    ...(overrideMetadata || {}),
  };

  const metadataResult = DocumentMetadataSchema.safeParse(mergedMetadata);
  if (!metadataResult.success) {
    const errorDetails = metadataResult.error.issues
      .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
      .join('; ');
    throw new MalformedDocumentError(
      `Metadata validation failed for '${filename}': ${errorDetails}`,
      metadataResult.error.issues
    );
  }

  const cleanBody = body.trim();
  if (cleanBody.length === 0) {
    throw new MalformedDocumentError(`Markdown document '${filename}' has empty body content.`);
  }

  const metadata = metadataResult.data;

  return {
    document_id: metadata.document_id,
    title: metadata.title,
    filename,
    format: 'markdown',
    content: cleanBody,
    metadata,
    content_hash: contentHash,
    raw_data: { frontmatter: rawMetadata },
  };
}
