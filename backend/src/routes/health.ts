import { Router, Request, Response } from 'express';
import { runStartupDiagnostics } from '../services/startupDiagnostics';
import { ApiSuccessResponse } from '../types/api';

const router = Router();

router.get('/health', async (req: Request, res: Response) => {
  const diagnostics = await runStartupDiagnostics();

  const response: ApiSuccessResponse<any> = {
    success: true,
    data: {
      status: diagnostics.status,
      uptime: process.uptime(),
      version: '1.0.0',
      environment: diagnostics.environment,
      services: {
        database: {
          status: diagnostics.services.database.status === 'ok' ? 'connected' : 'disconnected',
          message: diagnostics.services.database.message,
          ...(diagnostics.services.database.details || {}),
        },
        ollama: {
          status: diagnostics.services.ollama.status === 'ok' ? 'connected' : 'unreachable',
          message: diagnostics.services.ollama.message,
          ...(diagnostics.services.ollama.details || {}),
        },
        configuration: {
          status: diagnostics.services.configuration.status,
          message: diagnostics.services.configuration.message,
        },
      },
      summary: diagnostics.summary,
    },
    correlation_id: req.correlationId || undefined,
    timestamp: new Date().toISOString(),
  };

  res.status(200).json(response);
});

export default router;
