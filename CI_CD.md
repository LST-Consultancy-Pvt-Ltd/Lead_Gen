# Auto-deploy to a VPS on `git push`

A reusable GitHub Actions → SSH → Docker Compose deployment. Push to a mapped
branch, and that branch's environment rebuilds and restarts itself.

This document is written to be copied into other projects. Everything
project-specific is isolated in one config block per file.

---

## 1. How it works

```
git push origin <branch>
        │
        ▼
GitHub Actions (ubuntu-latest)
        │  resolves <branch> → a directory on the server
        │  opens an SSH session with a deploy key
        ▼
VPS: cd <dir>
     git stash           # any uncommitted edits to TRACKED files
     git fetch && git reset --hard origin/<branch>
     ./scripts/deploy.sh # the freshly pulled script
        │
        ▼
     baseline = .last-deployed (the last SUCCESSFUL deploy)
     for each stack changed since that baseline:
         docker compose build
         docker compose up -d
         poll its health URL until it answers (or fail the job)
     write HEAD to .last-deployed    # only if everything above passed
```

Five design choices worth understanding before you adapt it:

**`git reset --hard`, not `git pull`.** A deploy checkout should be a mirror of
the remote, not a working copy. A pull breaks whenever someone has edited a
tracked file on the server — and on a long-lived deploy box, someone always
has. A hard reset replaces tracked files outright and can never conflict.
Untracked files (`.env`, `docker-compose.override.yml`) are left alone, which
is exactly where per-environment config should live. We deliberately never run
`git clean`.

**The deploy script is re-read after the reset.** The SSH session pulls first,
then executes `scripts/deploy.sh` from the *new* commit. So a change to the
deploy logic takes effect on the push that contains it, not the one after.

**The job fails if the app doesn't come back.** Building and starting a
container proves nothing — a container that crash-loops on a bad migration
still "starts". The script polls a real health endpoint and dumps container
logs into the run output if it never answers.

**Uncommitted server-side edits are stashed, not discarded.** The flip side of
a hard reset is that it silently reverts hand-edits to tracked files. On a
long-lived server those edits are sometimes load-bearing — a compose file
pinned to a different database image, say — and losing one mid-deploy takes
production down. The job stashes them first (`--untracked-files=no`, so `.env`
and `docker-compose.override.yml` are never touched) and prints them as a
warning annotation, so the change is recoverable with `git stash list` and
visible in the run log.

The real lesson is the one underneath: **anything a server genuinely needs to
keep should be untracked** — an override file, not an edit to a tracked one.
Stashing is a safety net for mistakes, not a place to keep config.

**Progress is tracked in `.last-deployed`, not inferred from `HEAD`.** The
reset happens before the build, so after a failed deploy `HEAD` already equals
the target commit. A retry that used `HEAD` as its baseline would diff a commit
against itself, skip every stack and report a green deploy that deployed
nothing. The baseline is written only once every stack is healthy, so a retry
re-attempts the same range. Keep the file untracked (gitignored) so the reset
cannot remove it.

---

## 2. Requirements

On the server:

- Docker with the Compose v2 plugin (`docker compose`, not `docker-compose`)
- One git checkout per environment, already cloned, already on the right branch,
  with `origin` pointing at the repo and credentials that can fetch it
- `curl` (used for health checks)

In the repo:

- A `docker-compose.yml` per stack, with `build:` contexts
- A health endpoint per stack that returns 2xx/3xx when the app is actually up

---

## 3. One-time setup

### 3.1 Create a deploy key on the server

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N "" -C "github-actions"
cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
cat ~/.ssh/github_deploy          # the PRIVATE key — this is the secret
```

Verify it works before trusting it to CI:

```bash
ssh -i ~/.ssh/github_deploy -o IdentitiesOnly=yes <user>@<host> 'echo ok'
```

### 3.2 Add repository secrets

GitHub → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `VPS_HOST` | server IP or hostname |
| `VPS_USER` | SSH user |
| `VPS_SSH_KEY` | the full private key, `-----BEGIN-----` through `-----END-----`, **with a trailing newline** |
| `VPS_PORT` | optional; defaults to 22 |

A missing trailing newline on the key is the most common cause of a failed
first run. Never commit the key; never paste it into chat or an issue.

### 3.3 Confirm environments can't collide

If two environments share a server, each must have its own:

- **Compose project name** — `COMPOSE_PROJECT_NAME` in `.env`, or `name:` in the
  compose file. **This is the one that bites.** Two checkouts resolving to the
  same project name share containers *and volumes* — meaning two environments
  writing to one database.
- **Host ports** — every published port
- **Database name**

Check before the first automated deploy:

```bash
grep -E 'COMPOSE_PROJECT_NAME|_PORT|POSTGRES_DB' <env1>/*/.env <env2>/*/.env
```

### 3.4 Commit on every deployed branch

A workflow only runs if it exists on the branch being pushed. Merge the CI
commit into each mapped branch before expecting pushes to deploy.

### 3.5 Pre-flight on a server that's been running by hand

Automating an existing manually-managed server is where this goes wrong. Before
the first automated deploy, in **every** checkout:

```bash
git status                       # uncommitted edits to TRACKED files?
git log origin/<branch>..HEAD    # commits that exist only here?
git diff origin/<branch> -- '*docker-compose*' Dockerfile
```

Anything that shows up is config the server needs and git is about to overwrite.
Move it into an untracked `docker-compose.override.yml` **first**, or commit it.
Checking only for local *commits* is not enough — an uncommitted one-line edit
to a compose file is just as load-bearing and much easier to miss.

Also record what the live containers actually are, since the compose file may
no longer describe them:

```bash
docker compose ps --format '{{.Service}}\t{{.Image}}'
```

If a running image differs from the compose file (`postgres:18-alpine` vs a
committed `postgres:16-alpine`), the first deploy will recreate that container
with the wrong image. For a database, that means a crash-loop — see §8.

---

## 4. `.github/workflows/deploy.yml`

Edit the `env:` block and the `case` statement; the rest is portable.

```yaml
name: Deploy to VPS

on:
  push:
    branches: [test, main_backup]     # CONFIG: deployed branches
  workflow_dispatch:                  # adds a manual "Run workflow" button

concurrency:
  group: deploy-${{ github.ref_name }}
  cancel-in-progress: false           # queue; never kill a running build

env:                                  # CONFIG: branch → directory
  TEST_DIR: /root/Lead_Gen_Test
  MAIN_BACKUP_DIR: /root/Lead_Gen

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Resolve target directory
        id: target
        run: |
          case "${{ github.ref_name }}" in
            test)        echo "dir=${TEST_DIR}"        >> "$GITHUB_OUTPUT" ;;
            main_backup) echo "dir=${MAIN_BACKUP_DIR}" >> "$GITHUB_OUTPUT" ;;
            *) echo "No deploy target for ${{ github.ref_name }}"; exit 1 ;;
          esac

      - name: Deploy over SSH
        uses: appleboy/ssh-action@v1.2.0
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          port: ${{ secrets.VPS_PORT || 22 }}
          command_timeout: 25m
          script_stop: true
          script: |
            set -euo pipefail
            cd "${{ steps.target.outputs.dir }}"
            echo "Current: $(git rev-parse HEAD)"

            # Preserve hand-edits to tracked files instead of losing them.
            # --untracked-files=no leaves .env / override files alone.
            DIRTY="$(git status --porcelain --untracked-files=no)"
            if [ -n "$DIRTY" ]; then
              echo "::warning::Uncommitted changes to tracked files found on the server; stashing before reset"
              echo "$DIRTY"
              git stash push -m "auto-deploy $(date -u +%FT%TZ)" \
                || echo "::warning::stash failed (unmerged paths?); reset will discard these"
            fi

            git fetch --prune origin
            git reset --hard "origin/${{ github.ref_name }}"

            # No baseline argument: the script reads .last-deployed. Passing
            # HEAD here would be wrong on a retry, where the reset already ran.
            chmod +x scripts/deploy.sh
            ./scripts/deploy.sh
```

---

## 5. `scripts/deploy.sh`

Runs on the server, from the repo root, after the reset. Only the `STACKS`
block is project-specific.

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Baseline: .last-deployed (last SUCCESSFUL deploy) > $1 > rebuild everything.
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

# CONFIG: "<dir>|<env file>|<port var>|<default port>|<health path>"
STACKS=(
  "backend|backend/.env|BACKEND_PORT|4000|/health"
  "frontend|frontend/.env|FRONTEND_PORT|3000|/"
)

log() { printf '\n=== %s\n' "$*"; }

changed() {                       # anything under $1 changed since PREV_SHA?
  [ -n "$PREV_SHA" ] || return 0  # unknown previous state → rebuild
  git cat-file -e "${PREV_SHA}^{commit}" 2>/dev/null || return 0
  ! git diff --quiet "$PREV_SHA" HEAD -- "$1"
}

env_val() {                       # read KEY=value from an env file, or default
  local file="$1" key="$2" default="$3" val=""
  [ -f "$file" ] && val="$(grep -E "^${key}=" "$file" | tail -1 | cut -d= -f2- | tr -d "\"' \r")"
  echo "${val:-$default}"
}

wait_for() {
  local name="$1" url="$2" tries="${3:-30}"
  log "Waiting for $name at $url"
  for i in $(seq 1 "$tries"); do
    curl -fsS --max-time 5 "$url" >/dev/null 2>&1 && { echo "$name is up"; return 0; }
    sleep 10
  done
  echo "ERROR: $name did not become healthy" >&2
  (cd "$ROOT/$name" && docker compose ps && docker compose logs --tail=80)
  return 1
}

DID_ANYTHING=0
for spec in "${STACKS[@]}"; do
  IFS='|' read -r dir envfile portvar portdef health <<< "$spec"
  if ! changed "$dir"; then log "$dir unchanged — skipping"; continue; fi
  log "Deploying $dir"
  (cd "$ROOT/$dir" && docker compose build && docker compose up -d --remove-orphans)
  wait_for "$dir" "http://127.0.0.1:$(env_val "$ROOT/$envfile" "$portvar" "$portdef")${health}"
  DID_ANYTHING=1
done

[ "$DID_ANYTHING" -eq 1 ] && docker image prune -f >/dev/null

# Only now does this commit count as deployed. A failure above leaves the old
# value, so the next run retries the same range instead of assuming success.
git rev-parse HEAD > "$STATE_FILE"
log "Deploy complete: $(git rev-parse --short HEAD)"
```

Add `.gitattributes` so Windows checkouts can't ship CRLF scripts — on Linux
that fails as `\r: command not found`:

```
*.sh text eol=lf
```

And gitignore the state file, so it isn't reported as a dirty tracked file:

```
.last-deployed
```

Commit the script executable: `git add --chmod=+x scripts/deploy.sh`

---

## 6. Adapting to a new project

1. Copy `.github/workflows/deploy.yml`, `scripts/deploy.sh`, `.gitattributes`.
2. Workflow: edit `on.push.branches`, the `env:` directory map, and the `case`.
3. Script: edit `STACKS` — one line per compose project.
4. Create the deploy key and the three secrets (§3.1–3.2).
5. Clone the repo on the server, one directory per environment, each on its
   branch, each with its own `.env`.
6. Verify no collisions (§3.3).
7. Trigger manually via **Run workflow** on the least important branch first.

**Single-stack project?** Reduce `STACKS` to one line. **No health endpoint?**
Point it at any path that returns 2xx when the app is up; failing that, replace
`wait_for` with a check that the container is still running after 30s — weaker,
but better than nothing.

---

## 7. Behaviour notes

- **Only changed stacks rebuild**, measured against `.last-deployed`. A
  frontend-only push won't restart the API.
- **The first run on a server rebuilds everything**, since no baseline exists.
- **A failed deploy leaves the checkout at the new commit** but the containers
  on the old image. The app keeps serving the old code; nothing is half-applied
  except any database migration that already ran. Fix the cause and re-run.
- **Database migrations** run wherever your image already runs them (e.g. a
  Dockerfile `CMD` of `migrate && start`). Nothing in this pipeline runs them
  separately — and nothing reviews them. `migrate deploy` applies whatever is
  committed, unattended. Back up production before a destructive migration.
- **Brief downtime** while `up -d` recreates a container. For zero-downtime you
  need a proxy and two container sets — a larger change than this.
- **Concurrency** is per branch: pushes queue rather than overlap.

---

## 8. Troubleshooting

| Symptom | Cause |
|---|---|
| `ssh: handshake failed` | Key mangled in the secret — missing BEGIN/END or trailing newline. Regenerate and re-paste. |
| `Permission denied (publickey)` | Public key not in the server's `authorized_keys`, or `~/.ssh` perms wrong (`700` dir, `600` file). |
| Workflow doesn't trigger | The workflow file isn't on the pushed branch, or the branch isn't in `on.push.branches`. |
| `scripts/deploy.sh: not found` | Script missing from the commit, or CRLF line endings — add `.gitattributes`. |
| Health check times out | App genuinely failed to boot. Read the logs the script dumped — usually a failed migration or a missing env var. |
| Port already in use | Two environments sharing a port. See §3.3. |
| Two environments share a database | Same compose project name. See §3.3. |
| Deploy "succeeds" but nothing changed | The stack's directory had no changes since `.last-deployed` — by design. Delete `.last-deployed` to force a full rebuild. |
| A database container crash-loops right after a deploy, logging `initdb: error: directory ... exists but is not empty` | The reset reverted a hand-edited compose file, so the container is now a **different major version** than the one that wrote the volume — or expects the cluster at a different path. (Postgres 18 stores data at `<volume>/18/docker`; 16 and earlier at the volume root.) The data is intact; the container just can't find or read it. Inspect with `docker run --rm -v <volume>:/d alpine find /d -maxdepth 4 -name PG_VERSION -exec sh -c 'echo {} = $(cat {})' \;`, then pin the right image and `PGDATA` in an untracked `docker-compose.override.yml`. Never `down -v`. |

---

## 9. Rollback

```bash
cd <deploy dir>
git reset --hard <known-good-sha>
./scripts/deploy.sh                # no PREV_SHA → rebuilds everything
```

Or re-run an older successful run from the Actions tab. Note this rolls back
*code*, not *schema* — a migration that already ran stays applied. Restore from
your backup if the schema itself needs reverting.

---

## 10. Security

- The deploy key is a private key with shell access to the server. It lives
  only in GitHub Secrets. Anyone who can push to a mapped branch, or who can
  edit the workflow, can run commands on that server.
- Restrict who can push to production branches (branch protection rules).
- Scope the key: a dedicated non-root deploy user with Docker access beats
  `root`.
- Secrets aren't available to workflows from forked-PR runs, so this can't be
  triggered by an outside contributor.
- `.env` files stay on the server and out of git — which is also what makes the
  hard reset safe.
