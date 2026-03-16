#!/usr/bin/env bash
# Shared config loader for deploy scripts.
# Sources .deploy.env from the project root if it exists.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"
DEPLOY_ENV="${PROJECT_ROOT}/.deploy.env"

if [[ -f "${DEPLOY_ENV}" ]]; then
  set -a
  source "${DEPLOY_ENV}"
  set +a
elif [[ -z "${GCP_PROJECT_ID:-}" ]]; then
  echo -e "\033[0;31m[x]\033[0m Missing GCP_PROJECT_ID."
  echo ""
  echo "  Either create .deploy.env:"
  echo "    cp .deploy.env.example .deploy.env"
  echo ""
  echo "  Or export it:"
  echo "    export GCP_PROJECT_ID=your-project-id"
  echo ""
  exit 1
fi

# Defaults
export GCP_PROJECT_ID="${GCP_PROJECT_ID}"
export GCP_REGION="${GCP_REGION:-us-central1}"
export FRONTEND_URL="${FRONTEND_URL:-https://autoqa.vercel.app}"
