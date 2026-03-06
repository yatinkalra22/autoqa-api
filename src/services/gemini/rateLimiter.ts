class GeminiRateLimiter {
  private queue: Array<() => void> = []
  private tokens = 15
  private refillInterval: ReturnType<typeof setInterval>

  constructor() {
    this.refillInterval = setInterval(() => {
      this.tokens = 15
      this.processQueue()
    }, 60000)
  }

  async acquire(): Promise<void> {
    if (this.tokens > 0) {
      this.tokens--
      return
    }
    return new Promise((resolve) => {
      this.queue.push(resolve)
    })
  }

  private processQueue() {
    while (this.queue.length > 0 && this.tokens > 0) {
      this.tokens--
      this.queue.shift()!()
    }
  }

  destroy() {
    clearInterval(this.refillInterval)
  }
}

export const geminiLimiter = new GeminiRateLimiter()
