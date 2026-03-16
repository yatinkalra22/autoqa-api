import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import * as fs from 'fs/promises'
import * as path from 'path'
import { db } from '../db'
import { testRuns, tests, authProfiles, sharedReports } from '../db/schema'
import { runQueue } from '../services/queue/jobs'
import { eq, desc, and } from 'drizzle-orm'
import { generatePlaywrightCode } from '../services/exporter/playwright'
import { config } from '../config'
import { requireAuth, optionalAuth } from '../middleware/firebaseAuth'

const authConfigSchema = z.object({
  loginUrl: z.string().url(),
  credentials: z.array(z.object({
    field: z.string(),
    value: z.string(),
  })).min(1),
  submitButton: z.string().optional(),
}).optional()

const createRunSchema = z.object({
  targetUrl: z.string().url(),
  prompt: z.string().min(10).max(2000),
  maxSteps: z.number().int().min(5).max(50).default(20),
  saveTest: z.boolean().default(false),
  testName: z.string().optional(),
  testId: z.string().uuid().optional(),
  auth: authConfigSchema,
  authProfileId: z.string().uuid().optional(),
})

export const runsRouter: FastifyPluginAsync = async (app) => {
  // All routes require authentication
  app.addHook('preHandler', requireAuth)

  app.post<{ Body: z.infer<typeof createRunSchema> }>('/', async (req, reply) => {
    const body = createRunSchema.parse(req.body)
    const userId = req.user!.uid

    let testId = body.testId
    if (body.saveTest && body.testName) {
      const [test] = await db.insert(tests).values({
        name: body.testName,
        prompt: body.prompt,
        targetUrl: body.targetUrl,
        maxSteps: body.maxSteps,
        authProfileId: body.authProfileId || null,
        userId,
      }).returning()
      testId = test.id
    }

    const [run] = await db.insert(testRuns).values({
      testId: testId || null,
      prompt: body.prompt,
      targetUrl: body.targetUrl,
      status: 'QUEUED',
      triggeredBy: 'manual',
      userId,
    }).returning()

    // Resolve auth — either inline config or saved profile
    let auth = body.auth
    if (!auth && body.authProfileId) {
      // Verify the auth profile belongs to this user
      const [profile] = await db.select().from(authProfiles)
        .where(and(eq(authProfiles.id, body.authProfileId), eq(authProfiles.userId, userId)))
      if (profile) {
        auth = {
          loginUrl: profile.loginUrl,
          credentials: profile.credentials as any,
          submitButton: profile.submitButton || undefined,
        }
      }
    }

    await runQueue.add('execute-test', {
      runId: run.id,
      targetUrl: body.targetUrl,
      prompt: body.prompt,
      maxSteps: body.maxSteps,
      auth,
    })

    return { runId: run.id }
  })

  app.get<{ Params: { runId: string } }>('/:runId', async (req, reply) => {
    const userId = req.user!.uid
    const [run] = await db.select().from(testRuns)
      .where(and(eq(testRuns.id, req.params.runId), eq(testRuns.userId, userId)))
    if (!run) return reply.code(404).send({ error: 'Run not found' })

    // Reconstruct narrations from persisted steps
    const steps = (run.steps as any[]) ?? []
    const narrations: Array<{ step: number; text: string; type: string; success?: boolean }> = []
    for (const s of steps) {
      if (s.narration) {
        narrations.push({ step: s.step, text: s.narration, type: 'action', success: s.success })
      }
      if (s.success === false) {
        narrations.push({ step: s.step, text: `Step ${s.step} failed: ${s.action} on "${s.target}"`, type: 'validation', success: false })
      }
    }
    if (run.summary) {
      narrations.push({ step: 0, text: run.summary, type: 'summary', success: run.status === 'PASS' })
    }

    // Serve screenshot from DB (persistent across deploys)
    let lastScreenshotDataUrl = ''
    if (run.screenshotBase64) {
      lastScreenshotDataUrl = `data:image/png;base64,${run.screenshotBase64}`
    } else {
      // Fallback to filesystem for old runs
      try {
        const screenshotPath = path.join(config.localStoragePath, `screenshot-${run.id}.png`)
        const buf = await fs.readFile(screenshotPath)
        lastScreenshotDataUrl = `data:image/png;base64,${buf.toString('base64')}`
      } catch {
        // Screenshot not available
      }
    }

    const { reportHtml: _rh, screenshotBase64: _sb, ...runData } = run
    return { ...runData, narrations, lastScreenshotDataUrl }
  })

  app.get('/', async (req) => {
    const userId = req.user!.uid
    return db.select({
      id: testRuns.id,
      testId: testRuns.testId,
      prompt: testRuns.prompt,
      targetUrl: testRuns.targetUrl,
      status: testRuns.status,
      startedAt: testRuns.startedAt,
      completedAt: testRuns.completedAt,
      summary: testRuns.summary,
      reportUrl: testRuns.reportUrl,
      errorMessage: testRuns.errorMessage,
      durationMs: testRuns.durationMs,
      triggeredBy: testRuns.triggeredBy,
      geminiCalls: testRuns.geminiCalls,
      userId: testRuns.userId,
    }).from(testRuns)
      .where(eq(testRuns.userId, userId))
      .orderBy(desc(testRuns.startedAt))
      .limit(50)
  })

  app.get<{ Params: { runId: string } }>('/:runId/export', async (req, reply) => {
    const userId = req.user!.uid
    const [run] = await db.select().from(testRuns)
      .where(and(eq(testRuns.id, req.params.runId), eq(testRuns.userId, userId)))
    if (!run) return reply.code(404).send({ error: 'Run not found' })
    if (!run.steps || !Array.isArray(run.steps) || run.steps.length === 0) {
      return reply.code(400).send({ error: 'No steps to export' })
    }

    const code = generatePlaywrightCode(run.targetUrl, run.prompt, run.steps as any)
    return reply
      .header('Content-Type', 'text/plain')
      .header('Content-Disposition', `attachment; filename="autoqa-test-${req.params.runId.slice(0, 8)}.spec.ts"`)
      .send(code)
  })

  // Share a run — creates a public share link
  app.post<{ Params: { runId: string } }>('/:runId/share', async (req, reply) => {
    const userId = req.user!.uid
    // Verify the run belongs to this user
    const [run] = await db.select().from(testRuns)
      .where(and(eq(testRuns.id, req.params.runId), eq(testRuns.userId, userId)))
    if (!run) return reply.code(404).send({ error: 'Run not found' })

    // Check if already shared
    const [existing] = await db.select().from(sharedReports)
      .where(eq(sharedReports.runId, run.id))
    if (existing) {
      const baseUrl = req.headers.origin || req.headers.referer?.replace(/\/$/, '') || ''
      return { shareId: existing.id, shareUrl: `${baseUrl}/shared/${existing.id}` }
    }

    const [shared] = await db.insert(sharedReports).values({
      runId: run.id,
      userId,
    }).returning()

    const baseUrl = req.headers.origin || req.headers.referer?.replace(/\/$/, '') || ''
    return { shareId: shared.id, shareUrl: `${baseUrl}/shared/${shared.id}` }
  })
}
