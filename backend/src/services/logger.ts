import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_KEY_PATTERN =
  /(password|hash|secret|token|authorization|cookie|apikey|api_key|raw_content|prompt|bearer)/i;

/**
 * Recursively redacts sensitive keys and values from logging metadata.
 */
export function sanitizeLogData(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || value === undefined) {
    return value ?? null;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => sanitizeLogData(v, depth + 1));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ? value.stack.split('\n').slice(0, 5).join('\n') : undefined,
    };
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitizeLogData(v, depth + 1);
      }
    }
    return out;
  }

  if (typeof value === 'string' && value.length > 500) {
    return `${value.slice(0, 497)}...`;
  }

  return value;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlation_id?: string | null;
  actor_id?: string | null;
  context?: string;
  metadata?: Record<string, unknown>;
  error?: {
    name?: string;
    message: string;
    code?: string;
    statusCode?: number;
    stack?: string;
  };
}

class Logger {
  private minLevel: LogLevel = (process.env.LOG_LEVEL?.toLowerCase() as LogLevel) || 'info';

  setLevel(level: LogLevel): void {
    if (LOG_LEVEL_PRIORITY[level] !== undefined) {
      this.minLevel = level;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= (LOG_LEVEL_PRIORITY[this.minLevel] ?? 20);
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>, err?: Error): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      correlation_id:
        (meta?.correlation_id as string) ||
        (meta?.correlationId as string) ||
        (meta?.requestId as string) ||
        null,
      actor_id: (meta?.actor_id as string) || (meta?.actorId as string) || null,
      context: (meta?.context as string) || undefined,
      metadata: meta ? (sanitizeLogData(meta) as Record<string, unknown>) : undefined,
    };

    if (err) {
      entry.error = {
        name: err.name,
        message: err.message,
        code: (err as any).code,
        statusCode: (err as any).statusCode,
        stack: err.stack,
      };
    }

    const json = JSON.stringify(entry);
    if (level === 'error') {
      console.error(json);
    } else if (level === 'warn') {
      console.warn(json);
    } else {
      console.log(json);
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.write('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.write('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>, err?: Error): void {
    this.write('error', message, meta, err);
  }
}

export const logger = new Logger();

// Express type augmentation for correlationId
declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

/**
 * Request correlation middleware:
 * - Reads incoming 'x-request-id' or 'x-correlation-id', or generates a secure random UUID.
 * - Attaches to req.correlationId.
 * - Sets 'X-Request-Id' and 'X-Correlation-Id' response headers.
 */
export function requestCorrelationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const incoming =
    (typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id'].trim()) ||
    (typeof req.headers['x-correlation-id'] === 'string' && req.headers['x-correlation-id'].trim()) ||
    crypto.randomUUID();

  req.correlationId = incoming;
  res.setHeader('X-Request-Id', incoming);
  res.setHeader('X-Correlation-Id', incoming);

  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const actorId = req.user?.id || null;
    const level: LogLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level](`${req.method} ${req.originalUrl || req.url} ${res.statusCode} [${durationMs}ms]`, {
      correlation_id: incoming,
      actor_id: actorId,
      status: res.statusCode,
      method: req.method,
      path: req.originalUrl || req.url,
      ip: req.ip || req.socket.remoteAddress || null,
      duration_ms: durationMs,
    });
  });

  next();
}
