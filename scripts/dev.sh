#!/usr/bin/env bash
#
# SmartCard Master 开发辅助脚本
#
# 用法：
#   ./scripts/dev.sh ui [--port 4199]   前端热更新：daemon + Vite（浏览器调试，改 client/ 秒级生效）
#   ./scripts/dev.sh desktop            启动桌面 Tauri（首次会自动先构建 runtime）
#   ./scripts/dev.sh runtime            只构建桌面 runtime（CLI + web-shell 打包进 runtime/）
#   ./scripts/dev.sh sync               只重建 web-shell 并拷进 runtime，快速带到桌面窗口
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
  ./scripts/dev.sh help               显示帮助
EOF
}

need_runtime() {
  if [[ ! -d "$RUNTIME_WEB_SHELL" ]]; then
    warn "runtime 尚未构建，先执行 build:runtime（首次较慢）..."
    pnpm --dir "$DESKTOP" run build:runtime
  fi
}

case "${1:-}" in
  ui)
    shift
    warn "请先关闭正在运行的桌面 App / 其它 qwen serve（会话运行时是单例，否则会话接口会 503）"
    log "启动 daemon + Vite 前端热更新 ..."
    cd "$ROOT"
    exec pnpm run dev:daemon -- "$@"
    ;;
  desktop)
    need_runtime
    log "启动桌面 Tauri (tauri dev) ..."
    exec pnpm --dir "$DESKTOP" run dev
    ;;
  runtime)
    log "构建桌面 runtime ..."
    exec pnpm --dir "$DESKTOP" run build:runtime
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
  "" | -h | --help | help)
    usage
    ;;
  *)
    warn "未知命令：$1"
    usage
    exit 1
    ;;
esac
