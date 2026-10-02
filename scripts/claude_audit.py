"""Independent overlay audit for Lune (glyph-accurate, not the app's own check).

Usage: python3 scripts/claude_audit.py [piece ...] [--widths 375,591,1024] [--shots]
Prints one row per piece/width/mode with collision counts by obstacle kind.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8000/?v=claude"
OUT = Path("/tmp/lune-shots")
OUT.mkdir(exist_ok=True)

AUDIT_JS = r"""
(kind) => {
  const host = document.getElementById('osmd');
  const svg = host.querySelector('svg');
  const sel = kind === 'fingers' ? 'text.lune-finger' : 'text.lune-letter';
  const vis = (el) => {
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
  };
  const labels = [...host.querySelectorAll(sel)].filter(vis);
  const other = [...host.querySelectorAll(kind === 'fingers' ? 'text.lune-letter' : 'text.lune-finger')].filter(vis).length;
  const rect = (el) => { const r = el.getBoundingClientRect(); return {l:r.left,t:r.top,r:r.right,b:r.bottom}; };
  // shrink label boxes to ink: glyph bbox includes ascender/descender space
  const ink = (r) => ({l: r.l + 0.5, r: r.r - 0.5, t: r.t + (r.b - r.t) * 0.18, b: r.b - (r.b - r.t) * 0.18});
  const inter = (a, b) => Math.min(a.r, b.r) > Math.max(a.l, b.l) && Math.min(a.b, b.b) > Math.max(a.t, b.t);
  const groups = {
    notehead: 'g.vf-notehead path',
    stem: 'path.vf-stem, g.vf-stem path',
    beam: 'g.vf-beam path',
    flag: 'g.vf-flag path',
    accidental: 'g.vf-modifiers path',
    tie: 'g.vf-curve path',
    text: 'g.vf-text text, g.vf-text path',
    clef: 'g.vf-clef path, g.vf-timesignature path, g.vf-keysignature path',
    barline: 'g.vf-measure > rect, g.vf-connector path',
    rest: 'g.vf-rest path',
    dynamics: 'g.vf-dynamics path, g.vf-dynamics text',
  };
  const obs = [];
  for (const k in groups) {
    svg.querySelectorAll(groups[k]).forEach((e) => {
      if (e.closest('.lune-letter-layer, .lune-finger-layer, .lune-audit')) return;
      obs.push({k, e, r: rect(e)});
    });
  }
  const pt = svg.createSVGPoint();
  const hits = (o, lr) => {
    if (o.e.tagName === 'text') return true;
    let m; try { m = o.e.getScreenCTM(); } catch { return true; }
    if (!m) return true;
    const inv = m.inverse();
    for (let i = 0; i <= 6; i++) for (let j = 0; j <= 4; j++) {
      pt.x = lr.l + (lr.r - lr.l) * i / 6; pt.y = lr.t + (lr.b - lr.t) * j / 4;
      const q = pt.matrixTransform(inv);
      try { if (o.e.isPointInFill(q) || o.e.isPointInStroke(q)) return true; } catch { return true; }
    }
    return false;
  };
  const counts = {}; const offenders = [];
  const lrs = labels.map((l) => ink(rect(l)));
  labels.forEach((lab, i) => {
    const lr = lrs[i];
    const hitKinds = new Set();
    for (const o of obs) {
      if (hitKinds.has(o.k)) continue;
      if (!inter(lr, o.r)) continue;
      if (hits(o, lr)) hitKinds.add(o.k);
    }
    hitKinds.forEach((k) => {
      counts[k] = (counts[k] || 0) + 1;
      if (offenders.length < 25) offenders.push({k, t: lab.textContent, x: Math.round(lr.l), y: Math.round(lr.t + scrollY)});
    });
  });
  let ll = 0;
  for (let i = 0; i < lrs.length; i++) for (let j = i + 1; j < lrs.length; j++) {
    if (Math.abs(lrs[i].t - lrs[j].t) > 60) continue;
    if (inter(lrs[i], lrs[j])) { ll++; if (offenders.length < 25) offenders.push({k: 'label', t: labels[i].textContent + '/' + labels[j].textContent, x: Math.round(lrs[i].l), y: Math.round(lrs[i].t + scrollY)}); }
  }
  if (ll) counts.label = ll;
  // distance from label to nearest notehead (readability: label must sit by its note)
  const heads = [...svg.querySelectorAll('g.vf-notehead')].map((g) => { const r = g.getBoundingClientRect(); return {x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2}; });
  let far = 0; let maxD = 0;
  lrs.forEach((lr) => {
    const cx = (lr.l + lr.r) / 2, cy = (lr.t + lr.b) / 2;
    let best = Infinity;
    for (const h of heads) { const d = Math.hypot(h.x - cx, h.y - cy); if (d < best) best = d; }
    if (best > maxD) maxD = best;
    if (best > 40) far++;
  });
  const fs = labels.map((l) => l.getBoundingClientRect().height);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return {labels: labels.length, other, heads: heads.length, total, counts, far, maxD: Math.round(maxD),
          minH: fs.length ? Math.round(Math.min(...fs) * 10) / 10 : null, offenders: offenders.slice(0, 12)};
}
"""


def wait_stable(page, sel, timeout=60):
    page.wait_for_selector("#osmd svg", timeout=timeout * 1000)
    last, stable, end = -1, 0, time.time() + timeout
    while time.time() < end:
        n = page.locator(sel).count()
        if n == last and n > 0:
            stable += 1
            if stable >= 4:
                return n
        else:
            stable, last = 0, n
        page.wait_for_timeout(300)
    return page.locator(sel).count()


def set_mode(page, mode):
    page.evaluate("""(m)=>{const el=document.getElementById('anno-'+m); if(!el) return; el.checked=true; el.dispatchEvent(new Event('change',{bubbles:true}));}""", mode)
    page.wait_for_timeout(300)


def open_piece(page, query):
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_function("() => typeof opensheetmusicdisplay !== 'undefined' && typeof LuneAnnotate !== 'undefined'")
    page.fill("#q", query)
    page.wait_for_timeout(400)
    page.press("#q", "Enter")
    page.wait_for_function("() => !document.getElementById('studio')?.hidden", timeout=90000)
    for _ in range(6):
        page.click("#tab-score")
        try:
            page.wait_for_selector("#osmd svg", timeout=15000)
            break
        except Exception:
            continue
    page.wait_for_timeout(600)


def main():
    args = sys.argv[1:]
    widths = [375, 591, 1024, 1440]
    shots = "--shots" in args
    pieces = []
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--widths":
            widths = [int(x) for x in args[i + 1].split(",")]
            i += 2
            continue
        if not a.startswith("-"):
            pieces.append(a)
        i += 1
    pieces = pieces or ["fur elise"]
    rows = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for q in pieces:
            page = browser.new_page(viewport={"width": widths[0], "height": 900}, device_scale_factor=2 if shots else 1)
            errs = []
            page.on("pageerror", lambda e: errs.append(str(e)))
            open_piece(page, q)
            for w in widths:
                page.set_viewport_size({"width": w, "height": 900})
                page.wait_for_timeout(700)
                for mode in ("notes", "fingers"):
                    set_mode(page, mode)
                    sel = "text.lune-finger" if mode == "fingers" else "text.lune-letter"
                    t0 = time.time()
                    wait_stable(page, sel)
                    dt = time.time() - t0
                    r = page.evaluate(AUDIT_JS, mode)
                    r.update(piece=q, width=w, mode=mode, settle=round(dt, 1))
                    rows.append(r)
                    print(json.dumps({k: r[k] for k in ("piece", "width", "mode", "labels", "other", "heads", "total", "counts", "far", "maxD", "minH", "settle")}), flush=True)
                    if "-v" in sys.argv: print("   ", r["offenders"][:8])
                    if shots:
                        page.screenshot(path=str(OUT / f"{q.replace(' ', '_')}-{w}-{mode}.png"), full_page=False)
            if errs:
                print("PAGE ERRORS:", errs[:5])
            page.close()
        browser.close()
    Path("/tmp/lune-audit.json").write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
