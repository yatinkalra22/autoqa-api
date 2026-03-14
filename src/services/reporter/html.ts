import * as fs from 'fs/promises'
import * as path from 'path'
import { config } from '../../config'

interface StepRecord {
  step: number
  action: string
  target: string
  value?: string
  narration: string
  reasoning: string
  success: boolean
  durationMs: number
}

interface ReportOptions {
  prompt: string
  targetUrl: string
  status: 'PASS' | 'FAIL' | 'ERROR'
  steps: StepRecord[]
  screenshots: string[]
  summary: string
  durationMs: number
}

export async function generateReport(runId: string, opts: ReportOptions): Promise<string> {
  const { prompt, targetUrl, status, steps, screenshots, summary, durationMs } = opts

  const isPassed = status === 'PASS'
  const statusLabel = isPassed ? 'PASS' : status === 'ERROR' ? 'ERROR' : 'FAIL'
  const statusColor  = isPassed ? '#21714b' : '#b13a3a'
  const statusBg     = isPassed ? '#d4f0e3' : '#fde8e8'
  const statusBorder = isPassed ? '#86d4b0' : '#e7a8a8'
  const stepBorder   = (ok: boolean) => ok ? '#86d4b0' : '#e7a8a8'
  const stepBadgeColor = (ok: boolean) => ok ? '#21714b' : '#b13a3a'
  const stepBadgeBg    = (ok: boolean) => ok ? '#d4f0e3' : '#fde8e8'
  const date = new Date().toLocaleString()

  const stepsHtml = steps.map((s, i) => {
    const screenshot = screenshots[i + 1]
    const screenshotTag = screenshot
      ? `<img src="data:image/png;base64,${screenshot}" style="width:100%;border-radius:10px;margin-top:14px;border:1px solid #b9cbe8;" alt="Step ${s.step}" />`
      : ''

    return `
    <div style="background:#ffffff;border:1px solid #b9cbe8;border-radius:12px;padding:16px;margin-bottom:14px;border-left:3px solid ${stepBorder(s.success)}">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap;">
        <span style="background:#D6E3F8;color:#1d2e4c;padding:2px 9px;border-radius:5px;font-size:11px;font-weight:700;letter-spacing:0.04em;">Step ${s.step}</span>
        <span style="background:${stepBadgeBg(s.success)};color:${stepBadgeColor(s.success)};padding:2px 8px;border-radius:5px;font-size:11px;font-weight:700;">${s.success ? 'OK' : 'FAIL'}</span>
        <span style="color:#1d2e4c;font-weight:500;flex:1;font-size:14px;">${escapeHtml(s.action)} &ldquo;${escapeHtml(s.target)}&rdquo;${s.value ? ` <span style="color:#4d5f7c;font-size:12px;background:#edf3fd;padding:2px 8px;border-radius:4px;margin-left:6px;">value: &ldquo;${escapeHtml(s.value)}&rdquo;</span>` : ''}</span>
        <span style="color:#4d5f7c;font-size:12px;">${s.durationMs}ms</span>
      </div>
      <div style="color:#1d2e4c;font-size:14px;margin-bottom:4px;">${escapeHtml(s.narration)}</div>
      <div style="color:#4d5f7c;font-size:12px;font-style:italic;">${escapeHtml(s.reasoning)}</div>
      ${screenshotTag}
    </div>`
  }).join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AutoQA Report — ${statusLabel}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Inter, -apple-system, sans-serif;
    background: linear-gradient(180deg, #f7faff 0%, #D6E3F8 60%, #c8d9f5 100%);
    min-height: 100vh;
    color: #1d2e4c;
    line-height: 1.6;
    padding: 36px 16px 60px;
  }
  .container { max-width: 900px; margin: 0 auto; }
  img { max-width: 100%; display: block; }
</style>
</head>
<body>
<div class="container">

  <!-- Header bar -->
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:28px;">
    <div style="width:34px;height:34px;background:#EE964B;border-radius:9px;display:flex;align-items:center;justify-content:center;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
    </div>
    <span style="font-size:18px;font-weight:700;color:#1d2e4c;">AutoQA</span>
    <span style="margin-left:auto;font-size:12px;color:#4d5f7c;">${date}</span>
  </div>

  <!-- Run card -->
  <div style="background:#ffffff;border:1px solid #b9cbe8;border-radius:18px;padding:26px;margin-bottom:22px;box-shadow:0 4px 24px -8px rgba(100,130,180,0.13);">
    <span style="display:inline-flex;align-items:center;gap:7px;padding:5px 16px;border-radius:999px;font-weight:700;font-size:13px;background:${statusBg};color:${statusColor};border:1px solid ${statusBorder};margin-bottom:14px;">
      ${statusLabel}
    </span>
    <h1 style="font-size:22px;font-weight:700;color:#1d2e4c;margin-bottom:10px;">AutoQA Report</h1>
    <div style="display:flex;gap:18px;color:#4d5f7c;font-size:13px;flex-wrap:wrap;margin-bottom:14px;">
      <span>🌐 ${escapeHtml(targetUrl)}</span>
      <span>⏱ ${(durationMs / 1000).toFixed(1)}s</span>
      <span>📋 ${steps.length} steps</span>
    </div>
    <div style="padding:13px 16px;background:#edf3fd;border-radius:10px;border:1px solid #b9cbe8;color:#1d2e4c;font-size:14px;">
      &ldquo;${escapeHtml(prompt)}&rdquo;
    </div>
  </div>

  <!-- AI Summary -->
  <div style="background:#ffffff;border:1px solid #b9cbe8;border-radius:14px;padding:20px;margin-bottom:24px;box-shadow:0 2px 12px -4px rgba(100,130,180,0.10);">
    <h2 style="color:#4d5f7c;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:10px;">AI Summary</h2>
    <p style="color:#1d2e4c;font-size:14px;line-height:1.7;">${escapeHtml(summary)}</p>
  </div>

  <!-- Steps -->
  <h2 style="color:#4d5f7c;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:14px;">Execution Steps</h2>
  ${stepsHtml}

  <div style="margin-top:36px;text-align:center;color:#4d5f7c;font-size:12px;">
    Generated by <strong>AutoQA</strong> &middot; Run ID: <code style="background:#D6E3F8;padding:1px 6px;border-radius:4px;">${runId}</code>
  </div>

</div>
</body>
</html>`

  const reportDir = config.localStoragePath
  await fs.mkdir(reportDir, { recursive: true })
  const filename = `report-${runId}.html`
  await fs.writeFile(path.join(reportDir, filename), html, 'utf8')

  return `/api/reports/${runId}`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
