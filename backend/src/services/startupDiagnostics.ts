import { config } from '../config';
import { checkDatabaseHealth, query } from '../db';
import { logger } from './logger';

export interface ServiceDiagnostic {
  name: string;
  status: 'ok' | 'degraded' | 'failed';
  message: string;
  details?: Record<string, unknown>;
}

export interface StartupDiagnosticsReport {
  ok: boolean;
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  environment: string;
  services: {
    configuration: ServiceDiagnostic;
    database: ServiceDiagnostic;
    ollama: ServiceDiagnostic;
  };
  summary: string;
}

const REQUIRED_TABLES = [
  'documents',
  'document_versions',
  'document_chunks',
  'ingestion_jobs',
  'users',
  'groups',
  'tenants',
  'user_groups',
  'user_tenants',
  'document_permissions',
  'approved_summaries',
  'audit_logs',
  'conversations',
];

export async function runStartupDiagnostics(): Promise<StartupDiagnosticsReport> {
  const timestamp = new Date().toISOString();

  // 1. Configuration check
  let configDiag: ServiceDiagnostic;
  if (!config.DATABASE_URL) {
    configDiag = {
      name: 'Configuration',
      status: 'failed',
      message: 'DATABASE_URL is not set.',
    };
  } else if (!config.AUTH_SECRET || config.AUTH_SECRET.length < 16) {
    configDiag = {
      name: 'Configuration',
      status: 'degraded',
      message: 'AUTH_SECRET is weak or default.',
    };
  } else {
    configDiag = {
      name: 'Configuration',
      status: 'ok',
      message: 'Configuration validated successfully.',
      details: {
        port: config.PORT,
        node_env: config.NODE_ENV,
        ollama_url: config.OLLAMA_BASE_URL,
        frontend_url: config.FRONTEND_URL,
      },
    };
  }

  // 2. Database & pgvector check
  let dbDiag: ServiceDiagnostic;
  try {
    const dbHealth = await checkDatabaseHealth();
    if (dbHealth.status === 'connected') {
      const tablesRes = await query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
      );
      const existingTables = new Set(tablesRes.rows.map((r) => r.table_name));
      const missingTables = REQUIRED_TABLES.filter((t) => !existingTables.has(t));

      if (missingTables.length > 0) {
        dbDiag = {
          name: 'PostgreSQL Database',
          status: 'degraded',
          message: `Missing migrations or schema tables: ${missingTables.join(', ')}`,
          details: {
            pgvectorVersion: dbHealth.pgvectorVersion,
            missingTables,
          },
        };
      } else {
        dbDiag = {
          name: 'PostgreSQL Database',
          status: 'ok',
          message: `Connected with pgvector extension ${dbHealth.pgvectorVersion || 'active'}.`,
          details: {
            pgvectorVersion: dbHealth.pgvectorVersion,
            tablesVerified: REQUIRED_TABLES.length,
          },
        };
      }
    } else {
      dbDiag = {
        name: 'PostgreSQL Database',
        status: 'failed',
        message: dbHealth.message || 'Unable to connect to PostgreSQL.',
      };
    }
  } catch (err) {
    dbDiag = {
      name: 'PostgreSQL Database',
      status: 'failed',
      message: err instanceof Error ? err.message : 'Database health check failed.',
    };
  }

  // 3. Ollama service and models check
  let ollamaDiag: ServiceDiagnostic;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const [verRes, tagsRes] = await Promise.all([
      fetch(`${config.OLLAMA_BASE_URL}/api/version`, { signal: controller.signal }).catch(
        () => null
      ),
      fetch(`${config.OLLAMA_BASE_URL}/api/tags`, { signal: controller.signal }).catch(
        () => null
      ),
    ]);
    clearTimeout(timer);

    if (verRes && verRes.ok) {
      const verJson = (await verRes.json().catch(() => ({}))) as { version?: string };
      let modelList: string[] = [];
      if (tagsRes && tagsRes.ok) {
        const tagsJson = (await tagsRes.json().catch(() => ({}))) as {
          models?: Array<{ name: string }>;
        };
        modelList = tagsJson.models?.map((m) => m.name) || [];
      }

      const hasEmbedding =
        modelList.length === 0 ||
        modelList.some((m) => m.includes(config.OLLAMA_EMBEDDING_MODEL));
      const hasChat =
        modelList.length === 0 ||
        modelList.some((m) => m.includes(config.OLLAMA_CHAT_MODEL));

      ollamaDiag = {
        name: 'Ollama AI Engine',
        status: hasEmbedding && hasChat ? 'ok' : 'degraded',
        message: `Connected to Ollama v${verJson.version || 'unknown'} at ${config.OLLAMA_BASE_URL}.`,
        details: {
          version: verJson.version,
          endpoint: config.OLLAMA_BASE_URL,
          embeddingModel: config.OLLAMA_EMBEDDING_MODEL,
          chatModel: config.OLLAMA_CHAT_MODEL,
          modelsFound: modelList,
        },
      };
    } else {
      ollamaDiag = {
        name: 'Ollama AI Engine',
        status: 'degraded',
        message: `Ollama service unreachable at ${config.OLLAMA_BASE_URL}. Inference will fail if not started.`,
      };
    }
  } catch (err) {
    ollamaDiag = {
      name: 'Ollama AI Engine',
      status: 'degraded',
      message: `Failed to probe Ollama: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const overallStatus =
    configDiag.status === 'failed' || dbDiag.status === 'failed'
      ? 'unhealthy'
      : configDiag.status === 'degraded' ||
          dbDiag.status === 'degraded' ||
          ollamaDiag.status === 'degraded'
        ? 'degraded'
        : 'healthy';

  const report: StartupDiagnosticsReport = {
    ok: overallStatus !== 'unhealthy',
    status: overallStatus,
    timestamp,
    environment: config.NODE_ENV,
    services: {
      configuration: configDiag,
      database: dbDiag,
      ollama: ollamaDiag,
    },
    summary:
      overallStatus === 'healthy'
        ? 'All AccessCore services and database extensions are operational.'
        : `AccessCore is running in ${overallStatus} state: ${[
            configDiag.status !== 'ok' ? configDiag.message : '',
            dbDiag.status !== 'ok' ? dbDiag.message : '',
            ollamaDiag.status !== 'ok' ? ollamaDiag.message : '',
          ]
            .filter(Boolean)
            .join(' | ')}`,
  };

  if (overallStatus === 'unhealthy') {
    logger.error(`[Startup Diagnostics] ${report.summary}`, { report });
  } else if (overallStatus === 'degraded') {
    logger.warn(`[Startup Diagnostics] ${report.summary}`, { report });
  } else {
    logger.info(`[Startup Diagnostics] ${report.summary}`, { report });
  }

  return report;
}
