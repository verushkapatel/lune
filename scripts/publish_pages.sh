#!/usr/bin/env bash
# Publish a built Pages site to the gh-pages branch (https://verushkapatel.github.io/lune/).
# Usage: scripts/publish_pages.sh [site-folder]   (default: pages-site)
set -euo pipefail
cd "$(dirname "$0")/.."
SITE="${1:-pages-site}"
[ -f "$SITE/index.html" ] || { echo "No site at $SITE — build it first (python3 scripts/export_pages.py)"; exit 1; }
WORK="$(mktemp -d)"
git fetch -q origin gh-pages
git worktree add -q "$WORK" origin/gh-pages --detach
rsync -a --delete --exclude .git "$SITE"/ "$WORK"/
cd "$WORK"
git add -A
git commit -q -m "Publish Lune site from $(git -C "$OLDPWD" rev-parse --short HEAD 2>/dev/null || echo local)" || echo "nothing to publish"
git push origin HEAD:gh-pages
cd - >/dev/null
git worktree remove --force "$WORK"
echo "Published: https://verushkapatel.github.io/lune/"
