#!/usr/bin/env sh
# Opens MediPOS as its own window, with no address bar or tabs, so the counter
# looks like a till rather than a browser.
PORT="${PORT:-4173}"
URL="http://localhost:${PORT}"

for BROWSER in google-chrome chromium chromium-browser brave-browser microsoft-edge; do
  if command -v "$BROWSER" >/dev/null 2>&1; then
    exec "$BROWSER" --app="$URL" --start-maximized
  fi
done

echo "No Chrome-based browser found; opening in the default browser instead."
xdg-open "$URL"
