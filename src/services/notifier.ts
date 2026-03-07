interface NotifyPayload {
  runId: string
  status: 'PASS' | 'FAIL' | 'ERROR'
  prompt: string
  targetUrl: string
  summary: string | null
  durationMs: number | null
  reportUrl: string | null
  stepsCount: number
}

interface WebhookConfig {
  url: string
  type: 'slack' | 'generic'
}

// In-memory config (persists for server lifetime; could be moved to DB)
let webhooks: WebhookConfig[] = []

export function getWebhooks() {
  return webhooks
}

export function setWebhooks(configs: WebhookConfig[]) {
  webhooks = configs
}

export async function notifyRunComplete(payload: NotifyPayload) {
  if (webhooks.length === 0) return

  await Promise.allSettled(
    webhooks.map(wh => sendWebhook(wh, payload))
  )
}

async function sendWebhook(wh: WebhookConfig, payload: NotifyPayload) {
  const body = wh.type === 'slack'
    ? buildSlackPayload(payload)
    : buildGenericPayload(payload)

  await fetch(wh.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })
}

function buildSlackPayload(p: NotifyPayload) {
  const emoji = p.status === 'PASS' ? ':white_check_mark:' : p.status === 'FAIL' ? ':x:' : ':warning:'
  const color = p.status === 'PASS' ? '#16a34a' : '#dc2626'

  return {
    attachments: [
      {
        color,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${emoji} *AutoQA Test ${p.status}*\n*URL:* ${p.targetUrl}\n*Test:* ${p.prompt.slice(0, 200)}`,
            },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Steps:* ${p.stepsCount}` },
              { type: 'mrkdwn', text: `*Duration:* ${p.durationMs ? `${(p.durationMs / 1000).toFixed(1)}s` : 'N/A'}` },
            ],
          },
          ...(p.summary ? [{
            type: 'section',
            text: { type: 'mrkdwn', text: `*Summary:* ${p.summary.slice(0, 500)}` },
          }] : []),
          ...(p.reportUrl ? [{
            type: 'actions',
            elements: [{
              type: 'button',
              text: { type: 'plain_text', text: 'View Report' },
              url: p.reportUrl,
            }],
          }] : []),
        ],
      },
    ],
  }
}

function buildGenericPayload(p: NotifyPayload) {
  return {
    event: 'test_complete',
    ...p,
    timestamp: new Date().toISOString(),
  }
}
