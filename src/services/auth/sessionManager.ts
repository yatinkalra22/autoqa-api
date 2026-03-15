import * as fs from 'fs/promises'
import * as path from 'path'
import * as crypto from 'crypto'
import { config } from '../../config'
import type { Page } from 'playwright'
import { findElementByDescription, captureScreenshot } from '../playwright/engine'
import { planNextAction } from '../gemini/planner'
import { geminiLimiter } from '../gemini/rateLimiter'

export interface AuthConfig {
  loginUrl: string
  credentials: Array<{ field: string; value: string }>
  submitButton?: string
}

interface StoredSession {
  cookies: any[]
  origins: any[]
  createdAt: string
  loginUrl: string
}

const SESSION_DIR = path.join(config.localStoragePath, 'sessions')
const SESSION_TTL_MS = 30 * 60 * 1000 // 30 minutes

/**
 * Generate a unique key for a domain + credentials combo.
 * We hash the credentials so we don't store them in filenames.
 */
function sessionKey(loginUrl: string, credentials: AuthConfig['credentials']): string {
  const domain = new URL(loginUrl).hostname
  const credHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(credentials))
    .digest('hex')
    .slice(0, 12)
  return `${domain}_${credHash}`
}

/**
 * Try to load a cached session for the given auth config.
 * Returns null if no valid session exists.
 */
export async function loadCachedSession(
  authConfig: AuthConfig
): Promise<StoredSession | null> {
  const key = sessionKey(authConfig.loginUrl, authConfig.credentials)
  const sessionPath = path.join(SESSION_DIR, `${key}.json`)

  try {
    const data = await fs.readFile(sessionPath, 'utf8')
    const session: StoredSession = JSON.parse(data)

    // Check TTL
    const age = Date.now() - new Date(session.createdAt).getTime()
    if (age > SESSION_TTL_MS) {
      await fs.unlink(sessionPath).catch(() => {})
      return null
    }

    return session
  } catch {
    return null
  }
}

/**
 * Delete a cached session (e.g. when it turns out to be stale).
 */
export async function invalidateCachedSession(authConfig: AuthConfig): Promise<void> {
  const key = sessionKey(authConfig.loginUrl, authConfig.credentials)
  const sessionPath = path.join(SESSION_DIR, `${key}.json`)
  await fs.unlink(sessionPath).catch(() => {})
}

/**
 * Save browser session state for reuse.
 */
async function saveSession(
  authConfig: AuthConfig,
  storageState: { cookies: any[]; origins: any[] }
): Promise<void> {
  await fs.mkdir(SESSION_DIR, { recursive: true })
  const key = sessionKey(authConfig.loginUrl, authConfig.credentials)
  const session: StoredSession = {
    ...storageState,
    createdAt: new Date().toISOString(),
    loginUrl: authConfig.loginUrl,
  }
  await fs.writeFile(
    path.join(SESSION_DIR, `${key}.json`),
    JSON.stringify(session),
    'utf8'
  )
}

/**
 * Perform login using the provided auth config.
 * Uses a hybrid approach: DOM selectors first, then AI-driven if needed.
 *
 * Returns the number of Gemini API calls made during auth.
 */
export async function performLogin(
  page: Page,
  authConfig: AuthConfig,
  broadcastFn?: (msg: string) => void
): Promise<{ success: boolean; geminiCalls: number; error?: string }> {
  let geminiCalls = 0
  const log = (msg: string) => broadcastFn?.(msg)

  try {
    // Navigate to login page
    log('Navigating to login page...')
    await page.goto(authConfig.loginUrl, {
      waitUntil: 'networkidle',
      timeout: 30000,
    })
    await page.waitForTimeout(1000)

    // Fill each credential field
    for (const cred of authConfig.credentials) {
      log(`Entering ${cred.field}...`)

      // Try DOM selectors first
      let locator = await findElementByDescription(page, cred.field, 'type')

      if (locator) {
        await locator.click({ timeout: 3000 })
        await page.waitForTimeout(150)
        await locator.fill(cred.value)
        await page.waitForTimeout(300)
      } else {
        // Fall back to AI-driven detection
        const screenshot = await captureScreenshot(page)
        await geminiLimiter.acquire()
        const plan = await planNextAction(screenshot, `Type "${cred.value}" into the ${cred.field} field`, [], 1)
        geminiCalls++

        // Use AI to find the field by its description
        locator = await findElementByDescription(page, plan.target || cred.field, 'type')
        if (locator) {
          await locator.click({ timeout: 3000 })
          await page.waitForTimeout(150)
          await locator.fill(cred.value)
          await page.waitForTimeout(300)
        } else {
          return {
            success: false,
            geminiCalls,
            error: `Could not find the "${cred.field}" field on the login page.`,
          }
        }
      }
    }

    // Click submit button
    const submitLabel = authConfig.submitButton || 'submit'
    log(`Clicking ${submitLabel}...`)

    let submitLocator = await findElementByDescription(page, submitLabel, 'click')

    // If user didn't specify a button, try common patterns
    if (!submitLocator) {
      const commonButtons = [
        'Log in', 'Login', 'Sign in', 'Sign In', 'Submit',
        'Continue', 'Next', "Let's Go", "Let's Cook",
      ]
      for (const label of commonButtons) {
        submitLocator = await findElementByDescription(page, label, 'click')
        if (submitLocator) break
      }
    }

    if (!submitLocator) {
      // Last resort: try submitting the form via Enter key
      await page.keyboard.press('Enter')
    } else {
      await submitLocator.click({ timeout: 5000 })
    }

    // Wait for the login form to disappear (handles slow redirects and SPAs)
    // Poll every 1s for up to 12s
    let loginFormGone = false
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(1000)
      // Check if we navigated away from the login page
      const hasLoginForm = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'))
        const hasPassword = inputs.some(i => i.type === 'password')
        const hasEmail = inputs.some(i =>
          i.type === 'email' ||
          i.placeholder?.toLowerCase().includes('email') ||
          i.name?.toLowerCase().includes('email')
        )
        return hasPassword && hasEmail
      }).catch(() => false)

      if (!hasLoginForm) {
        loginFormGone = true
        log('Page navigated after login.')
        break
      }

      // Also check if URL changed (some sites keep the form in DOM briefly)
      if (i === 3) {
        await page.waitForLoadState('networkidle').catch(() => {})
      }
    }

    if (!loginFormGone) {
      // One final check — look for error messages on the page
      const errorOnPage = await page.evaluate(() => {
        const el = document.querySelector('[role="alert"], .error, .alert-danger, .error-message')
        return el?.textContent?.trim() || ''
      }).catch(() => '')

      log('Login may have failed — still seeing login form.')
      return {
        success: false,
        geminiCalls,
        error: errorOnPage
          ? `Login failed: ${errorOnPage}`
          : 'Login did not succeed — the login form is still visible. Check credentials.',
      }
    }

    // Save session for reuse
    const storageState = await page.context().storageState()
    await saveSession(authConfig, storageState)

    log('Login successful — session saved for reuse.')
    return { success: true, geminiCalls }
  } catch (err: any) {
    return {
      success: false,
      geminiCalls,
      error: `Login failed: ${err.message}`,
    }
  }
}
