#!/usr/bin/env bash
# Builds a MediPOS.app on the desktop so staff double-click an icon, not a script.
#   ./install/setup-macos.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$HERE/.." && pwd)"
APP="$HOME/Desktop/MediPOS.app"

echo
echo "  Setting up MediPOS..."
echo

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is not installed."
  echo "  Install Node 20 or newer from https://nodejs.org, then run this again."
  exit 1
fi
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "  MediPOS needs Node 20 or newer; this Mac has $(node -v)."
  exit 1
fi
echo "  Node $(node -v) found."

chmod +x "$HERE/medipos-launch.sh"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>MediPOS</string>
  <key>CFBundleDisplayName</key><string>MediPOS</string>
  <key>CFBundleIdentifier</key><string>com.medipos.pos</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>MediPOS</string>
  <key>CFBundleIconFile</key><string>MediPOS</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

cat > "$APP/Contents/MacOS/MediPOS" <<LAUNCH
#!/bin/sh
exec "${HERE}/medipos-launch.sh"
LAUNCH
chmod +x "$APP/Contents/MacOS/MediPOS"
cp "$HERE/MediPOS.icns" "$APP/Contents/Resources/MediPOS.icns"

# Gatekeeper flags anything unsigned that arrived from outside; clear it so the
# shop is not asked to approve their own till.
xattr -cr "$APP" 2>/dev/null || true
touch "$APP"
echo "  Put MediPOS.app on the desktop."

echo
read -r -p "  Start MediPOS automatically when this Mac turns on? (Y/n) " auto
if [[ -z "${auto}" || "${auto}" =~ ^[Yy] ]]; then
  osascript -e "tell application \"System Events\" to make login item at end with properties {path:\"$APP\", hidden:true}" >/dev/null
  echo "  It will now open by itself at login."
else
  echo "  Skipped. Staff can open it from the desktop icon."
fi

echo
echo "  Done. Double-click MediPOS on the desktop."
echo
