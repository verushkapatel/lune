#!/usr/bin/env bash
# Copy frontend/ into an already-built pages-site/ (scores and analysis stay).
# For local checks only — a full build is scripts/export_pages.py.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d pages-site/static ] || { echo "No pages-site — build it first (python3 scripts/export_pages.py)"; exit 1; }
rsync -a --exclude sw.js --exclude manifest.webmanifest frontend/ pages-site/static/
cp frontend/index.html frontend/sw.js frontend/manifest.webmanifest pages-site/
rm -f pages-site/static/manifest.json
echo "synced frontend → pages-site"
