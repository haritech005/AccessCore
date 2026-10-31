export interface HealthCheckData {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  version: string;
  environment: string;
  services: {
    database: {
      status: 'connected' | 'disconnected' | 'unconfigured';
      message?: string;
      pgvectorVersion?: string;
      tablesReady?: boolean;
    };
    ollama: {
      status: 'connected' | 'disconnected' | 'unreachable';
      endpoint: string;
      chatModel: string;
      embeddingModel: string;
      message?: string;
    };
  };
}

export type Sensitivity = 'public' | 'internal' | 'confidential' | 'restricted';
export type DisclosurePolicy = 'customer_facing' | 'internal_only' | 'restricted_roles';

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
  unauthorized_access?: boolean;
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

export interface DocumentRecord {
  id: string;
  document_id: string;
  title: string;
  filename: string;
  format: string;
  current_version: number;
  status: string;
  error_message: string | null;
  metadata: {
    document_id?: string;
    title?: string;
    format?: string;
    tenant_id?: string;
    sensitivity?: Sensitivity;
    disclosure_policy?: DisclosurePolicy;
    authorized_groups?: string[];
    product?: string;
    version?: string;
    [key: string]: unknown;
  };
  created_at: string;
  updated_at: string;
}

export interface IngestDocumentOutput {
  job_id: string;
  document_id: string;
  doc_uuid: string;
  version: number;
  version_uuid: string;
  status: 'completed' | 'failed' | 'processing';
  content_hash: string;
  chunks_count: number;
  embeddings_reused_count: number;
  is_new_version: boolean;
  is_reused: boolean;
  message: string;
  completed_at: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  total?: number;
  timestamp?: string;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

import { getStoredToken } from './auth';

function getAuthHeaders(token?: string): Record<string, string> {
  const effectiveToken = token || getStoredToken();
  const headers: Record<string, string> = {};
  if (effectiveToken) {
    headers['Authorization'] = `Bearer ${effectiveToken}`;
  }
  return headers;
}

/**
 * Health check endpoint: verifies backend, database, and Ollama connectivity.
 */
export async function fetchHealthStatus(): Promise<{
  data: HealthCheckData | null;
  error: string | null;
  responseTimeMs: number;
}> {
  const startTime = Date.now();
  try {
    const res = await fetch(`${API_BASE_URL}/health`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    const responseTimeMs = Date.now() - startTime;

    if (!res.ok) {
      return {
        data: null,
        error: `Backend responded with HTTP ${res.status}: ${res.statusText}`,
        responseTimeMs,
      };
    }

    const json: ApiResponse<HealthCheckData> = await res.json();
    if (!json.success || !json.data) {
      return {
        data: null,
        error: json.error?.message || 'Failed to parse health check data',
        responseTimeMs,
      };
    }

    return {
      data: json.data,
      error: null,
      responseTimeMs,
    };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Unable to connect to backend service',
      responseTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Query the enterprise RAG chatbot with evidence retrieval and grounded citation generation.
 */
export async function askQuestion(
  question: string,
  options?: {
    top_k?: number;
    min_similarity?: number;
    tenant_scope?: string[];
    user_groups?: string[];
    token?: string;
  }
): Promise<{
  data: RAGAnswerResponse | null;
  error: string | null;
}> {
  try {
    const authHeaders = getAuthHeaders(options?.token);

    const res = await fetch(`${API_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...authHeaders,
      },
      credentials: 'include',
      body: JSON.stringify({
        question,
        top_k: options?.top_k ?? 5,
        min_similarity: options?.min_similarity ?? 0.35,
        tenant_scope: options?.tenant_scope,
        user_groups: options?.user_groups,
      }),
      cache: 'no-store',
    });

    if (!res.ok) {
      let errorMsg = `Server error (HTTP ${res.status})`;
      try {
        const errorJson = await res.json();
        if (errorJson.error?.message) {
          errorMsg = errorJson.error.message;
        }
      } catch {
        // Fallback to generic message
      }
      return { data: null, error: errorMsg };
    }

    const json: ApiResponse<RAGAnswerResponse> = await res.json();
    if (!json.success || !json.data) {
      return {
        data: null,
        error: json.error?.message || 'Failed to retrieve answer from system.',
      };
    }

    return { data: json.data, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Failed to communicate with knowledge assistant.',
    };
  }
}

/**
 * Fetch list of all indexed documents in the knowledge base.
 */
export async function fetchDocuments(params?: {
  tenant_id?: string;
  sensitivity?: string;
  token?: string;
}): Promise<{
  data: DocumentRecord[] | null;
  error: string | null;
}> {
  try {
    const url = new URL(`${API_BASE_URL}/api/documents`);
    if (params?.tenant_id) url.searchParams.set('tenant_id', params.tenant_id);
    if (params?.sensitivity) url.searchParams.set('sensitivity', params.sensitivity);

    const authHeaders = getAuthHeaders(params?.token);

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...authHeaders,
      },
      credentials: 'include',
      cache: 'no-store',
    });

    if (!res.ok) {
      return { data: null, error: `Failed to fetch documents: HTTP ${res.status}` };
    }

    const json: ApiResponse<DocumentRecord[]> = await res.json();
    return { data: json.data || [], error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Failed to fetch indexed documents.',
    };
  }
}

/**
 * Helper to encode a browser File into a base64 string.
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        // Data URL format: "data:application/pdf;base64,JVBERi0xLj..."
        // Extract only the base64 content after the comma
        const base64Index = reader.result.indexOf(',');
        const base64 = base64Index !== -1 ? reader.result.slice(base64Index + 1) : reader.result;
        resolve(base64);
      } else {
        reject(new Error('Failed to read file as data string.'));
      }
    };
    reader.onerror = (error) => reject(error);
  });
}

/**
 * Ingest / upload a document (PDF, Markdown, JSON) into AccessCore.
 */
export async function uploadDocument(
  file: File,
  overrideMetadata?: Record<string, unknown>,
  token?: string
): Promise<{
  data: IngestDocumentOutput | null;
  error: string | null;
}> {
  try {
    const base64Content = await fileToBase64(file);
    const authHeaders = getAuthHeaders(token);

    const res = await fetch(`${API_BASE_URL}/api/documents/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...authHeaders,
      },
      credentials: 'include',
      body: JSON.stringify({
        filename: file.name,
        content: base64Content,
        is_base64: true,
        override_metadata: overrideMetadata,
      }),
      cache: 'no-store',
    });

    const json: ApiResponse<IngestDocumentOutput> = await res.json();

    if (!res.ok || !json.success) {
      return {
        data: null,
        error: json.error?.message || `Ingestion failed with HTTP ${res.status}`,
      };
    }

    return { data: json.data || null, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Document upload failed.',
    };
  }
}
