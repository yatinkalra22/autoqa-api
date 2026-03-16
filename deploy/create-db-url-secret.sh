#!/usr/bin/env bash
# =============================================================================
# Create the DATABASE_URL secret for Cloud Run
# =============================================================================
# Cloud Run connects to Cloud SQL via Unix socket, so the DATABASE_URL
# uses a special format. Run this after gcp-setup.sh.
#
# Usage:
#   chmod +x deploy/create-db-url-secret.sh
#   ./deploy/create-db-url-secret.sh
# =============================================================================

set -euo pipefail

# Load config from .deploy.env
source "$(dirname "$0")/_config.sh"

PROJECT_ID="${GCP_PROJECT_ID}"
DB_INSTANCE_NAME="autoqa-db"
DB_NAME="autoqa"
DB_USER="autoqa"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $1"; }
info() { echo -e "${BLUE}[i]${NC} $1"; }

# Get connection name for socket path
CONNECTION_NAME=$(gcloud sql instances describe "${DB_INSTANCE_NAME}" \
  --project="${PROJECT_ID}" \
  --format="value(connectionName)")

# Get password from Secret Manager
DB_PASSWORD=$(gcloud secrets versions access latest \
  --secret="autoqa-db-password" \
  --project="${PROJECT_ID}")

# Cloud Run uses Unix socket: /cloudsql/CONNECTION_NAME
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost/${DB_NAME}?host=/cloudsql/${CONNECTION_NAME}"

info "DATABASE_URL = postgresql://${DB_USER}:****@localhost/${DB_NAME}?host=/cloudsql/${CONNECTION_NAME}"

# Create or update the secret
if gcloud secrets describe "autoqa-database-url" --project="${PROJECT_ID}" --format="value(name)" 2>/dev/null; then
  echo -n "${DATABASE_URL}" | gcloud secrets versions add "autoqa-database-url" \
    --data-file=- \
    --project="${PROJECT_ID}"
  log "Secret 'autoqa-database-url' updated."
else
  echo -n "${DATABASE_URL}" | gcloud secrets create "autoqa-database-url" \
    --data-file=- \
    --replication-policy="automatic" \
    --project="${PROJECT_ID}"
  log "Secret 'autoqa-database-url' created."
fi

# Grant access to Cloud Run service account
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")
SA_EMAIL="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud secrets add-iam-policy-binding "autoqa-database-url" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor" \
  --project="${PROJECT_ID}" \
  --quiet 2>/dev/null

log "Done! Cloud Run can now access the database URL secret."
