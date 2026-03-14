import { getGeminiModel, screenshotToPart } from './client'

export interface BlockerAnalysis {
  hasBlocker: boolean
  blockerType: 'oauth' | 'captcha' | '2fa' | 'paywall' | 'geo_block' | 'rate_limit' | 'none'
  description: string
  userAdvice: string
}

/**
 * Analyzes the current page state after repeated failures to identify
 * known blockers that prevent test automation from proceeding.
 */
export async function detectBlocker(
  screenshotBase64: string,
  failedAction: string,
  failedTarget: string
): Promise<BlockerAnalysis> {
  const model = getGeminiModel()

  const prompt = `You are a QA automation expert. The test agent has repeatedly failed to perform: ${failedAction} on "${failedTarget}".

Analyze the screenshot and determine if there is a known blocker preventing automation.

Common blockers:
- "oauth": Third-party login buttons (Google, Facebook, GitHub, Apple sign-in) that open external auth popups requiring real credentials
- "captcha": CAPTCHA, reCAPTCHA, hCaptcha, or bot-detection challenges
- "2fa": Two-factor authentication, OTP, SMS verification screens
- "paywall": Paid content, subscription walls, or premium feature gates
- "geo_block": Geographic restrictions or VPN detection
- "rate_limit": Rate limiting, too many requests, or cooldown screens
- "none": No identifiable blocker — the element may just be hard to interact with

Respond with JSON:
{
  "hasBlocker": true | false,
  "blockerType": "oauth" | "captcha" | "2fa" | "paywall" | "geo_block" | "rate_limit" | "none",
  "description": "What you see on the page that indicates this blocker (1-2 sentences)",
  "userAdvice": "Actionable advice for the user on how to handle this situation (1-2 sentences)"
}`

  const result = await model.generateContent([
    { text: prompt },
    screenshotToPart(screenshotBase64),
  ])

  let text = result.response.text().trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }

  try {
    return JSON.parse(text) as BlockerAnalysis
  } catch {
    return {
      hasBlocker: false,
      blockerType: 'none',
      description: 'Could not analyze the page.',
      userAdvice: 'Try a different test approach or check the target page manually.',
    }
  }
}
