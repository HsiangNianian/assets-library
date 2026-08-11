#!/usr/bin/env bash
# 停止 assets-library 的所有服务：Web + worker + Chroma
set -euo pipefail

cd "$(dirname "$0")/.."

PID_DIR="$(pwd)/.run"

c_ok()   { printf '\033[0;32m%s\033[0m\n' "$*"; }
c_warn() { printf '\033[0;33m%s\033[0m\n' "$*"; }
c_info() { printf '\033[0;36m%s\033[0m\n' "$*"; }

stop_pid_file() {
  local name="$1" file="$2"
  if [ -f "$file" ]; then
    local pid
    pid="$(cat "$file")"
    if kill -0 "$pid" 2>/dev/null; then
      c_info "停止 $name (PID $pid) ..."
      kill "$pid" 2>/dev/null || true
      for i in $(seq 1 10); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
      done
      if kill -0 "$pid" 2>/dev/null; then
        c_warn "$name 未在 10s 内退出，发送 SIGKILL"
        kill -9 "$pid" 2>/dev/null || true
      fi
      c_ok "$name 已停止"
    else
      c_warn "$name 进程已不存在（清理残留 PID 文件）"
    fi
    rm -f "$file"
  else
    c_warn "$name 未在运行（无 PID 文件）"
  fi
}

# 先停 Web+worker（dev/prd 都是 concurrently 父进程，会带走 next 和 tsx 子进程）
stop_pid_file "Web+worker" "$PID_DIR/app.pid"

# 再停 Chroma
stop_pid_file "Chroma" "$PID_DIR/chroma.pid"

echo
c_ok "全部已停止。数据保留在 ./data、./media、./chroma-data。"
