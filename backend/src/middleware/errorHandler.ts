import { Request, Response, NextFunction } from 'express';
import { ApiErrorResponse } from '../types/api';

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
  const response: ApiErrorResponse = {
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `The requested endpoint '${req.method} ${req.originalUrl}' does not exist.`,
    },
    timestamp: new Date().toISOString(),
  };

  res.status(404).json(response);
}

export function errorHandler(
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const anyErr = err as { statusCode?: number; code?: string; details?: unknown };
  const statusCode = typeof anyErr.statusCode === 'number' ? anyErr.statusCode : 500;
  const code = typeof anyErr.code === 'string' ? anyErr.code : 'INTERNAL_SERVER_ERROR';
  const details = anyErr.details;

  const response: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message: err.message || 'An unexpected error occurred.',
      ...(details ? { details } : {}),
    },
    timestamp: new Date().toISOString(),
  };

  res.status(statusCode).json(response);
}
