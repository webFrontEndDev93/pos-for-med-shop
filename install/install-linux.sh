#!/usr/bin/env bash
# Installs MediPOS as a systemd service so the till is ready when the shop opens.
#   sudo ./install/install-linux.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_AS="${SUDO_USER:-$USER}"
PORT="${PORT:-4173}"
SERVICE=/etc/systemd/system/medipos.service

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo:  sudo $0" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node is not installed. Install Node 20 or newer first: https://nodejs.org" >&2
  exit 1
fi

NODE_BIN="$(command -v node)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "MediPOS needs Node 20 or newer; this machine has $(node -v)." >&2
  exit 1
fi

cat > "$SERVICE" <<UNIT
[Unit]
Description=MediPOS point of sale
After=network.target

[Service]
Type=simple
User=${RUN_AS}
WorkingDirectory=${APP_DIR}
Environment=PORT=${PORT}
ExecStart=${NODE_BIN} ${APP_DIR}/server/index.mjs
# A till must come back by itself after a crash or a power cut.
Restart=always
RestartSec=2
StandardOutput=append:/var/log/medipos.log
StandardError=append:/var/log/medipos.log

[Install]
WantedBy=multi-user.target
UNIT

touch /var/log/medipos.log
chown "$RUN_AS" /var/log/medipos.log

systemctl daemon-reload
systemctl enable medipos
systemctl restart medipos
sleep 2
systemctl --no-pager --lines=10 status medipos || true

cat <<DONE

  MediPOS is installed and will start automatically at boot.

    Open:     http://localhost:${PORT}
    Logs:     tail -f /var/log/medipos.log
    Stop:     sudo systemctl stop medipos
    Start:    sudo systemctl start medipos
    Remove:   sudo systemctl disable --now medipos && sudo rm ${SERVICE}

DONE
