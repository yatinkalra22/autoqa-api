import { getGeminiModel, screenshotToPart, withRetry } from './client'

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
7. NEVER retry the same action on the same target more than 2 times. If an action has failed 2+ times in the history, do NOT attempt it again — either try a different approach or set action to "done" and explain the failure.
8. If you see 3 or more consecutive failures in the action history, set action to "done" immediately. The test has encountered an obstacle it cannot overcome.
9. If the test goal includes specific credentials (email, password, username), use EXACTLY those credentials — do not generate fake ones.
10. If you encounter OAuth/social login buttons (Google, Facebook, GitHub, Apple), CAPTCHA challenges, or 2FA prompts, these CANNOT be automated. Set action to "done" and explain in reasoning that this requires real authentication that cannot be automated.

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
  stepNumber: number,
  options?: { authCompleted?: boolean; authCredentials?: Array<{ field: string; value: string }> }
): Promise<PlanResult> {
  const model = getGeminiModel()

  const historyText = history.length > 0
    ? `\nActions taken so far:\n${history.map((h, i) => {
        const valueInfo = h.value ? ` (value: "${h.value}")` : ''
        return `${i + 1}. [${h.success ? 'OK' : 'FAIL'}] ${h.action}: "${h.target}"${valueInfo}`
      }).join('\n')}`
    : '\nThis is the first action.'

  let authContext = ''
  if (options?.authCompleted) {
    authContext = `\nIMPORTANT: The user has ALREADY authenticated via a separate login flow before this test started. You are now logged in. Do NOT attempt to fill in login forms, enter credentials, or click login/sign-in buttons — authentication is already complete. Focus on testing the application AFTER login. If you see a login page, it may be because the page hasn't redirected yet — try waiting or navigating to the app's main page.`
  } else if (options?.authCredentials && options.authCredentials.length > 0) {
    // Auth was provided but login hasn't completed yet — tell the planner to use real credentials
    const credList = options.authCredentials.map(c => `${c.field}: "${c.value}"`).join(', ')
    authContext = `\nIMPORTANT: The user has provided login credentials. If you see a login form, use EXACTLY these credentials — do NOT generate fake ones:\n${credList}`
  }

  const prompt = `${SYSTEM_PROMPT}

TEST GOAL: ${testGoal}
CURRENT STEP: ${stepNumber}${historyText}${authContext}

Look at the current screenshot and decide the next action.
Respond with JSON matching this schema exactly:
${ACTION_SCHEMA}`

  const result = await withRetry(() => model.generateContent([
    { text: prompt },
    screenshotToPart(screenshotBase64),
  ]))

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
