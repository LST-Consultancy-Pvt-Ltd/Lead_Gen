#!/usr/bin/env bash
#
# Runs ON THE VPS, from the repo root, after the workflow has already reset the
# checkout to the target commit. Rebuilds only the stacks whose source changed,
# then waits for each to come back healthy.
#
#   ./scripts/deploy.sh [PREV_SHA]
#
# With no PREV_SHA (or an unknown one), both stacks are rebuilt.
set -euo pipefail

PREV_SHA="${1:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '\n=== %s\n' "$*"; }

# Did anything under $1 change between PREV_SHA and HEAD?
changed() {
  [ -n "$PREV_SHA" ] || return 0
  git cat-file -e "${PREV_SHA}^{commit}" 2>/dev/null || return 0
  ! git diff --quiet "$PREV_SHA" HEAD -- "$1"
}

# Poll a URL until it answers, or give up.
wait_for() {
  local name="$1" url="$2" tries="${3:-30}"
  log "Waiting for $name at $url"
  for i in $(seq 1 "$tries"); do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      echo "$name is up (after ${i}0s)"
      return 0
    fi
    sleep 10
  done
  echo "ERROR: $name did not become healthy" >&2
  (cd "$ROOT/$name" && docker compose ps && docker compose logs --tail=80)
  return 1
}

# Read a KEY=value out of a stack's .env, falling back to a default.
env_val() {
  local file="$1" key="$2" default="$3" val=""
  [ -f "$file" ] && val="$(grep -E "^${key}=" "$file" | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
  echo "${val:-$default}"
}

deploy_stack() {
  local stack="$1"
  log "Deploying $stack"
  cd "$ROOT/$stack"
  docker compose build
  # Backend applies pending Prisma migrations on boot (see backend/Dockerfile
  # CMD) -- if a migration fails the container exits and the health gate below
  # catches it.
  docker compose up -d --remove-orphans
  cd "$ROOT"
}

DID_ANYTHING=0

if changed backend; then
  deploy_stack backend
  wait_for backend "http://127.0.0.1:$(env_val "$ROOT/backend/.env" BACKEND_PORT 4000)/health"
  DID_ANYTHING=1
else
  log "backend unchanged -- skipping"
fi

if changed frontend; then
  deploy_stack frontend
  wait_for frontend "http://127.0.0.1:$(env_val "$ROOT/frontend/.env" FRONTEND_PORT 3000)/"
  DID_ANYTHING=1
else
  log "frontend unchanged -- skipping"
fi

if [ "$DID_ANYTHING" -eq 1 ]; then
  log "Pruning dangling images"
  docker image prune -f >/dev/null
else
  log "Nothing to rebuild for this push"
fi

log "Deploy complete: $(git rev-parse --short HEAD)"
