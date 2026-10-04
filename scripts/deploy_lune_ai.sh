#!/usr/bin/env bash
# Put Lune AI live for everyone with a Lune account, in one go.
#
#   scripts/deploy_lune_ai.sh
#
# What it does:
#   1. tests the Lune AI Worker (workers/lune-ai)
#   2. signs you in to Cloudflare (a browser window opens the first time)
#   3. deploys the Worker to your free Cloudflare account
#   4. checks it answers, then writes its address into frontend/lune-config.js
#   5. bumps the ?v= stamp, publishes the site to GitHub Pages, commits and pushes
#
# Needs: Node.js (https://nodejs.org, the LTS installer), git, python3, rsync,
# and a free Cloudflare account (https://dash.cloudflare.com/sign-up).
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n== %s\n' "$1"; }
command -v npx >/dev/null || { echo "Node.js is not installed. Get the LTS installer from https://nodejs.org, then run this again."; exit 1; }

say "1/5 Testing the Lune AI Worker"
node workers/lune-ai/test.mjs

say "2/5 Signing in to Cloudflare"
cd workers/lune-ai
if ! npx -y wrangler@4 whoami 2>/dev/null | grep -qi "logged in"; then
  echo "A browser window will open. Sign in to Cloudflare and press Allow."
  npx -y wrangler@4 login
fi

say "3/5 Deploying (the first time, Wrangler may ask you to pick a workers.dev name: any short name is fine)"
OUT="$(npx -y wrangler@4 deploy 2>&1 | tee /dev/stderr)"
URL="$(printf '%s' "$OUT" | grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' | head -1)"
cd ../..
[ -n "$URL" ] || { echo "Could not find the Worker's address in Wrangler's output above. Send that output to Claude."; exit 1; }
echo "Lune AI is at $URL"

say "4/5 Checking it answers"
ok=""
for i in 1 2 3 4 5 6; do
  if curl -fsS "$URL/health" | grep -q '"ok":true'; then ok=1; break; fi
  sleep 5
done
[ -n "$ok" ] || { echo "$URL/health did not answer. Wait a minute and run this script again."; exit 1; }
python3 - "$URL" <<'PY'
import re, sys
from pathlib import Path
p = Path("frontend/lune-config.js")
s = p.read_text(encoding="utf-8")
s2 = re.sub(r'aiServer: "[^"]*",', f'aiServer: "{sys.argv[1]}",', s, count=1)
assert s2 != s or f'aiServer: "{sys.argv[1]}"' in s, "aiServer not found in lune-config.js"
p.write_text(s2, encoding="utf-8")
print("frontend/lune-config.js now points at", sys.argv[1])
PY

say "5/5 Publishing"
python3 - <<'PY'
import re
from pathlib import Path
p = Path("frontend/index.html")
s = p.read_text(encoding="utf-8")
cur = re.search(r"lune(\d+)", re.search(r"\?v=lune\d+", s).group(0)).group(1)
nxt = f"{int(cur) + 1:0{len(cur)}d}"
p.write_text(s.replace(f"lune{cur}", f"lune{nxt}"), encoding="utf-8")
print(f"stamp lune{cur} -> lune{nxt}")
PY
[ -d pages-site/static ] || git worktree add pages-site origin/gh-pages --detach
git -C pages-site fetch -q origin gh-pages && git -C pages-site checkout -q --detach origin/gh-pages
scripts/sync_pages_dev.sh
scripts/publish_pages.sh
git add frontend/lune-config.js frontend/index.html
git commit -m "Turn on Lune AI for account holders ($URL)"
git push
say "Done. In two minutes, open https://lune.page in a private window: the landing page shows Now superpowered with Lune AI."
