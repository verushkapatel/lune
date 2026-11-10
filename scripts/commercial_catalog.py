#!/usr/bin/env python3
"""Remove every non-commercial-licence score from a built site's catalogue.

Today that is the ASAP dataset (235 movements, CC BY-NC-SA 4.0). The free
site may list them; a paid product may not. Run this on a built site before
publishing a commercial version:

    python3 scripts/commercial_catalog.py pages-site
    LUNE_COMMERCIAL=1 scripts/build_site.sh        (does the same as step 8)

It edits remote-catalog.json and search-index.json in <site>/static and
prints what it removed. Scores are fetched on open, so nothing else ships them.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

NC_SOURCES = {"asap"}


def non_commercial(item: dict, credits: dict) -> bool:
    src = item.get("source")
    lic = (item.get("credit") or credits.get(src) or {}).get("license", "")
    return src in NC_SOURCES or "-NC" in lic.upper() or " NC" in lic.upper()


def main(site: str) -> int:
    static = Path(site) / "static"
    cat_path, idx_path = static / "remote-catalog.json", static / "search-index.json"
    cat = json.loads(cat_path.read_text())
    credits = cat.get("credits", {})
    gone = {i["id"] for i in cat["items"] if non_commercial(i, credits)}
    gone_sources = {i.get("source") for i in cat["items"] if i["id"] in gone}
    cat["items"] = [i for i in cat["items"] if i["id"] not in gone]
    cat["count"] = len(cat["items"])
    for s in gone_sources:
        cat.get("credits", {}).pop(s, None)
    cat_path.write_text(json.dumps(cat, ensure_ascii=False))

    idx = json.loads(idx_path.read_text())
    before = len(idx["items"])
    idx["items"] = [i for i in idx["items"] if i["id"] not in gone and i.get("source") not in gone_sources]
    idx["count"] = len(idx["items"])
    idx["remote"] = sum(1 for i in idx["items"] if i.get("remote"))
    idx_path.write_text(json.dumps(idx, ensure_ascii=False))
    print(f"removed {len(gone)} non-commercial scores ({', '.join(sorted(filter(None, gone_sources))) or 'none'}); "
          f"catalogue {cat['count']}, search index {before} → {idx['count']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "pages-site"))
