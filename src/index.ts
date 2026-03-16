import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyWebsocket from '@fastify/websocket'
import fastifyHelmet from '@fastify/helmet'
import fastifyRateLimit from '@fastify/rate-limit'
import * as fs from 'fs/promises'
import * as path from 'path'
import { config } from './config'
import { startWorker } from './services/queue/worker'
import { runsRouter } from './routes/runs'
import { testsRouter } from './routes/tests'
import { webhooksRouter } from './routes/webhooks'
import { authProfilesRouter } from './routes/authProfiles'
import { runSocketHandler } from './ws/runSocket'
import { suggestTests } from './services/gemini/suggester'
import { auditAccessibility } from './services/gemini/a11yAuditor'
import { compareScreenshots } from './services/gemini/visualDiff'
import { browserPool, captureScreenshot } from './services/playwright/engine'
import { requireAuth } from './middleware/firebaseAuth'
import { db } from './db'
import { sharedReports, testRuns, userWebhooks } from './db/schema'
import { eq, and } from 'drizzle-orm'

const app = Fastify({
  logger: {
    transport: config.isDev
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  },
})

async function bootstrap() {
  // Security: HTTP headers (CSP, HSTS, X-Frame-Options, etc.)
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: false, // Disable CSP for API (frontend handles it)
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow cross-origin for screenshots
  })

  // Security: Rate limiting
  await app.register(fastifyRateLimit, {
    max: 100,           // 100 requests per window
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      // Rate limit by user ID if authenticated, otherwise by IP
      return req.user?.uid || req.ip
    },
  })

  await app.register(fastifyCors, { origin: config.corsOrigins })
  await app.register(fastifyWebsocket)

  // Health check — no auth required
  app.get('/health', async () => ({
    status: 'ok',
    version: '1.0.0',
  }))

  // Authenticated route groups
  await app.register(runsRouter, { prefix: '/api/runs' })
  await app.register(testsRouter, { prefix: '/api/tests' })
  await app.register(webhooksRouter, { prefix: '/api/webhooks' })
  await app.register(authProfilesRouter, { prefix: '/api/auth-profiles' })

  // Shared report viewing — PUBLIC (no auth required)
  app.get<{ Params: { shareId: string } }>('/api/shared/:shareId', async (req, reply) => {
    const [shared] = await db.select().from(sharedReports)
      .where(eq(sharedReports.id, req.params.shareId))
    if (!shared) return reply.code(404).send({ error: 'Shared report not found' })

    const [run] = await db.select().from(testRuns)
      .where(eq(testRuns.id, shared.runId))
    if (!run) return reply.code(404).send({ error: 'Run not found' })

    // Reconstruct narrations
    const steps = (run.steps as any[]) ?? []
    const narrations: Array<{ step: number; text: string; type: string; success?: boolean }> = []
    for (const s of steps) {
      if (s.narration) {
        narrations.push({ step: s.step, text: s.narration, type: 'action', success: s.success })
      }
    }
    if (run.summary) {
      narrations.push({ step: 0, text: run.summary, type: 'summary', success: run.status === 'PASS' })
    }

    let lastScreenshotDataUrl = ''
    try {
      const screenshotPath = path.join(config.localStoragePath, `screenshot-${run.id}.png`)
      const buf = await fs.readFile(screenshotPath)
      lastScreenshotDataUrl = `data:image/png;base64,${buf.toString('base64')}`
    } catch {
      // No screenshot
    }

    // Return sanitized data (no userId, no error messages)
    return {
      id: run.id,
      prompt: run.prompt,
      targetUrl: run.targetUrl,
      status: run.status,
      steps: run.steps,
      summary: run.summary,
      durationMs: run.durationMs,
      narrations,
      lastScreenshotDataUrl,
      sharedBy: shared.userId,
      sharedAt: shared.createdAt,
    }
  })

  // Report serving — no auth required (UUID is unguessable, same pattern as shared reports)
  app.get<{ Params: { runId: string } }>('/api/reports/:runId', async (req, reply) => {
    const [run] = await db.select().from(testRuns)
      .where(eq(testRuns.id, req.params.runId))
    if (!run) return reply.code(404).send('Report not found')

    // Serve from DB (persistent) with filesystem cache fallback
    if (run.reportHtml) {
      return reply.type('text/html').send(run.reportHtml)
    }

    // Fallback to filesystem (for runs created before DB storage)
    const reportPath = path.join(config.localStoragePath, `report-${req.params.runId}.html`)
    try {
      const html = await fs.readFile(reportPath, 'utf8')
      return reply.type('text/html').send(html)
    } catch {
      return reply.code(404).send('Report not found')
    }
  })

  // AI test suggestions — requires auth
  app.post<{ Body: { targetUrl: string } }>('/api/suggest', {
    preHandler: requireAuth,
  }, async (req, reply) => {
    const { targetUrl } = req.body
    if (!targetUrl) return reply.code(400).send({ error: 'targetUrl is required' })
    try {
      const suggestions = await suggestTests(targetUrl)
      return { suggestions }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Failed to generate suggestions' })
    }
  })

  // Accessibility audit — requires auth
  app.post<{ Body: { targetUrl: string } }>('/api/a11y', {
    preHandler: requireAuth,
  }, async (req, reply) => {
    const { targetUrl } = req.body
    if (!targetUrl) return reply.code(400).send({ error: 'targetUrl is required' })
    try {
      const { page, release } = await browserPool.acquire()
      try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
        const screenshot = await captureScreenshot(page)
        const audit = await auditAccessibility(screenshot, targetUrl)
        return audit
      } finally {
        await release()
      }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Audit failed' })
    }
  })

  // Visual regression comparison — requires auth
  app.post<{ Body: { baselineRunId: string; currentRunId: string } }>('/api/compare', {
    preHandler: requireAuth,
  }, async (req, reply) => {
    const { baselineRunId, currentRunId } = req.body
    const userId = req.user!.uid
    if (!baselineRunId || !currentRunId) {
      return reply.code(400).send({ error: 'baselineRunId and currentRunId are required' })
    }

    // Verify both runs belong to this user
    const [baseline] = await db.select().from(testRuns)
      .where(and(eq(testRuns.id, baselineRunId), eq(testRuns.userId, userId)))
    const [current] = await db.select().from(testRuns)
      .where(and(eq(testRuns.id, currentRunId), eq(testRuns.userId, userId)))
    if (!baseline || !current) {
      return reply.code(404).send({ error: 'One or both runs not found' })
    }

    // Read screenshots from DB first, fall back to filesystem
    let baselineB64 = baseline.screenshotBase64
    let currentB64 = current.screenshotBase64

    if (!baselineB64 || !currentB64) {
      try {
        if (!baselineB64) {
          const buf = await fs.readFile(path.join(config.localStoragePath, `screenshot-${baselineRunId}.png`))
          baselineB64 = buf.toString('base64')
        }
        if (!currentB64) {
          const buf = await fs.readFile(path.join(config.localStoragePath, `screenshot-${currentRunId}.png`))
          currentB64 = buf.toString('base64')
        }
      } catch {
        return reply.code(404).send({ error: 'Screenshot not found for one or both runs' })
      }
    }

    if (!baselineB64 || !currentB64) {
      return reply.code(404).send({ error: 'Screenshot not found for one or both runs' })
    }

    try {
      const diff = await compareScreenshots(baselineB64, currentB64)
      return {
        ...diff,
        baselineScreenshot: `data:image/png;base64,${baselineB64}`,
        currentScreenshot: `data:image/png;base64,${currentB64}`,
      }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Comparison failed' })
    }
  })

  // Notification webhook settings — per-user, stored in DB
  app.get('/api/settings/webhooks', {
    preHandler: requireAuth,
  }, async (req) => {
    const userId = req.user!.uid
    const webhooks = await db.select().from(userWebhooks)
      .where(eq(userWebhooks.userId, userId))
    return {
      webhooks: webhooks.map(w => ({ url: w.url, type: w.type as 'slack' | 'generic' })),
    }
  })

  app.put<{ Body: { webhooks: Array<{ url: string; type: 'slack' | 'generic' }> } }>(
    '/api/settings/webhooks',
    { preHandler: requireAuth },
    async (req) => {
      const userId = req.user!.uid
      const { webhooks } = req.body

      // Delete existing and insert new
      await db.delete(userWebhooks).where(eq(userWebhooks.userId, userId))
      if (webhooks && webhooks.length > 0) {
        const valid = webhooks.filter(w => w.url.trim())
        if (valid.length > 0) {
          await db.insert(userWebhooks).values(
            valid.map(w => ({ userId, url: w.url, type: w.type }))
          )
        }
      }

      const saved = await db.select().from(userWebhooks)
        .where(eq(userWebhooks.userId, userId))
      return {
        webhooks: saved.map(w => ({ url: w.url, type: w.type as 'slack' | 'generic' })),
      }
    }
  )

  app.get('/ws/runs/:runId', { websocket: true }, runSocketHandler as any)

  startWorker()

  await app.listen({ port: config.port, host: '0.0.0.0' })
  app.log.info(`AutoQA API running on port ${config.port}`)
}

bootstrap().catch((err) => {
  console.error(err)
  process.exit(1)
})
