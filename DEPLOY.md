# Deploying LeadForge AI to Hostinger (Docker)

The whole stack runs from a single `docker-compose.yml`:

| Service    | Image / build      | Port  | Purpose                          |
|------------|--------------------|-------|----------------------------------|
| `postgres` | postgres:16-alpine | 5432* | Database (Prisma)                |
| `redis`    | redis:7-alpine     | 6379* | Queues / cache (bull, ioredis)   |
| `backend`  | `./backend`        | 4000  | Express API (`/health`, `/api/*`)|
| `frontend` | `./frontend`       | 3000  | Next.js UI (standalone)          |

\* Postgres/Redis are only reachable inside the compose network — not published to the host.

---

## 1. Prerequisites on the Hostinger VPS

Use a **VPS plan** (KVM). In hPanel, either pick the **Ubuntu 24.04 with Docker** OS template, or install Docker manually:

```bash
curl -fsSL https://get.docker.com | sh
```

Docker Compose v2 ships with Docker Engine (`docker compose ...`).

## 2. Get the code onto the server

```bash
git clone <your-repo-url> leadforge
cd leadforge
```

## 3. Configure environment

```bash
cp .env.example .env
nano .env          # fill in real secrets
```

Must-set values:
- `POSTGRES_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `NEXTAUTH_SECRET` — strong random strings.
- `NEXT_PUBLIC_API_URL` — **the browser-facing** API URL. This is baked into the
  frontend at build time. On a real server set it to your domain, e.g.
  `https://yourdomain.com/api` (see the reverse-proxy note below), **not** `localhost`.
- `FRONTEND_URL` / `CORS_ORIGINS` — your public frontend URL, e.g. `https://yourdomain.com`.
- Provider keys you actually use (`OPENAI_API_KEY`, `SERPAPI_KEY`, `SIGNALHIRE_API_KEY`, email, Google OAuth…).

`DATABASE_URL` and `REDIS_URL` are set automatically by compose — leave them out.

## 4. Build and run

```bash
docker compose up -d --build
```

- Prisma migrations (`prisma migrate deploy`) run automatically when the backend starts.
- Check status / logs:

```bash
docker compose ps
docker compose logs -f backend
```

Verify the API is healthy:

```bash
curl http://localhost:4000/health      # -> {"status":"ok",...}
```

## 5. (Optional) Seed the database

```bash
docker compose exec backend node prisma/seed.js
docker compose exec backend node prisma/seed-dropdowns.js
```

---

## Putting it behind your domain (recommended)

For a clean single-domain setup, run a reverse proxy (Nginx / Caddy / Traefik)
in front so `https://yourdomain.com` → frontend and `https://yourdomain.com/api` → backend.

Minimal **Caddy** example (`Caddyfile`) — automatic HTTPS:

```
yourdomain.com {
    handle /api/* {
        reverse_proxy localhost:4000
    }
    handle {
        reverse_proxy localhost:3000
    }
}
```

Then set in `.env` and rebuild the frontend:

```
NEXT_PUBLIC_API_URL=https://yourdomain.com/api
FRONTEND_URL=https://yourdomain.com
CORS_ORIGINS=https://yourdomain.com
```

```bash
docker compose up -d --build frontend
```

> `NEXT_PUBLIC_API_URL` is compiled into the browser bundle, so **any change to it
> requires rebuilding the `frontend` image** (`--build`), not just a restart.

Open the VPS firewall for 80/443 (and 3000/4000 only if you access them directly):

```bash
ufw allow 80 && ufw allow 443
```

---

## Common operations

```bash
docker compose down            # stop (keeps data volumes)
docker compose down -v         # stop and DELETE database/redis volumes
docker compose up -d --build   # rebuild after code changes
docker compose exec backend npx prisma migrate deploy   # apply migrations manually
```

Data persists in the named volumes `pgdata` and `redisdata`.
