import { EventEmitter } from 'events'

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

interface Job<T> {
  id: string
  data: T
}

type JobHandler<T> = (job: Job<T>) => Promise<void>

/**
 * Simple in-memory job queue that replaces BullMQ+Redis.
 * Supports concurrency limiting — no external dependencies needed.
 */
class InMemoryQueue<T> extends EventEmitter {
  private queue: Job<T>[] = []
  private running = 0
  private concurrency: number
  private handler: JobHandler<T> | null = null
  private jobCounter = 0

  constructor(private name: string, opts: { concurrency?: number } = {}) {
    super()
    this.concurrency = opts.concurrency ?? 3
  }

  setHandler(fn: JobHandler<T>) {
    this.handler = fn
  }

  async add(_jobName: string, data: T): Promise<Job<T>> {
    const job: Job<T> = {
      id: `${this.name}-${++this.jobCounter}`,
      data,
    }
    this.queue.push(job)
    this.process()
    return job
  }

  private async process() {
    while (this.queue.length > 0 && this.running < this.concurrency) {
      const job = this.queue.shift()
      if (!job || !this.handler) continue
      this.running++
      this.handler(job)
        .catch((err) => {
          console.error(`Job ${job.id} failed:`, err)
          this.emit('failed', job, err)
        })
        .finally(() => {
          this.running--
          this.process()
        })
    }
  }
}

export const runQueue = new InMemoryQueue<TestJobData>('test-runs', { concurrency: 3 })
