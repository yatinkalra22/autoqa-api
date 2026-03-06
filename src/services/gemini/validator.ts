import { getGeminiModel, screenshotToPart } from './client'

export interface ValidationResult {
  status: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  confidence: number
  explanation: string
  evidence: string[]
  suggestions: string[]
}

export async function validateTestResult(
  screenshots: string[],
  testGoal: string,
  steps: Array<{ action: string; target: string; narration: string; success: boolean }>
): Promise<ValidationResult> {
  const model = getGeminiModel()

  const stepsText = steps.map((s, i) =>
    `Step ${i + 1}: [${s.success ? 'OK' : 'FAIL'}] ${s.action} "${s.target}" - ${s.narration}`
  ).join('\n')

  const screenshotParts = screenshots.slice(-3).map(screenshotToPart)

  const prompt = `You are a QA test analyst. Determine if this test PASSED or FAILED.

TEST GOAL: ${testGoal}

STEPS TAKEN:
${stepsText}

The attached screenshots show the browser state (most recent last).

Respond with JSON:
{
  "status": "PASS" | "FAIL" | "INCONCLUSIVE",
  "confidence": 0-100,
  "explanation": "3-5 sentences explaining the result",
  "evidence": ["specific observations from screenshots"],
  "suggestions": ["actionable debugging suggestions if failed"]
}`

  const result = await model.generateContent([
    { text: prompt },
    ...screenshotParts,
  ])

  return JSON.parse(result.response.text()) as ValidationResult
}
