#!/usr/bin/env bash
# Installs MediPOS as a launchd agent so it starts when the shop Mac logs in.
#   ./install/install-macos.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-4173}"
PLIST="$HOME/Library/LaunchAgents/com.medipos.pos.plist"

if ! command -v node >/dev/null 2>&1; then
  echo "Node is not installed. Install Node 20 or newer first: https://nodejs.org" >&2
  exit 1
fi
NODE_BIN="$(command -v node)"

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.medipos.pos</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${APP_DIR}/server/index.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>${APP_DIR}</string>
  <key>EnvironmentVariables</key><dict><key>PORT</key><string>${PORT}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${HOME}/Library/Logs/medipos.log</string>
  <key>StandardErrorPath</key><string>${HOME}/Library/Logs/medipos.log</string>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

cat <<DONE

  MediPOS is installed and will start when you log in.

    Open:     http://localhost:${PORT}
    Logs:     tail -f ~/Library/Logs/medipos.log
    Stop:     launchctl unload ${PLIST}
    Start:    launchctl load ${PLIST}

DONE
