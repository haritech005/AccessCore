export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  timestamp: string;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

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
