import { createApp } from './app';
import { config } from './config';

const app = createApp();

const server = app.listen(config.PORT, () => {
  console.log(`[AccessCore Backend] Server running on http://localhost:${config.PORT}`);
  console.log(`[AccessCore Backend] Environment: ${config.NODE_ENV}`);
  console.log(`[AccessCore Backend] Health check: http://localhost:${config.PORT}/health`);
});

const gracefulShutdown = (signal: string) => {
  console.log(`[AccessCore Backend] Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    console.log('[AccessCore Backend] HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

export default app;
