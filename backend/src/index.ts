import express from 'express';
import cors from 'cors';
import { config } from './config';
import healthRouter from './routes/health';
import documentsRouter from './routes/documents';
import retrievalRouter from './routes/retrieval';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

const app = express();

app.use(
  cors({
    origin: [config.FRONTEND_URL, 'http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
  })
);

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// API endpoints
app.use(healthRouter);
app.use('/api', healthRouter);
app.use('/api', documentsRouter);
app.use('/api', retrievalRouter);

// 404 and Error handling
app.use(notFoundHandler);
app.use(errorHandler);

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
