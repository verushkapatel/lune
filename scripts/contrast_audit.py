"""Contrast audit: every visible button, link, input, label and text line on
Lune's main screens, in both themes. Reports anything under 3:1 (WCAG's
floor for large text and controls) and counts what falls under 4.5:1.

    .venv/bin/python scripts/contrast_audit.py [base-url]

Colours inside a flipped region (the dark-mode score page and bar panel) are
flipped before measuring, the way the browser shows them.
"""
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8137/lune/"

MEASURE = """() => {
  const parse = (c) => { const m = c.match(/[\\d.]+/g); return m ? m.map(Number) : null; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const flipped = (el) => { let n = 0; for (let e = el; e; e = e.parentElement) if (/invert/.test(getComputedStyle(e).filter)) n++; return n % 2 === 1; };
  const inv = (c) => [255 - c[0], 255 - c[1], 255 - c[2]];
  const bgOf = (el) => {
    let layers = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && (c[3] === undefined || c[3] > 0)) { layers.push(c); if (c[3] === undefined || c[3] >= 0.98) break; }
    }
    let base = [10, 10, 10];
    const root = parse(getComputedStyle(document.body).backgroundColor); if (root && (root[3] === undefined || root[3] > 0.9)) base = root;
    for (const c of layers.reverse()) { const a = c[3] === undefined ? 1 : c[3]; base = [0, 1, 2].map((i) => c[i] * a + base[i] * (1 - a)); }
    return base;
  };
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('button, a, input, select, textarea, label, p, h1, h2, h3, h4, li, span, strong, summary')) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.3 || el.closest('[hidden], [aria-hidden="true"], svg')) continue;
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim() || (el.matches('input, textarea, select') ? (el.value || el.placeholder || '') : '');
    if (!text) continue;
    if (el.disabled || (el.tagName === 'INPUT' && /radio|checkbox|range|file/.test(el.type))) continue;
    let fg = parse(cs.color); let bg = bgOf(el);
    if (!fg) continue;
    const a = fg[3] === undefined ? 1 : fg[3]; fg = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
    if (flipped(el)) { fg = inv(fg); bg = inv(bg); }
    const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const key = text.slice(0, 30) + '|' + el.tagName; if (seen.has(key)) continue; seen.add(key);
    out.push({ ratio: Math.round(ratio * 10) / 10, text: text.slice(0, 40), tag: el.tagName.toLowerCase(), cls: (el.className && el.className.baseVal === undefined ? String(el.className) : '').slice(0, 40), id: el.id });
  }
  return out;
}"""


def screens(pg):
    pg.goto(BASE, wait_until="networkidle")
    pg.wait_for_timeout(600)
    yield "landing"
    pg.goto(BASE + "#/debussy-clair-de-lune/score", wait_until="networkidle")
    pg.wait_for_selector("#osmd:not([data-partial]) g.vf-notehead", timeout=40000)
    pg.evaluate("() => { setBarSelection([2], { open: true }); }")
    pg.wait_for_timeout(800)
    yield "score + bar panel"
    pg.click("#btn-tell")
    pg.wait_for_timeout(400)
    yield "ask lune"
    pg.click("#ask-close")
    pg.evaluate("() => { clearBarSelection({ close: true }); }")
    pg.click(".studio-tab[data-panel=explain]")
    pg.wait_for_timeout(700)
    yield "overview"
    pg.click(".studio-tab[data-panel=piano]")
    pg.wait_for_timeout(700)
    yield "piano"
    pg.evaluate("async () => { LuneStore.completeLocalSignIn('t@lune.test'); ['onboarded','seenWelcome','seenSignedWelcome'].forEach(k => LuneStore.setPref(k, true)); await LunePractice.addCurrentToRepertoire({ quiet: true }); LunePractice.showRepertoire(); }")
    pg.wait_for_timeout(1200)
    yield "repertoire"
    pg.click("#btn-settings")
    pg.wait_for_timeout(400)
    yield "settings"
    pg.evaluate("() => document.getElementById('settings-dialog').close()")
    pg.click("#btn-share")
    pg.wait_for_timeout(300)
    yield "share"
    pg.evaluate("() => document.getElementById('share-dialog').close()")
    pg.evaluate("() => { goHome({ forceApp: true }); document.querySelector('#hello:not([hidden]) button')?.click(); }")
    pg.wait_for_timeout(900)
    yield "member home"
    pg.evaluate("() => { LuneFeedback.open(); }")
    pg.wait_for_timeout(400)
    yield "feedback"


bad_total = 0
with sync_playwright() as p:
    b = p.chromium.launch()
    for theme in ("dark", "light"):
        cx = b.new_context(service_workers="block", viewport={"width": 1280, "height": 820})
        cx.add_init_script(f"try{{localStorage.setItem('lune.theme','{theme}')}}catch(e){{}}")
        pg = cx.new_page()
        for name in screens(pg):
            rows = pg.evaluate(MEASURE)
            low = [r for r in rows if r["ratio"] < 3]
            mid = [r for r in rows if 3 <= r["ratio"] < 4.5]
            bad_total += len(low)
            print(f"{theme:5} {name:18} {len(rows):3} measured · {len(low)} under 3:1 · {len(mid)} under 4.5:1")
            for r in low[:8]:
                print(f"        {r['ratio']}  <{r['tag']} {('#' + r['id']) if r['id'] else '.' + r['cls']}>  “{r['text']}”")
        cx.close()
    b.close()
print(f"\n{bad_total} under 3:1 in all")
sys.exit(1 if bad_total else 0)
