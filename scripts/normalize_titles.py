#!/usr/bin/env python3
"""Give weakly titled bundled pieces the title their source already states.

Some Humdrum-derived scores were listed by opus alone ("Op. 11") although the
file name carries the number within the opus and the score carries the kind
of piece ("Prelude"). This rewrites those titles as "Prelude, Op. 11 No. 14"
using only those two facts from the source. Nothing is guessed: if either is
missing, the title is left as it was.

    python3 scripts/normalize_titles.py [site-dir]
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
site = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "pages-site")
WEAK = re.compile(r"^((?:[A-Z][\w’' -]+, )?Op\.?\s*\d+[a-z]?|No\.?\s*\d+|\d+)$", re.I)


def better(row: dict) -> str | None:
    if not WEAK.match(row["title"].strip()):
        return None
    name = Path(row["file"]).name
    # prefer the fullest form in the name: op11_no14 before a bare op11
    m = re.search(r"op(\d+)[a-z]?_no(\d+)", name, flags=re.I) or re.search(r"op(\d+)[a-z]?()", name, flags=re.I)
    if not m:
        return None
    path = site / "static" / row["file"]
    if not path.exists():
        return None
    head = path.read_text(errors="ignore")[:4000]
    kind = re.search(r"<movement-title>([^<]+)</movement-title>", head) or re.search(r"<work-title>([^<]+)</work-title>", head)
    if not kind or WEAK.match(kind.group(1).strip()):
        return None
    title = f"{kind.group(1).strip()}, Op. {int(m.group(1))}"
    if m.group(2):
        title += f" No. {int(m.group(2))}"
    return title


def main() -> None:
    opens_path = site / "static" / "opens.json"
    opens = json.loads(opens_path.read_text())
    changed = {}
    for row in opens:
        # the entry and its own overview must name the piece the same way; the
        # overview's title comes from the curated catalogue, so it wins
        curated = row.get("overview", {}).get("title") if isinstance(row.get("overview"), dict) else None
        # a piece with a stored analysis shows that analysis's title once opened: list it the same way
        if row.get("analysis"):
            try:
                shown = json.loads((site / "static" / row["analysis"]).read_text()).get("title")
                if shown and shown.strip():
                    curated = shown
                    row["title"], row_was = "", row["title"]  # force adoption below, whatever its form
                    if curated == row_was:
                        row["title"] = row_was
            except (OSError, ValueError):
                pass
        if curated and curated != row["title"] and (row["title"] == "" or not WEAK.match(curated.strip())):
            changed[row["id"]] = curated
            row["title"] = curated
            if isinstance(row.get("overview"), dict):
                row["overview"]["title"] = curated
            continue
        title = better(row)
        if title and title != row["title"]:
            changed[row["id"]] = title
            row["title"] = title
            if isinstance(row.get("overview"), dict):
                row["overview"]["title"] = title
            row["hay"] = f"{row.get('hay', '')} {title.lower()}".strip()
    opens_path.write_text(json.dumps(opens))
    for idx_path in (ROOT / "frontend" / "search-index.json", site / "static" / "search-index.json"):
        if not idx_path.exists():
            continue
        idx = json.loads(idx_path.read_text())
        for item in idx["items"]:
            if item["id"] in changed:
                item["title"] = changed[item["id"]]
                item["hay"] = f"{item.get('hay', '')} {changed[item['id']].lower()}".strip()
        idx_path.write_text(json.dumps(idx, ensure_ascii=False))
    print(f"{len(changed)} titles normalised from their sources")
    for k in list(changed)[:4]:
        print("  ", k, "→", changed[k])


if __name__ == "__main__":
    main()
