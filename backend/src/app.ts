import express, { Express } from 'express';
import cors from 'cors';
import { config } from './config';
import healthRouter from './routes/health';
import authRouter from './routes/auth';
import documentsRouter from './routes/documents';
import retrievalRouter from './routes/retrieval';
import ragRouter from './routes/rag';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

export function createApp(): Express {
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
  app.use('/api', authRouter);
  app.use('/api', documentsRouter);
  app.use('/api', retrievalRouter);
  app.use('/api', ragRouter);

  // 404 and Error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

