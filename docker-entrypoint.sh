#!/bin/sh
set -eu

mkdir -p "$MEDIA_ROOT"
chown -R node:node "$MEDIA_ROOT"

# MySQL 迁移命令由 Drizzle 的迁移表保证幂等；Web 和 worker 启动前均可安全执行。
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  setpriv --reuid=node --regid=node --init-groups \
    ./node_modules/.bin/tsx --env-file=.env src/server/db/migrate.ts
fi

exec setpriv --reuid=node --regid=node --init-groups "$@"
