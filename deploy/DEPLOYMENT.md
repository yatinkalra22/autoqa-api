# AutoQA API — Deployment Guide

Complete guide for deploying AutoQA API to Google Cloud Platform using Cloud Run and Cloud SQL.

## Architecture Overview

```
┌─────────────────┐     HTTPS      ┌─────────────────────┐
│   Vercel (FE)   │ ──────────────→│   Cloud Run (API)   │
│   Next.js App   │                │   Fastify + PW      │
└─────────────────┘                └────────┬────────────┘
                                            │ Unix Socket
                                   ┌────────▼────────────┐
                                   │   Cloud SQL          │
                                   │   PostgreSQL 16      │
                                   └─────────────────────┘
```

**GCP Services Used:**

| Service | Purpose | Cost Tier |
|---------|---------|-----------|
| Cloud Run | API server with Playwright/Chromium | Pay-per-use (scales to zero) |
| Cloud SQL | Managed PostgreSQL 16 | db-f1-micro (~$7/mo) |
| Artifact Registry | Docker image storage | Free tier covers it |
| Secret Manager | API keys, DB credentials | Free for < 10k accesses/mo |
| Cloud Build | CI/CD pipeline | 120 free build-minutes/day |

## Prerequisites

1. **Google Cloud SDK** installed and authenticated:
   ```bash
   # Install: https://cloud.google.com/sdk/docs/install
   gcloud auth login
   gcloud auth application-default login
   ```

2. **A GCP project** with billing enabled

3. **API keys ready:**
   - Gemini API key (from [Google AI Studio](https://aistudio.google.com/apikey))
   - Firebase project ID (from [Firebase Console](https://console.firebase.google.com))

## Step 0: Create Deploy Config

```bash
cp .deploy.env.example .deploy.env
```

Edit `.deploy.env` with your values:
```
GCP_PROJECT_ID=auto-qa-6468c       # Your Firebase/GCP project ID
GCP_REGION=us-central1             # GCP region
FRONTEND_URL=https://your-app.vercel.app
```

This file is gitignored — your project ID and config stay local.

## Step 1: Provision Infrastructure

```bash
./deploy/gcp-setup.sh
```

This creates:
- Artifact Registry repository for Docker images
- Cloud SQL PostgreSQL 16 instance (private IP, no public access)
- Database user with auto-generated password (stored in Secret Manager)
- Secrets for Gemini API key and Firebase project ID (prompts you for values)
- IAM bindings so Cloud Run can access secrets and Cloud SQL

## Step 2: Create Database URL Secret

```bash
./deploy/create-db-url-secret.sh
```

This constructs the `DATABASE_URL` using the Cloud SQL Unix socket path format that Cloud Run requires, and stores it in Secret Manager.

## Step 3: Run Database Migrations

```bash
./deploy/migrate.sh
```

This starts a local Cloud SQL Auth Proxy, connects to the production database, and runs all Drizzle migrations.

## Step 4: Build and Deploy

```bash
# Set your frontend URL for CORS
export FRONTEND_URL=https://your-app.vercel.app

./deploy/deploy.sh
```

This builds the Docker image via Cloud Build, pushes it to Artifact Registry, and deploys to Cloud Run with all secrets and Cloud SQL connection configured.

The script outputs the service URL when complete.

## CI/CD (Automatic Deployments)

The `cloudbuild.yaml` in the project root defines a Cloud Build pipeline that automatically builds and deploys on every push to `main`.

### Setup GitHub trigger:

```bash
gcloud builds triggers create github \
  --repo-name=autoqa-api \
  --repo-owner=YOUR_GITHUB_USERNAME \
  --branch-pattern="^main$" \
  --build-config=cloudbuild.yaml \
  --project=your-project-id
```

After this, every push to `main` will:
1. Build the Docker image
2. Push to Artifact Registry (tagged with commit SHA)
3. Deploy to Cloud Run

## Frontend Deployment (Vercel)

After the backend is deployed, update your frontend environment:

```bash
# In your autoqa-web project
echo "NEXT_PUBLIC_API_URL=https://autoqa-api-xxxxx.run.app" >> .env.local
echo "NEXT_PUBLIC_WS_URL=wss://autoqa-api-xxxxx.run.app" >> .env.local
```

Deploy via Vercel:
```bash
# Option 1: Vercel CLI
npx vercel --prod

# Option 2: Connect GitHub repo in Vercel dashboard
# vercel.com → Import Project → Select autoqa-web repo
```

Set these environment variables in Vercel project settings:
- `NEXT_PUBLIC_API_URL` — Cloud Run service URL
- `NEXT_PUBLIC_WS_URL` — Same URL but with `wss://` protocol
- `NEXT_PUBLIC_FIREBASE_API_KEY` — From Firebase Console
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` — From Firebase Console
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID` — From Firebase Console

## Configuration Reference

### Cloud Run Settings

| Setting | Value | Reason |
|---------|-------|--------|
| CPU | 2 vCPU | Playwright needs CPU for browser rendering |
| Memory | 2 GiB | Chromium is memory-hungry |
| Min instances | 0 | Scale to zero when idle (saves cost) |
| Max instances | 3 | Limits concurrent browser sessions |
| Timeout | 300s | Long-running test executions |
| Concurrency | 10 | Requests per instance |
| Port | 8080 | Cloud Run standard |

### Cloud SQL Settings

| Setting | Value |
|---------|-------|
| Version | PostgreSQL 16 |
| Tier | db-f1-micro (upgrade for production traffic) |
| Public IP | Disabled (private only) |
| Storage | Auto-increase enabled |

### Secrets (in Secret Manager)

| Secret Name | Content |
|-------------|---------|
| `autoqa-db-password` | Auto-generated DB password |
| `autoqa-database-url` | Full PostgreSQL connection string |
| `autoqa-gemini-key` | Gemini API key |
| `autoqa-firebase-project-id` | Firebase project ID |

## Troubleshooting

### View Cloud Run logs
```bash
gcloud run services logs read autoqa-api --region=us-central1 --limit=50
```

### Connect to production database locally
```bash
# Start proxy
cloud-sql-proxy YOUR_CONNECTION_NAME --port=15432

# Connect via psql
psql "postgresql://autoqa:PASSWORD@localhost:15432/autoqa"
```

### Force redeploy
```bash
IMAGE_TAG=latest ./deploy/deploy.sh
```

### Check service health
```bash
curl https://autoqa-api-xxxxx.run.app/health
```

## Cost Estimate

For light usage (< 100 test runs/day):

| Service | Monthly Cost |
|---------|-------------|
| Cloud Run | ~$0–5 (scales to zero) |
| Cloud SQL (db-f1-micro) | ~$7 |
| Artifact Registry | ~$0 (free tier) |
| Secret Manager | ~$0 (free tier) |
| Cloud Build | ~$0 (120 free min/day) |
| **Total** | **~$7–12/mo** |
