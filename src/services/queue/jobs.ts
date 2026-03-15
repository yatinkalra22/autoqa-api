import { Queue } from 'bullmq'
import { redis } from './redis'

export interface AuthConfig {
  loginUrl: string
  credentials: Array<{ field: string; value: string }>
  submitButton?: string
}

export interface TestJobData {
  runId: string
  targetUrl: string
  prompt: string
  maxSteps: number
  auth?: AuthConfig
}

export const runQueue = new Queue<TestJobData>('test-runs', {
  connection: redis,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 100,
    removeOnFail: 100,
  },
})
