export interface HealthCheckData {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  version: string;
  environment: string;
  services: {
    database: {
      status: 'connected' | 'disconnected' | 'unconfigured';
      message?: string;
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

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  timestamp: string;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

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
        'Accept': 'application/json',
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
