#!/usr/bin/env bash
# Clean build of the Lune site, from sources, into a fresh folder.
#
#   scripts/build_site.sh [site-dir]        (default: pages-site)
#
# 1. bundled library: download the open MusicXML sources, write opens.json
# 2. remote catalogue: list fetch-on-open scores (musetrainer, OpenScore)
# 3. ASAP piano scores added to the catalogue
# 4. titles normalised from their sources; duplicates removed; light theme generated
# 5. app files copied in; service worker and manifest placed at the root
# 6. braille music for every piece the translator can handle
# 7. verification: no blocked (in-copyright) piece anywhere
# 8. LUNE_COMMERCIAL=1 only: drop non-commercial-licence scores (ASAP)
# Every step that lists or downloads scores uses scripts/blocked.py.
# It does not publish. Run scripts/publish_pages.sh for that.
set -euo pipefail
cd "$(dirname "$0")/.."
SITE="${1:-pages-site}"
PY="${PYTHON:-.venv/bin/python}"

echo "== 1/7 bundled library → $SITE"
rm -rf "$SITE"
mkdir -p "$SITE/static"
"$PY" scripts/expand_pages_library.py "$SITE"

echo "== 2/7 remote catalogue"
"$PY" scripts/build_remote_catalog.py

echo "== 3/7 ASAP piano scores"
TREE="$(mktemp)"
curl -fsSL "https://api.github.com/repos/fosfrancesco/asap-dataset/git/trees/master?recursive=1" -o "$TREE"
"$PY" scripts/add_asap_catalog.py "$TREE"
rm -f "$TREE"

echo "== 4/7 titles and duplicates"
"$PY" scripts/normalize_titles.py "$SITE"
"$PY" scripts/dedupe_index.py
"$PY" scripts/build_light_theme.py

echo "== 5/7 app files"
rsync -a --exclude sw.js --exclude manifest.webmanifest frontend/ "$SITE/static/"
cp frontend/index.html frontend/sw.js frontend/manifest.webmanifest "$SITE/"
touch "$SITE/.nojekyll"
[ -f pages-site/CNAME ] && cp pages-site/CNAME "$SITE/CNAME" || echo "lune.page" > "$SITE/CNAME"

echo "== 6/7 braille"
if [ "${LUNE_SKIP_BRAILLE:-0}" != "1" ]; then
  "$PY" scripts/braille_export.py "$SITE" | tail -1
  "$PY" scripts/braille_retry.py "$SITE" | tail -1
fi

echo "== 7/7 verification"
"$PY" scripts/verify_no_blocked.py "$SITE"
if [ "${LUNE_COMMERCIAL:-0}" = "1" ]; then
  echo "== 8 commercial catalogue"
  "$PY" scripts/commercial_catalog.py "$SITE"
fi
echo "built: $SITE"
