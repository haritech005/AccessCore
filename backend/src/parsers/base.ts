import crypto from 'crypto';
import path from 'path';

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export class DocumentParseError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, code = 'PARSE_ERROR', statusCode = 400) {
    super(message);
    this.name = 'DocumentParseError';
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnsupportedFormatError extends DocumentParseError {
  constructor(filename: string, ext: string) {
    super(
      `File '${filename}' has an unsupported extension '${ext}'. Supported formats: .pdf, .md, .json`,
      'UNSUPPORTED_FORMAT',
      415
    );
  }
}

export class FileEmptyError extends DocumentParseError {
  constructor(filename: string) {
    super(`File '${filename}' is empty (0 bytes).`, 'FILE_EMPTY', 400);
  }
}

export class FileTooLargeError extends DocumentParseError {
  constructor(filename: string, sizeBytes: number) {
    super(
      `File '${filename}' (${(sizeBytes / (1024 * 1024)).toFixed(2)}MB) exceeds the maximum allowed limit of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`,
      'FILE_TOO_LARGE',
      413
    );
  }
}

export class MalformedDocumentError extends DocumentParseError {
  details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message, 'MALFORMED_DOCUMENT', 400);
    this.details = details;
  }
}

export function validateFileBasics(
  buffer: Buffer,
  filename: string,
  allowedExtensions: string[]
): string {
  if (!buffer || buffer.length === 0) {
    throw new FileEmptyError(filename);
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new FileTooLargeError(filename, buffer.length);
  }

  const ext = path.extname(filename).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    throw new UnsupportedFormatError(filename, ext);
  }

  return ext;
}

export function computeSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
