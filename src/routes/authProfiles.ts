import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db'
import { authProfiles } from '../db/schema'
import { eq, desc } from 'drizzle-orm'

const profileSchema = z.object({
  name: z.string().min(1).max(100),
  domain: z.string().min(1),
  loginUrl: z.string().url(),
  credentials: z.array(z.object({
    field: z.string().min(1),
    value: z.string().min(1),
  })).min(1),
  submitButton: z.string().optional(),
})

export const authProfilesRouter: FastifyPluginAsync = async (app) => {
  // List all auth profiles
  app.get('/', async () => {
    const profiles = await db.select().from(authProfiles).orderBy(desc(authProfiles.updatedAt))
    // Mask credential values in the list response
    return profiles.map(p => ({
      ...p,
      credentials: (p.credentials as any[]).map(c => ({
        field: c.field,
        value: c.field.toLowerCase().includes('password') ? '••••••••' : c.value,
        hasValue: true,
      })),
    }))
  })

  // Get a single profile with full credentials (for use in test runs)
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const [profile] = await db.select().from(authProfiles).where(eq(authProfiles.id, req.params.id))
    if (!profile) return reply.code(404).send({ error: 'Profile not found' })
    return profile
  })

  // Create a new auth profile
  app.post<{ Body: z.infer<typeof profileSchema> }>('/', async (req) => {
    const body = profileSchema.parse(req.body)
    const [profile] = await db.insert(authProfiles).values({
      name: body.name,
      domain: body.domain,
      loginUrl: body.loginUrl,
      credentials: body.credentials as any,
      submitButton: body.submitButton || null,
    }).returning()
    return profile
  })

  // Update an auth profile
  app.put<{ Params: { id: string }; Body: z.infer<typeof profileSchema> }>('/:id', async (req, reply) => {
    const body = profileSchema.parse(req.body)
    const [updated] = await db.update(authProfiles).set({
      name: body.name,
      domain: body.domain,
      loginUrl: body.loginUrl,
      credentials: body.credentials as any,
      submitButton: body.submitButton || null,
      updatedAt: new Date(),
    }).where(eq(authProfiles.id, req.params.id)).returning()
    if (!updated) return reply.code(404).send({ error: 'Profile not found' })
    return updated
  })

  // Delete an auth profile
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    await db.delete(authProfiles).where(eq(authProfiles.id, req.params.id))
    return reply.code(204).send()
  })

  // Find profiles matching a domain
  app.get<{ Querystring: { domain: string } }>('/match', async (req) => {
    const { domain } = req.query
    if (!domain) return []
    const all = await db.select().from(authProfiles)
    // Match by domain substring (e.g., "example.com" matches "app.example.com")
    const matches = all.filter(p =>
      domain.includes(p.domain) || p.domain.includes(domain)
    )
    return matches.map(p => ({
      ...p,
      credentials: (p.credentials as any[]).map(c => ({
        field: c.field,
        value: c.field.toLowerCase().includes('password') ? '••••••••' : c.value,
        hasValue: true,
      })),
    }))
  })
}
