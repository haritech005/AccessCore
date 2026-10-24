import { config } from '../config';

export const EMBEDDING_DIMENSION = 768; // nomic-embed-text dimension

export class EmbeddingError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, code = 'EMBEDDING_ERROR', statusCode = 502) {
    super(message);
    this.name = 'EmbeddingError';
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class EmbeddingService {
  private baseUrl: string;
  private model: string;

  constructor(options?: { baseUrl?: string; model?: string }) {
    this.baseUrl = (options?.baseUrl || config.OLLAMA_BASE_URL).replace(/\/$/, '');
    this.model = options?.model || config.OLLAMA_EMBEDDING_MODEL;
  }

  /**
   * Generates a 768-dimensional normalized embedding for a single text string.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new EmbeddingError('Cannot generate embedding for empty text', 'EMPTY_TEXT_ERROR', 400);
    }

    const url = `${this.baseUrl}/api/embeddings`;
    let response: Response;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout

      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: text.trim(),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new EmbeddingError(
        `Failed to connect to Ollama embedding service at ${url}: ${message}`,
        'OLLAMA_CONNECTION_ERROR'
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new EmbeddingError(
        `Ollama embedding request failed (${response.status}): ${errorBody || response.statusText}`,
        'OLLAMA_API_ERROR',
        response.status
      );
    }

    const json = (await response.json()) as { embedding?: number[] };
    if (!json.embedding || !Array.isArray(json.embedding)) {
      throw new EmbeddingError(
        'Ollama response did not contain an embedding vector array.',
        'MALFORMED_EMBEDDING_RESPONSE'
      );
    }

    if (json.embedding.length !== EMBEDDING_DIMENSION) {
      throw new EmbeddingError(
        `Invalid embedding dimension: expected ${EMBEDDING_DIMENSION}, got ${json.embedding.length}.`,
        'DIMENSION_MISMATCH_ERROR'
      );
    }

    return json.embedding;
  }

  /**
   * Generates embeddings for an array of texts in bounded concurrent batches.
   */
  async generateBatchEmbeddings(
    texts: string[],
    concurrency = 4
  ): Promise<number[][]> {
    const results: number[][] = new Array(texts.length);

    for (let i = 0; i < texts.length; i += concurrency) {
      const slice = texts.slice(i, i + concurrency);
      const batchPromises = slice.map((text, idx) =>
        this.generateEmbedding(text).then((vec) => {
          results[i + idx] = vec;
        })
      );
      await Promise.all(batchPromises);
    }

    return results;
  }

  /**
   * Health check to verify Ollama embedding model availability.
   */
  async checkHealth(): Promise<{ available: boolean; model: string; dimension?: number; error?: string }> {
    try {
      const testVec = await this.generateEmbedding('healthcheck ping');
      return {
        available: true,
        model: this.model,
        dimension: testVec.length,
      };
    } catch (err: unknown) {
      return {
        available: false,
        model: this.model,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

export const embeddingService = new EmbeddingService();
