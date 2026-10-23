import path from 'path';
import { DocumentMetadata, ParsedDocument } from '../types/document';
import {
  DocumentParseError,
  FileEmptyError,
  FileTooLargeError,
  MalformedDocumentError,
  MAX_FILE_SIZE_BYTES,
  UnsupportedFormatError,
  computeSha256,
  validateFileBasics,
} from './base';
import { parseJsonTicket, formatTicketToText } from './jsonTicket';
import { parseMarkdown } from './markdown';
import { parsePdf } from './pdf';

export * from './base';
export * from './markdown';
export * from './jsonTicket';
export * from './pdf';

export interface ParseDocumentOptions {
  filename: string;
  buffer: Buffer;
  overrideMetadata?: Partial<DocumentMetadata>;
}

/**
 * Unified entry point for parsing and validating documents.
 * Dispatches to format-specific parsers based on file extension.
 * Validates size, content integrity, and metadata constraints.
 */
export async function parseDocument(
  options: ParseDocumentOptions
): Promise<ParsedDocument> {
  const { filename, buffer, overrideMetadata } = options;

  if (!buffer || buffer.length === 0) {
    throw new FileEmptyError(filename);
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new FileTooLargeError(filename, buffer.length);
  }

  const ext = path.extname(filename).toLowerCase();

  switch (ext) {
    case '.md':
    case '.markdown':
      return parseMarkdown(buffer, filename, overrideMetadata);
    case '.json':
      return parseJsonTicket(buffer, filename, overrideMetadata);
    case '.pdf':
      return await parsePdf(buffer, filename, overrideMetadata);
    default:
      throw new UnsupportedFormatError(filename, ext);
  }
}
