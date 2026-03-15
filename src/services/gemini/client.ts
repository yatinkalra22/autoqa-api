import { GoogleGenerativeAI } from '@google/generative-ai'
import { config } from '../../config'

const genAI = new GoogleGenerativeAI(config.geminiApiKey)

export function getGeminiModel() {
  return genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  })
}

export function screenshotToPart(base64: string) {
  return {
    inlineData: {
      data: base64,
      mimeType: 'image/png' as const,
    },
  }
}

/**
 * Retry wrapper for Gemini API calls.
 * Retries on 503 (overloaded) and 429 (rate limit) with exponential backoff.
 */
export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      const msg = err?.message || ''
      const isRetryable = msg.includes('503') || msg.includes('429') || msg.includes('overloaded') || msg.includes('high demand')
      if (!isRetryable || attempt === maxRetries) throw err
      const delay = Math.min(1000 * Math.pow(2, attempt), 8000)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw new Error('Unreachable')
}
