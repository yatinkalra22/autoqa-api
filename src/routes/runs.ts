import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import * as fs from 'fs/promises'
import * as path from 'path'
import { db } from '../db'
import { testRuns, tests, authProfiles } from '../db/schema'
import { runQueue } from '../services/queue/jobs'
import { eq, desc } from 'drizzle-orm'
import { generatePlaywrightCode } from '../services/exporter/playwright'
import { config } from '../config'

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
  app.post<{ Body: z.infer<typeof createRunSchema> }>('/', async (req, reply) => {
    const body = createRunSchema.parse(req.body)

    let testId = body.testId
    if (body.saveTest && body.testName) {
      const [test] = await db.insert(tests).values({
        name: body.testName,
        prompt: body.prompt,
        targetUrl: body.targetUrl,
        maxSteps: body.maxSteps,
        authProfileId: body.authProfileId || null,
      }).returning()
      testId = test.id
    }

    const [run] = await db.insert(testRuns).values({
      testId: testId || null,
      prompt: body.prompt,
      targetUrl: body.targetUrl,
      status: 'QUEUED',
      triggeredBy: 'manual',
    }).returning()

    // Resolve auth — either inline config or saved profile
    let auth = body.auth
    if (!auth && body.authProfileId) {
      const [profile] = await db.select().from(authProfiles)
        .where(eq(authProfiles.id, body.authProfileId))
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
    const [run] = await db.select().from(testRuns).where(eq(testRuns.id, req.params.runId))
    if (!run) return reply.code(404).send({ error: 'Run not found' })

    // Reconstruct narrations from persisted steps so the run viewer can display them
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

    // Read the final saved screenshot from disk (base64 PNG)
    let lastScreenshotDataUrl = ''
    try {
      const screenshotPath = path.join(config.localStoragePath, `screenshot-${run.id}.png`)
      const buf = await fs.readFile(screenshotPath)
      lastScreenshotDataUrl = `data:image/png;base64,${buf.toString('base64')}`
    } catch {
      // Screenshot not available (older runs or error runs)
    }

    return { ...run, narrations, lastScreenshotDataUrl }
  })

  app.get('/', async () => {
    return db.select().from(testRuns).orderBy(desc(testRuns.startedAt)).limit(50)
  })

  app.get<{ Params: { runId: string } }>('/:runId/export', async (req, reply) => {
    const [run] = await db.select().from(testRuns).where(eq(testRuns.id, req.params.runId))
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
}
