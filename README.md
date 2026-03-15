# AutoQA API

> Backend for AutoQA — AI-powered browser testing agent. Powered by Gemini 2.5 Flash + Playwright.

## Tech Stack

| Layer | Technology |
|-------|------------|
| HTTP | Fastify 5 + TypeScript |
| Auth | Firebase Admin SDK (JWT verification) |
| AI | Google Gemini 2.5 Flash (Vision) |
| Browser | Playwright (Chromium) |
| Queue | BullMQ + Redis |
| Database | PostgreSQL + Drizzle ORM |
| Security | Helmet, rate limiting, per-user data scoping |
| Images | Sharp (screenshot annotation) |

## Quick Start

```bash
# 1. Start infrastructure
docker-compose up -d

# 2. Install dependencies
pnpm install

# 3. Configure environment
cp .env.example .env
# Edit .env — add GEMINI_API_KEY and Firebase service account

# 4. Install Playwright browsers
npx playwright install chromium

# 5. Run database migrations
pnpm db:migrate

# 6. Start development server
pnpm dev
```

The API runs on `http://localhost:3001`.

### Firebase Setup

The API verifies Firebase ID tokens from the frontend. You need to provide Firebase Admin credentials via one of:

1. **Service account JSON** (recommended for local dev):
   ```
   FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"..."}
   ```

2. **Project ID only** (for Cloud Run/GCE with Application Default Credentials):
   ```
   FIREBASE_PROJECT_ID=your-firebase-project-id
   ```

3. **Service account file path**:
   ```
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
   ```

## Security

### Authentication
- All API endpoints (except `/health` and `/api/shared/:id`) require a valid Firebase JWT in the `Authorization: Bearer <token>` header
- Tokens are verified server-side using Firebase Admin SDK
- Expired tokens return `401` with a descriptive message

### Authorization (Per-User Data Scoping)
- Every database table includes a `user_id` column
- All queries filter by the authenticated user's UID
- Users can only access their own runs, tests, auth profiles, and webhooks
- Shared reports are the only cross-user data access point (read-only)

### Security Headers
- HTTP security headers via `@fastify/helmet` (HSTS, X-Frame-Options, X-Content-Type-Options, etc.)
- Rate limiting via `@fastify/rate-limit` (100 req/min per user)

### Data Protection
- Auth profile credentials with password fields are masked in list responses
- Full credentials are only returned for single-profile lookups by the owner
- Shared reports expose only sanitized run data (no userId, no error internals)

## API Endpoints

All endpoints except `/health` and `/api/shared/:id` require `Authorization: Bearer <firebase-jwt>`.

```
GET  /health                      Health check (public)
POST /api/runs                    Start a new test run
GET  /api/runs                    List your recent runs
GET  /api/runs/:id                Get run details (yours only)
GET  /api/runs/:id/export         Export as Playwright code
POST /api/runs/:id/share          Create a shareable link
GET  /api/shared/:id              View shared report (public)
GET  /api/tests                   List your saved tests
POST /api/tests/:id/run           Re-run a saved test
DELETE /api/tests/:id             Delete a saved test
GET  /api/auth-profiles           List your auth profiles
GET  /api/auth-profiles/:id       Get profile with credentials
POST /api/auth-profiles           Create auth profile
PUT  /api/auth-profiles/:id       Update auth profile
DELETE /api/auth-profiles/:id     Delete auth profile
GET  /api/auth-profiles/match     Find profiles by domain
POST /api/suggest                 AI test suggestions
POST /api/a11y                    Accessibility audit
POST /api/compare                 Visual regression comparison
GET  /api/settings/webhooks       Get your webhook config
PUT  /api/settings/webhooks       Update your webhooks
POST /api/webhooks/ci             CI/CD webhook trigger
GET  /api/reports/:id             View HTML report (yours only)
WS   /ws/runs/:id                 Real-time run updates
```

## Architecture

```
User (Firebase JWT)
    → Fastify API (auth middleware verifies token)
        → User-scoped DB queries (Drizzle + Postgres)
        → BullMQ Queue (Redis)
            → Playwright Browser (screenshots)
            → Gemini Vision API (action planning)
            → Execute action at coordinates
            → Validate result visually
            → Generate annotated report
        → WebSocket broadcast (real-time updates)
```

### Service Map

```
src/
├── middleware/
│   └── firebaseAuth.ts     # JWT verification, requireAuth/optionalAuth hooks
├── routes/
│   ├── runs.ts             # Test runs (user-scoped CRUD + share)
│   ├── tests.ts            # Saved tests (user-scoped CRUD)
│   ├── authProfiles.ts     # Auth profiles (user-scoped CRUD)
│   └── webhooks.ts         # CI webhook trigger
├── services/
│   ├── gemini/             # AI vision services (planner, detector, validator, etc.)
│   ├── playwright/         # Browser pool, screenshot capture, action execution
│   ├── queue/              # BullMQ jobs + worker (main test execution loop)
│   ├── auth/               # Session caching for login automation
│   ├── reporter/           # HTML report + screenshot annotation
│   ├── exporter/           # Playwright code export
│   └── notifier.ts         # Per-user webhook notifications (DB-backed)
├── ws/
│   └── runSocket.ts        # WebSocket for real-time updates
├── db/
│   ├── schema.ts           # Drizzle schema (with userId columns)
│   ├── migrations/         # SQL migrations
│   └── index.ts            # DB connection
├── config.ts               # Environment config (Zod validated)
└── index.ts                # Server entry point (Fastify + plugins)
```

## Database Migration

After adding auth columns:

```bash
pnpm db:migrate
```

This runs migration `0003_add_auth_columns.sql` which:
- Adds `user_id` to `tests`, `test_runs`, and `auth_profiles`
- Creates `shared_reports` table for public report sharing
- Creates `user_webhooks` table (replaces in-memory storage)
- Adds indexes for efficient user-scoped queries

## Deployment

```bash
# Build Docker image
docker build -t autoqa-api .

# Or deploy to Railway
railway up
```

Set these environment variables in production:
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `GEMINI_API_KEY` — Google Gemini API key
- `FIREBASE_SERVICE_ACCOUNT_KEY` or `FIREBASE_PROJECT_ID`
- `CORS_ORIGINS` — Frontend URL(s)
- `WEBHOOK_SECRET` — For CI webhook authentication
