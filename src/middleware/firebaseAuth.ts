import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth'
import type { FastifyRequest, FastifyReply } from 'fastify'

// Initialize Firebase Admin SDK
// Priority: FIREBASE_PROJECT_ID (simplest) > FIREBASE_SERVICE_ACCOUNT_KEY (JSON string) > ADC
if (getApps().length === 0) {
  if (process.env.FIREBASE_PROJECT_ID) {
    // Simplest setup — just needs the project ID to verify tokens
    initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID })
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
    try {
      // Try parsing as inline JSON (must be single-line in .env)
      const parsed = JSON.parse(raw)
      initializeApp({ credential: cert(parsed) })
    } catch {
      // Treat as file path to a JSON file
      initializeApp({ credential: cert(raw) })
    }
  } else {
    // Fall back to application default credentials (GOOGLE_APPLICATION_CREDENTIALS)
    initializeApp()
  }
}

const firebaseAuth = getAuth()

export interface AuthenticatedUser {
  uid: string
  email: string | undefined
  name: string | undefined
  picture: string | undefined
}

// Augment FastifyRequest with user property
declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser
  }
}

/**
 * Fastify preHandler hook that verifies Firebase ID tokens.
 * Attaches the decoded user to `request.user`.
 * Returns 401 if the token is missing or invalid.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Authentication required' })
  }

  const token = authHeader.slice(7)
  if (!token) {
    return reply.code(401).send({ error: 'Authentication required' })
  }

  try {
    const decoded: DecodedIdToken = await firebaseAuth.verifyIdToken(token)
    request.user = {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      picture: decoded.picture,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid token'
    // Distinguish expired vs invalid
    if (message.includes('expired')) {
      return reply.code(401).send({ error: 'Token expired. Please sign in again.' })
    }
    return reply.code(401).send({ error: 'Invalid authentication token' })
  }
}

/**
 * Optional auth — attaches user if token is present but doesn't block if missing.
 * Useful for endpoints that work for both authenticated and anonymous users (e.g. shared reports).
 */
export async function optionalAuth(request: FastifyRequest, _reply: FastifyReply) {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return

  const token = authHeader.slice(7)
  if (!token) return

  try {
    const decoded: DecodedIdToken = await firebaseAuth.verifyIdToken(token)
    request.user = {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      picture: decoded.picture,
    }
  } catch {
    // Silently ignore — user remains undefined
  }
}
