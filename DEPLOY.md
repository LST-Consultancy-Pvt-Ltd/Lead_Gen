# Deploying LeadForge AI to Hostinger (two separate Docker projects)

Backend and frontend deploy as **two independent compose projects** via the
Hostinger **Docker Manager → Terminal**. They don't share a docker network —
the browser calls the backend over its **public URL**, and the backend allows
that origin via `CORS_ORIGINS`.

```
leadforge-backend   →  Postgres + Redis + Express API   (host port 4000)
leadforge-frontend  →  Next.js UI                        (host port 3000)
```

Recommended public URLs (set up in hPanel → domain / subdomain, pointing to the VPS):
- Frontend: `https://yourdomain.com`
- Backend:  `https://api.yourdomain.com`

---

## 0. Open the Terminal

In Docker Manager (the screen you're on) click **Terminal** (top-right), or SSH in:

```bash
ssh root@<your-vps-ip>
```

## 1. Get the code on the server (once)

```bash
git clone <your-repo-url> leadforge
cd leadforge
```

Update later with `git pull` and re-run the build commands.

---

## 2. Deploy the BACKEND

```bash
cd ~/leadforge/backend
cp .env.example .env
nano .env          # set POSTGRES_PASSWORD, JWT secrets, provider keys,
                   # FRONTEND_URL / CORS_ORIGINS = https://yourdomain.com
docker compose up -d --build
```

- `DATABASE_URL` / `REDIS_URL` are wired to the compose Postgres/Redis automatically.
- Prisma migrations run on startup. Verify:

```bash
docker compose ps
docker compose logs -f backend
curl http://localhost:4000/health      # -> {"status":"ok",...}
```

(Optional) seed data:

```bash
docker compose exec backend node prisma/seed.js
docker compose exec backend node prisma/seed-dropdowns.js
```

---

## 3. Deploy the FRONTEND

```bash
cd ~/leadforge/frontend
cp .env.example .env
nano .env          # set NEXT_PUBLIC_API_URL to the PUBLIC backend URL,
                   # e.g. https://api.yourdomain.com/api
docker compose up -d --build
docker compose ps
```

> `NEXT_PUBLIC_API_URL` is compiled into the browser bundle, so **changing it
> requires a rebuild** (`docker compose up -d --build`), not just a restart.

---

## 4. Point your domains at the containers (HTTPS)

Put a reverse proxy in front so traffic hits HTTPS on 443 instead of raw
3000/4000. Minimal **Caddy** (`~/Caddyfile`, auto-HTTPS):

```
yourdomain.com {
    reverse_proxy localhost:3000
}
api.yourdomain.com {
    reverse_proxy localhost:4000
}
```

```bash
docker run -d --name caddy --restart unless-stopped --network host \
  -v ~/Caddyfile:/etc/caddy/Caddyfile \
  -v caddy_data:/data caddy:2
```

Then in `frontend/.env`: `NEXT_PUBLIC_API_URL=https://api.yourdomain.com/api`
and in `backend/.env`: `CORS_ORIGINS=https://yourdomain.com` — rebuild the frontend.

Open the firewall:

```bash
ufw allow 80 && ufw allow 443
```

---

## Deploying via the .yaml editor instead of Terminal

The Docker Manager's **.yaml editor** builds from a compose file but has **no
access to your source code**, so `build:` contexts won't work there. To use the
UI, first push prebuilt images to a registry (Docker Hub / GHCR):

```bash
# on any machine with the repo
docker build -t <user>/leadforge-backend ./backend
docker build -t <user>/leadforge-frontend \
  --build-arg NEXT_PUBLIC_API_URL=https://api.yourdomain.com/api ./frontend
docker push <user>/leadforge-backend
docker push <user>/leadforge-frontend
```

Then in each project's `.yaml editor`, replace `build:` with
`image: <user>/leadforge-backend` (or `-frontend`). **The Terminal route above
avoids all of this** and is simpler for a first deploy.

---

## Common operations

```bash
docker compose logs -f                 # tail logs (run in the project folder)
docker compose down                    # stop (keeps DB/redis volumes)
docker compose down -v                 # stop and DELETE data volumes
docker compose up -d --build           # rebuild after `git pull`
docker compose exec backend npx prisma migrate deploy   # manual migration
```

Database/Redis data persists in the `leadforge-backend` project's `pgdata` /
`redisdata` volumes.
