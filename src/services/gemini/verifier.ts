import { getGeminiModel, screenshotToPart, withRetry } from './client'

export interface VerificationResult {
  success: boolean
  observation: string
  suggestedFix?: string
}

/**
 * Verifies that a browser action actually took effect by comparing
 * before/after screenshots. Only used for 'type' and 'click' actions
 * where visual confirmation is possible.
 */
export async function verifyActionEffect(
  screenshotBefore: string,
  screenshotAfter: string,
  action: string,
  target: string,
  value?: string
): Promise<VerificationResult> {
  const model = getGeminiModel()

  let expectation = ''
  if (action === 'type' && value) {
    expectation = `The text "${value}" should now be visible in or near the "${target}" field. For PASSWORD fields, the text will appear as dots/bullets — that counts as success. The field should no longer show only its placeholder text.`
  } else if (action === 'click') {
    expectation = `Clicking "${target}" should have caused a visible change — a navigation, a dropdown opening, a button state change, a form submission, a modal appearing, or similar. Compare the two screenshots for any meaningful difference.`
  } else {
    return { success: true, observation: 'Verification not applicable for this action type.' }
  }

  const prompt = `You are a QA verification agent. Compare the BEFORE and AFTER screenshots to determine if the action succeeded.

ACTION PERFORMED: ${action} on "${target}"${value ? ` with value "${value}"` : ''}

EXPECTED RESULT: ${expectation}

Look carefully at both screenshots. Respond with JSON:
{
  "success": true | false,
  "observation": "What you see in the after screenshot vs the before screenshot (1-2 sentences)",
  "suggestedFix": "If failed, suggest what went wrong (e.g. 'clicked wrong element', 'field was not focused', 'text was typed into wrong field'). Omit if success."
}`

  const result = await withRetry(() => model.generateContent([
    { text: prompt },
    { text: 'BEFORE:' },
    screenshotToPart(screenshotBefore),
    { text: 'AFTER:' },
    screenshotToPart(screenshotAfter),
  ]))

  let text = result.response.text().trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  return JSON.parse(text) as VerificationResult
}
