import { DocumentChunk, Sensitivity, DisclosurePolicy } from './document';

export interface RetrievalQuery {
  query: string;
  top_k?: number;
  min_similarity?: number;
  tenant_scope?: string[];
  user_groups?: string[];
}

export interface RetrievedChunk extends DocumentChunk {
  similarity: number;
  cosine_distance: number;
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
}

export interface RAGAnswerResponse {
  question: string;
  answer: string;
  citations: Citation[];
  insufficient_evidence: boolean;
  unauthorized_access: boolean;
  retrieved_chunks: {
    document_id: string;
    chunk_index: number;
    similarity: number;
  }[];
  latency_ms: {
    retrieval: number;
    generation: number;
    total: number;
  };
}
