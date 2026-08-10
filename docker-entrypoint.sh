#!/bin/sh
set -eu

database_dir=$(dirname "$DATABASE_PATH")
mkdir -p "$database_dir" "$MEDIA_ROOT"
chown -R node:node "$database_dir" "$MEDIA_ROOT"

# Each long-running service verifies the schema before it starts. flock keeps
# Web and worker from running SQLite migrations concurrently on first startup.
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  flock "$database_dir/.migration.lock" \
    setpriv --reuid=node --regid=node --init-groups \
    ./node_modules/.bin/tsx --env-file=.env src/server/db/migrate.ts
fi

exec setpriv --reuid=node --regid=node --init-groups "$@"
