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

  app.get('/ws/runs/:runId', { websocket: true }, runSocketHandler as any)

  startWorker()

  await app.listen({ port: config.port, host: '0.0.0.0' })
  app.log.info(`AutoQA API running on port ${config.port}`)
}

bootstrap().catch((err) => {
  console.error(err)
  process.exit(1)
})
