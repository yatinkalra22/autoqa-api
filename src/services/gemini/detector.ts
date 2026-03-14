import { getGeminiModel, screenshotToPart } from './client'

export interface DetectionResult {
  found: boolean
  x: number
  y: number
  width: number
  height: number
  confidence: number
  description: string
}

export async function detectElement(
  screenshotBase64: string,
  elementDescription: string,
  screenshotDimensions = { width: 1280, height: 800 }
): Promise<DetectionResult> {
  const model = getGeminiModel()

  const prompt = `You are a precise UI element detector for browser automation.
The screenshot is ${screenshotDimensions.width}x${screenshotDimensions.height} pixels.

Find this element: "${elementDescription}"

IMPORTANT RULES:
- For input fields: return the bounding box of the INPUT AREA itself (the text box), not the label.
- For buttons: return the bounding box of the clickable button element.
- Password fields may show dots/bullets or appear empty — they are still valid input fields.
- If multiple similar elements exist, pick the one that best matches the description.
- Be as precise as possible — the click/type action will target the CENTER of this bounding box.

Return JSON with the bounding box:
{
  "found": true | false,
  "x": pixels from left edge to the LEFT edge of the element (number),
  "y": pixels from top edge to the TOP edge of the element (number),
  "width": element width in pixels (number),
  "height": element height in pixels (number),
  "confidence": 0-100,
  "description": "brief description of what you found"
}

If the element is not visible, set found: false and all coordinates to 0.`

  const result = await model.generateContent([
    { text: prompt },
    screenshotToPart(screenshotBase64),
  ])

  let text = result.response.text().trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  return JSON.parse(text) as DetectionResult
}
