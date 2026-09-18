#!/usr/bin/env bash
# Puts a MediPOS icon on the desktop and (optionally) starts it at login.
#   ./install/setup-linux.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$HERE/.." && pwd)"
DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"

echo
echo "  Setting up MediPOS..."
echo

BUNDLED="$(ls -d "$HERE/../runtime/"*/node 2>/dev/null | head -1 || true)"
if [ -n "$BUNDLED" ] && [ -x "$BUNDLED" ]; then
  echo "  Node is bundled with MediPOS - nothing to install."
elif ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is not installed."
  echo "  Install Node 20 or newer from https://nodejs.org, then run this again."
  exit 1
elif [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "  MediPOS needs Node 20 or newer; this computer has $(node -v)."
  exit 1
else
  echo "  Node $(node -v) found."
fi

chmod +x "$HERE/medipos-launch.sh"

write_entry() {
  cat > "$1" <<DESKTOP
[Desktop Entry]
Type=Application
Name=MediPOS
Comment=Open the MediPOS till
Exec=${HERE}/medipos-launch.sh
Icon=${HERE}/MediPOS.png
Terminal=false
Categories=Office;
DESKTOP
  chmod +x "$1"
}

mkdir -p "$DESKTOP_DIR" "$HOME/.local/share/applications"
write_entry "$DESKTOP_DIR/MediPOS.desktop"
write_entry "$HOME/.local/share/applications/MediPOS.desktop"
# GNOME wants desktop launchers explicitly marked as trusted.
gio set "$DESKTOP_DIR/MediPOS.desktop" metadata::trusted true 2>/dev/null || true
echo "  Put a MediPOS icon on the desktop and in the applications menu."

echo
read -r -p "  Start MediPOS automatically when this computer turns on? (Y/n) " auto
if [[ -z "${auto}" || "${auto}" =~ ^[Yy] ]]; then
  mkdir -p "$HOME/.config/autostart"
  write_entry "$HOME/.config/autostart/MediPOS.desktop"
  echo "  It will now open by itself at login."
else
  echo "  Skipped. Staff can open it from the desktop icon."
fi

echo
echo "  Done. Double-click the MediPOS icon on the desktop."
echo
