import { getGeminiModel, screenshotToPart } from './client'

export interface VisualDiffResult {
  hasChanges: boolean
  changeLevel: 'none' | 'minor' | 'moderate' | 'major'
  differences: Array<{
    area: string
    description: string
    severity: 'low' | 'medium' | 'high'
  }>
  summary: string
}

const DIFF_PROMPT = `You are a visual regression testing expert. Compare these two screenshots of the same web page taken at different times.

Identify all visual differences between the FIRST image (baseline) and the SECOND image (current).

Focus on:
- Layout changes (element positions, spacing, alignment)
- Color/style changes (backgrounds, borders, text colors)
- Content changes (text differences, missing/added elements)
- Typography changes (font size, weight, family)
- Image/media changes
- Broken UI elements

Respond with valid JSON only:
{
  "hasChanges": true/false,
  "changeLevel": "none" | "minor" | "moderate" | "major",
  "differences": [
    {
      "area": "Description of where on the page",
      "description": "What changed between baseline and current",
      "severity": "low" | "medium" | "high"
    }
  ],
  "summary": "Brief overall comparison summary"
}`

export async function compareScreenshots(
  baselineBase64: string,
  currentBase64: string
): Promise<VisualDiffResult> {
  const model = getGeminiModel()

  const result = await model.generateContent([
    { text: DIFF_PROMPT },
    screenshotToPart(baselineBase64),
    screenshotToPart(currentBase64),
  ])

  const text = result.response.text()
  return JSON.parse(text) as VisualDiffResult
}
