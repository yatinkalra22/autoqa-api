import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db'
import { tests, testRuns } from '../db/schema'
import { runQueue } from '../services/queue/jobs'
import { eq, desc } from 'drizzle-orm'

export const testsRouter: FastifyPluginAsync = async (app) => {
  app.get('/', async () => {
    const allTests = await db.select().from(tests).orderBy(desc(tests.createdAt))
    const enriched = await Promise.all(allTests.map(async (t) => {
      const [lastRun] = await db.select().from(testRuns)
        .where(eq(testRuns.testId, t.id))
        .orderBy(desc(testRuns.startedAt))
        .limit(1)
      return { ...t, lastRun: lastRun || null }
    }))
    return enriched
  })

  app.post<{ Params: { id: string } }>('/:id/run', async (req, reply) => {
    const [test] = await db.select().from(tests).where(eq(tests.id, req.params.id))
    if (!test) return reply.code(404).send({ error: 'Test not found' })

    const [run] = await db.insert(testRuns).values({
      testId: test.id,
      prompt: test.prompt,
      targetUrl: test.targetUrl,
      status: 'QUEUED',
      triggeredBy: 'manual',
    }).returning()

    await runQueue.add('execute-test', {
      runId: run.id,
      targetUrl: test.targetUrl,
      prompt: test.prompt,
      maxSteps: test.maxSteps || 20,
    })

    return { runId: run.id }
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    await db.delete(tests).where(eq(tests.id, req.params.id))
    return reply.code(204).send()
  })
}
