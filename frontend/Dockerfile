# ---- LeadForge frontend (Next.js standalone) ----
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat

COPY package*.json ./
RUN npm ci

COPY . .

# NEXT_PUBLIC_* vars are baked into the browser bundle at build time, so the
# API URL must be reachable FROM THE USER'S BROWSER (your public domain),
# not an internal docker hostname. Override via --build-arg / compose `args`.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build

# ---- runtime ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Standalone output bundles only what's needed to run
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
