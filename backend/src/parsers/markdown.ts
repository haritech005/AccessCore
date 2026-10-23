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

  // Merge frontmatter with any explicit caller overrides
  const mergedMetadata = {
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
