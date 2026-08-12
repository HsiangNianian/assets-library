#!/usr/bin/env bash
# 启动 assets-library 的所有服务：Chroma + Next.js Web + worker
# 模式由 .env 的 APP_MODE 决定（prd 默认 / dev）
set -euo pipefail

cd "$(dirname "$0")/.."

# 读取 .env（APP_MODE 等变量在此定义）；命令行环境变量优先于 .env
if [ -f .env ]; then
  # 只导入 .env 中尚未在环境中设置的变量，避免覆盖 ./scripts/start.sh APP_MODE=dev 这类显式覆盖
  set -a
  while IFS='=' read -r key value || [ -n "$key" ]; do
    case "$key" in
      ''|\#*) continue ;;
    esac
    [ -n "${!key:-}" ] || export "$key=$value"
  done < .env
  set +a
fi

PORT="${PORT:-23015}"
CHROMA_PORT="${CHROMA_PORT:-23016}"
APP_MODE="${APP_MODE:-prd}"
CHROMA_DIR="$(pwd)/chroma-data"
PID_DIR="$(pwd)/.run"
mkdir -p "$PID_DIR" "$CHROMA_DIR"

c_ok()    { printf '\033[0;32m%s\033[0m\n' "$*"; }
c_warn()  { printf '\033[0;33m%s\033[0m\n' "$*"; }
c_err()   { printf '\033[0;31m%s\033[0m\n' "$*"; }
c_info()  { printf '\033[0;36m%s\033[0m\n' "$*"; }

is_running() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

# ---------- Chroma ----------
CHROMA_PID_FILE="$PID_DIR/chroma.pid"
CHROMA_LOG="$PID_DIR/chroma.log"

if is_running "$CHROMA_PID_FILE"; then
  c_warn "Chroma 已在运行 (PID $(cat "$CHROMA_PID_FILE"))"
else
  c_info "启动 Chroma @ 0.0.0.0:$CHROMA_PORT ..."
  nohup env UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple uvx --from chromadb chroma run \
    --path "$CHROMA_DIR" \
    --host 0.0.0.0 \
    --port "$CHROMA_PORT" \
    > "$CHROMA_LOG" 2>&1 &
  echo $! > "$CHROMA_PID_FILE"
  # 等待端口就绪
  for i in $(seq 1 30); do
    if curl -sS -m 1 "http://127.0.0.1:$CHROMA_PORT/api/v2/heartbeat" >/dev/null 2>&1 \
       || curl -sS -m 1 "http://127.0.0.1:$CHROMA_PORT/api/v1/heartbeat" >/dev/null 2>&1; then
      c_ok "Chroma 就绪 (PID $(cat "$CHROMA_PID_FILE"))"
      break
    fi
    sleep 1
    [ "$i" = 30 ] && { c_err "Chroma 30s 内未就绪，查看日志: $CHROMA_LOG"; }
  done
fi

# ---------- 数据库迁移 ----------
DB_PID_FILE="$PID_DIR/db-migrate.done"
if [ ! -f "$DB_PID_FILE" ]; then
  c_info "执行数据库迁移 ..."
  pnpm run db:migrate
  touch "$DB_PID_FILE"
  c_ok "数据库迁移完成"
else
  c_warn "跳过数据库迁移（删除 .run/db-migrate.done 可强制重跑）"
fi

# ---------- Web + worker ----------
APP_PID_FILE="$PID_DIR/app.pid"
APP_LOG="$PID_DIR/app.log"

if is_running "$APP_PID_FILE"; then
  c_warn "Web+worker 已在运行 (PID $(cat "$APP_PID_FILE"))"
else
  if [ "$APP_MODE" = "dev" ]; then
    c_info "启动 Web + worker [dev/turbopack] (PORT=$PORT) ..."
    PORT="$PORT" HOSTNAME=0.0.0.0 nohup pnpm run dev > "$APP_LOG" 2>&1 &
  else
    # prd: 确保 build 产物存在
    if [ ! -d ".next" ] || [ ! -f ".next/BUILD_ID" ]; then
      c_info "生产模式首次启动，执行 build ..."
      pnpm run build
    fi
    c_info "启动 Web + worker [prd] (PORT=$PORT) ..."
    PORT="$PORT" HOSTNAME=0.0.0.0 nohup pnpm run start:all > "$APP_LOG" 2>&1 &
  fi
  echo $! > "$APP_PID_FILE"
  # prd 秒起，dev 首次编译慢，统一给 60s
  for i in $(seq 1 60); do
    if curl -sS -m 1 "http://127.0.0.1:$PORT" >/dev/null 2>&1; then
      c_ok "Web 就绪 → http://0.0.0.0:$PORT  [mode=$APP_MODE]"
      break
    fi
    sleep 1
    [ "$i" = 60 ] && c_err "Web 60s 内未响应，查看日志: $APP_LOG"
  done
fi

echo
c_ok "全部就绪。  [mode=$APP_MODE]"
echo "  Web:     http://0.0.0.0:$PORT"
echo "  Chroma:  http://0.0.0.0:$CHROMA_PORT"
echo "  模式:    $APP_MODE  (改 .env 的 APP_MODE=dev 切开发模式)"
echo "  日志:    $PID_DIR/{chroma,app}.log"
echo "  关闭:    ./scripts/stop.sh"
