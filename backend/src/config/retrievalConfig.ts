import { z } from 'zod';

/**
 * Zod schema defining the valid operational boundaries for retrieval parameters.
 * Prevents denial-of-service, excessive memory consumption, or database saturation.
 */
export const retrievalConfigSchema = z.object({
  top_k: z.number().int().min(1).max(20).default(4),
  vector_candidates: z.number().int().min(5).max(100).default(20),
  fts_candidates: z.number().int().min(5).max(100).default(20),
  min_similarity: z.number().min(0.10).max(0.95).default(0.35),
  rrf_k: z.number().int().min(1).max(200).default(60),
  diversity_threshold: z.number().min(0.30).max(0.95).default(0.70),
  max_chunks_per_doc: z.number().int().min(1).max(10).default(2),
});

export type RetrievalConfig = z.infer<typeof retrievalConfigSchema>;

/**
 * Standard retrieval presets tailored for different enterprise operational profiles.
 */
export const RETRIEVAL_PRESETS = {
  /**
   * Balanced (Default):
   * Optimized for high precision, solid cross-document recall, and low latency (<70ms retrieval).
   */
  balanced: {
    top_k: 4,
    vector_candidates: 20,
    fts_candidates: 20,
    min_similarity: 0.35,
    rrf_k: 60,
    diversity_threshold: 0.70,
    max_chunks_per_doc: 2,
  },
  /**
   * High Recall:
   * Expands candidate pools and top_k for deep investigations and multi-document synthesis queries.
   */
  high_recall: {
    top_k: 6,
    vector_candidates: 35,
    fts_candidates: 35,
    min_similarity: 0.30,
    rrf_k: 60,
    diversity_threshold: 0.65,
    max_chunks_per_doc: 3,
  },
  /**
   * Low Latency:
   * Narrows candidate pools for lightweight embedded devices, mobile users, or SLA-critical endpoints.
   */
  low_latency: {
    top_k: 3,
    vector_candidates: 10,
    fts_candidates: 10,
    min_similarity: 0.40,
    rrf_k: 40,
    diversity_threshold: 0.75,
    max_chunks_per_doc: 2,
  },
} as const;

export type RetrievalPresetName = keyof typeof RETRIEVAL_PRESETS;

/**
 * Default production retrieval configuration.
 */
export const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  ...RETRIEVAL_PRESETS.balanced,
};

/**
 * Sanitizes and validates user- or request-supplied retrieval options against safe operational bounds.
 * Falls back to default values for undefined or invalid inputs.
 */
export function sanitizeRetrievalOptions(options?: Partial<RetrievalConfig>): RetrievalConfig {
  if (!options) {
    return { ...DEFAULT_RETRIEVAL_CONFIG };
  }

  const result = retrievalConfigSchema.safeParse({
    top_k: options.top_k ?? DEFAULT_RETRIEVAL_CONFIG.top_k,
    vector_candidates: options.vector_candidates ?? DEFAULT_RETRIEVAL_CONFIG.vector_candidates,
    fts_candidates: options.fts_candidates ?? DEFAULT_RETRIEVAL_CONFIG.fts_candidates,
    min_similarity: options.min_similarity ?? DEFAULT_RETRIEVAL_CONFIG.min_similarity,
    rrf_k: options.rrf_k ?? DEFAULT_RETRIEVAL_CONFIG.rrf_k,
    diversity_threshold: options.diversity_threshold ?? DEFAULT_RETRIEVAL_CONFIG.diversity_threshold,
    max_chunks_per_doc: options.max_chunks_per_doc ?? DEFAULT_RETRIEVAL_CONFIG.max_chunks_per_doc,
  });

  if (!result.success) {
    console.warn(
      `[RetrievalConfig] Invalid parameters provided (${result.error.issues.map((i) => i.message).join(', ')}). Falling back to safe production defaults.`
    );
    return { ...DEFAULT_RETRIEVAL_CONFIG };
  }

  // Ensure vector_candidates and fts_candidates are at least equal to top_k
  const sanitized = result.data;
  if (sanitized.vector_candidates < sanitized.top_k) {
    sanitized.vector_candidates = sanitized.top_k;
  }
  if (sanitized.fts_candidates < sanitized.top_k) {
    sanitized.fts_candidates = sanitized.top_k;
  }

  return sanitized;
}

