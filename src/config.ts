import { z } from 'zod'
import 'dotenv/config'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  GEMINI_API_KEY: z.string(),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  STORAGE_TYPE: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_PATH: z.string().default('./storage/reports'),
  S3_BUCKET: z.string().optional(),
  MAX_CONCURRENT_BROWSERS: z.coerce.number().default(3),
})

const parsed = schema.parse(process.env)

export const config = {
  isDev: parsed.NODE_ENV === 'development',
  port: parsed.PORT,
  databaseUrl: parsed.DATABASE_URL,
  redisUrl: parsed.REDIS_URL,
  geminiApiKey: parsed.GEMINI_API_KEY,
  corsOrigins: parsed.CORS_ORIGINS.split(','),
  storageType: parsed.STORAGE_TYPE,
  localStoragePath: parsed.LOCAL_STORAGE_PATH,
  s3Bucket: parsed.S3_BUCKET,
  maxConcurrentBrowsers: parsed.MAX_CONCURRENT_BROWSERS,
}
