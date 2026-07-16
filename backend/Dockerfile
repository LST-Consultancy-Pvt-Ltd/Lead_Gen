# ---- LeadForge backend (Express + Prisma + Postgres/Redis) ----
FROM node:20-alpine AS deps
WORKDIR /app
# Prisma needs openssl on Alpine to generate/run its query engine
RUN apk add --no-cache openssl libc6-compat
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev
# Generate the Prisma client against the installed deps
RUN npx prisma generate

# ---- runtime ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl libc6-compat wget

# node_modules (incl. generated prisma client) + app source
COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 4000

# Container-level healthcheck hitting the app's /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health || exit 1

# Apply pending migrations, then boot the API
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
