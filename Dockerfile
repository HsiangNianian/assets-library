# syntax=docker/dockerfile:1

# Build from the repository root. The resulting image can run either role:
#   docker run ... ghcr.io/<owner>/assets-library pnpm start:web
#   docker run ... ghcr.io/<owner>/assets-library pnpm start:worker
FROM node:22-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

WORKDIR /app

FROM base AS dependencies

# Native dependencies such as better-sqlite3 and sharp may need to compile.
RUN apt-get update \
    && apt-get install --no-install-recommends -y python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS builder

COPY . .
RUN pnpm build

FROM base AS runner

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# These paths are deliberately inside mounted, persistent directories.
ENV DATABASE_PATH=/app/data/assets.db
ENV MEDIA_ROOT=/app/media

WORKDIR /app

# The worker is TypeScript and uses tsx, so retain its runtime dependency and
# source files in addition to the standalone Next.js output.
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/src ./src
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint

RUN touch /app/.env \
    && mkdir -p /app/data /app/media \
    && chmod +x /usr/local/bin/docker-entrypoint

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint"]

# Start the Web service by default. Override this command with
# "pnpm start:worker" to run the background worker from the same image.
CMD ["pnpm", "start:web"]
