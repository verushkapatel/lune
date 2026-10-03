#!/usr/bin/env python3
"""Remove accidental duplicates from the search index (at the data layer).

Two kinds are removed:
  - the same id listed twice (a bundled piece that is also in a remote list):
    the first, bundled entry is kept;
  - a remote entry whose score is already bundled under another id: same
    composer and same normalised title as a bundled entry.
Different movements, arrangements ("easy", "fingered", "for beginner") and
editions with different titles are different entries and are kept.
"""
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def norm(text: str) -> str:
    t = unicodedata.normalize("NFD", text or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def main() -> None:
    path = ROOT / "frontend" / "search-index.json"
    data = json.loads(path.read_text())
    seen_id, seen_work, out = set(), set(), []
    dropped_id = dropped_work = 0
    # bundled entries first, so they win
    items = sorted(data["items"], key=lambda i: bool(i.get("remote")))
    for item in items:
        if item["id"] in seen_id:
            dropped_id += 1
            continue
        work = (norm(item.get("composer", "")).split(" ")[-1:], norm(item.get("title", "")))
        key = (tuple(work[0]), work[1])
        if item.get("remote") and work[1] and key in seen_work:
            dropped_work += 1
            continue
        seen_id.add(item["id"])
        seen_work.add(key)
        out.append(item)
    data["items"] = out
    data["count"] = len(out)
    if isinstance(data.get("remote"), int):
        data["remote"] = sum(1 for i in out if i.get("remote"))
    path.write_text(json.dumps(data, ensure_ascii=False))
    print(f"search index: {len(out)} entries ({dropped_id} repeated ids and {dropped_work} already-bundled works removed)")


if __name__ == "__main__":
    main()
