import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db'
import { tests, testRuns, authProfiles } from '../db/schema'
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

    // Resolve auth profile if the test has one linked
    let auth: { loginUrl: string; credentials: Array<{ field: string; value: string }>; submitButton?: string } | undefined
    if (test.authProfileId) {
      const [profile] = await db.select().from(authProfiles).where(eq(authProfiles.id, test.authProfileId))
      if (profile) {
        auth = {
          loginUrl: profile.loginUrl,
          credentials: profile.credentials as any,
          submitButton: profile.submitButton || undefined,
        }
      }
    }

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
      auth,
    })

    return { runId: run.id }
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    await db.delete(tests).where(eq(tests.id, req.params.id))
    return reply.code(204).send()
  })
}
