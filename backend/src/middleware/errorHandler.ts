import { Request, Response, NextFunction } from 'express';
import { ApiErrorResponse } from '../types/api';
import { logger } from '../services/logger';

export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_SERVER_ERROR', details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  const correlationId = req.correlationId || undefined;
  const response: ApiErrorResponse = {
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `The requested endpoint '${req.method} ${req.originalUrl}' does not exist.`,
    },
    ...(correlationId ? { correlation_id: correlationId } : {}),
    timestamp: new Date().toISOString(),
  };

  res.status(404).json(response);
}

export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const anyErr = err as { statusCode?: number; code?: string; details?: unknown };
  const statusCode = typeof anyErr.statusCode === 'number' ? anyErr.statusCode : 500;
  const code = typeof anyErr.code === 'string' ? anyErr.code : 'INTERNAL_SERVER_ERROR';
  const correlationId = req.correlationId || undefined;
  const is500 = statusCode >= 500;

  // Log internal errors structured with correlation ID and stack trace
  logger.error(
    `Request error on ${req.method} ${req.originalUrl || req.url}: ${err.message}`,
    {
      correlation_id: correlationId,
      actor_id: req.user?.id || null,
      status_code: statusCode,
      error_code: code,
      path: req.originalUrl || req.url,
      method: req.method,
    },
    err
  );

  // In production, mask raw unexpected internal server errors to prevent leaking database/server details
  const isDevOrTest = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
  const clientMessage =
    is500 && !isDevOrTest && code === 'INTERNAL_SERVER_ERROR'
      ? `An internal error occurred. Please contact support referencing correlation ID: ${correlationId || 'N/A'}`
      : err.message || 'An unexpected error occurred.';

  const response: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message: clientMessage,
      ...(anyErr.details ? { details: anyErr.details } : {}),
    },
    ...(correlationId ? { correlation_id: correlationId } : {}),
    timestamp: new Date().toISOString(),
  };

  res.status(statusCode).json(response);
}
