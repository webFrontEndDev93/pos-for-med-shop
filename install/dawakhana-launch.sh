#!/usr/bin/env bash
# Starts Dawakhana if it is not already running, then opens it in its own window.
# Used by the desktop shortcut on Linux and by the macOS app bundle.
set -u

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-4173}"

# A runtime bundled under runtime/<platform>/node wins over anything installed,
# so a packaged shop needs no install and no internet.
NODE_BIN="node"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)  CANDIDATE="$APP_DIR/runtime/linux-x64/node" ;;
  Darwin-arm64)  CANDIDATE="$APP_DIR/runtime/darwin-arm64/node" ;;
  Darwin-x86_64) CANDIDATE="$APP_DIR/runtime/darwin-x64/node" ;;
  *)             CANDIDATE="" ;;
esac
if [ -n "$CANDIDATE" ] && [ -x "$CANDIDATE" ]; then NODE_BIN="$CANDIDATE"; fi
URL="http://localhost:${PORT}"
LOG="${APP_DIR}/server/data/dawakhana.log"

up() { curl -fsS --max-time 2 "${URL}/api/health" >/dev/null 2>&1; }

notify() {
  # Whatever this desktop has: a dialog, a notification, or just the terminal.
  if command -v zenity >/dev/null 2>&1; then zenity --error --title=Dawakhana --text="$1" 2>/dev/null
  elif command -v osascript >/dev/null 2>&1; then osascript -e "display alert \"Dawakhana\" message \"$1\"" >/dev/null 2>&1
  else echo "$1" >&2
  fi
}

if [ "$NODE_BIN" = "node" ] && ! command -v node >/dev/null 2>&1; then
  notify "Dawakhana needs Node.js, which is not installed. Install it once from https://nodejs.org, then open Dawakhana again."
  exit 1
fi

if ! up; then
  mkdir -p "${APP_DIR}/server/data"
  ( cd "$APP_DIR" && nohup "$NODE_BIN" server/index.mjs >>"$LOG" 2>&1 & ) >/dev/null 2>&1
  # Up to 30s — the first start also seeds the demo shop.
  for _ in $(seq 1 60); do
    sleep 0.5
    up && break
  done
fi

if ! up; then
  notify "Dawakhana did not start. See ${LOG}. The shop's records are safe in ${APP_DIR}/server/data."
  exit 1
fi

# App mode: no tabs, no address bar — it looks like a till, not a browser.
for browser in google-chrome chromium chromium-browser brave-browser microsoft-edge; do
  if command -v "$browser" >/dev/null 2>&1; then
    exec "$browser" --app="$URL" --start-maximized
  fi
done

if command -v open >/dev/null 2>&1; then
  for app in "Google Chrome" "Microsoft Edge"; do
    if [ -d "/Applications/${app}.app" ]; then
      exec open -na "$app" --args --app="$URL" --start-maximized
    fi
  done
  exec open "$URL"
fi

exec xdg-open "$URL"
