# ─── UAR Web (Next.js, standalone output) ────────────────────────────────────
# Bun runtime matches the repo (bun.lock). next.config.ts bakes the /api
# rewrites (BACKEND_URL) into the build output, so BACKEND_URL must be set at
# BUILD time — passed from docker-compose.yml build args — and is also set at
# runtime for good measure.

FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG BACKEND_URL=http://api:3005
ENV BACKEND_URL=$BACKEND_URL
ENV NEXT_TELEMETRY_DISABLED=1
# package.json build script: next build + copies .next/static and public into
# .next/standalone so the standalone server serves everything unchanged.
RUN bun run build

FROM oven/bun:1 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3006
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/.next/standalone ./
EXPOSE 3006
CMD ["bun", "server.js"]
