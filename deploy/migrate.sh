#!/usr/bin/env bash
# =============================================================================
# AutoQA API — Run Database Migrations on Cloud SQL
# =============================================================================
# Connects to Cloud SQL via Cloud SQL Auth Proxy and runs Drizzle migrations.
#
# Usage:
#   chmod +x deploy/migrate.sh
#   ./deploy/migrate.sh
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
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $1"; }
info() { echo -e "${BLUE}[i]${NC} $1"; }
err()  { echo -e "${RED}[x]${NC} $1"; exit 1; }

echo ""
echo "======================================"
echo "  AutoQA — Database Migration"
echo "======================================"
echo ""

# Get connection name
CONNECTION_NAME=$(gcloud sql instances describe "${DB_INSTANCE_NAME}" \
  --project="${PROJECT_ID}" \
  --format="value(connectionName)" 2>/dev/null) || \
  err "Could not find Cloud SQL instance '${DB_INSTANCE_NAME}'"

info "Instance: ${CONNECTION_NAME}"

# Get password from Secret Manager
DB_PASSWORD=$(gcloud secrets versions access latest \
  --secret="autoqa-db-password" \
  --project="${PROJECT_ID}" 2>/dev/null) || \
  err "Could not read secret 'autoqa-db-password'"

# Check if cloud-sql-proxy is installed
if ! command -v cloud-sql-proxy >/dev/null 2>&1; then
  echo ""
  info "Installing Cloud SQL Auth Proxy..."
  if [[ "$OSTYPE" == "darwin"* ]]; then
    brew install cloud-sql-proxy 2>/dev/null || {
      curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.0/cloud-sql-proxy.darwin.arm64
      chmod +x cloud-sql-proxy
      sudo mv cloud-sql-proxy /usr/local/bin/
    }
  else
    curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.0/cloud-sql-proxy.linux.amd64
    chmod +x cloud-sql-proxy
    sudo mv cloud-sql-proxy /usr/local/bin/
  fi
fi

# Start proxy in background on a random port
PROXY_PORT=15432
log "Starting Cloud SQL Auth Proxy on port ${PROXY_PORT}..."
cloud-sql-proxy "${CONNECTION_NAME}" \
  --port="${PROXY_PORT}" \
  --quiet &
PROXY_PID=$!

# Wait for proxy to be ready
sleep 3

# Ensure proxy is cleaned up on exit
cleanup() {
  kill "${PROXY_PID}" 2>/dev/null || true
}
trap cleanup EXIT

# Run migrations
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:${PROXY_PORT}/${DB_NAME}"

log "Running Drizzle migrations..."
DATABASE_URL="${DATABASE_URL}" npx tsx src/db/migrate.ts

echo ""
log "Migrations complete!"
echo ""
