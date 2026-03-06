import { Worker } from 'bullmq'
import { redis } from './redis'
import { db } from '../../db'
import { testRuns } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { browserPool, captureScreenshot, executeAction } from '../playwright/engine'
import { planNextAction } from '../gemini/planner'
import { detectElement } from '../gemini/detector'
import { validateTestResult } from '../gemini/validator'
import { geminiLimiter } from '../gemini/rateLimiter'
import { generateReport } from '../reporter/html'
import { annotateScreenshot } from '../reporter/annotator'
import { broadcastToRun } from '../../ws/runSocket'
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
      const actionHistory: Array<{ action: string; target: string; success: boolean }> = []

      try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
        const initialScreenshot = await captureScreenshot(page)
        screenshots.push(initialScreenshot)

        for (let step = 1; step <= maxSteps; step++) {
          const currentScreenshot = await captureScreenshot(page)

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

          if (['click', 'type', 'hover'].includes(plan.action) && plan.target) {
            await geminiLimiter.acquire()
            const detection = await detectElement(currentScreenshot, plan.target)
            geminiCalls++

            if (detection.found) {
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
            }
          }

          const result = await executeAction(page, plan.action, plan.value, x, y)
          const screenshotAfter = await captureScreenshot(page)
          screenshots.push(screenshotAfter)

          const stepRecord: StepRecord = {
            step,
            action: plan.action,
            target: plan.target,
            value: plan.value,
            reasoning: plan.reasoning,
            narration: plan.narration,
            success: result.success,
            annotation,
            durationMs: 0,
            timestamp: new Date().toISOString(),
          }
          steps.push(stepRecord)
          actionHistory.push({ action: plan.action, target: plan.target, success: result.success })

          let annotatedScreenshot = screenshotAfter
          if (annotation) {
            try {
              annotatedScreenshot = await annotateScreenshot(screenshotAfter, annotation, step, result.success)
            } catch {}
          }

          broadcast(runId, {
            type: 'step_complete',
            step,
            success: result.success,
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
