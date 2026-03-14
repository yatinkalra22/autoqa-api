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

CRITICAL RULES:
1. When action is "type", you MUST provide a realistic value to type in the "value" field. NEVER leave it empty.
   - For email fields: generate a plausible fake email like "testuser@example.com"
   - For password fields: generate a fake password like "WrongPass123!" (for wrong-credential tests) or "TestPass123!" (for valid tests)
   - For any other input: generate appropriate realistic test data
2. Password fields often show dots/bullets or appear empty visually — this is NORMAL. If you previously typed into a password field and it shows dots or appears masked, that means it WORKED. Do NOT re-type into it.
3. Always identify elements by their visible label, placeholder text, or visual appearance.
4. After clicking a submit/login button, if the page needs time to respond, use a "wait" action before checking results.
5. When the test goal mentions "wrong credentials" or "invalid", intentionally use incorrect data.
6. When the test goal mentions "valid credentials" or similar, use realistic but fake data unless specific credentials are provided.

You MUST respond with valid JSON only. No markdown, no explanation outside JSON.`

const ACTION_SCHEMA = `{
  "action": "click" | "type" | "scroll" | "pressKey" | "navigate" | "wait" | "done",
  "target": "Human description of the element (e.g. 'blue Submit button', 'Email input field')",
  "value": "REQUIRED for type: the actual text to type (e.g. 'testuser@example.com', 'WrongPass123!'). For pressKey: key name (e.g. 'Enter'). For wait: milliseconds. For navigate: URL.",
  "reasoning": "1-2 sentences: why this action advances the test goal",
  "narration": "First-person present-tense: what you are doing right now",
  "confidence": 0-100
}

IMPORTANT:
- If action is 'type', value MUST contain the actual text to type. Never leave it empty or set it to the field label.
- If action is 'wait', set value to milliseconds as string (e.g. "2000").
- If action is 'navigate', set value to the URL.
- If the test goal is complete or clearly failed, set action to 'done'.`

export async function planNextAction(
  screenshotBase64: string,
  testGoal: string,
  history: Array<{ action: string; target: string; value?: string; success: boolean }>,
  stepNumber: number
): Promise<PlanResult> {
  const model = getGeminiModel()

  const historyText = history.length > 0
    ? `\nActions taken so far:\n${history.map((h, i) => {
        const valueInfo = h.value ? ` (value: "${h.value}")` : ''
        return `${i + 1}. [${h.success ? 'OK' : 'FAIL'}] ${h.action}: "${h.target}"${valueInfo}`
      }).join('\n')}`
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

  let text = result.response.text().trim()
  // Strip markdown code fences if present
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  const parsed = JSON.parse(text) as PlanResult
  // Ensure type actions always have a value
  if (parsed.action === 'type' && !parsed.value) {
    parsed.value = 'test@example.com' // fallback so we never type nothing
  }
  return parsed
}
