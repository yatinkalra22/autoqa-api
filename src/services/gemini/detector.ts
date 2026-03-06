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

Return JSON with the bounding box:
{
  "found": true | false,
  "x": pixels from left edge (number),
  "y": pixels from top edge (number),
  "width": element width in pixels (number),
  "height": element height in pixels (number),
  "confidence": 0-100,
  "description": "brief description of what you found"
}

If the element is not visible, set found: false and all coordinates to 0.
Be precise. The click will go to the CENTER of this bounding box.`

  const result = await model.generateContent([
    { text: prompt },
    screenshotToPart(screenshotBase64),
  ])

  return JSON.parse(result.response.text()) as DetectionResult
}
