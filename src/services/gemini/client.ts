import { GoogleGenerativeAI } from '@google/generative-ai'
import { config } from '../../config'

const genAI = new GoogleGenerativeAI(config.geminiApiKey)

export function getGeminiModel() {
  return genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  })
}

export function screenshotToPart(base64: string) {
  return {
    inlineData: {
      data: base64,
      mimeType: 'image/png' as const,
    },
  }
}
