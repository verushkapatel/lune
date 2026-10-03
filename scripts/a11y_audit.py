#!/usr/bin/env python3
"""Automated accessibility checks with axe-core on every screen.

    python3 scripts/a11y_audit.py [width ...]

Runs axe-core (WCAG 2.1 A and AA rules, plus landmark and heading best
practices) on each screen in scripts/lune_screens.py. Colour contrast is
left to scripts/contrast_audit.py. axe-core is fetched once from the npm
registry into /tmp/lune-axe.

Automated checks find perhaps a third of accessibility problems. They do not
replace trying Lune with a screen reader.
"""
import io
import json
import sys
import tarfile
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).parent))
from lune_screens import READY, SCREENS  # noqa: E402

AXE_VERSION = "4.13.0"
AXE = Path("/tmp/lune-axe") / f"axe-{AXE_VERSION}.min.js"
WIDTHS = [int(w) for w in sys.argv[1:]] or [1280, 390]


def axe_source() -> str:
    if not AXE.exists():
        AXE.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://registry.npmjs.org/axe-core/-/axe-core-{AXE_VERSION}.tgz"
        data = urllib.request.urlopen(url, timeout=60).read()
        with tarfile.open(fileobj=io.BytesIO(data)) as t:
            AXE.write_bytes(t.extractfile("package/axe.min.js").read())
    return AXE.read_text(encoding="utf-8")


RUN = """async () => {
  const r = await axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
    rules: { 'color-contrast': { enabled: false }, 'region': { enabled: false } },
    resultTypes: ['violations'],
  });
  return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help,
    nodes: v.nodes.slice(0, 4).map(n => n.target.join(' ')), count: v.nodes.length }));
}"""


def main():
    src = axe_source()
    total = 0
    with sync_playwright() as p:
        b = p.chromium.launch()
        for width in WIDTHS:
            for name, (url, js, wait) in SCREENS.items():
                ctx = b.new_context(viewport={"width": width, "height": 860 if width > 600 else 844})
                pg = ctx.new_page()
                try:
                    pg.goto(url, wait_until="networkidle")
                    if "score" in url or "piano" in url:
                        pg.wait_for_function(READY, timeout=60000)
                    if js:
                        pg.evaluate(js)
                    pg.wait_for_timeout(wait)
                    pg.add_script_tag(content=src)
                    found = pg.evaluate(RUN)
                except Exception as e:
                    print(f"FAIL  {width} {name}: could not run ({e!r})"[:200])
                    total += 1
                    ctx.close()
                    continue
                for v in found:
                    print(f"FAIL  {width} {name}: {v['id']} ({v['impact']}) {v['help']} ×{v['count']}  {json.dumps(v['nodes'])[:160]}")
                total += len(found)
                ctx.close()
        b.close()
    print(f"\n{len(SCREENS) * len(WIDTHS)} screens checked, {total} axe violations")
    sys.exit(1 if total else 0)


if __name__ == "__main__":
    main()
