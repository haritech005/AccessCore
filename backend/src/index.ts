import { createApp } from './app';
import { config } from './config';
import { logger } from './services/logger';
import { runStartupDiagnostics } from './services/startupDiagnostics';

const app = createApp();

const server = app.listen(config.PORT, async () => {
  logger.info(`AccessCore Backend server running on http://localhost:${config.PORT}`, {
    port: config.PORT,
    environment: config.NODE_ENV,
  });
  await runStartupDiagnostics();
});

const gracefulShutdown = (signal: string) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`, { signal });
  server.close(() => {
    logger.info('HTTP server closed.', { signal });
    process.exit(0);
  });
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

export default app;
