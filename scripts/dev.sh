#!/usr/bin/env bash
#
# SmartCard Master 开发辅助脚本
#
# 用法：
#   ./scripts/dev.sh ui [--port 4199]   前端热更新：daemon + Vite（浏览器调试，改 client/ 秒级生效）
#   ./scripts/dev.sh desktop            启动桌面 Tauri（首次会自动先构建 runtime）
#   ./scripts/dev.sh runtime            只构建桌面 runtime（CLI + web-shell 打包进 runtime/）
#   ./scripts/dev.sh sync               只重建 web-shell 并拷进 runtime，快速带到桌面窗口
#   ./scripts/dev.sh stopdaemon         终止残留的 daemon 进程（cli-entry.js serve）
#   ./scripts/dev.sh help               显示本帮助
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP="$ROOT/packages/desktop"
WEBSHELL="$ROOT/packages/web-shell"
RUNTIME_WEB_SHELL="$DESKTOP/runtime/qwen-code/lib/web-shell"

log()  { printf '\033[1;36m[dev]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[dev]\033[0m %s\n' "$*" >&2; }

usage() {
  cat <<'EOF'
SmartCard Master 开发辅助

  ./scripts/dev.sh ui [--port 4199]   前端热更新：daemon + Vite；打开输出的 Vite 地址
                                      （默认 5173，被占自动 +1）。改 packages/web-shell/client/**
                                      即时生效。启动前请先关闭桌面 App / 其它 qwen serve。
  ./scripts/dev.sh desktop            启动桌面 Tauri（runtime 不存在时会先 build:runtime）
  ./scripts/dev.sh runtime            只构建桌面 runtime
  ./scripts/dev.sh sync               只重建 web-shell 并拷进 runtime；改完前端后重启桌面 App
  ./scripts/dev.sh stopdaemon         终止残留的 daemon 进程（cli-entry.js serve）
                                      （桌面 App 关窗口不会结束 daemon，残留会跑旧代码）
  ./scripts/dev.sh help               显示帮助
EOF
}

need_runtime() {
  if [[ ! -d "$RUNTIME_WEB_SHELL" ]]; then
    warn "runtime 尚未构建，先执行 build:runtime（首次较慢）..."
    ( cd "$DESKTOP" && npm run build:runtime )
  fi
}

# packages/desktop 被 pnpm-workspace.yaml 排除（'!packages/desktop'），是独立
# npm 包（自带 package-lock.json）。根 `pnpm install` 不会装它，需在目录内 `npm ci`。
need_desktop_deps() {
  if [[ ! -x "$DESKTOP/node_modules/.bin/tauri" ]]; then
    log "安装桌面依赖（packages/desktop 是独立 npm 包，单独 npm ci）..."
    ( cd "$DESKTOP" && npm ci --no-audit --progress=false )
  fi
}

# 终止残留的 daemon 进程。桌面 App 关窗口不会结束它，残留会继续跑旧 runtime
# （表现为改动不生效、或旧 daemon 占用端口导致 token 不匹配 401）。
stop_daemon() {
  local pattern="node .*runtime/qwen-code/lib/cli-entry.js serve"
  # 排除本脚本及其父 shell：命令行里若出现该 pattern 字符串（如把本命令写进
  # 一条复合命令），pgrep -f 会把调用者自己也匹配进来并误杀。
  local pids
  pids="$(
    pgrep -f "$pattern" 2>/dev/null |
      grep -vx -e "$$" -e "${PPID:-0}" || true
  )"
  if [[ -z "$pids" ]]; then
    log "没有正在运行的 daemon"
    return 0
  fi
  log "终止 daemon 进程：$(echo "$pids" | tr '\n' ' ')"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  for _ in $(seq 1 20); do
    if ! pgrep -f "$pattern" >/dev/null 2>&1; then
      log "daemon 已停止"
      return 0
    fi
    sleep 0.5
  done
  warn "daemon 未在 10s 内退出，强制结束"
  pkill -9 -f "$pattern" 2>/dev/null || true
}

case "${1:-}" in
  ui)
    shift
    warn "请先关闭正在运行的桌面 App / 其它 qwen serve（会话运行时是单例，否则会话接口会 503）"
    log "启动 daemon + Vite 前端热更新 ..."
    cd "$ROOT"
    exec pnpm run dev:daemon "$@"
    ;;
  desktop)
    need_runtime
    need_desktop_deps
    log "启动桌面 Tauri (tauri dev) ..."
    cd "$DESKTOP"
    exec npm run dev
    ;;
  runtime)
    log "构建桌面 runtime ..."
    cd "$DESKTOP"
    exec npm run build:runtime
    ;;
  sync)
    need_runtime
    log "重建 web-shell ..."
    pnpm --dir "$WEBSHELL" run build
    log "拷贝到 runtime：$RUNTIME_WEB_SHELL"
    rm -rf "$RUNTIME_WEB_SHELL"
    cp -r "$WEBSHELL/dist" "$RUNTIME_WEB_SHELL"
    log "完成。请重启桌面 App（或窗口里的 Restart）使改动生效"
    ;;
  stopdaemon)
    stop_daemon
    ;;
  "" | -h | --help | help)
    usage
    ;;
  *)
    warn "未知命令：$1"
    usage
    exit 1
    ;;
esac
