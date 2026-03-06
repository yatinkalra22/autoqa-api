import { chromium, Browser, BrowserContext, Page } from 'playwright'
import { config } from '../../config'

class BrowserPool {
  async acquire(): Promise<{ browser: Browser; context: BrowserContext; page: Page; release: () => Promise<void> }> {
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,800',
      ],
    })

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    })

    const page = await context.newPage()

    const release = async () => {
      await browser.close().catch(() => {})
    }

    return { browser, context, page, release }
  }
}

export const browserPool = new BrowserPool()

export async function captureScreenshot(page: Page): Promise<string> {
  const buffer = await page.screenshot({ type: 'png', fullPage: false })
  return buffer.toString('base64')
}

export async function executeAction(
  page: Page,
  action: string,
  value?: string,
  x?: number,
  y?: number
): Promise<{ success: boolean; error?: string }> {
  try {
    switch (action) {
      case 'click':
        if (x !== undefined && y !== undefined) {
          await page.mouse.click(x, y)
        }
        break

      case 'type':
        if (x !== undefined && y !== undefined) {
          await page.mouse.click(x, y)
          await page.keyboard.press('Control+a')
          await page.keyboard.type(value || '', { delay: 30 })
        }
        break

      case 'pressKey':
        await page.keyboard.press(value || 'Enter')
        break

      case 'scroll':
        await page.mouse.wheel(0, parseInt(value || '300'))
        break

      case 'navigate':
        await page.goto(value || '', { waitUntil: 'domcontentloaded', timeout: 30000 })
        break

      case 'wait':
        await page.waitForTimeout(parseInt(value || '1000'))
        break

      case 'hover':
        if (x !== undefined && y !== undefined) {
          await page.mouse.move(x, y)
        }
        break
    }

    await page.waitForTimeout(800)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
