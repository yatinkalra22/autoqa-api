# AutoQA API

> Backend for AutoQA — AI-powered browser testing agent. Powered by Gemini 2.5 Flash + Playwright.

## Tech Stack

| Layer | Technology |
|-------|------------|
| HTTP | Fastify 5 + TypeScript |
| Auth | Firebase Admin SDK (JWT verification) |
| AI | Google Gemini 2.5 Flash (Vision) |
| Browser | Playwright (Chromium) |
| Queue | In-memory job queue (zero dependencies) |
| Database | PostgreSQL + Drizzle ORM |
| Security | Helmet, rate limiting, per-user data scoping |
| Images | Sharp (screenshot annotation) |
| Deploy | GCP Cloud Run + Cloud SQL |

## Quick Start

```bash
# 1. Start PostgreSQL
docker-compose up -d

# 2. Install dependencies
pnpm install

# 3. Configure environment
cp .env.example .env
# Edit .env — add GEMINI_API_KEY and FIREBASE_PROJECT_ID

# 4. Install Playwright browsers
npx playwright install chromium

# 5. Run database migrations
pnpm db:migrate

# 6. Start development server
pnpm dev
```

The API runs on the port specified in `.env` (default `3001`).

### Firebase Setup

The API verifies Firebase ID tokens from the frontend. Configure via one of:

1. **Project ID only** (simplest — works locally and on GCP):
   ```
   FIREBASE_PROJECT_ID=your-firebase-project-id
   ```

2. **Service account JSON** (for non-GCP environments):
   ```
   FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"..."}
   ```

3. **Application Default Credentials** (auto-detected on GCP):
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
        → In-memory Job Queue (concurrency-limited)
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
│   ├── queue/              # In-memory job queue + worker (main test execution loop)
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

```bash
pnpm db:migrate
```

Migrations are in `src/db/migrations/` and run automatically via Drizzle's migrator. Key migrations:
- `0003_add_auth_columns.sql` — Adds `user_id` to all tables, creates `shared_reports` and `user_webhooks` tables, adds indexes for user-scoped queries.

## Deployment

See [deploy/DEPLOYMENT.md](deploy/DEPLOYMENT.md) for the full deployment guide.

### Quick Deploy (GCP Cloud Run)

```bash
# 0. Create deploy config (one-time, gitignored)
cp .deploy.env.example .deploy.env
# Edit .deploy.env with your GCP_PROJECT_ID

# 1. Provision infrastructure (one-time)
./deploy/gcp-setup.sh

# 2. Create database URL secret (one-time)
./deploy/create-db-url-secret.sh

# 3. Run database migrations
./deploy/migrate.sh

# 4. Build and deploy
./deploy/deploy.sh
```

### CI/CD

Push to `main` triggers automatic deployment via Cloud Build. See `cloudbuild.yaml`.

### Environment Variables (Production)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `FIREBASE_PROJECT_ID` | Yes | Firebase project ID for token verification |
| `PORT` | No | Server port (default: `3001`, Cloud Run uses `8080`) |
| `CORS_ORIGINS` | No | Comma-separated frontend URLs |
| `MAX_CONCURRENT_BROWSERS` | No | Parallel browser instances (default: `3`) |
| `STORAGE_TYPE` | No | `local` or `s3` (default: `local`) |
| `WEBHOOK_SECRET` | No | For CI webhook authentication |
