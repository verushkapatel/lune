#!/usr/bin/env bash
# Copy the hand-written frontend over an existing Pages build, without rebuilding
# the library, scores or braille (scripts/export_pages.py takes hours).
# Usage: scripts/sync_pages_dev.sh [site-folder]   (default: pages-site)
# Get a site folder first with: git worktree add pages-site origin/gh-pages --detach
set -euo pipefail
cd "$(dirname "$0")/.."
SITE="${1:-pages-site}"
[ -d "$SITE/static" ] || { echo "No Pages build at $SITE"; exit 1; }
rsync -a --exclude sw.js --exclude manifest.webmanifest --exclude manifest.json frontend/ "$SITE/static/"
cp frontend/index.html "$SITE/index.html"
cp frontend/sw.js frontend/manifest.webmanifest "$SITE/"
grep -o 'v=lune[0-9]*' frontend/index.html | head -1 | cut -d= -f2 > "$SITE/deploy-stamp.txt"
echo "Synced frontend into $SITE (stamp $(cat "$SITE/deploy-stamp.txt"))"
