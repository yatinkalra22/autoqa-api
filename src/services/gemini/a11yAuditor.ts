import { getGeminiModel, screenshotToPart } from './client'

export interface A11yIssue {
  severity: 'critical' | 'major' | 'minor'
  category: string
  element: string
  issue: string
  suggestion: string
}

export interface A11yAuditResult {
  score: number
  issues: A11yIssue[]
  summary: string
}

const AUDIT_PROMPT = `You are an expert web accessibility auditor. Analyze the screenshot for accessibility issues based on WCAG 2.1 guidelines.

Check for:
- Color contrast (text vs background)
- Missing or poor alt text indicators (images without descriptions)
- Touch target sizes (buttons/links too small)
- Text readability (font size, spacing)
- Focus indicators (visible focus states)
- Heading hierarchy issues
- Form label associations
- Keyboard navigation hints

Respond with valid JSON only:
{
  "score": 0-100,
  "issues": [
    {
      "severity": "critical" | "major" | "minor",
      "category": "contrast" | "images" | "touch-targets" | "typography" | "focus" | "structure" | "forms" | "navigation",
      "element": "Description of the element with the issue",
      "issue": "What the accessibility problem is",
      "suggestion": "How to fix it"
    }
  ],
  "summary": "Brief overall accessibility assessment"
}`

export async function auditAccessibility(screenshotBase64: string, targetUrl: string): Promise<A11yAuditResult> {
  const model = getGeminiModel()

  const prompt = `${AUDIT_PROMPT}

URL being audited: ${targetUrl}

Analyze the screenshot and provide a thorough accessibility audit.`

  const result = await model.generateContent([
    { text: prompt },
    screenshotToPart(screenshotBase64),
  ])

  const text = result.response.text()
  return JSON.parse(text) as A11yAuditResult
}
