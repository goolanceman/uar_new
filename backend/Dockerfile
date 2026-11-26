# ─── UAR Backend API ─────────────────────────────────────────────────────────
# Runtime is Bun (matches the repo's bun.lock) with tsx running the TypeScript
# directly so the `@/*` tsconfig path aliases resolve at runtime.
FROM oven/bun:1

WORKDIR /app

# Install dependencies first (layer-cached)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# App source (includes prisma/schema.prisma)
COPY . .

# Generate the Prisma client for the pinned schema
RUN bunx prisma generate

EXPOSE 3005

# prisma db push happens via the compose service or manually — the container
# only starts the API server against DATABASE_URL provided at runtime.
CMD ["bun", "run", "start"]
