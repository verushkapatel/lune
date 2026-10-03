#!/usr/bin/env python3
"""Build the static site for https://verushkapatel.github.io/lune.

Uses scores already on disk (bundled library and the local cache). It does not
download new files. Analysis is written beside each score so the Pages site can
open a piece without the Python server.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))

# Keep a developer .env key off the public export.
os.environ["OPENAI_API_KEY"] = ""
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ.setdefault("LUNE_CACHE_DIR", "/tmp/lune-pages-analysis")

import backend.scoresource as scoresource  # noqa: E402

scoresource._download = lambda *args, **kwargs: None  # noqa: SLF001


def _cached_corpus_only(source_s: str):
    """Never parse the music21 corpus during export — use a file already on disk."""
    cache_name = "corpus_" + re.sub(r"[^a-zA-Z0-9]+", "_", source_s)[-90:] + ".musicxml"
    cached = scoresource._cache_dir() / cache_name  # noqa: SLF001
    if cached.exists() and cached.stat().st_size > 500:
        return cached
    return None


scoresource._parse_corpus_path = _cached_corpus_only  # noqa: SLF001

from backend.discover import piece_overview  # noqa: E402
from backend.main import _piece_from_path_cached  # noqa: E402

SITE = Path(os.environ.get("LUNE_PAGES_DIR") or "/tmp/lune-pages")
INDEX = ROOT / "frontend" / "search-index.json"


def slug(path: Path) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", path.stem).strip("_")[:60] or "score"
    digest = hashlib.sha1(str(path.resolve()).encode()).hexdigest()[:8]
    return f"{stem}_{digest}"


def main() -> None:
    data = json.loads(INDEX.read_text(encoding="utf-8"))
    items = data["items"] if isinstance(data, dict) else data
    print(f"search items: {len(items)}", flush=True)
    print("collecting scores already on disk", flush=True)
    available = []
    for entry in scoresource.build_catalogue():
        path = scoresource._fetch_from_catalogue_entry(entry)  # noqa: SLF001
        if not path:
            continue
        path = Path(path)
        if path.exists() and path.stat().st_size > 500:
            available.append((entry, path))
    print(f"files on disk: {len(available)}", flush=True)

    by_path: dict[str, dict] = {}
    rows = []
    t0 = time.time()
    for item in items:
        title = (item.get("title") or "").strip()
        composer = (item.get("composer") or "").strip()
        query = (item.get("query") or "").strip()
        blob = scoresource._norm(f"{query} {composer} {title}")  # noqa: SLF001
        best_score = 0
        best_entry = None
        best_path = None
        for entry, path in available:
            score = scoresource._title_score(blob, entry)  # noqa: SLF001
            if scoresource._composer_hit(blob, entry.get("composer") or ""):  # noqa: SLF001
                score += 2
            if score > best_score:
                best_score = score
                best_entry = entry
                best_path = path
        if not best_entry or not best_path or best_score < 8:
            continue
        resolved = {
            "path": str(best_path),
            "title": best_entry.get("title") or title,
            "composer": best_entry.get("composer") or composer,
            "source": best_entry.get("source") or "library",
        }
        key = str(best_path.resolve())
        if key not in by_path:
            by_path[key] = {"path": best_path, "name": slug(best_path), "resolved": resolved}
        rows.append((item, resolved, key))

    print(
        f"matched {len(rows)} searches to {len(by_path)} files in {time.time() - t0:.1f}s",
        flush=True,
    )

    if SITE.exists():
        shutil.rmtree(SITE)
    scores = SITE / "static" / "scores"
    analyses = SITE / "static" / "analysis"
    scores.mkdir(parents=True)
    analyses.mkdir(parents=True)

    analysed: dict[str, dict] = {}
    for n, (key, info) in enumerate(by_path.items(), start=1):
        path: Path = info["path"]
        name = info["name"]
        resolved = info["resolved"]
        shutil.copyfile(path, scores / f"{name}.musicxml")
        print(f"analyse {n}/{len(by_path)} {path.name}", flush=True)
        t1 = time.time()
        payload = _piece_from_path_cached(
            path,
            filename=path.name,
            meta={
                "title": resolved.get("title") or "",
                "composer": resolved.get("composer") or "",
            },
        )
        payload.pop("musicxml", None)
        payload.pop("dataUrl", None)
        analysed[key] = payload
        (analyses / f"{name}.json").write_text(json.dumps(payload), encoding="utf-8")
        print(f"  {time.time() - t1:.1f}s  {path.name}", flush=True)

    opens = []
    for item, resolved, key in rows:
        info = by_path[key]
        name = info["name"]
        title = resolved.get("title") or item.get("title") or ""
        composer = resolved.get("composer") or item.get("composer") or ""
        payload = analysed[key]
        overview = piece_overview(title, composer, payload, remote=False)
        download = re.sub(r"[^A-Za-z0-9._-]+", "_", title or name).strip("_")[:80] or "score"
        opens.append(
            {
                "title": title,
                "composer": composer,
                "query": item.get("query") or "",
                "hay": item.get("hay") or "",
                "epoch": overview.get("epoch") or overview.get("era") or "",
                "file": f"scores/{name}.musicxml",
                "analysis": f"analysis/{name}.json",
                "source": resolved.get("source") or "library",
                "overview": overview,
                "downloadName": f"{download}.musicxml",
                "fallbackNote": resolved.get("fallbackNote") or "",
            }
        )

    (SITE / "static" / "opens.json").write_text(json.dumps(opens), encoding="utf-8")

    frontend = ROOT / "frontend"
    for entry in frontend.iterdir():
        dest = SITE / "static" / entry.name
        if entry.is_dir():
            shutil.copytree(entry, dest, dirs_exist_ok=True)
        else:
            shutil.copy2(entry, dest)
    # Mark the export as static (no Python server): the app reads uploads,
    # practice notes and links in the browser.
    index_html = (frontend / "index.html").read_text(encoding="utf-8")
    if 'name="lune-static"' not in index_html:
        index_html = index_html.replace("<head>", '<head>\n  <meta name="lune-static" content="1">', 1)
    (SITE / "index.html").write_text(index_html, encoding="utf-8")
    (SITE / ".nojekyll").write_text("", encoding="utf-8")

    # Only list scores that are really there, once each, with credits.
    import importlib.util  # noqa: E402

    spec = importlib.util.spec_from_file_location("pages_catalog", ROOT / "scripts" / "pages_catalog.py")
    catalog = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(catalog)
    catalog.build(SITE, reanalyze=False)
    print(f"site: {SITE}  opens: {len(opens)}", flush=True)


if __name__ == "__main__":
    main()
