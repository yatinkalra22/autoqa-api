#!/usr/bin/env bash
# =============================================================================
# AutoQA API — Build & Deploy to Cloud Run
# =============================================================================
# Builds the Docker image via Cloud Build and deploys to Cloud Run.
#
# Usage:
#   chmod +x deploy/deploy.sh
#   ./deploy/deploy.sh
# =============================================================================

set -euo pipefail

# Load config from .deploy.env
source "$(dirname "$0")/_config.sh"

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PROJECT_ID="${GCP_PROJECT_ID}"
REGION="${GCP_REGION}"
SERVICE_NAME="autoqa-api"
REPO_NAME="autoqa"
DB_INSTANCE_NAME="autoqa-db"
IMAGE_NAME="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}"
TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo 'latest')}"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $1"; }
info() { echo -e "${BLUE}[i]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }

echo ""
echo "======================================"
echo "  AutoQA API — Deploy to Cloud Run"
echo "======================================"
echo ""

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------
gcloud config set project "${PROJECT_ID}" --quiet

CONNECTION_NAME=$(gcloud sql instances describe "${DB_INSTANCE_NAME}" \
  --format="value(connectionName)" 2>/dev/null)

info "Image:      ${IMAGE_NAME}:${TAG}"
info "Cloud SQL:  ${CONNECTION_NAME}"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Build image with Cloud Build
# ---------------------------------------------------------------------------
log "Building Docker image via Cloud Build..."
gcloud builds submit \
  --tag "${IMAGE_NAME}:${TAG}" \
  --timeout=1200s \
  --quiet

# Also tag as latest
log "Tagging as latest..."
gcloud artifacts docker tags add \
  "${IMAGE_NAME}:${TAG}" \
  "${IMAGE_NAME}:latest" \
  --quiet 2>/dev/null || true

# ---------------------------------------------------------------------------
# Step 2: Deploy to Cloud Run
# ---------------------------------------------------------------------------
log "Deploying to Cloud Run..."

# Read frontend URL for CORS
FRONTEND_URL="${FRONTEND_URL:-https://autoqa.vercel.app}"

gcloud run deploy "${SERVICE_NAME}" \
  --image="${IMAGE_NAME}:${TAG}" \
  --region="${REGION}" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --cpu=2 \
  --memory=2Gi \
  --min-instances=0 \
  --max-instances=3 \
  --timeout=300s \
  --concurrency=10 \
  --set-env-vars="NODE_ENV=production,STORAGE_TYPE=local,LOCAL_STORAGE_PATH=/tmp/storage/reports,MAX_CONCURRENT_BROWSERS=2,CORS_ORIGINS=${FRONTEND_URL}" \
  --set-secrets="\
GEMINI_API_KEY=autoqa-gemini-key:latest,\
FIREBASE_PROJECT_ID=autoqa-firebase-project-id:latest,\
DATABASE_URL=autoqa-database-url:latest" \
  --add-cloudsql-instances="${CONNECTION_NAME}" \
  --quiet

# ---------------------------------------------------------------------------
# Step 3: Get service URL
# ---------------------------------------------------------------------------
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region="${REGION}" \
  --format="value(status.url)")

echo ""
log "Deployment complete!"
echo ""
echo "======================================"
echo "  Deployment Summary"
echo "======================================"
echo ""
info "Service URL:  ${SERVICE_URL}"
info "Image:        ${IMAGE_NAME}:${TAG}"
info "Region:       ${REGION}"
echo ""
info "Update your frontend .env:"
info "  NEXT_PUBLIC_API_URL=${SERVICE_URL}"
info "  NEXT_PUBLIC_WS_URL=${SERVICE_URL/https/wss}"
echo ""
warn "Don't forget to run migrations: ./deploy/migrate.sh"
echo ""
