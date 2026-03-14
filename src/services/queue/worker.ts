import { Worker } from 'bullmq'
import { redis } from './redis'
import { db } from '../../db'
import { testRuns } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { browserPool, captureScreenshot, executeAction, findElementByDescription } from '../playwright/engine'
import { planNextAction } from '../gemini/planner'
import { detectElement } from '../gemini/detector'
import { validateTestResult } from '../gemini/validator'
import { verifyActionEffect } from '../gemini/verifier'
import { detectBlocker } from '../gemini/blockerDetector'
import { geminiLimiter } from '../gemini/rateLimiter'
import { generateReport } from '../reporter/html'
import * as fs from 'fs/promises'
import * as path from 'path'
import { config } from '../../config'
import { annotateScreenshot } from '../reporter/annotator'
import { broadcastToRun } from '../../ws/runSocket'
import { notifyRunComplete } from '../notifier'
import type { TestJobData } from './jobs'
import type { WSMessage } from '../../ws/runSocket'

interface StepRecord {
  step: number
  action: string
  target: string
  value?: string
  reasoning: string
  narration: string
  success: boolean
  annotation?: any
  durationMs: number
  timestamp: string
}

export function startWorker() {
  const worker = new Worker<TestJobData>(
    'test-runs',
    async (job) => {
      const { runId, targetUrl, prompt, maxSteps } = job.data
      const startedAt = new Date()
      let geminiCalls = 0

      await db.update(testRuns).set({ status: 'RUNNING', startedAt }).where(eq(testRuns.id, runId))
      broadcast(runId, { type: 'run_started', runId })

      const { page, release } = await browserPool.acquire()
      const steps: StepRecord[] = []
      const screenshots: string[] = []
      const actionHistory: Array<{ action: string; target: string; value?: string; success: boolean }> = []

      try {
        await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 })
        const initialScreenshot = await captureScreenshot(page)
        screenshots.push(initialScreenshot)

        let consecutiveFailures = 0
        const MAX_CONSECUTIVE_FAILURES = 3

        for (let step = 1; step <= maxSteps; step++) {
          // Circuit breaker: stop if too many consecutive failures
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            // Analyze WHY we're stuck — detect known blockers
            const lastFailedAction = actionHistory[actionHistory.length - 1]
            const currentScreenshot = await captureScreenshot(page)
            try {
              await geminiLimiter.acquire()
              const blocker = await detectBlocker(
                currentScreenshot,
                lastFailedAction?.action || 'unknown',
                lastFailedAction?.target || 'unknown'
              )
              geminiCalls++

              if (blocker.hasBlocker) {
                const blockerLabels: Record<string, string> = {
                  oauth: 'Third-Party Authentication Required',
                  captcha: 'CAPTCHA / Bot Detection',
                  '2fa': 'Two-Factor Authentication Required',
                  paywall: 'Paywall / Subscription Required',
                  geo_block: 'Geographic Restriction Detected',
                  rate_limit: 'Rate Limiting Detected',
                }
                const label = blockerLabels[blocker.blockerType] || 'Automation Blocker Detected'
                broadcast(runId, {
                  type: 'validation',
                  passed: false,
                  message: `⚠ ${label}: ${blocker.description} — ${blocker.userAdvice}`,
                })
              } else {
                broadcast(runId, {
                  type: 'validation',
                  passed: false,
                  message: `Stopping after ${MAX_CONSECUTIVE_FAILURES} consecutive failed actions. The element "${lastFailedAction?.target}" could not be interacted with. Try rewording your test instructions or check the target page.`,
                })
              }
            } catch {
              broadcast(runId, {
                type: 'validation',
                passed: false,
                message: `Stopping after ${MAX_CONSECUTIVE_FAILURES} consecutive failed actions. The test cannot proceed.`,
              })
            }
            break
          }

          const currentScreenshot = await captureScreenshot(page)

          const stepStart = Date.now()

          await geminiLimiter.acquire()
          const plan = await planNextAction(currentScreenshot, prompt, actionHistory, step)
          geminiCalls++

          broadcast(runId, {
            type: 'step_start',
            step,
            action: plan.action,
            target: plan.target,
            reasoning: plan.reasoning,
            narration: plan.narration,
          })

          if (plan.action === 'done') {
            broadcast(runId, { type: 'validation', passed: true, message: 'Test sequence complete. Evaluating results...' })
            break
          }

          let x: number | undefined
          let y: number | undefined
          let annotation: any = undefined

          // Strategy: Try DOM selectors first (precise), fall back to AI vision detection
          let locator = null as any
          if (['click', 'type', 'hover'].includes(plan.action) && plan.target) {
            // 1. Try Playwright DOM selectors (fast, precise)
            locator = await findElementByDescription(page, plan.target, plan.action)

            if (!locator) {
              // 2. Fall back to AI vision-based coordinate detection
              await geminiLimiter.acquire()
              let detection = await detectElement(currentScreenshot, plan.target)
              geminiCalls++

              // Retry once with a fresh screenshot if detection fails
              if (!detection.found || detection.confidence < 30) {
                await page.waitForTimeout(1000)
                const retryScreenshot = await captureScreenshot(page)
                await geminiLimiter.acquire()
                detection = await detectElement(retryScreenshot, plan.target)
                geminiCalls++
              }

              if (detection.found && detection.confidence >= 20) {
                x = Math.round(detection.x + detection.width / 2)
                y = Math.round(detection.y + detection.height / 2)
                annotation = {
                  x: detection.x,
                  y: detection.y,
                  w: detection.width,
                  h: detection.height,
                  label: plan.target,
                  color: 'blue',
                }
              } else {
                broadcast(runId, { type: 'validation', passed: false, message: `Could not find element: "${plan.target}"` })
                const stepDuration = Date.now() - stepStart
                steps.push({
                  step,
                  action: plan.action,
                  target: plan.target,
                  value: plan.value,
                  reasoning: plan.reasoning,
                  narration: plan.narration,
                  success: false,
                  durationMs: stepDuration,
                  timestamp: new Date().toISOString(),
                })
                actionHistory.push({ action: plan.action, target: plan.target, value: plan.value, success: false })
                consecutiveFailures++
                broadcast(runId, {
                  type: 'step_complete',
                  step,
                  success: false,
                  screenshotDataUrl: `data:image/png;base64,${currentScreenshot}`,
                })
                continue
              }
            }
          }

          // Validate that we have either a locator or coordinates for interactive actions
          if (['click', 'type'].includes(plan.action) && !locator && x === undefined) {
            const stepDuration = Date.now() - stepStart
            steps.push({
              step,
              action: plan.action,
              target: plan.target,
              value: plan.value,
              reasoning: plan.reasoning,
              narration: plan.narration,
              success: false,
              durationMs: stepDuration,
              timestamp: new Date().toISOString(),
            })
            actionHistory.push({ action: plan.action, target: plan.target, value: plan.value, success: false })
            consecutiveFailures++
            broadcast(runId, {
              type: 'step_complete',
              step,
              success: false,
              screenshotDataUrl: `data:image/png;base64,${currentScreenshot}`,
            })
            continue
          }

          const result = await executeAction(page, plan.action, plan.value, x, y, locator)
          const screenshotAfter = await captureScreenshot(page)
          screenshots.push(screenshotAfter)

          // Self-verify type and click actions by comparing before/after screenshots
          let actionSuccess = result.success
          let verificationNote = ''
          if (result.success && ['type', 'click'].includes(plan.action)) {
            try {
              await geminiLimiter.acquire()
              const verification = await verifyActionEffect(
                currentScreenshot, screenshotAfter, plan.action, plan.target, plan.value
              )
              geminiCalls++
              if (!verification.success) {
                actionSuccess = false
                verificationNote = verification.observation
                broadcast(runId, {
                  type: 'validation',
                  passed: false,
                  message: `Step ${step} verification failed: ${verification.observation}${verification.suggestedFix ? ` (${verification.suggestedFix})` : ''}`,
                })
              }
            } catch {
              // If verification itself fails, trust the original result
            }
          }

          const stepDuration = Date.now() - stepStart

          const stepRecord: StepRecord = {
            step,
            action: plan.action,
            target: plan.target,
            value: plan.value,
            reasoning: plan.reasoning,
            narration: verificationNote
              ? `${plan.narration} [VERIFY FAILED: ${verificationNote}]`
              : plan.narration,
            success: actionSuccess,
            annotation,
            durationMs: stepDuration,
            timestamp: new Date().toISOString(),
          }
          steps.push(stepRecord)
          actionHistory.push({ action: plan.action, target: plan.target, value: plan.value, success: actionSuccess })
          if (actionSuccess) {
            consecutiveFailures = 0
          } else {
            consecutiveFailures++
          }

          let annotatedScreenshot = screenshotAfter
          if (annotation) {
            try {
              annotatedScreenshot = await annotateScreenshot(screenshotAfter, annotation, step, result.success)
            } catch {}
          }

          broadcast(runId, {
            type: 'step_complete',
            step,
            action: plan.action,
            target: plan.target,
            value: plan.value,
            success: actionSuccess,
            screenshotDataUrl: `data:image/png;base64,${annotatedScreenshot}`,
            annotation,
          })

          if (!result.success) {
            broadcast(runId, { type: 'validation', passed: false, message: `Step ${step} failed: ${result.error}` })
          }
        }

        await geminiLimiter.acquire()
        const validation = await validateTestResult(screenshots, prompt, steps.map(s => ({
          action: s.action, target: s.target, narration: s.narration, success: s.success,
        })))
        geminiCalls++

        const finalStatus = validation.status === 'PASS' ? 'PASS' : 'FAIL'
        const completedAt = new Date()
        const durationMs = completedAt.getTime() - startedAt.getTime()

        // Save final screenshot for visual regression
        const finalScreenshot = screenshots[screenshots.length - 1]
        if (finalScreenshot) {
          const screenshotDir = config.localStoragePath
          await fs.mkdir(screenshotDir, { recursive: true })
          await fs.writeFile(
            path.join(screenshotDir, `screenshot-${runId}.png`),
            Buffer.from(finalScreenshot, 'base64')
          )
        }

        const reportUrl = await generateReport(runId, {
          prompt,
          targetUrl,
          status: finalStatus,
          steps,
          screenshots,
          summary: validation.explanation,
          durationMs,
        })

        await db.update(testRuns).set({
          status: finalStatus,
          completedAt,
          steps: steps as any,
          summary: validation.explanation,
          reportUrl,
          durationMs,
          geminiCalls,
        }).where(eq(testRuns.id, runId))

        broadcast(runId, {
          type: 'run_complete',
          status: finalStatus,
          summary: validation.explanation,
          reportUrl: reportUrl || '',
          durationMs,
        })

        notifyRunComplete({
          runId,
          status: finalStatus,
          prompt,
          targetUrl,
          summary: validation.explanation,
          durationMs,
          reportUrl,
          stepsCount: steps.length,
        }).catch(() => {})
      } catch (err: any) {
        const msg = err.message || 'Unknown error'
        await db.update(testRuns).set({
          status: 'ERROR',
          completedAt: new Date(),
          errorMessage: msg,
          steps: steps as any,
          geminiCalls,
        }).where(eq(testRuns.id, runId))

        broadcast(runId, { type: 'error', message: msg })
      } finally {
        await release()
      }
    },
    { connection: redis, concurrency: 3 }
  )

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err)
  })

  return worker
}

function broadcast(runId: string, message: WSMessage) {
  broadcastToRun(runId, message).catch(() => {})
}
