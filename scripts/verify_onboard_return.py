#!/usr/bin/env python3
"""Smoke checks for onboard return path + library search-index health."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    onboard = (ROOT / "frontend" / "onboard.js").read_text(encoding="utf-8")
    css = (ROOT / "frontend" / "styles.css").read_text(encoding="utf-8")

    checks = [
        ("composer search input", "id=\"composer-q\"" in onboard or "id='composer-q'" in onboard),
        ("filteredComposers helper", "function filteredComposers" in onboard),
        ("hasCompletedOnboarding gate", "function hasCompletedOnboarding" in onboard),
        ("welcome back mode", 'mode: "back"' in onboard or "mode: 'back'" in onboard),
        ("Welcome back copy", "Welcome back." in onboard),
        ("session welcome-back key", "lune.welcomeBack.session" in onboard),
        ("afterAuth pulls prefs", "pullPrefs" in onboard and "async function afterAuth" in onboard),
        ("composer search CSS", ".onboard-composer-search" in css),
        ("welcome-back moon CSS", ".hello-moon" in css and "hello-moon-drift" in css),
    ]
    for label, ok in checks:
        print(("OK  " if ok else "BAD "), label)
        if not ok:
            fail(label)

    # Returning path must not fall through to showOnboard(0) when onboarded.
    # Heuristic: afterAuth body mentions hasCompletedOnboarding before showOnboard.
    m = re.search(r"async function afterAuth\(\)\s*\{(.+?)\n  \}", onboard, re.S)
    if not m:
        fail("could not parse afterAuth")
    body = m.group(1)
    if "hasCompletedOnboarding()" not in body:
        fail("afterAuth missing hasCompletedOnboarding")
    if body.index("hasCompletedOnboarding()") > body.rfind("showOnboard"):
        fail("hasCompletedOnboarding must run before showOnboard fallback")

    idx_path = ROOT / "frontend" / "search-index.json"
    data = json.loads(idx_path.read_text(encoding="utf-8"))
    items = data.get("items") or []
    composers = {i.get("composer") for i in items if i.get("composer")}
    print(f"OK   search-index pieces={len(items)} composers={len(composers)}")
    if len(items) < 200:
        fail(f"search-index too small ({len(items)})")
    if len(composers) < 10:
        fail(f"too few composers ({len(composers)})")

    cat_path = ROOT / "frontend" / "composers-index.json"
    if not cat_path.exists():
        fail("missing frontend/composers-index.json")
    cat = json.loads(cat_path.read_text(encoding="utf-8"))
    cat_n = int(cat.get("count") or len(cat.get("composers") or []))
    print(f"OK   composers-index count={cat_n}")
    if cat_n < 150:
        fail(f"composers-index too small ({cat_n})")
    if "composers-index.json" not in (ROOT / "frontend" / "onboard.js").read_text(encoding="utf-8"):
        fail("onboard.js does not load composers-index.json")

    # Spot-check famous works exist
    hay = " ".join(f"{i.get('title','')} {i.get('composer','')} {i.get('hay','')}" for i in items).lower()
    for needle in ("clair de lune", "chopin", "beethoven", "bach", "joplin"):
        if needle not in hay:
            fail(f"missing expected library needle: {needle}")
        print(f"OK   library contains {needle!r}")

    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    main()
