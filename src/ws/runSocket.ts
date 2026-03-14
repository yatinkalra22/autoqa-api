import type { FastifyRequest } from 'fastify'
import type { RawData, WebSocket } from 'ws'

export type WSMessage =
  | { type: 'run_started'; runId: string }
  | { type: 'step_start'; step: number; action: string; target: string; reasoning: string; narration: string }
  | { type: 'step_complete'; step: number; success: boolean; screenshotDataUrl: string; annotation?: any }
  | { type: 'validation'; passed: boolean; message: string }
  | { type: 'run_complete'; status: string; summary: string; reportUrl: string; durationMs: number }
  | { type: 'error'; message: string; step?: number }
  | { type: 'ping' }

const rooms = new Map<string, Set<WebSocket>>()

export async function runSocketHandler(
  ws: WebSocket,
  req: FastifyRequest<{ Params: { runId: string } }>
) {
  const runId = req.params.runId

  if (!rooms.has(runId)) rooms.set(runId, new Set())
  rooms.get(runId)!.add(ws)

  ws.on('message', (data: RawData) => {
    try {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }))
    } catch {}
  })

  ws.on('close', () => {
    rooms.get(runId)?.delete(ws)
    if (rooms.get(runId)?.size === 0) rooms.delete(runId)
  })

  ws.on('error', () => {
    rooms.get(runId)?.delete(ws)
  })
}

export async function broadcastToRun(runId: string, message: WSMessage): Promise<void> {
  const clients = rooms.get(runId)
  if (!clients || clients.size === 0) return

  const payload = JSON.stringify(message)
  const dead: WebSocket[] = []

  for (const ws of clients) {
    try {
      if (ws.readyState === 1) {
        ws.send(payload)
      } else {
        dead.push(ws)
      }
    } catch {
      dead.push(ws)
    }
  }

  dead.forEach(ws => clients.delete(ws))
}
