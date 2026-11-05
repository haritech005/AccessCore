import { retrievalService } from './retrievalService';
import { fullTextSearchService } from './fullTextSearchService';
import { authorizationService } from './authorizationService';
import {
  HybridQueryOptions,
  HybridRetrievalResult,
  HybridChunk,
  RetrievedChunk,
  FullTextChunk,
} from '../types/rag';
import { AppError } from '../middleware/errorHandler';

export class HybridRetrievalService {
  /**
   * Default RRF smoothing constant (k=60 is standard in information retrieval literature).
   */
  public static readonly DEFAULT_RRF_K = 60;

  /**
   * Default candidate pool over-fetching limits.
   */
  public static readonly DEFAULT_CANDIDATE_POOL = 20;

  /**
   * Executes hybrid retrieval by executing dense vector search (pgvector) and
   * sparse lexical search (PostgreSQL tsvector) in parallel, then merging their
   * candidate pools using Reciprocal Rank Fusion (RRF).
   *
   * Features:
   * 1. Parallel execution for minimal latency overhead.
   * 2. Reciprocal Rank Fusion (RRF) to combine disparate ranking scales without normalization bias.
   * 3. Lossless chunk deduplication preserving citation metadata and match provenance.
   * 4. Multi-document candidate diversity so single documents do not saturate top-K.
   * 5. Strict preservation of Phase 2/3 tenant isolation, group clearance, and sensitivity.
   */
  async retrieveHybridChunks(options: HybridQueryOptions): Promise<HybridRetrievalResult> {
    const totalStart = Date.now();
    const {
      query: userQuery,
      top_k = 4,
      vector_candidates = HybridRetrievalService.DEFAULT_CANDIDATE_POOL,
      fts_candidates = HybridRetrievalService.DEFAULT_CANDIDATE_POOL,
      rrf_k = HybridRetrievalService.DEFAULT_RRF_K,
      min_similarity = 0.35,
      tenant_scope,
      user_groups,
      user,
      audience,
    } = options;

    if (!userQuery || typeof userQuery !== 'string' || userQuery.trim().length === 0) {
      throw new AppError('Hybrid retrieval query must be a non-empty string.', 400, 'INVALID_QUERY');
    }

    const cleanQuery = userQuery.trim();
    if (cleanQuery.length > 2000) {
      throw new AppError('Hybrid retrieval query exceeds maximum allowed length of 2000 characters.', 400, 'QUERY_TOO_LONG');
    }

    // 0. Account Status Guard
    if (user && user.status !== 'active') {
      return {
        query: cleanQuery,
        chunks: [],
        total_retrieved: 0,
        vector_count: 0,
        fts_count: 0,
        latency_ms: { vector: 0, fts: 0, fusion: 0, total: Date.now() - totalStart },
      };
    }

    const effectiveTopK = Math.min(Math.max(1, top_k), 50);
    const effectiveVectorPool = Math.min(Math.max(effectiveTopK, vector_candidates), 50);
    const effectiveFtsPool = Math.min(Math.max(effectiveTopK, fts_candidates), 50);

    // 1. Parallel Execution: Run Dense Vector Search and Sparse Full-Text Search concurrently
    const [vectorResult, ftsResult] = await Promise.all([
      retrievalService.retrieveChunks({
        query: cleanQuery,
        top_k: effectiveVectorPool,
        min_similarity,
        tenant_scope,
        user_groups,
        user,
      }),
      fullTextSearchService.searchChunks({
        query: cleanQuery,
        top_k: effectiveFtsPool,
        tenant_scope,
        user_groups,
        user,
        audience,
      }),
    ]);

    // Check if either engine identified an unauthorized top match
    const hasBlockedTopMatch = Boolean(
      vectorResult.has_blocked_top_match || ftsResult.has_blocked_top_match
    );

    // If blocked by authorization pre-check, return empty immediately
    if (hasBlockedTopMatch && vectorResult.chunks.length === 0 && ftsResult.chunks.length === 0) {
      return {
        query: cleanQuery,
        chunks: [],
        total_retrieved: 0,
        vector_count: 0,
        fts_count: 0,
        latency_ms: {
          vector: vectorResult.latency_ms,
          fts: ftsResult.latency_ms,
          fusion: 0,
          total: Date.now() - totalStart,
        },
        has_blocked_top_match: true,
      };
    }

    // 2. Reciprocal Rank Fusion (RRF) & Candidate Deduplication
    const fusionStart = Date.now();
    const fusedChunks = this.fuseCandidates(
      vectorResult.chunks,
      ftsResult.chunks,
      rrf_k,
      effectiveTopK
    );
    const fusionLatency = Date.now() - fusionStart;

    // 3. Defense-in-depth: Final Authoritative Security Verification
    let verifiedChunks = fusedChunks;
    if (user) {
      verifiedChunks = fusedChunks.filter((chunk) => {
        return authorizationService.can(user, 'search:retrieval', {
          type: 'chunk',
          document_id: chunk.document_id,
          tenant_id: chunk.metadata.tenant_id,
          allowed_groups: chunk.metadata.allowed_groups,
          sensitivity: chunk.metadata.sensitivity,
          is_active: chunk.is_active,
        }).allowed;
      });
    }

    return {
      query: cleanQuery,
      chunks: verifiedChunks,
      total_retrieved: verifiedChunks.length,
      vector_count: vectorResult.chunks.length,
      fts_count: ftsResult.chunks.length,
      latency_ms: {
        vector: vectorResult.latency_ms,
        fts: ftsResult.latency_ms,
        fusion: fusionLatency,
        total: Date.now() - totalStart,
      },
      has_blocked_top_match: hasBlockedTopMatch,
    };
  }

  /**
   * Combines vector search candidates and full-text search candidates using
   * Reciprocal Rank Fusion (RRF) with deduplication and document-diversity protection.
   *
   * Formula:
   *   RRF_score(chunk) = 1 / (k + rank_vector) + 1 / (k + rank_fts)
   *
   * Where rank is 1-indexed (rank=1 for highest match, rank=2 for second, etc.).
   */
  public fuseCandidates(
    vectorChunks: RetrievedChunk[],
    ftsChunks: FullTextChunk[],
    rrfK: number = HybridRetrievalService.DEFAULT_RRF_K,
    topK: number = 4
  ): HybridChunk[] {
    const candidateMap = new Map<string, {
      chunk: RetrievedChunk | FullTextChunk;
      vectorRank?: number;
      ftsRank?: number;
      similarity: number;
      cosineDistance: number;
      headline?: string;
    }>();

    // 1. Process Vector Candidates
    vectorChunks.forEach((vc, idx) => {
      const rank = idx + 1; // 1-indexed
      const key = vc.id || `${vc.document_id}_${vc.chunk_index}`;
      candidateMap.set(key, {
        chunk: vc,
        vectorRank: rank,
        similarity: vc.similarity,
        cosineDistance: vc.cosine_distance,
      });
    });

    // 2. Process Full-Text Search Candidates (Merge or Add)
    ftsChunks.forEach((fc, idx) => {
      const rank = idx + 1; // 1-indexed
      const key = fc.id || `${fc.document_id}_${fc.chunk_index}`;
      const existing = candidateMap.get(key);

      if (existing) {
        existing.ftsRank = rank;
        if (fc.headline) {
          existing.headline = fc.headline;
        }
      } else {
        candidateMap.set(key, {
          chunk: fc,
          ftsRank: rank,
          similarity: 0.5, // Default baseline similarity for pure text matches
          cosineDistance: 0.5,
          headline: fc.headline,
        });
      }
    });

    // 3. Calculate RRF Score for Each Unique Candidate
    const fusedList: HybridChunk[] = [];

    candidateMap.forEach((entry, chunkId) => {
      let rrfScore = 0;
      let matchedBy: 'vector' | 'fts' | 'both' = 'vector';

      if (entry.vectorRank && entry.ftsRank) {
        rrfScore = (1 / (rrfK + entry.vectorRank)) + (1 / (rrfK + entry.ftsRank));
        matchedBy = 'both';
      } else if (entry.vectorRank) {
        rrfScore = 1 / (rrfK + entry.vectorRank);
        matchedBy = 'vector';
      } else if (entry.ftsRank) {
        rrfScore = 1 / (rrfK + entry.ftsRank);
        matchedBy = 'fts';
      }

      const baseChunk = entry.chunk;

      fusedList.push({
        id: chunkId,
        document_id: baseChunk.document_id,
        version_id: baseChunk.version_id,
        chunk_index: baseChunk.chunk_index,
        content: baseChunk.content,
        metadata: { ...baseChunk.metadata },
        is_active: baseChunk.is_active,
        similarity: entry.similarity,
        cosine_distance: entry.cosineDistance,
        rrf_score: rrfScore,
        vector_rank: entry.vectorRank,
        fts_rank: entry.ftsRank,
        matched_by: matchedBy,
        headline: entry.headline,
      });
    });

    // 4. Sort Candidates by RRF Score Descending
    fusedList.sort((a, b) => b.rrf_score - a.rrf_score);

    // 5. Document Diversity Guard: Prevent a single document from dominating top-K slots
    // when multiple competitive documents exist.
    // Candidates meeting the relative relevance threshold (>= 70% of top score) are capped
    // at MAX_CHUNKS_PER_DOC to ensure diverse representation for multi-document queries (e.g. EVAL-005).
    // Lower-scoring candidates or surplus chunks from dominant documents are held in deferred
    // and used to fill remaining slots in score order.
    const selected: HybridChunk[] = [];
    const docCounts = new Map<string, number>();
    const deferred: HybridChunk[] = [];

    const topScore = fusedList[0]?.rrf_score || 0;
    const relativeThreshold = topScore * 0.70;
    const MAX_CHUNKS_PER_DOC = Math.max(2, Math.floor(topK / 2));

    for (const item of fusedList) {
      const isCompetitive = (item.rrf_score || 0) >= relativeThreshold;
      const count = docCounts.get(item.document_id) || 0;

      if (isCompetitive && count < MAX_CHUNKS_PER_DOC) {
        selected.push(item);
        docCounts.set(item.document_id, count + 1);
        if (selected.length === topK) break;
      } else {
        deferred.push(item);
      }
    }

    // If slots remain unfilled, fill them from deferred chunks in score order
    while (selected.length < topK && deferred.length > 0) {
      selected.push(deferred.shift()!);
    }

    return selected;
  }
}

export const hybridRetrievalService = new HybridRetrievalService();
