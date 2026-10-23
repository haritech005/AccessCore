import path from 'path';
import { PDFParse } from 'pdf-parse';
import { DocumentMetadata, DocumentMetadataSchema, ParsedDocument } from '../types/document';
import {
  computeSha256,
  MalformedDocumentError,
  validateFileBasics,
} from './base';

export async function parsePdf(
  buffer: Buffer,
  filename: string,
  overrideMetadata?: Partial<DocumentMetadata>
): Promise<ParsedDocument> {
  validateFileBasics(buffer, filename, ['.pdf']);
  const contentHash = computeSha256(buffer);

  // Validate PDF magic header signature
  if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new MalformedDocumentError(
      `File '${filename}' is not a valid PDF: missing '%PDF-' header signature.`
    );
  }

  const parser = new PDFParse({ data: buffer });
  let extractedText = '';
  let pageCount = 0;
  let pdfInfo: Record<string, unknown> = {};

  try {
    const textResult = await parser.getText();
    extractedText = textResult.text ? textResult.text.trim() : '';

    try {
      const infoResult = await parser.getInfo();
      pageCount = infoResult.total || 0;
      pdfInfo = (infoResult.info || {}) as Record<string, unknown>;
    } catch {
      // Info extraction optional fallback
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new MalformedDocumentError(
      `Failed to parse PDF document '${filename}': ${message}`
    );
  } finally {
    try {
      await parser.destroy();
    } catch {
      // Ignore parser destroy cleanup issues
    }
  }

  if (extractedText.length === 0) {
    throw new MalformedDocumentError(
      `PDF document '${filename}' does not contain any extractable text (it may be scanned/image-only or corrupted).`
    );
  }

  // Derive document_id from override or filename (e.g., PDOC-0005.pdf -> PDOC-0005)
  const basename = path.basename(filename, path.extname(filename));
  const idMatch = basename.match(/^([A-Z]{2,4}-[0-9]{3,5})/);
  const derivedId = idMatch ? idMatch[1] : undefined;

  const titleFromInfo = typeof pdfInfo.Title === 'string' && pdfInfo.Title.trim() ? pdfInfo.Title.trim() : undefined;
  const cleanTitle = basename.replace(/^[A-Z]{2,4}-[0-9]{3,5}[-_ ]*/, '').replace(/[-_]/g, ' ').trim() || 'Untitled Document';

  const nowIso = new Date().toISOString();

  const rawMetadata: Record<string, unknown> = {
    document_id: derivedId,
    title: titleFromInfo || cleanTitle,
    document_type: 'formal_pdf',
    tenant_id: 'global',
    owner_team: 'customer_support',
    allowed_groups: ['grp_support'],
    sensitivity: 'internal',
    disclosure_policy: 'internal_only',
    created_at: nowIso,
    updated_at: nowIso,
    version: '1.0',
    ...(overrideMetadata || {}),
  };

  const metadataResult = DocumentMetadataSchema.safeParse(rawMetadata);
  if (!metadataResult.success) {
    const errorDetails = metadataResult.error.issues
      .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
      .join('; ');
    throw new MalformedDocumentError(
      `Metadata validation failed for PDF '${filename}': ${errorDetails}`,
      metadataResult.error.issues
    );
  }

  const metadata = metadataResult.data;

  return {
    document_id: metadata.document_id,
    title: metadata.title,
    filename,
    format: 'pdf',
    content: extractedText,
    metadata,
    content_hash: contentHash,
    raw_data: {
      page_count: pageCount,
      pdf_info: pdfInfo,
    },
  };
}
