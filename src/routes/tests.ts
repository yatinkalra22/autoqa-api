import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db'
import { tests, testRuns, authProfiles } from '../db/schema'
import { runQueue } from '../services/queue/jobs'
import { eq, desc, and } from 'drizzle-orm'
import { requireAuth } from '../middleware/firebaseAuth'

export const testsRouter: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get('/', async (req) => {
    const userId = req.user!.uid
    const allTests = await db.select().from(tests)
      .where(eq(tests.userId, userId))
      .orderBy(desc(tests.createdAt))
    const enriched = await Promise.all(allTests.map(async (t) => {
      const [lastRun] = await db.select().from(testRuns)
        .where(and(eq(testRuns.testId, t.id), eq(testRuns.userId, userId)))
        .orderBy(desc(testRuns.startedAt))
        .limit(1)
      return { ...t, lastRun: lastRun || null }
    }))
    return enriched
  })

  app.post<{ Params: { id: string } }>('/:id/run', async (req, reply) => {
    const userId = req.user!.uid
    const [test] = await db.select().from(tests)
      .where(and(eq(tests.id, req.params.id), eq(tests.userId, userId)))
    if (!test) return reply.code(404).send({ error: 'Test not found' })

    // Resolve auth profile if the test has one linked
    let auth: { loginUrl: string; credentials: Array<{ field: string; value: string }>; submitButton?: string } | undefined
    if (test.authProfileId) {
      const [profile] = await db.select().from(authProfiles)
        .where(and(eq(authProfiles.id, test.authProfileId), eq(authProfiles.userId, userId)))
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
      userId,
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
    const userId = req.user!.uid
    // Only delete if belongs to user
    const [test] = await db.select().from(tests)
      .where(and(eq(tests.id, req.params.id), eq(tests.userId, userId)))
    if (!test) return reply.code(404).send({ error: 'Test not found' })
    await db.delete(tests).where(eq(tests.id, req.params.id))
    return reply.code(204).send()
  })
}
