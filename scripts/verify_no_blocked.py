#!/usr/bin/env python3
"""Fail if a blocked (in-copyright) piece is listed or shipped anywhere.

    python3 scripts/verify_no_blocked.py [site-dir]

Checks the catalogue and search index in frontend/, and in the built site:
file names, opens.json, the braille index, and the opening of every score.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from blocked import BLOCKED  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
site = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "pages-site")
hits = []

for rel in ("frontend/remote-catalog.json", "frontend/search-index.json"):
    for item in json.loads((ROOT / rel).read_text())["items"]:
        text = " ".join(str(item.get(k, "")) for k in ("id", "title", "composer", "hay", "query", "url"))
        if BLOCKED.search(text):
            hits.append(f"{rel}: {item.get('id')}")

if site.exists():
    for path in site.rglob("*"):
        if path.is_file() and BLOCKED.search(path.name):
            hits.append(f"file: {path.relative_to(site)}")
    for rel in ("static/opens.json", "static/remote-catalog.json", "static/search-index.json", "static/braille/index.json"):
        p = site / rel
        if p.exists() and BLOCKED.search(p.read_text(errors="ignore")):
            hits.append(f"listed in {rel}")
    for path in (site / "static" / "scores").glob("*.musicxml"):
        if BLOCKED.search(path.read_text(errors="ignore")[:6000]):
            hits.append(f"score header: {path.name}")

if hits:
    print("BLOCKED MATERIAL FOUND:")
    for h in hits:
        print("  ", h)
    sys.exit(1)
print("clean: no blocked pieces in frontend/ or", site.name)
