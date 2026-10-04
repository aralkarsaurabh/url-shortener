# Build from the repo root, because the lockfile lives there:
#   docker build -f url-shortener/Dockerfile -t system-design/url-shortener .

# ---------- Stage 1: production dependencies ----------
FROM node:24-alpine AS deps
WORKDIR /app
# The lockfile covers every workspace, so all their package.json files must be present.
COPY package.json package-lock.json ./
COPY url-shortener/package.json url-shortener/
COPY rate-limiter/package.json rate-limiter/
COPY round-robin-load-balancer/package.json round-robin-load-balancer/
RUN npm ci --omit=dev --workspace url-shortener

# ---------- Stage 2: runner ----------
FROM node:24-alpine AS runner
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY url-shortener/package.json url-shortener/
COPY url-shortener/src url-shortener/src
USER node
EXPOSE 3000
# Unhealthy only when Postgres is down (503). Redis down is "degraded" (200): the service still works.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "url-shortener/src/server.js"]
