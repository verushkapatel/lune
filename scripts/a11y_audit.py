"""axe-core audit of Lune's main screens. Fails on any serious or critical issue.

    npm install --no-save axe-core@4        (once; or set AXE_JS to axe.min.js)
    .venv/bin/python scripts/a11y_audit.py [base-url]

Colour contrast is left to scripts/contrast_audit.py, which accounts for the
CSS filter that draws the light theme and the dark score page; axe can't.
"""
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from claude_test_state import browser_only, unlock_guest  # noqa: E402

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8137/lune/"
AXE_JS = os.environ.get("AXE_JS") or str(Path(__file__).resolve().parents[1] / "node_modules" / "axe-core" / "axe.min.js")
PIECE = "debussy-clair-de-lune"


def wait_score(pg):
    pg.wait_for_function("() => document.querySelectorAll('#osmd .lane-letter').length > 50", timeout=60000)
    pg.wait_for_timeout(400)


def open_coach(pg):
    pg.evaluate("() => setBarSelection([3], {open: true})")
    pg.wait_for_selector(".lp-coach")


def open_settings(pg):
    pg.goto(BASE, wait_until="networkidle")
    pg.evaluate("() => document.getElementById('btn-settings')?.click()")
    pg.wait_for_selector("dialog[open]")


SCREENS = [
    ("home", "", None),
    ("score", f"#/{PIECE}/score", wait_score),
    ("bar panel", f"#/{PIECE}/score", lambda pg: (wait_score(pg), open_coach(pg))),
    ("explain", f"#/{PIECE}/explain", lambda pg: pg.wait_for_timeout(1200)),
    ("piano", f"#/{PIECE}/piano", lambda pg: pg.wait_for_timeout(2500)),
    ("repertoire", "#/repertoire", lambda pg: pg.wait_for_selector("#repertoire:not([hidden])")),
    ("study", "#/study", lambda pg: pg.wait_for_timeout(800)),
    ("settings", None, open_settings),
]

RUN = """async () => {
  const r = await axe.run(document, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false } },
  });
  return r.violations
    .filter(v => v.impact === 'serious' || v.impact === 'critical')
    .map(v => ({ id: v.id, impact: v.impact, help: v.help,
                 nodes: v.nodes.slice(0, 4).map(n => n.target.join(' ')) , count: v.nodes.length }));
}"""


def keyboard_checks(pg):
    """Skip link first in tab order and lands in the view; toasts reach screen readers."""
    bad = 0
    pg.goto(BASE + f"#/{PIECE}/score", wait_until="networkidle")
    pg.reload(wait_until="networkidle")  # a fresh load, nothing focused, no dialog left open
    wait_score(pg)
    pg.keyboard.press("Tab")
    first = pg.evaluate("() => [document.activeElement.id, document.activeElement.getBoundingClientRect().top >= 0]")
    pg.keyboard.press("Enter")
    landed = pg.evaluate("() => document.activeElement.id")
    pg.evaluate("() => toast('Saved to your plan')")
    live = pg.evaluate("() => document.getElementById('toast-live')?.textContent || ''")
    for name, ok, detail in [
        ("keys: Tab reaches the skip link first, on screen", first == ["skip-link", True], first),
        ("keys: the skip link moves focus into the score view", landed == "studio", landed),
        ("screen readers: toasts are announced through a live region", live == "Saved to your plan", live),
    ]:
        print(f"{'PASS' if ok else 'FAIL'}  {name}" + ("" if ok else f"  [{detail}]"))
        bad += 0 if ok else 1
    return bad


def main():
    if not Path(AXE_JS).exists():
        sys.exit(f"axe-core not found at {AXE_JS}; npm install --no-save axe-core@4 or set AXE_JS")
    total = 0
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        for theme in ("dark", "light"):
            ctx = b.new_context(viewport={"width": 1280, "height": 860})
            browser_only(ctx)
            ctx.add_init_script(f"try {{ localStorage.setItem('lune.theme', '{theme}'); }} catch (e) {{}}")
            pg = ctx.new_page()
            pg.goto(BASE, wait_until="networkidle")
            unlock_guest(pg)
            for name, route, ready in SCREENS:
                if route is not None:
                    pg.goto(BASE + route, wait_until="networkidle")
                if ready:
                    ready(pg)
                pg.add_script_tag(path=AXE_JS)
                found = pg.evaluate(RUN)
                total += len(found)
                print(f"{'PASS' if not found else 'FAIL'}  {theme:5} {name}")
                for v in found:
                    print(f"      {v['impact']:8} {v['id']}: {v['help']} ({v['count']}×) {v['nodes']}")
            if theme == "dark":
                total += keyboard_checks(pg)
            ctx.close()
        b.close()
    print(f"\n{total} serious/critical issue types")
    sys.exit(1 if total else 0)


if __name__ == "__main__":
    main()
