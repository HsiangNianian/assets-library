#!/bin/sh
set -eu

database_dir=$(dirname "$DATABASE_PATH")
mkdir -p "$database_dir" "$MEDIA_ROOT"
chown -R node:node "$database_dir" "$MEDIA_ROOT"

exec setpriv --reuid=node --regid=node --init-groups "$@"
