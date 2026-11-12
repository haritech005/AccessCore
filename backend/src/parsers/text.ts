import { DocumentMetadata, DocumentMetadataSchema, ParsedDocument } from '../types/document';
import { computeSha256, MalformedDocumentError, validateFileBasics } from './base';

/**
 * Parses a UTF-8 plain-text (.txt) file using explicit metadata overrides or filename conventions.
 * Rejects binary/null-byte payloads and empty text files.
 */
export function parseText(
  buffer: Buffer,
  filename: string,
  overrideMetadata?: Partial<DocumentMetadata>
): ParsedDocument {
  validateFileBasics(buffer, filename, ['.txt']);
  if (buffer.includes(0)) {
    throw new MalformedDocumentError(
      `Text document '${filename}' appears to contain binary/null bytes and was rejected.`
    );
  }

  const contentHash = computeSha256(buffer);
  const cleanBody = buffer.toString('utf-8').trim();
  if (cleanBody.length === 0) {
    throw new MalformedDocumentError(`Text document '${filename}' has empty body content.`);
  }

  const basename = filename.replace(/\.[^/.]+$/, '');
  const idMatch = basename.match(/^([A-Z]{2,4}-[0-9]{3,5})/);
  const derivedId = idMatch ? idMatch[1] : undefined;
  const nowIso = new Date().toISOString();

  const firstLine = cleanBody.split(/\r?\n/)[0]?.trim();
  const derivedTitle =
    (firstLine && firstLine.length <= 120 ? firstLine : null) ||
    basename.replace(/^[A-Z]{2,4}-[0-9]{3,5}[-_ ]*/, '').replace(/[-_]/g, ' ').trim() ||
    'Untitled Text Document';

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

  const mergedMetadata = {
    ...defaultMetadata,
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

  const metadata = metadataResult.data;
  return {
    document_id: metadata.document_id,
    title: metadata.title,
    filename,
    format: 'text',
    content: cleanBody,
    metadata,
    content_hash: contentHash,
  };
}

