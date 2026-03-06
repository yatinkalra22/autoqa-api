import { getGeminiModel, screenshotToPart } from './client'

export interface PlanResult {
  action: 'click' | 'type' | 'scroll' | 'pressKey' | 'navigate' | 'wait' | 'done'
  target: string
  value?: string
  reasoning: string
  narration: string
  confidence: number
}

const SYSTEM_PROMPT = `You are AutoQA, an expert visual QA testing agent with perfect perception.
You receive screenshots of a web browser and decide what action to take next to achieve a testing goal.
You think step by step and take precise, targeted actions.

You MUST respond with valid JSON only. No markdown, no explanation outside JSON.`

const ACTION_SCHEMA = `{
  "action": "click" | "type" | "scroll" | "pressKey" | "navigate" | "wait" | "done",
  "target": "Human description of the element (e.g. 'blue Submit button', 'Email input field')",
  "value": "Text to type (if action=type) or key name (if action=pressKey, e.g. 'Enter')",
  "reasoning": "1-2 sentences: why this action advances the test goal",
  "narration": "First-person present-tense: what you are doing right now",
  "confidence": 0-100
}

If action is 'wait', set value to milliseconds as string (e.g. "2000").
If action is 'navigate', set value to the URL.
If the test goal is complete or clearly failed, set action to 'done'.`

export async function planNextAction(
  screenshotBase64: string,
  testGoal: string,
  history: Array<{ action: string; target: string; success: boolean }>,
  stepNumber: number
): Promise<PlanResult> {
  const model = getGeminiModel()

  const historyText = history.length > 0
    ? `\nActions taken so far:\n${history.map((h, i) => `${i + 1}. [${h.success ? 'OK' : 'FAIL'}] ${h.action}: "${h.target}"`).join('\n')}`
    : '\nThis is the first action.'

  const prompt = `${SYSTEM_PROMPT}

TEST GOAL: ${testGoal}
CURRENT STEP: ${stepNumber}${historyText}

Look at the current screenshot and decide the next action.
Respond with JSON matching this schema exactly:
${ACTION_SCHEMA}`

  const result = await model.generateContent([
    { text: prompt },
    screenshotToPart(screenshotBase64),
  ])

  const text = result.response.text()
  return JSON.parse(text) as PlanResult
}
