#!/usr/bin/env python3
"""Build the allowlisted remote MusicXML catalogue for free fetch-on-open.

Only credible, free hosts:
  - raw.githubusercontent.com (musetrainer/library, OpenScore/*, craigsapp when MusicXML)
Never PDFs. Never commercial sheet sites. Zero paid APIs.

Writes:
  frontend/remote-catalog.json
  merges remote titles into frontend/search-index.json (keeps local opens first)
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

USER_AGENT = "LuneRemoteCatalog/1.0 (+https://lune.page/; free open scores only)"

ALLOWLIST_HOSTS = (
    "raw.githubusercontent.com",
)

SOURCE_CREDITS = {
    "musetrainer": {
        "source": "musetrainer/library",
        "sourceUrl": "https://github.com/musetrainer/library",
        "license": "Public-domain / open source edition",
        "licenseUrl": "https://github.com/musetrainer/library",
    },
    "openscore": {
        "source": "OpenScore",
        "sourceUrl": "https://github.com/OpenScore",
        "license": "CC0 1.0",
        "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
    },
    "openscore-lieder": {
        "source": "OpenScore Lieder",
        "sourceUrl": "https://github.com/OpenScore/Lieder",
        "license": "CC0 1.0",
        "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
    },
    "openscore-quartets": {
        "source": "OpenScore String Quartets",
        "sourceUrl": "https://github.com/OpenScore/StringQuartets",
        "license": "CC0 1.0",
        "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
    },
    "mutopia": {
        "source": "Mutopia Project",
        "sourceUrl": "https://www.mutopiaproject.org/",
        "license": "Creative Commons / public domain (per piece)",
        "licenseUrl": "https://www.mutopiaproject.org/legal.html",
    },
    "wikimedia": {
        "source": "Wikimedia Commons",
        "sourceUrl": "https://commons.wikimedia.org/",
        "license": "Public domain / free license (per file)",
        "licenseUrl": "https://commons.wikimedia.org/wiki/Commons:Licensing",
    },
    "library": {
        "source": "Lune free library",
        "sourceUrl": "https://lune.page/",
        "license": "Public-domain / open licence of the source edition",
        "licenseUrl": "",
    },
}

# Filenames / titles that look modern-copyright or non-PD; skip remote listing.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from blocked import BLOCKED as BLOCK_TITLE  # noqa: E402  (shared with every build step)


def download_json(url: str) -> dict | list | None:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            return json.loads(resp.read().decode("utf-8", "ignore"))
    except Exception as exc:
        print(f"  warn: {url}: {exc}", flush=True)
        return None


def norm(text: str) -> str:
    import unicodedata

    t = unicodedata.normalize("NFD", text or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def pretty_stem(name: str) -> str:
    stem = re.sub(r"\.(mxl|musicxml|xml)$", "", name, flags=re.I)
    stem = stem.replace("__", " — ").replace("_", " ")
    stem = re.sub(r"\s+", " ", stem).strip(" .")
    return stem or "Untitled"


def split_title_composer(fname: str) -> tuple[str, str]:
    """Best-effort title/composer from musetrainer-style filenames."""
    stem = re.sub(r"\.(mxl|musicxml|xml)$", "", fname, flags=re.I)
    stem = stem.replace("_", " ")
    stem = re.sub(r"\s+", " ", stem).strip()
    # Pattern: Title - Composer Name (common in musetrainer/library)
    if " - " in stem:
        left, right = stem.rsplit(" - ", 1)
        right = right.strip()
        if 1 <= len(right.split()) <= 6 and re.search(r"[A-Za-z]", right):
            return left.strip() or pretty_stem(fname), right
    return pretty_stem(fname), ""


def composer_from_openscore_path(path: str) -> str:
    # scores/Liszt,_Franz/... → Franz Liszt
    m = re.search(r"scores/([^/]+)/", path)
    if not m:
        return ""
    raw = m.group(1).replace("_", " ")
    if "," in raw:
        last, first = [p.strip() for p in raw.split(",", 1)]
        if first and last:
            return f"{first} {last}"
    return raw


def slug_id(composer: str, title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", norm(f"{composer}-{title}")).strip("-")[:72] or "score"


def allowlisted(url: str) -> bool:
    try:
        from urllib.parse import urlparse

        host = urlparse(url).hostname or ""
    except Exception:
        return False
    return host in ALLOWLIST_HOSTS and url.startswith("https://")


def github_tree(owner: str, repo: str, branch: str = "master") -> list[str]:
    data = download_json(f"https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1")
    if not isinstance(data, dict):
        return []
    return [t["path"] for t in data.get("tree") or [] if t.get("type") == "blob"]


def ingest_musetrainer() -> list[dict]:
    paths = github_tree("musetrainer", "library", "master")
    out = []
    credit = SOURCE_CREDITS["musetrainer"]
    seen_urls: set[str] = set()
    for path in paths:
        if not path.startswith("scores/"):
            continue
        if not re.search(r"\.(mxl|musicxml|xml)$", path, re.I):
            continue
        fname = path.split("/", 1)[1]
        title, composer = split_title_composer(fname)
        if BLOCK_TITLE.search(title) or BLOCK_TITLE.search(fname) or BLOCK_TITLE.search(composer):
            continue
        url = "https://raw.githubusercontent.com/musetrainer/library/master/" + path
        if not allowlisted(url) or url in seen_urls:
            continue
        seen_urls.add(url)
        out.append(
            {
                "id": slug_id(composer, title),
                "title": title,
                "composer": composer,
                "query": norm(f"{composer} {title}")[:80] or slug_id(composer, title),
                "hay": norm(f"{title} {composer}"),
                "group": f"Open MusicXML · {composer.split()[-1]}" if composer else "Open MusicXML",
                "source": "musetrainer",
                "format": "mxl" if path.lower().endswith(".mxl") else "musicxml",
                "url": url,
                "credit": credit,
                "openable": True,
                "remote": True,
            }
        )
    # Always include curated musetrainer index (in case GitHub tree is rate-limited)
    try:
        from backend.free_catalogues import MUSETAINER_BASE, MUSETAINER_INDEX

        for entry in MUSETAINER_INDEX:
            url = MUSETAINER_BASE + entry["file"]
            if not allowlisted(url) or url in seen_urls:
                continue
            if BLOCK_TITLE.search(entry["title"]) or BLOCK_TITLE.search(entry["composer"]):
                continue
            seen_urls.add(url)
            out.append(
                {
                    "id": slug_id(entry["composer"], entry["title"]),
                    "title": entry["title"],
                    "composer": entry["composer"],
                    "query": entry["keys"][0] if entry.get("keys") else norm(entry["title"]),
                    "hay": norm(" ".join([entry["title"], entry["composer"], *entry.get("keys", [])])),
                    "group": f"Open MusicXML · {entry['composer'].split()[-1]}",
                    "source": "musetrainer",
                    "format": "mxl" if entry["file"].lower().endswith(".mxl") else "musicxml",
                    "url": url,
                    "credit": credit,
                    "openable": True,
                    "remote": True,
                }
            )
    except Exception as exc:
        print(f"  warn: curated musetrainer seed: {exc}", flush=True)
    return out


def ingest_openscore(owner_repo: str, branch: str, source_key: str, group: str) -> list[dict]:
    owner, repo = owner_repo.split("/", 1)
    paths = github_tree(owner, repo, branch)
    credit = SOURCE_CREDITS[source_key]
    out = []
    for path in paths:
        if not re.search(r"\.(mxl|musicxml|xml)$", path, re.I):
            continue
        # Prefer scores/ trees
        if "scores/" not in path and not path.endswith((".mxl", ".musicxml", ".xml")):
            continue
        composer = composer_from_openscore_path(path)
        title = pretty_stem(path.split("/")[-1])
        # Prefer folder name as work title when file is opaque (lc123.mxl)
        parts = path.split("/")
        if len(parts) >= 3 and re.match(r"lc\d+", title, re.I):
            title = pretty_stem(parts[-2])
        if BLOCK_TITLE.search(title) or BLOCK_TITLE.search(composer):
            continue
        url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"
        if not allowlisted(url):
            continue
        out.append(
            {
                "id": slug_id(composer, title),
                "title": title,
                "composer": composer,
                "query": norm(f"{composer} {title}")[:80],
                "hay": norm(f"{title} {composer} openscore"),
                "group": group,
                "source": source_key,
                "format": "mxl" if path.lower().endswith(".mxl") else "musicxml",
                "url": url,
                "credit": credit,
                "openable": True,
                "remote": True,
            }
        )
    return out


def enrich_from_curated(items: list[dict]) -> None:
    """Fill composers/titles from curated MUSETAINER_INDEX when filenames match."""
    try:
        from backend.free_catalogues import MUSETAINER_INDEX, OPENSCORE_BASE, OPENSCORE_INDEX
    except Exception:
        return
    by_file = {e["file"]: e for e in MUSETAINER_INDEX}
    for it in items:
        if it.get("source") != "musetrainer":
            continue
        fname = (it.get("url") or "").rsplit("/", 1)[-1]
        hit = by_file.get(fname)
        if not hit:
            for k, e in by_file.items():
                if norm(k) == norm(fname):
                    hit = e
                    break
        if not hit:
            continue
        it["title"] = hit["title"]
        it["composer"] = hit["composer"]
        it["query"] = hit["keys"][0]
        it["hay"] = norm(" ".join([hit["title"], hit["composer"], *hit.get("keys", [])]))
        it["id"] = slug_id(hit["composer"], hit["title"])
        it["group"] = f"Open MusicXML · {hit['composer'].split()[-1]}"

    # Seed curated OpenScore Lieder paths if the GitHub tree missed them
    credit = SOURCE_CREDITS["openscore-lieder"]
    have = {it["url"] for it in items}
    for entry in OPENSCORE_INDEX:
        url = OPENSCORE_BASE + entry["path"]
        if not allowlisted(url) or url in have:
            continue
        items.append(
            {
                "id": slug_id(entry["composer"], entry["title"]),
                "title": entry["title"],
                "composer": entry["composer"],
                "query": entry["keys"][0] if entry.get("keys") else norm(entry["title"]),
                "hay": norm(" ".join([entry["title"], entry["composer"], *entry.get("keys", [])])),
                "group": "OpenScore Lieder",
                "source": "openscore-lieder",
                "format": "mxl" if entry["path"].lower().endswith(".mxl") else "musicxml",
                "url": url,
                "credit": credit,
                "openable": True,
                "remote": True,
            }
        )


def merge_search_index(remote_items: list[dict]) -> None:
    path = ROOT / "frontend" / "search-index.json"
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"items": []}
    local = data.get("items") or []
    seen = {norm(f"{i.get('composer')}|{i.get('title')}|{i.get('query')}") for i in local}
    merged = list(local)
    added = 0
    for it in remote_items:
        key = norm(f"{it.get('composer')}|{it.get('title')}|{it.get('query')}")
        if key in seen:
            continue
        seen.add(key)
        merged.append(
            {
                "id": it["id"],
                "title": it["title"],
                "composer": it.get("composer") or "Unknown",
                "query": it["query"],
                "group": it.get("group") or "Remote free",
                "hay": it.get("hay") or norm(f"{it['title']} {it.get('composer')}"),
                "openable": True,
                "remote": True,
                "source": it.get("source"),
            }
        )
        added += 1
    out = {
        "items": merged,
        "count": len(merged),
        "curated": True,
        "complete": False,
        "remote": True,
    }
    path.write_text(json.dumps(out), encoding="utf-8")
    print(f"search-index: {len(local)} local + {added} remote = {len(merged)}", flush=True)


def main() -> None:
    print("building remote catalog…", flush=True)
    items: list[dict] = []
    items.extend(ingest_musetrainer())
    print(f"  musetrainer: {sum(1 for i in items if i['source']=='musetrainer')}", flush=True)
    items.extend(ingest_openscore("OpenScore/Lieder", "main", "openscore-lieder", "OpenScore Lieder"))
    print(f"  openscore-lieder total so far: {sum(1 for i in items if 'openscore' in i['source'])}", flush=True)
    items.extend(
        ingest_openscore("OpenScore/StringQuartets", "main", "openscore-quartets", "OpenScore Quartets")
    )
    enrich_from_curated(items)

    # Dedupe by url
    by_url: dict[str, dict] = {}
    for it in items:
        by_url[it["url"]] = it
    items = sorted(by_url.values(), key=lambda x: (x.get("composer") or "", x.get("title") or ""))

    catalog = {
        "version": 1,
        "allowlistHosts": list(ALLOWLIST_HOSTS),
        "policy": {
            "formats": ["musicxml", "mxl"],
            "pdf": False,
            "paidApis": False,
            "note": "Only free MusicXML/MXL from allowlisted GitHub raw hosts. No PDF ingest.",
        },
        "credits": SOURCE_CREDITS,
        "count": len(items),
        "items": items,
    }
    out = ROOT / "frontend" / "remote-catalog.json"
    out.write_text(json.dumps(catalog), encoding="utf-8")
    print(f"wrote {out} ({len(items)} fetchable scores)", flush=True)
    merge_search_index(items)
    # Keep pages-site copy in sync when present
    pages = ROOT / "pages-site" / "static" / "remote-catalog.json"
    if pages.parent.exists():
        pages.write_text(json.dumps(catalog), encoding="utf-8")
        (pages.parent / "search-index.json").write_text(
            (ROOT / "frontend" / "search-index.json").read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        print(f"synced {pages}", flush=True)


if __name__ == "__main__":
    main()
