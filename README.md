# AutoQA API

> Backend for AutoQA - AI-powered browser testing agent. Powered by Gemini 2.0 Flash + Playwright.

## Tech Stack

| Layer | Technology |
|-------|------------|
| HTTP | Fastify 5 + TypeScript |
| AI | Google Gemini 2.0 Flash (Vision) |
| Browser | Playwright (Chromium) |
| Queue | BullMQ + Redis |
| Database | PostgreSQL + Drizzle ORM |
| Images | Sharp (screenshot annotation) |

## Quick Start

```bash
# 1. Start infrastructure
docker-compose up -d

# 2. Install dependencies
pnpm install

# 3. Configure environment
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY from https://aistudio.google.com/

# 4. Install Playwright browsers
npx playwright install chromium

# 5. Generate and run database migrations
pnpm db:generate
pnpm db:migrate

# 6. Start development server
pnpm dev
```

The API runs on `http://localhost:3001`.

## API Endpoints

```
GET  /health                    Health check
POST /api/runs                  Start a new test run
GET  /api/runs                  List recent runs
GET  /api/runs/:id              Get run status
GET  /api/runs/:id/export       Export run as Playwright test code
GET  /api/tests                 List saved tests
POST /api/tests/:id/run         Re-run a saved test
DELETE /api/tests/:id           Delete a saved test
POST /api/suggest               AI-generated test suggestions
POST /api/a11y                  Accessibility audit (Gemini Vision)
POST /api/compare               Visual regression (compare two runs)
GET  /api/settings/webhooks     Get notification webhook config
PUT  /api/settings/webhooks     Update notification webhooks
POST /api/webhooks/ci           CI/CD webhook trigger
GET  /api/reports/:id           View HTML report
WS   /ws/runs/:id               Real-time run updates
```

## Architecture

```
User Prompt -> Fastify API -> BullMQ Queue
                                  |
                          Playwright Browser
                          (takes screenshots)
                                  |
                        Gemini Vision API
                        (plans next action)
                                  |
                     Execute action at coordinates
                     (no HTML selectors needed)
                                  |
                    Validate result visually
                    Generate annotated report
```

### How the AI Agent Works

AutoQA uses a **vision-first agentic loop** — no DOM parsing, no CSS selectors. The AI sees the page as a human would and decides what to do next.

#### Step-by-step execution flow:

1. **Navigate** — Playwright opens the target URL in a headless Chromium browser.
2. **Screenshot** — A full-page screenshot is captured after every action.
3. **Plan** (Gemini Vision) — The planner AI receives the screenshot + test goal + action history, and returns the next action as structured JSON (`click`, `type`, `scroll`, `pressKey`, `wait`, `navigate`, or `done`).
4. **Detect** (Gemini Vision) — For actions that target an element (click, type, hover), a second AI call locates the element's bounding box on the screenshot. If detection fails, the system retries once with a fresh screenshot.
5. **Execute** — Playwright performs the action at the detected coordinates (mouse click, keyboard type, etc.).
6. **Verify** (Gemini Vision) — For `type` and `click` actions, the AI compares before/after screenshots to confirm the action actually took effect (e.g., text appeared in the input, page changed after click). If verification fails, the step is marked as failed with a diagnostic message.
7. **Repeat** — Steps 2–6 repeat until the AI signals `done` or the step limit is reached.
8. **Validate** (Gemini Vision) — A final AI call reviews the last screenshots and step history to determine PASS / FAIL / INCONCLUSIVE.
8. **Report** — An annotated HTML report is generated with screenshots, step details, and AI summary.

#### Key design decisions:

- **Coordinate-based interaction** — Actions are performed at pixel coordinates, not CSS selectors. This means AutoQA works on any web app without needing access to source code or a test framework.
- **Automatic test data generation** — When a test goal mentions "wrong password" or "invalid credentials", the AI generates appropriate fake data (e.g., `testuser@example.com`, `WrongPass123!`). No hardcoded test fixtures needed.
- **Retry on detection failure** — If element detection fails or returns low confidence, the system waits 1 second, takes a fresh screenshot, and retries before marking the step as failed.
- **Robust action execution** — Type actions use triple-click-to-select + backspace to clear existing input before typing. Actions properly fail when coordinates or values are missing (no silent false-positives).
- **Self-verification** — After every `type` and `click` action, the AI compares before/after screenshots to confirm the action took effect. This catches cases where a click missed its target or text wasn't entered into the right field.
- **Rate limiting** — Gemini API calls are rate-limited via a token bucket to stay within API quotas.

### Service Map

```
src/
├── services/
│   ├── gemini/
│   │   ├── client.ts        # Gemini API client (model config, screenshot encoding)
│   │   ├── planner.ts       # Plans next browser action from screenshot + goal
│   │   ├── detector.ts      # Locates UI elements by bounding box
│   │   ├── validator.ts     # Evaluates test pass/fail from screenshots
│   │   ├── suggester.ts     # Suggests tests for a given URL
│   │   ├── verifier.ts      # Post-action self-verification (before/after comparison)
│   │   ├── a11yAuditor.ts   # WCAG 2.1 accessibility audit
│   │   ├── visualDiff.ts    # Screenshot comparison for visual regression
│   │   └── rateLimiter.ts   # Token bucket rate limiter for API calls
│   ├── playwright/
│   │   └── engine.ts        # Browser pool, screenshot capture, action execution
│   ├── queue/
│   │   ├── jobs.ts          # BullMQ job definitions
│   │   ├── worker.ts        # Main test execution loop (orchestrates everything)
│   │   └── redis.ts         # Redis connection
│   ├── reporter/
│   │   ├── html.ts          # HTML report generation
│   │   └── annotator.ts     # Screenshot annotation with bounding boxes
│   └── exporter/            # Playwright code export
├── routes/
│   ├── runs.ts              # Test run CRUD + execution trigger
│   ├── tests.ts             # Saved test management
│   └── webhooks.ts          # Webhook/notification settings
├── ws/
│   └── runSocket.ts         # WebSocket server for real-time updates
├── db/                      # Drizzle ORM schema + connection
├── config.ts                # Environment config
└── index.ts                 # Fastify server entry point
```

## Deployment

```bash
# Build Docker image
docker build -t autoqa-api .

# Or deploy to Railway
railway up
```
