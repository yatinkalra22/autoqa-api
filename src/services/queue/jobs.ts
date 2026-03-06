import { Queue } from 'bullmq'
import { redis } from './redis'

export interface TestJobData {
  runId: string
  targetUrl: string
  prompt: string
  maxSteps: number
}

export const runQueue = new Queue<TestJobData>('test-runs', {
  connection: redis,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 100,
    removeOnFail: 100,
  },
})
