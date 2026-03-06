import sharp from 'sharp'

export interface AnnotationBox {
  x: number
  y: number
  w: number
  h: number
  label: string
  color: string
}

export async function annotateScreenshot(
  screenshotBase64: string,
  box: AnnotationBox,
  stepNumber: number,
  success: boolean
): Promise<string> {
  const imgBuffer = Buffer.from(screenshotBase64, 'base64')
  const color = success ? { r: 34, g: 197, b: 94 } : { r: 239, g: 68, b: 68 }

  const metadata = await sharp(imgBuffer).metadata()
  const imgWidth = metadata.width || 1280
  const imgHeight = metadata.height || 800

  const labelText = `${stepNumber}. ${box.label.substring(0, 30)}`
  const labelWidth = Math.min(labelText.length * 8 + 20, 300)

  const svgOverlay = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${imgWidth}" height="${imgHeight}">
      <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"
        fill="none" stroke="rgb(${color.r},${color.g},${color.b})" stroke-width="3" rx="4" />
      <rect x="${box.x}" y="${Math.max(0, box.y - 28)}"
        width="${labelWidth}" height="24"
        fill="rgb(${color.r},${color.g},${color.b})" rx="4" />
      <text x="${box.x + 6}" y="${Math.max(0, box.y - 28) + 16}"
        font-family="monospace" font-size="12" fill="white" font-weight="bold">
        ${labelText}
      </text>
    </svg>
  `

  const annotated = await sharp(imgBuffer)
    .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
    .png()
    .toBuffer()

  return annotated.toString('base64')
}
