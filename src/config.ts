import { z } from 'zod'
import 'dotenv/config'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().optional(), // No longer required — in-memory queue used
  GEMINI_API_KEY: z.string(),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:5173'),
  STORAGE_TYPE: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_PATH: z.string().default('./storage/reports'),
  S3_BUCKET: z.string().optional(),
  MAX_CONCURRENT_BROWSERS: z.coerce.number().default(3),
  // Firebase Admin — at least one of these should be set
  FIREBASE_SERVICE_ACCOUNT_KEY: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
})

const parsed = schema.parse(process.env)

export const config = {
  isDev: parsed.NODE_ENV === 'development',
  port: parsed.PORT,
  databaseUrl: parsed.DATABASE_URL,
  geminiApiKey: parsed.GEMINI_API_KEY,
  corsOrigins: parsed.CORS_ORIGINS.split(','),
  storageType: parsed.STORAGE_TYPE,
  localStoragePath: parsed.LOCAL_STORAGE_PATH,
  s3Bucket: parsed.S3_BUCKET,
  maxConcurrentBrowsers: parsed.MAX_CONCURRENT_BROWSERS,
}
