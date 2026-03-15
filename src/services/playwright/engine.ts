import { chromium, Browser, BrowserContext, Page, Locator } from 'playwright'
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

/**
 * Try to find an element using Playwright DOM selectors based on the AI's
 * human-readable target description. Tries multiple strategies in order.
 * Returns the locator if found, null otherwise.
 */
export async function findElementByDescription(
  page: Page,
  target: string,
  action: string
): Promise<Locator | null> {
  const timeout = 3000

  // Strategies ordered by reliability
  const strategies: Array<() => Locator> = []

  if (action === 'type') {
    // For type actions, prioritize input-specific selectors
    strategies.push(
      // Match by placeholder text (exact)
      () => page.getByPlaceholder(target, { exact: true }),
      // Match by placeholder text (partial)
      () => page.getByPlaceholder(target),
      // Match by associated label
      () => page.getByLabel(target, { exact: true }),
      () => page.getByLabel(target),
      // Match by role with name
      () => page.getByRole('textbox', { name: target }),
      () => page.getByRole('spinbutton', { name: target }),
      // Match input by common attributes
      () => page.locator(`input[placeholder*="${escapeSelector(target)}" i]`),
      () => page.locator(`input[name*="${escapeSelector(target)}" i]`),
      () => page.locator(`input[aria-label*="${escapeSelector(target)}" i]`),
      () => page.locator(`textarea[placeholder*="${escapeSelector(target)}" i]`),
    )

    // If the target mentions "email", try email-specific selectors
    if (/email/i.test(target)) {
      strategies.push(
        () => page.locator('input[type="email"]'),
        () => page.locator('input[name*="email" i]'),
        () => page.locator('input[autocomplete="email"]'),
      )
    }
    // If the target mentions "password", try password-specific selectors
    if (/password/i.test(target)) {
      strategies.push(
        () => page.locator('input[type="password"]'),
        () => page.locator('input[name*="password" i]'),
        () => page.locator('input[autocomplete*="password" i]'),
      )
    }
  } else if (action === 'click') {
    strategies.push(
      // Match by role + name (buttons, links)
      () => page.getByRole('button', { name: target }),
      () => page.getByRole('link', { name: target }),
      () => page.getByRole('menuitem', { name: target }),
      () => page.getByRole('tab', { name: target }),
      // Match by exact text
      () => page.getByText(target, { exact: true }),
      // Match by partial text
      () => page.getByText(target),
      // Match by title/aria-label
      () => page.locator(`[title="${escapeSelector(target)}" i]`),
      () => page.locator(`[aria-label="${escapeSelector(target)}" i]`),
      // Common button patterns
      () => page.locator(`button:has-text("${escapeSelector(target)}")`),
      () => page.locator(`a:has-text("${escapeSelector(target)}")`),
      () => page.locator(`[role="button"]:has-text("${escapeSelector(target)}")`),
    )
  } else if (action === 'hover') {
    strategies.push(
      () => page.getByText(target),
      () => page.getByRole('button', { name: target }),
      () => page.getByRole('link', { name: target }),
      () => page.locator(`[title="${escapeSelector(target)}" i]`),
    )
  }

  // Try each strategy and return the first one that finds a visible element
  for (const getLocator of strategies) {
    try {
      const locator = getLocator()
      const count = await locator.count()
      if (count === 1) {
        // Single match — check if visible
        if (await locator.isVisible({ timeout: 500 }).catch(() => false)) {
          return locator
        }
      } else if (count > 1) {
        // Multiple matches — find the first visible one
        const first = locator.first()
        if (await first.isVisible({ timeout: 500 }).catch(() => false)) {
          return first
        }
      }
    } catch {
      // Strategy failed, try next
    }
  }

  return null
}

function escapeSelector(str: string): string {
  return str.replace(/["\\]/g, '\\$&')
}

export async function executeAction(
  page: Page,
  action: string,
  value?: string,
  x?: number,
  y?: number,
  locator?: Locator | null
): Promise<{ success: boolean; error?: string }> {
  try {
    switch (action) {
      case 'click': {
        // Listen for popups (e.g. OAuth windows) before clicking
        const popupPromise = page.context().waitForEvent('page', { timeout: 3000 }).catch(() => null)

        if (locator) {
          await locator.click({ timeout: 5000 })
        } else if (x !== undefined && y !== undefined) {
          await page.mouse.click(x, y)
        } else {
          return { success: false, error: 'No element or coordinates provided for click action' }
        }

        // Check if a popup opened (OAuth, external links, etc.)
        const popup = await popupPromise
        if (popup) {
          try {
            await popup.waitForLoadState('domcontentloaded', { timeout: 5000 })
          } catch {
            // Popup may have been blocked or closed
          }
        }

        await page.waitForTimeout(800)
        break
      }

      case 'type':
        if (!value) {
          return { success: false, error: 'No value provided for type action' }
        }
        if (locator) {
          await locator.click({ timeout: 5000 })
          await page.waitForTimeout(150)
          await locator.fill(value)
          await page.waitForTimeout(200)
        } else if (x !== undefined && y !== undefined) {
          // Fallback to coordinate-based typing
          await page.mouse.click(x, y)
          await page.waitForTimeout(200)
          await page.mouse.click(x, y, { clickCount: 3 })
          await page.waitForTimeout(100)
          await page.keyboard.press('Backspace')
          await page.waitForTimeout(100)
          await page.keyboard.type(value, { delay: 50 })
          await page.waitForTimeout(200)
        } else {
          return { success: false, error: 'No element or coordinates provided for type action' }
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
        if (locator) {
          await locator.hover({ timeout: 5000 })
        } else if (x !== undefined && y !== undefined) {
          await page.mouse.move(x, y)
        }
        break
    }

    await page.waitForTimeout(1200)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
