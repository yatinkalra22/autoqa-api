import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyWebsocket from '@fastify/websocket'
import * as fs from 'fs/promises'
import * as path from 'path'
import { config } from './config'
import { redis } from './services/queue/redis'
import { startWorker } from './services/queue/worker'
import { runsRouter } from './routes/runs'
import { testsRouter } from './routes/tests'
import { webhooksRouter } from './routes/webhooks'
import { runSocketHandler } from './ws/runSocket'
import { suggestTests } from './services/gemini/suggester'
import { auditAccessibility } from './services/gemini/a11yAuditor'
import { compareScreenshots } from './services/gemini/visualDiff'
import { browserPool, captureScreenshot } from './services/playwright/engine'
import { getWebhooks, setWebhooks } from './services/notifier'

const app = Fastify({
  logger: {
    transport: config.isDev
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  },
})

async function bootstrap() {
  await app.register(fastifyCors, { origin: config.corsOrigins })
  await app.register(fastifyWebsocket)

  app.get('/health', async () => ({
    status: 'ok',
    version: '1.0.0',
    redis: redis.status === 'ready' ? 'connected' : 'disconnected',
  }))

  await app.register(runsRouter, { prefix: '/api/runs' })
  await app.register(testsRouter, { prefix: '/api/tests' })
  await app.register(webhooksRouter, { prefix: '/api/webhooks' })

  // Report serving
  app.get<{ Params: { runId: string } }>('/api/reports/:runId', async (req, reply) => {
    const reportPath = path.join(config.localStoragePath, `report-${req.params.runId}.html`)
    try {
      const html = await fs.readFile(reportPath, 'utf8')
      return reply.type('text/html').send(html)
    } catch {
      return reply.code(404).send('Report not found')
    }
  })

  // AI test suggestions
  app.post<{ Body: { targetUrl: string } }>('/api/suggest', async (req, reply) => {
    const { targetUrl } = req.body
    if (!targetUrl) return reply.code(400).send({ error: 'targetUrl is required' })
    try {
      const suggestions = await suggestTests(targetUrl)
      return { suggestions }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Failed to generate suggestions' })
    }
  })

  // Accessibility audit
  app.post<{ Body: { targetUrl: string } }>('/api/a11y', async (req, reply) => {
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

  // Visual regression comparison
  app.post<{ Body: { baselineRunId: string; currentRunId: string } }>('/api/compare', async (req, reply) => {
    const { baselineRunId, currentRunId } = req.body
    if (!baselineRunId || !currentRunId) {
      return reply.code(400).send({ error: 'baselineRunId and currentRunId are required' })
    }
    try {
      const baselinePath = path.join(config.localStoragePath, `screenshot-${baselineRunId}.png`)
      const currentPath = path.join(config.localStoragePath, `screenshot-${currentRunId}.png`)

      const [baselineBuffer, currentBuffer] = await Promise.all([
        fs.readFile(baselinePath),
        fs.readFile(currentPath),
      ])

      const diff = await compareScreenshots(
        baselineBuffer.toString('base64'),
        currentBuffer.toString('base64')
      )

      return {
        ...diff,
        baselineScreenshot: `data:image/png;base64,${baselineBuffer.toString('base64')}`,
        currentScreenshot: `data:image/png;base64,${currentBuffer.toString('base64')}`,
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return reply.code(404).send({ error: 'Screenshot not found for one or both runs' })
      }
      return reply.code(500).send({ error: err.message || 'Comparison failed' })
    }
  })

  // Notification webhooks settings
  app.get('/api/settings/webhooks', async () => {
    return { webhooks: getWebhooks() }
  })

  app.put<{ Body: { webhooks: Array<{ url: string; type: 'slack' | 'generic' }> } }>(
    '/api/settings/webhooks',
    async (req) => {
      const { webhooks } = req.body
      setWebhooks(webhooks || [])
      return { webhooks: getWebhooks() }
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
