#!/usr/bin/env bash
#
# Runs ON THE VPS, from the repo root, after the workflow has already reset the
# checkout to the target commit. Rebuilds only the stacks whose source changed,
# then waits for each to come back healthy.
#
#   ./scripts/deploy.sh [PREV_SHA]
#
# With no PREV_SHA (or an unknown one), every stack is rebuilt.
# See CI_CD.md for the full picture and for reusing this in another project.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Baseline for "what changed", in priority order:
#   1. .last-deployed  - the last SUCCESSFUL deploy. Untracked, so a hard reset
#                        cannot remove it, and only written once every stack is
#                        healthy.
#   2. $1              - an explicit baseline, for manual use.
#   3. nothing         - rebuild every stack.
# The workflow passes no argument by design. After a deploy that reset the
# checkout but then failed, HEAD already equals the target, so a baseline of
# HEAD would diff a commit against itself, skip every stack and report a false
# green on the retry.
STATE_FILE="$ROOT/.last-deployed"
PREV_SHA="${1:-}"
if [ -s "$STATE_FILE" ]; then
  PREV_SHA="$(cat "$STATE_FILE")"
  echo "Last successful deploy: $PREV_SHA"
elif [ -n "$PREV_SHA" ]; then
  echo "Baseline from argument: $PREV_SHA"
else
  echo "No baseline recorded -- rebuilding every stack"
fi

# CONFIG: one line per compose project --
#   "<dir>|<env file>|<port var>|<default port>|<health path>"
# Ports are read from each environment's own untracked .env, so the same commit
# deploys correctly to test (4001/3006) and production (4000/3005).
STACKS=(
  "backend|backend/.env|BACKEND_PORT|4000|/health"
  "frontend|frontend/.env|FRONTEND_PORT|3000|/"
)

log() { printf '\n=== %s\n' "$*"; }

# Did anything under $1 change between PREV_SHA and HEAD?
changed() {
  [ -n "$PREV_SHA" ] || return 0                            # no baseline -> rebuild
  git cat-file -e "${PREV_SHA}^{commit}" 2>/dev/null || return 0
  ! git diff --quiet "$PREV_SHA" HEAD -- "$1"
}

# Read KEY=value out of an env file, falling back to a default.
env_val() {
  local file="$1" key="$2" default="$3" val=""
  [ -f "$file" ] && val="$(grep -E "^${key}=" "$file" | tail -1 | cut -d= -f2- | tr -d "\"' \r")"
  echo "${val:-$default}"
}

# Poll a URL until it answers, or fail loudly with the container's logs.
wait_for() {
  local name="$1" url="$2" tries="${3:-30}"
  log "Waiting for $name at $url"
  for i in $(seq 1 "$tries"); do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      echo "$name is up (after $((i * 10))s)"
      return 0
    fi
    sleep 10
  done
  echo "ERROR: $name did not become healthy" >&2
  (cd "$ROOT/$name" && docker compose ps && docker compose logs --tail=80)
  return 1
}

DID_ANYTHING=0

for spec in "${STACKS[@]}"; do
  IFS='|' read -r dir envfile portvar portdef health <<< "$spec"

  if ! changed "$dir"; then
    log "$dir unchanged -- skipping"
    continue
  fi

  log "Deploying $dir"
  # The backend applies pending Prisma migrations on boot (backend/Dockerfile
  # CMD). If one fails the container exits and the health gate below catches it.
  (cd "$ROOT/$dir" && docker compose build && docker compose up -d --remove-orphans)
  wait_for "$dir" "http://127.0.0.1:$(env_val "$ROOT/$envfile" "$portvar" "$portdef")${health}"
  DID_ANYTHING=1
done

if [ "$DID_ANYTHING" -eq 1 ]; then
  log "Pruning dangling images"
  docker image prune -f >/dev/null
else
  log "Nothing to rebuild for this push"
fi

# Only now, with every stack built and healthy, does this commit count as
# deployed. A failure above leaves the old value, so the next run retries the
# same range instead of assuming success.
git rev-parse HEAD > "$STATE_FILE"

log "Deploy complete: $(git rev-parse --short HEAD)"
