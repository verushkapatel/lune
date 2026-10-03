#!/usr/bin/env python3
"""Grow the static Pages library to every free score Lune can legally ship.

Downloads MusicXML from musetrainer/library and every entry in
backend.scoresource.build_catalogue(), copies them into pages-site/static/scores,
and rebuilds opens.json + search-index.json so search only lists pieces that
actually open. Analysis is left to the browser (LuneLite) when a JSON sidecar
is missing — that keeps this script fast enough to finish.

Usage:
    source .venv/bin/activate
    python3 scripts/expand_pages_library.py [pages-site]
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
import urllib.request
from urllib.parse import quote
import xml.etree.ElementTree as ET
import zipfile
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))
from blocked import is_blocked  # noqa: E402
os.chdir(ROOT)

MUSETAINER_RAW = "https://raw.githubusercontent.com/musetrainer/library/master/scores/"
MUSETAINER_TREE = "https://api.github.com/repos/musetrainer/library/git/trees/master?recursive=1"
USER_AGENT = "LunePagesExpand/1.0 (+https://verushkapatel.github.io/lune/)"


def slug(stem: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("_")[:72] or "score"
    digest = hashlib.sha1(stem.encode()).hexdigest()[:8]
    return f"{clean}_{digest}" if len(clean) < 8 else clean


def norm(text: str) -> str:
    import unicodedata

    t = unicodedata.normalize("NFD", text or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def download(url: str, timeout: float = 40.0) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
    except Exception as exc:
        print(f"  download fail {url}: {exc}", flush=True)
        return None
    if not data or data[:15].lower().startswith(b"<!doctype") or data[:6].lower().startswith(b"<html"):
        return None
    return data


def mxl_to_musicxml(raw: bytes) -> str | None:
    try:
        with zipfile.ZipFile(BytesIO(raw)) as zf:
            names = [n for n in zf.namelist() if not n.endswith("/")]
            root = None
            if "META-INF/container.xml" in names:
                container = zf.read("META-INF/container.xml").decode("utf-8", "ignore")
                m = re.search(r'full-path\s*=\s*"([^"]+)"', container)
                if m:
                    root = m.group(1)
            if not root:
                root = next((n for n in names if re.search(r"\.(xml|musicxml)$", n, re.I) and not n.startswith("META")), None)
            if not root:
                return None
            return zf.read(root).decode("utf-8", "ignore")
    except Exception:
        return None


def ensure_musicxml_bytes(raw: bytes, url: str) -> bytes | None:
    if raw[:2] == b"PK" or url.lower().endswith(".mxl"):
        text = mxl_to_musicxml(raw)
        return text.encode("utf-8") if text and len(text) > 400 else None
    if b"<score-partwise" in raw[:2000] or b"<score-timewise" in raw[:2000]:
        return raw
    return None


def xml_meta(text: str, fallback_title: str = "") -> tuple[str, str]:
    """Best-effort title/composer from MusicXML (full parse or regex)."""
    title, composer = fallback_title, ""

    def regex_meta(blob: str) -> tuple[str, str]:
        t = ""
        c = ""
        m = re.search(r"<work-title[^>]*>([^<]+)</work-title>", blob, re.I)
        if m:
            t = m.group(1).strip()
        if not t:
            m = re.search(r"<movement-title[^>]*>([^<]+)</movement-title>", blob, re.I)
            if m:
                t = m.group(1).strip()
        m = re.search(
            r'<creator[^>]*type\s*=\s*"composer"[^>]*>([^<]+)</creator>',
            blob,
            re.I,
        )
        if m:
            c = m.group(1).strip()
        if not c:
            m = re.search(r"<creator[^>]*>([^<]+)</creator>", blob, re.I)
            if m:
                c = m.group(1).strip()
        return t, c

    cleaned = re.sub(r"<!DOCTYPE[^>]*>", "", text or "", count=1, flags=re.I | re.S)
    try:
        root = ET.fromstring(cleaned)
    except ET.ParseError:
        t, c = regex_meta(text[:120000])
        return t or title or "Untitled", c

    def findtext(tag: str) -> str:
        for el in root.iter():
            if el.tag == tag or el.tag.endswith("}" + tag):
                if el.text and el.text.strip():
                    return el.text.strip()
        return ""

    title = findtext("work-title") or findtext("movement-title") or title or "Untitled"
    for el in root.iter():
        if el.tag.endswith("}creator") or el.tag == "creator":
            if (el.get("type") or "") == "composer" and el.text:
                composer = el.text.strip()
                break
    if not composer:
        composer = findtext("creator")
    if (not title or title == "Untitled" or not composer) and text:
        rt, rc = regex_meta(text[:120000])
        title = title if title and title != "Untitled" else (rt or title or "Untitled")
        composer = composer or rc
    return title, composer


def tidy_composer(name: str) -> str:
    n = (name or "").strip()
    if not n or n.lower() in {"unknown", "music21", "none", "composer"}:
        return ""
    n = (
        n.replace("&uuml;", "ü")
        .replace("&Uuml;", "Ü")
        .replace("&eacute;", "é")
        .replace("&agrave;", "à")
        .replace("&amp;", "&")
    )
    n = re.sub(r"\([^)]*\d{3,4}[^)]*\)", "", n).strip()
    n = re.sub(r"\s+", " ", n)
    if "," in n:
        last, first = [p.strip() for p in n.split(",", 1)]
        if first and last and not any(ch.isdigit() for ch in first[:4]):
            n = f"{first} {last}"
    folded = re.sub(
        r"[^a-z ]+",
        "",
        "".join(
            ch
            for ch in __import__("unicodedata").normalize("NFD", n.lower())
            if __import__("unicodedata").category(ch) != "Mn"
        ),
    ).strip()
    fixes = {
        "frederic chopin": "Frédéric Chopin",
        "frederic francois chopin": "Frédéric Chopin",
        "fryderyk chopin": "Frédéric Chopin",
        "fryderyk franciszek chopin": "Frédéric Chopin",
        "chopin": "Frédéric Chopin",
        "beethoven": "Ludwig van Beethoven",
        "ludwig van beethoven": "Ludwig van Beethoven",
        "lvbeethoven": "Ludwig van Beethoven",
        "l v beethoven": "Ludwig van Beethoven",
        "mozart": "Wolfgang Amadeus Mozart",
        "bach": "Johann Sebastian Bach",
        "j s bach": "Johann Sebastian Bach",
        "scriabin": "Alexander Scriabin",
        "debussy": "Claude Debussy",
        "claude achille debussy": "Claude Debussy",
        "satie": "Erik Satie",
        "joplin": "Scott Joplin",
        "pachelbel": "Johann Pachelbel",
        "liszt": "Franz Liszt",
        "franz liszt": "Franz Liszt",
        "schubert": "Franz Schubert",
        "haydn": "Joseph Haydn",
        "franz joseph haydn": "Joseph Haydn",
        "brahms": "Johannes Brahms",
        "tchaikovsky": "Pyotr Ilyich Tchaikovsky",
        "rimsky korsakov": "Nikolai Rimsky-Korsakov",
        "nikolai rimsky korsakov": "Nikolai Rimsky-Korsakov",
        "clementi": "Muzio Clementi",
        "scarlatti": "Domenico Scarlatti",
        "leontovych": "Mykola Leontovych",
        "mykola leontovych": "Mykola Leontovych",
    }
    if folded in fixes:
        return fixes[folded]
    if folded.startswith("arranged by") or folded.startswith("arr "):
        return ""
    return n


def pretty_from_filename(name: str) -> str:
    stem = re.sub(r"\.(mxl|musicxml|xml)$", "", name, flags=re.I)
    stem = re.sub(r"^(mt_|musetrainer_mt_|musetrainer_|library_)", "", stem, flags=re.I)
    stem = re.sub(r"_mxl(_[a-f0-9]+)?$", "", stem, flags=re.I)
    stem = re.sub(r"_[a-f0-9]{8}$", "", stem)
    stem = stem.replace("__", " — ").replace("_", " ").replace("-", " ")
    stem = re.sub(r"\s+", " ", stem).strip()
    if re.match(r"^tmp[a-z0-9_.]+$", stem, re.I) or stem.lower().endswith(".mxl"):
        return "Untitled"
    return stem or "Untitled"


def meta_from_stem(stem: str) -> tuple[str, str] | tuple[None, None]:
    """Recover title/composer from scoresource cache filenames."""
    s = stem
    beethoven_nick = {
        8: "Pathétique",
        14: "Moonlight",
        17: "Tempest",
        21: "Waldstein",
        23: "Appassionata",
        26: "Les Adieux",
        29: "Hammerklavier",
    }
    m = re.search(r"beethoven_sonata(\d+)-(\d+)", s, re.I)
    if m:
        n, mv = int(m.group(1)), int(m.group(2))
        label = f"Piano Sonata no. {n}"
        nick = beethoven_nick.get(n)
        if nick:
            label += f' "{nick}"'
        label += f" — Movement {mv}"
        return (label, "Ludwig van Beethoven")
    m = re.search(r"mozart_sonata(\d+)-([0-9a-z]+)", s, re.I)
    if m:
        return (
            f"Piano Sonata no. {int(m.group(1))} — Movement {m.group(2)}",
            "Wolfgang Amadeus Mozart",
        )
    m = re.search(r"haydn_sonata(\d+)-(\d+)", s, re.I)
    if m:
        return (
            f"Piano Sonata Hob. XVI:{int(m.group(1))} — Movement {int(m.group(2))}",
            "Joseph Haydn",
        )
    m = re.search(r"chopin_prelude28-(\d+)", s, re.I)
    if m:
        n = int(m.group(1))
        label = f"Prelude op. 28 no. {n}"
        if n == 15:
            label += ' "Raindrop"'
        return (label, "Frédéric Chopin")
    m = re.search(r"chopin_mazurka(\d+)-(\d+)", s, re.I)
    if m:
        return (
            f"Mazurka op. {int(m.group(1))} no. {int(m.group(2))}",
            "Frédéric Chopin",
        )
    m = re.search(r"joplin_(?:joplin_)?([a-z0-9]+)", s, re.I)
    if m:
        slug = m.group(1).lower()
        if slug == "joplin":
            m2 = re.search(r"joplin_joplin_([a-z0-9]+)", s, re.I)
            slug = m2.group(1).lower() if m2 else slug
        try:
            from backend.scoresource import JOPlIN_TITLES  # noqa: WPS433

            title = JOPlIN_TITLES.get(slug) or pretty_from_filename(slug)
        except Exception:
            title = pretty_from_filename(slug)
        if slug != "joplin":
            return (title, "Scott Joplin")
    m = re.search(r"scarlatti_(?:scarlatti_)?(L\d+K\d+)", s, re.I)
    if m:
        tag = m.group(1)
        km = re.match(r"L(\d+)K(\d+)", tag, re.I)
        if km:
            return (
                f"Keyboard Sonata K.{int(km.group(2))} / L.{int(km.group(1))}",
                "Domenico Scarlatti",
            )
        return (f"Keyboard Sonata {tag}", "Domenico Scarlatti")
    m = re.search(r"scriabin[-_]op(\d+)(?:[-_]no(\d+))?", s, re.I)
    if m:
        op = int(m.group(1))
        no = int(m.group(2)) if m.group(2) else None
        if no is None:
            return (f"Op. {op}", "Alexander Scriabin")
        return (f"Op. {op} no. {no}", "Alexander Scriabin")
    if "scriabin" in s.lower():
        return (pretty_from_filename(re.sub(r"^.*?scriabin_", "", s, flags=re.I)), "Alexander Scriabin")
    m = re.search(r"bach_(.+)$", s, re.I)
    if m and "chorale" in s.lower():
        return (pretty_from_filename(m.group(1)), "Johann Sebastian Bach")
    low = s.lower()
    hints = [
        ("bach", "Johann Sebastian Bach"),
        ("beethoven", "Ludwig van Beethoven"),
        ("mozart", "Wolfgang Amadeus Mozart"),
        ("chopin", "Frédéric Chopin"),
        ("liszt", "Franz Liszt"),
        ("debussy", "Claude Debussy"),
        ("satie", "Erik Satie"),
        ("joplin", "Scott Joplin"),
        ("schubert", "Franz Schubert"),
        ("brahms", "Johannes Brahms"),
        ("pachelbel", "Johann Pachelbel"),
        ("tchaikovsky", "Pyotr Ilyich Tchaikovsky"),
        ("rimsky", "Nikolai Rimsky-Korsakov"),
        ("bumblebee", "Nikolai Rimsky-Korsakov"),
        ("clementi", "Muzio Clementi"),
        ("leontovych", "Mykola Leontovych"),
        ("carol_of_the_bells", "Mykola Leontovych"),
        ("greensleeves", "Traditional"),
        ("twinkle", "Traditional"),
    ]
    for needle, composer in hints:
        if needle in low:
            title = pretty_from_filename(s)
            if title and title != "Untitled":
                return (title, composer)
    return (None, None)


def list_musetrainer() -> list[str]:
    raw = download(MUSETAINER_TREE)
    if not raw:
        return []
    try:
        data = json.loads(raw.decode())
    except json.JSONDecodeError:
        return []
    return [
        t["path"].split("/", 1)[1]
        for t in data.get("tree") or []
        if t.get("path", "").startswith("scores/") and t.get("type") == "blob" and not is_blocked(t["path"])
    ]


def write_score(scores_dir: Path, stem: str, xml_bytes: bytes) -> Path | None:
    name = slug(stem) + ".musicxml"
    dest = scores_dir / name
    if dest.exists() and dest.stat().st_size > 500:
        return dest
    dest.write_bytes(xml_bytes)
    return dest if dest.stat().st_size > 500 else None


def ingest_musetrainer(scores_dir: Path) -> list[Path]:
    files = list_musetrainer()
    print(f"musetrainer remote files: {len(files)}", flush=True)
    out = []
    for i, fname in enumerate(files, 1):
        stem = Path(fname).stem
        # Skip if we already have a matching score
        existing = list(scores_dir.glob(f"mt_{re.sub(r'[^A-Za-z0-9]+', '_', fname)[:60]}*"))
        existing += list(scores_dir.glob(f"*{slug(stem)}*"))
        cached = scores_dir / f"mt_{slug(stem)}.musicxml"
        if cached.exists() and cached.stat().st_size > 500:
            out.append(cached)
            continue
        print(f"  [{i}/{len(files)}] {fname}", flush=True)
        raw = download(MUSETAINER_RAW + quote(fname))
        if not raw:
            continue
        xml = ensure_musicxml_bytes(raw, fname)
        if not xml:
            print(f"    skip (not musicxml)", flush=True)
            continue
        dest = scores_dir / f"mt_{slug(stem)}.musicxml"
        dest.write_bytes(xml)
        out.append(dest)
        time.sleep(0.05)
    return out


def ingest_catalogue(scores_dir: Path) -> list[Path]:
    import backend.scoresource as scoresource

    cat = scoresource.build_catalogue(include_corpus=False)
    print(f"catalogue entries: {len(cat)}", flush=True)
    out = []
    for i, entry in enumerate(cat, 1):
        title = entry.get("title") or ""
        source = entry.get("source") or ""
        print(f"  [{i}/{len(cat)}] {source}: {title[:70]}", flush=True)
        try:
            path = scoresource._fetch_from_catalogue_entry(entry)  # noqa: SLF001
        except Exception as exc:
            print(f"    fail: {exc}", flush=True)
            continue
        if not path:
            print("    miss", flush=True)
            continue
        path = Path(path)
        if not path.exists() or path.stat().st_size < 500:
            print("    empty", flush=True)
            continue
        dest_stem = slug(f"{source}_{path.stem}")
        dest = scores_dir / f"{dest_stem}.musicxml"
        if not dest.exists() or dest.stat().st_size < 500:
            dest.write_bytes(path.read_bytes())
        out.append(dest)
    return out


def build_opens(site: Path) -> None:
    from backend.discover import piece_overview  # noqa: WPS433

    static = site / "static"
    scores = static / "scores"
    analysis = static / "analysis"
    analysis.mkdir(parents=True, exist_ok=True)
    # In-copyright pieces never ship, even if an earlier run left the file here.
    for stale in list(scores.glob("*.musicxml")):
        if is_blocked(stale.name, stale.read_text(errors="ignore")[:6000]):
            print(f"  removing blocked score {stale.name}", flush=True)
            stale.unlink()

    # Prefer curated metadata from free_catalogues when titles match.
    meta_by_norm: dict[str, dict] = {}
    try:
        from backend.free_catalogues import MUSETAINER_INDEX  # noqa: WPS433

        for e in MUSETAINER_INDEX:
            meta_by_norm[norm(e["title"])] = e
            for k in e.get("keys") or []:
                meta_by_norm[norm(k)] = e
    except Exception:
        pass

    # Modern in-copyright names that sometimes appear in scavenged MusicXML — never list them.
    blocked = {
        "paul de senneville",
        "richard clayderman",
        "clayderman",
        "yiruma",
        "ludovico einaudi",
        "einaudi",
        "hans zimmer",
    }

    def weak_title(t: str) -> bool:
        tl = (t or "").strip().lower()
        return (
            not tl
            or tl in {"untitled", "music21", "mxl", "score"}
            or tl.endswith(".mxl")
            or bool(re.match(r"^tmp[a-z0-9_.]+", tl))
        )

    def weak_composer(c: str) -> bool:
        cl = (c or "").strip().lower()
        return not cl or cl in {"unknown", "music21", "none", "composer"}

    entries = []
    seen_ids = set()
    # Prefer one file per title+composer (largest MusicXML wins).
    best_by_key: dict[str, tuple[int, Path, str, str, dict | None]] = {}
    for xml_path in sorted(scores.glob("*.musicxml")):
        text = xml_path.read_text(encoding="utf-8", errors="ignore")
        if "<score-partwise" not in text and "<score-timewise" not in text:
            continue
        fb = pretty_from_filename(xml_path.name.replace("mt_", "", 1).replace("musetrainer_", "", 1))
        title, composer = xml_meta(text, fb)
        stem_title, stem_composer = meta_from_stem(xml_path.stem)
        # Prefer catalogue-quality names from the filename when XML metadata is weak,
        # or whenever the stem encodes a known catalogue family (joplin/chopin/sonatas…).
        stem_family = bool(
            stem_title
            and stem_composer
            and re.search(
                r"(joplin|chopin_|beethoven_sonata|mozart_sonata|haydn_sonata|scriabin|scarlatti_)",
                xml_path.stem,
                re.I,
            )
        )
        if stem_title and (weak_title(title) or weak_composer(composer) or stem_family):
            if stem_family or weak_title(title):
                title = stem_title
            composer = stem_composer or composer
        elif stem_composer and weak_composer(composer):
            composer = stem_composer
        if stem_title and stem_composer and "scriabin" in (composer or "").lower():
            if weak_title(title) or len(title) < 4 or title.lower() in {"etude", "prelude", "impromptu", "fantasy"}:
                # Prefer opus labels from kern stems over generic movement titles.
                if re.search(r"op\s*\d+", stem_title, re.I) or stem_title.lower().startswith("op."):
                    title = stem_title
                    composer = stem_composer
        composer = tidy_composer(composer) or stem_composer or composer or ""
        if weak_title(title) and stem_title:
            title = stem_title
        if not title or weak_title(title):
            continue
        if not composer or weak_composer(composer):
            # Still allow Traditional / recoverable stem composers only.
            if stem_composer:
                composer = stem_composer
            else:
                continue
        if any(b in composer.lower() for b in blocked):
            continue
        if composer.lower().startswith("arranged by") or composer.lower().startswith("arr."):
            continue
        low = xml_path.name.lower()
        if "easy" in low and "easy" not in title.lower():
            title = f"{title} (easy)"
        if "canon_in_d_3" in low and "(3" not in title:
            title = f"{title} (version 3)"
        hit = meta_by_norm.get(norm(title)) or meta_by_norm.get(norm(fb)) or meta_by_norm.get(norm(title.replace(" (easy)", "")))
        if hit:
            base_title = hit.get("title") or title
            if "easy" in low and "easy" not in base_title.lower():
                title = f"{base_title} (easy)"
            else:
                title = base_title
            composer = hit.get("composer") or composer
        composer = tidy_composer(composer) or composer
        key = norm(f"{composer}|{title}")
        size = xml_path.stat().st_size
        prev = best_by_key.get(key)
        if not prev or size > prev[0]:
            best_by_key[key] = (size, xml_path, title, composer, hit)

    for _size, xml_path, title, composer, hit in sorted(best_by_key.values(), key=lambda x: (x[3], x[2])):
        pid = re.sub(r"[^a-z0-9]+", "-", norm(f"{composer}-{title}")).strip("-")[:72] or xml_path.stem
        if pid in seen_ids:
            pid = f"{pid}-{xml_path.stem[-6:]}"
        seen_ids.add(pid)
        overview = piece_overview(title, composer, {"title": title, "composer": composer}, remote=False)
        era = overview.get("epoch") or overview.get("era") or ""
        hay = norm(" ".join([title, composer, era, " ".join((hit or {}).get("keys") or []), xml_path.stem]))
        analysis_rel = f"analysis/{xml_path.stem}.json"
        analysis_path = static / analysis_rel
        download = re.sub(r"[^A-Za-z0-9._-]+", "_", norm(title)).strip("_")[:80] or "score"
        entries.append(
            {
                "id": pid,
                "title": title,
                "composer": composer,
                "query": pid,
                "group": (composer or "Library").split()[-1],
                "hay": hay,
                "epoch": era,
                "era": era,
                "file": f"scores/{xml_path.name}",
                "analysis": analysis_rel if analysis_path.exists() else "",
                "source": "library",
                "overview": overview,
                "credit": {
                    "source": "Free public-domain MusicXML (musetrainer / Humdrum / Lune library)",
                    "sourceUrl": "https://github.com/musetrainer/library",
                    "license": "Public domain / open licence of the source edition",
                    "licenseUrl": "",
                },
                "downloadName": f"{download}.musicxml",
                "fallbackNote": "",
            }
        )

    (static / "opens.json").write_text(json.dumps(entries), encoding="utf-8")
    index_items = [
        {k: e[k] for k in ("id", "title", "composer", "query", "group", "hay", "epoch", "era") if k in e}
        for e in entries
    ]
    (static / "search-index.json").write_text(
        json.dumps({"items": index_items, "count": len(index_items), "curated": True, "complete": True}),
        encoding="utf-8",
    )
    # Keep frontend fallback in sync so typeahead never promises missing scores.
    (ROOT / "frontend" / "search-index.json").write_text(
        json.dumps({"items": index_items, "count": len(index_items), "curated": True, "complete": True}),
        encoding="utf-8",
    )
    print(f"opens: {len(entries)} pieces", flush=True)


def main() -> None:
    site = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "pages-site")
    scores = site / "static" / "scores"
    scores.mkdir(parents=True, exist_ok=True)
    print(f"site: {site}", flush=True)
    ingest_musetrainer(scores)
    ingest_catalogue(scores)
    build_opens(site)
    print("done", flush=True)


if __name__ == "__main__":
    main()
