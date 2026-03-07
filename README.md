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

## Deployment

```bash
# Build Docker image
docker build -t autoqa-api .

# Or deploy to Railway
railway up
```
