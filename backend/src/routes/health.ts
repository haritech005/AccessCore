import { Router, Request, Response } from 'express';
import { config } from '../config';
import { checkDatabaseHealth } from '../db';
import { ApiSuccessResponse, HealthCheckData } from '../types/api';

const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
  let ollamaStatus: 'connected' | 'disconnected' | 'unreachable' = 'disconnected';
  let ollamaMessage: string | undefined;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const ollamaRes = await fetch(`${config.OLLAMA_BASE_URL}/api/version`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (ollamaRes.ok) {
      ollamaStatus = 'connected';
    } else {
      ollamaStatus = 'disconnected';
      ollamaMessage = `Ollama returned status ${ollamaRes.status}`;
    }
  } catch (err) {
    ollamaStatus = 'unreachable';
    ollamaMessage = err instanceof Error ? err.message : 'Failed to reach Ollama endpoint';
  }

  const dbHealth = await checkDatabaseHealth();

  const isHealthy = ollamaStatus === 'connected' && dbHealth.status === 'connected';

  const healthData: HealthCheckData = {
    status: isHealthy ? 'healthy' : 'degraded',
    uptime: process.uptime(),
    version: '1.0.0',
    environment: config.NODE_ENV,
    services: {
      database: {
        status: dbHealth.status,
        ...(dbHealth.message ? { message: dbHealth.message } : {}),
        ...(dbHealth.pgvectorVersion ? { pgvectorVersion: dbHealth.pgvectorVersion } : {}),
        ...(dbHealth.tablesReady !== undefined ? { tablesReady: dbHealth.tablesReady } : {}),
      },
      ollama: {
        status: ollamaStatus,
        endpoint: config.OLLAMA_BASE_URL,
        chatModel: config.OLLAMA_CHAT_MODEL,
        embeddingModel: config.OLLAMA_EMBEDDING_MODEL,
        ...(ollamaMessage ? { message: ollamaMessage } : {}),
      },
    },
  };

  const response: ApiSuccessResponse<HealthCheckData> = {
    success: true,
    data: healthData,
    timestamp: new Date().toISOString(),
  };

  res.status(isHealthy ? 200 : 200).json(response);
});

export default router;
