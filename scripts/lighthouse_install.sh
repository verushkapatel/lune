#!/usr/bin/env bash
# Lighthouse installability audit. Lighthouse 12 removed the PWA category, so
# this pins 11.7.1, the last version with installable-manifest.
# Usage: scripts/lighthouse_install.sh [url]   (default: the local dev server)
set -euo pipefail
URL="${1:-http://localhost:8137/lune/}"
DIR="${LH_DIR:-/tmp/lune-lighthouse}"
mkdir -p "$DIR"
[ -x "$DIR/node_modules/.bin/lighthouse" ] || (cd "$DIR" && npm init -y >/dev/null && npm i -s lighthouse@11.7.1 >/dev/null)
export CHROME_PATH="${CHROME_PATH:-$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1)}"
"$DIR/node_modules/.bin/lighthouse" "$URL" --only-categories=pwa --output=json --output-path="$DIR/report.json" \
  --chrome-flags="--headless=new --no-sandbox" --quiet
python3 - "$DIR/report.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
print("Lighthouse", r["lighthouseVersion"], "PWA score", r["categories"]["pwa"]["score"])
bad = 0
for k in ["installable-manifest", "splash-screen", "themed-omnibox", "maskable-icon", "viewport", "content-width"]:
    a = r["audits"][k]
    print(("PASS" if a["score"] == 1 else "FAIL"), k, a.get("explanation") or "")
    bad += a["score"] != 1
sys.exit(1 if bad else 0)
PY
