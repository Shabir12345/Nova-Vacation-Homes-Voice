# Multi-stage build — keeps the final image lean (~150MB vs ~800MB)

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (cached layer — only re-runs when package.json changes)
COPY package*.json ./
RUN npm ci --include=dev

# Build TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Security: run as non-root user
RUN addgroup -S nova && adduser -S nova -G nova

WORKDIR /app

# Copy only what's needed to run
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/src/db/*.sql ./dist/db/
COPY --from=builder /app/package.json ./

# Don't expose .env — mount it at runtime or use environment variables
ENV NODE_ENV=production

USER nova
EXPOSE 3000

# Health check — Twilio needs the server responsive
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
