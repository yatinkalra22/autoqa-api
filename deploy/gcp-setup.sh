#!/usr/bin/env bash
# =============================================================================
# AutoQA API — GCP Infrastructure Setup (Infrastructure-as-Code)
# =============================================================================
# Creates all required GCP resources for running the AutoQA API on Cloud Run
# with Cloud SQL (PostgreSQL) as the managed database.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated (gcloud auth login)
#   - A GCP project created (or this script creates one)
#   - Billing enabled on the project
#
# Usage:
#   chmod +x deploy/gcp-setup.sh
#   ./deploy/gcp-setup.sh
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
DB_INSTANCE_NAME="autoqa-db"
DB_NAME="autoqa"
DB_USER="autoqa"
DB_TIER="db-f1-micro"        # Cheapest tier — upgrade for production
REPO_NAME="autoqa"
IMAGE_NAME="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[x]${NC} $1"; exit 1; }
info() { echo -e "${BLUE}[i]${NC} $1"; }

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
command -v gcloud >/dev/null 2>&1 || err "gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install"

echo ""
echo "======================================"
echo "  AutoQA API — GCP Infrastructure"
echo "======================================"
echo ""
info "Project:  ${PROJECT_ID}"
info "Region:   ${REGION}"
info "Service:  ${SERVICE_NAME}"
info "Database: ${DB_INSTANCE_NAME} (${DB_TIER})"
echo ""

read -p "Continue with this configuration? (y/N) " -n 1 -r
echo ""
[[ $REPLY =~ ^[Yy]$ ]] || exit 0

# ---------------------------------------------------------------------------
# Step 1: Set project
# ---------------------------------------------------------------------------
log "Setting active project to ${PROJECT_ID}..."
gcloud config set project "${PROJECT_ID}" 2>/dev/null || {
  warn "Project ${PROJECT_ID} not found. Creating..."
  gcloud projects create "${PROJECT_ID}" --name="AutoQA Production"
  gcloud config set project "${PROJECT_ID}"
}

# ---------------------------------------------------------------------------
# Step 2: Enable required APIs
# ---------------------------------------------------------------------------
log "Enabling required GCP APIs..."
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  --quiet

# ---------------------------------------------------------------------------
# Step 3: Create Artifact Registry repository
# ---------------------------------------------------------------------------
log "Creating Artifact Registry repository..."
gcloud artifacts repositories describe "${REPO_NAME}" \
  --location="${REGION}" --format="value(name)" 2>/dev/null || \
gcloud artifacts repositories create "${REPO_NAME}" \
  --repository-format=docker \
  --location="${REGION}" \
  --description="AutoQA Docker images"

# ---------------------------------------------------------------------------
# Step 4: Create Cloud SQL instance
# ---------------------------------------------------------------------------
log "Creating Cloud SQL PostgreSQL instance..."
if gcloud sql instances describe "${DB_INSTANCE_NAME}" --format="value(name)" 2>/dev/null; then
  warn "Cloud SQL instance ${DB_INSTANCE_NAME} already exists — skipping."
else
  gcloud sql instances create "${DB_INSTANCE_NAME}" \
    --database-version=POSTGRES_16 \
    --tier="${DB_TIER}" \
    --region="${REGION}" \
    --edition=ENTERPRISE \
    --storage-auto-increase \
    --assign-ip \
    --quiet

  log "Creating database..."
  gcloud sql databases create "${DB_NAME}" \
    --instance="${DB_INSTANCE_NAME}" \
    --quiet

  # Generate a random password
  DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)

  log "Creating database user..."
  gcloud sql users create "${DB_USER}" \
    --instance="${DB_INSTANCE_NAME}" \
    --password="${DB_PASSWORD}" \
    --quiet

  # Store password in Secret Manager
  log "Storing database password in Secret Manager..."
  echo -n "${DB_PASSWORD}" | gcloud secrets create autoqa-db-password \
    --data-file=- \
    --replication-policy="automatic" \
    --quiet 2>/dev/null || \
  echo -n "${DB_PASSWORD}" | gcloud secrets versions add autoqa-db-password \
    --data-file=-

  info "Database password stored in Secret Manager: autoqa-db-password"
fi

# Get the Cloud SQL connection name
CONNECTION_NAME=$(gcloud sql instances describe "${DB_INSTANCE_NAME}" \
  --format="value(connectionName)")
info "Cloud SQL connection: ${CONNECTION_NAME}"

# ---------------------------------------------------------------------------
# Step 5: Store secrets
# ---------------------------------------------------------------------------
log "Setting up secrets in Secret Manager..."

create_secret() {
  local name=$1
  local prompt=$2
  if gcloud secrets describe "${name}" --format="value(name)" 2>/dev/null; then
    warn "Secret '${name}' already exists — skipping."
  else
    read -p "${prompt}: " -r value
    echo -n "${value}" | gcloud secrets create "${name}" \
      --data-file=- \
      --replication-policy="automatic" \
      --quiet
    log "Secret '${name}' created."
  fi
}

create_secret "autoqa-gemini-key" "Enter your Gemini API key"
create_secret "autoqa-firebase-project-id" "Enter your Firebase project ID"

# ---------------------------------------------------------------------------
# Step 6: Grant Cloud Run access to secrets and Cloud SQL
# ---------------------------------------------------------------------------
log "Configuring IAM permissions..."
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")
SA_EMAIL="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Grant project-level secret access (covers all secrets)
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet 2>/dev/null

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/cloudsql.client" \
  --quiet 2>/dev/null

echo ""
log "Infrastructure setup complete!"
echo ""
echo "======================================"
echo "  Next Steps"
echo "======================================"
echo ""
info "1. Build and deploy:  ./deploy/deploy.sh"
info "2. Run migrations:    ./deploy/migrate.sh"
echo ""
info "Resources created:"
info "  - Artifact Registry: ${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}"
info "  - Cloud SQL:         ${CONNECTION_NAME}"
info "  - Secrets:           autoqa-db-password, autoqa-gemini-key, autoqa-firebase-project-id"
echo ""
