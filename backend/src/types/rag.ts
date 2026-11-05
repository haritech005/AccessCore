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
    retrieval: number;
    filtering?: number;
    generation: number;
    total: number;
  };
}
