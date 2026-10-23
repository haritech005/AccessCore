import crypto from 'crypto';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { DocumentChunk, DocumentMetadata, ParsedDocument } from '../types/document';

export interface ChunkingOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  separators?: string[];
}

export const DEFAULT_CHUNK_SIZE = 1000;
export const DEFAULT_CHUNK_OVERLAP = 200;

export interface GeneratedChunk {
  chunk_index: number;
  content: string;
  chunk_hash: string;
  section_heading?: string;
  start_char: number;
  end_char: number;
  metadata: {
    document_id: string;
    title: string;
    tenant_id: string;
    allowed_groups: string[];
    sensitivity: DocumentMetadata['sensitivity'];
    disclosure_policy: DocumentMetadata['disclosure_policy'];
    section_heading?: string;
    start_char: number;
    end_char: number;
    chunk_hash: string;
    page_number?: number;
  };
}

export class ChunkingService {
  /**
   * Detects the nearest preceding section heading (# or ## or ###) for a text offset.
   */
  private findSectionHeading(fullText: string, offset: number): string | undefined {
    const textBefore = fullText.slice(0, Math.max(0, offset + 50));
    const headingMatches = [...textBefore.matchAll(/^(#{1,4})\s+(.+)$/gm)];
    if (headingMatches.length > 0) {
      const lastMatch = headingMatches[headingMatches.length - 1];
      return lastMatch[2].trim();
    }
    return undefined;
  }

  /**
   * Splits a parsed document into retrievable chunks with citation metadata.
   */
  async splitDocument(
    parsed: ParsedDocument,
    options?: ChunkingOptions
  ): Promise<GeneratedChunk[]> {
    const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const chunkOverlap = options?.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
    const separators = options?.separators ?? [
      '\n## ',
      '\n### ',
      '\n#### ',
      '\n\n',
      '\n',
      ' ',
      '',
    ];

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
      separators,
    });

    const rawChunks = await splitter.splitText(parsed.content);
    const fullText = parsed.content;
    const chunks: GeneratedChunk[] = [];

    let searchCursor = 0;

    for (let index = 0; index < rawChunks.length; index++) {
      const chunkText = rawChunks[index].trim();
      if (!chunkText) continue;

      // Find character boundaries in the original text
      let startChar = fullText.indexOf(chunkText, searchCursor);
      if (startChar === -1) {
        // Fallback if whitespace variations occurred during splitting
        startChar = fullText.indexOf(chunkText.slice(0, Math.min(50, chunkText.length)), searchCursor);
        if (startChar === -1) {
          startChar = searchCursor;
        }
      }
      const endChar = startChar + chunkText.length;
      searchCursor = Math.max(searchCursor, startChar + 1);

      const sectionHeading = this.findSectionHeading(fullText, startChar);
      const chunkHash = crypto.createHash('sha256').update(chunkText).digest('hex');

      chunks.push({
        chunk_index: index,
        content: chunkText,
        chunk_hash: chunkHash,
        section_heading: sectionHeading,
        start_char: startChar,
        end_char: endChar,
        metadata: {
          document_id: parsed.document_id,
          title: parsed.title,
          tenant_id: parsed.metadata.tenant_id,
          allowed_groups: parsed.metadata.allowed_groups,
          sensitivity: parsed.metadata.sensitivity,
          disclosure_policy: parsed.metadata.disclosure_policy,
          section_heading: sectionHeading,
          start_char: startChar,
          end_char: endChar,
          chunk_hash: chunkHash,
        },
      });
    }

    return chunks;
  }
}

export const chunkingService = new ChunkingService();
