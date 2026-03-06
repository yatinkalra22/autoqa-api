import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db'
import { tests, testRuns } from '../db/schema'
import { runQueue } from '../services/queue/jobs'
import { eq } from 'drizzle-orm'

const webhookSchema = z.object({
  suiteId: z.string().uuid(),
  token: z.string(),
  branch: z.string().optional(),
  commit: z.string().optional(),
  environment: z.string().optional(),
})

export const webhooksRouter: FastifyPluginAsync = async (app) => {
  app.post<{ Body: z.infer<typeof webhookSchema> }>('/ci', async (req, reply) => {
    const body = webhookSchema.parse(req.body)

    if (body.token !== process.env.WEBHOOK_SECRET) {
      return reply.code(401).send({ error: 'Invalid token' })
    }

    const suiteTests = await db.select().from(tests).where(eq(tests.suiteId, body.suiteId))
    if (suiteTests.length === 0) {
      return reply.code(404).send({ error: 'Suite not found or empty' })
    }

    const runIds: string[] = []
    for (const test of suiteTests) {
      const [run] = await db.insert(testRuns).values({
        testId: test.id,
        prompt: test.prompt,
        targetUrl: test.targetUrl,
        status: 'QUEUED',
        triggeredBy: 'ci',
      }).returning()

      await runQueue.add('execute-test', {
        runId: run.id,
        targetUrl: test.targetUrl,
        prompt: test.prompt,
        maxSteps: test.maxSteps || 20,
      })

      runIds.push(run.id)
    }

    return {
      status: 'queued',
      runIds,
      totalTests: suiteTests.length,
      message: `${suiteTests.length} tests queued from ${body.branch || 'unknown branch'}`,
    }
  })
}
