import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('4000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().optional(),
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
  OLLAMA_CHAT_MODEL: z.string().default('gemma3:4b'),
  OLLAMA_EMBEDDING_MODEL: z.string().default('nomic-embed-text'),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  AUTH_SECRET: z.string().default('accesscore-dev-auth-secret-key-32-chars-minimum!'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
