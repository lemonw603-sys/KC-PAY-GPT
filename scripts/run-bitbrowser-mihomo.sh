#!/usr/bin/env bash
set -euo pipefail

PROXY_DIR="${BITBROWSER_PROXY_DIR:-$HOME/Library/Application Support/AI充值业务/bitbrowser-proxy}"
MIHOMO_BIN="${MIHOMO_BIN:-/opt/homebrew/bin/mihomo}"
LOCK_DIR="$PROXY_DIR/.mihomo.lock"
mkdir "$LOCK_DIR" 2>/dev/null || {
  echo "mihomo already owns $LOCK_DIR" >&2
  exit 73
}
cleanup() { rmdir "$LOCK_DIR" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
exec "$MIHOMO_BIN" -d "$PROXY_DIR" -f "$PROXY_DIR/config.yaml"
