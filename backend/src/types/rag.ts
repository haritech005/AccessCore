import { DocumentChunk, Sensitivity, DisclosurePolicy } from './document';
import { AuthenticatedUser } from './identity';
import { AudienceMode } from './policy';

export interface RetrievalQuery {
  query: string;
  top_k?: number;
  min_similarity?: number;
  tenant_scope?: string[];
  user_groups?: string[];
  user?: AuthenticatedUser;
}

export interface RetrievedChunk extends DocumentChunk {
  similarity: number;
  cosine_distance: number;
}

export interface FullTextChunk extends DocumentChunk {
  rank: number;
  headline?: string;
}

export interface FullTextQuery {
  query: string;
  top_k?: number;
  tenant_scope?: string[];
  user_groups?: string[];
  user?: AuthenticatedUser;
  audience?: AudienceMode | string;
}

export interface FullTextSearchResult {
  query: string;
  chunks: FullTextChunk[];
  total_retrieved: number;
  latency_ms: number;
  has_blocked_top_match?: boolean;
}

export interface HybridChunk extends RetrievedChunk {
  rrf_score: number;
  vector_rank?: number;
  fts_rank?: number;
  matched_by: 'vector' | 'fts' | 'both';
  headline?: string;
}

export interface HybridQueryOptions {
  query: string;
  top_k?: number;
  vector_candidates?: number;
  fts_candidates?: number;
  rrf_k?: number;
  min_similarity?: number;
  tenant_scope?: string[];
  user_groups?: string[];
  user?: AuthenticatedUser;
  audience?: AudienceMode | string;
}

export interface HybridRetrievalResult {
  query: string;
  chunks: HybridChunk[];
  total_retrieved: number;
  vector_count: number;
  fts_count: number;
  latency_ms: {
    vector: number;
    fts: number;
    fusion: number;
    total: number;
  };
  has_blocked_top_match?: boolean;
}

export type RetrievalStrategy = 'vector' | 'fts' | 'hybrid';

export interface ChatMessageTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface QueryCondensationOptions {
  question: string;
  chat_history?: ChatMessageTurn[];
  model?: string;
}

export interface QueryCondensationResult {
  original_query: string;
  condensed_query: string;
  was_condensed: boolean;
  latency_ms: number;
}

export interface Citation {
  document_id: string;
  title: string;
  chunk_index: number;
  snippet: string;
  source_location?: string;
  tenant_id: string;
  sensitivity: Sensitivity;
  disclosure_policy: DisclosurePolicy;
  is_summary?: boolean;
}

export interface RAGAnswerResponse {
  question: string;
  condensed_query?: string;
  was_condensed?: boolean;
  answer: string;
  citations: Citation[];
  insufficient_evidence: boolean;
  unauthorized_access: boolean;
  policy_violated?: boolean;
  audience?: AudienceMode;
  retrieved_chunks: {
    document_id: string;
    chunk_index: number;
    similarity: number;
  }[];
  latency_ms: {
    condensation?: number;
    retrieval: number;
    filtering?: number;
    generation: number;
    total: number;
  };
}
