import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db'
import { testRuns, tests } from '../db/schema'
import { runQueue } from '../services/queue/jobs'
import { eq, desc } from 'drizzle-orm'
import { generatePlaywrightCode } from '../services/exporter/playwright'

const createRunSchema = z.object({
  targetUrl: z.string().url(),
  prompt: z.string().min(10).max(2000),
  maxSteps: z.number().int().min(5).max(50).default(20),
  saveTest: z.boolean().default(false),
  testName: z.string().optional(),
  testId: z.string().uuid().optional(),
})

export const runsRouter: FastifyPluginAsync = async (app) => {
  app.post<{ Body: z.infer<typeof createRunSchema> }>('/', async (req, reply) => {
    const body = createRunSchema.parse(req.body)

    const url = new URL(body.targetUrl)
    const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '::1']
    const blockedPrefixes = ['10.', '192.168.', '172.16.']
    if (blocked.includes(url.hostname) || blockedPrefixes.some(b => url.hostname.startsWith(b))) {
      return reply.code(400).send({ error: 'Internal URLs are not allowed.' })
    }

    let testId = body.testId
    if (body.saveTest && body.testName) {
      const [test] = await db.insert(tests).values({
        name: body.testName,
        prompt: body.prompt,
        targetUrl: body.targetUrl,
        maxSteps: body.maxSteps,
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

    await runQueue.add('execute-test', {
      runId: run.id,
      targetUrl: body.targetUrl,
      prompt: body.prompt,
      maxSteps: body.maxSteps,
    })

    return { runId: run.id }
  })

  app.get<{ Params: { runId: string } }>('/:runId', async (req, reply) => {
    const [run] = await db.select().from(testRuns).where(eq(testRuns.id, req.params.runId))
    if (!run) return reply.code(404).send({ error: 'Run not found' })
    return run
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
