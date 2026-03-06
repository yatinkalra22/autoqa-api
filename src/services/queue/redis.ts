import IORedis from 'ioredis'
import { config } from '../../config'

export const redis = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
})

redis.on('error', (err) => console.error('Redis error:', err))
redis.on('connect', () => console.info('Redis connected'))
