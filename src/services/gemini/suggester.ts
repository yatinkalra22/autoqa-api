import { getGeminiModel, screenshotToPart, withRetry } from './client'
import { geminiLimiter } from './rateLimiter'
import { browserPool, captureScreenshot } from '../playwright/engine'

export async function suggestTests(targetUrl: string): Promise<string[]> {
  const { page, release } = await browserPool.acquire()
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    const screenshot = await captureScreenshot(page)

    await geminiLimiter.acquire()
    const model = getGeminiModel()
    const result = await withRetry(() => model.generateContent([
      {
        text: `You are a QA expert. Look at this web page screenshot and suggest 5-8 practical test cases.

Return a JSON array of strings. Each string is a test instruction in plain English, suitable for an automated testing agent.
Focus on: user flows, form validation, navigation, and key business actions visible on the page.

Example format: ["Test the login flow with valid credentials", "Verify error message for empty form submission"]`,
      },
      screenshotToPart(screenshot),
    ]))

    return JSON.parse(result.response.text()) as string[]
  } finally {
    await release()
  }
}
