"""Letter-lane sweep: every catalogue piece, phone + desktop.
Checks one label per sounding note, no label/label or label/ink overlap."""
import json, sys, time
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8100/lune/"
CHECK = r"""
(mode) => {
  const svg = document.querySelector('#osmd svg');
  const labels = [...svg.querySelectorAll('g.lyrics text')].filter(t => t.getAttribute('visibility') !== 'hidden');
  // expected = pitched, non-grace notes that start a sound (tie starts / untied)
  let expected = 0;
  for (const m of state.osmd.GraphicSheet.MeasureList) for (const sm of m) if (sm) for (const se of sm.staffEntries) for (const g of se.graphicalVoiceEntries) for (const gn of g.notes) {
    const sn = gn.sourceNote; if (!sn.Pitch || sn.isRest?.() || sn.IsGraceNote) continue;
    const t = sn.NoteTie; if (t && t.StartNote && t.StartNote !== sn) continue;
    expected++;
  }
  const r = (e) => { const b = e.getBoundingClientRect(); return {l:b.left+0.5, r:b.right-0.5, t:b.top+b.height*0.2, b:b.bottom-b.height*0.2}; };
  const hit = (a, b) => Math.min(a.r,b.r) > Math.max(a.l,b.l) && Math.min(a.b,b.b) > Math.max(a.t,b.t);
  const lr = labels.map(r);
  let ll = 0;
  for (let i = 0; i < lr.length; i++) for (let j = i+1; j < lr.length; j++) { if (Math.abs(lr[i].t - lr[j].t) > 40) continue; if (hit(lr[i], lr[j])) ll++; }
  const ink = [...svg.querySelectorAll('g.vf-notehead, g.vf-stem, g.vf-beam, g.vf-modifiers, g.vf-curve, g.vf-flag, g.vf-text:not(.lyrics)')].map(r);
  let li = 0;
  for (const a of lr) for (const b of ink) if (hit(a, b)) { li++; break; }
  return {labels: labels.length, expected, ll, li};
}
"""
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page()
    pg.goto(BASE, wait_until="networkidle")
    opens = pg.evaluate("() => fetch('static/opens.json').then(r => r.json())")
    bad = []
    for w in (390, 1280):
        pg.set_viewport_size({"width": w, "height": 900})
        for row in opens:
            pg.goto(f"{BASE}?w={w}&n={time.time_ns()}#/{row['id']}/score", wait_until="networkidle")
            t0 = time.time()
            try:
                pg.wait_for_function("(id) => state.piece && state.piece.id === id && state.renderedLaneMode === 'letters' && document.querySelectorAll('#osmd g.lyrics text').length > 0", arg=row['id'], timeout=150000)
                pg.wait_for_timeout(400)
            except Exception:
                bad.append((w, row['id'], 'no labels')); print(w, row['id'], 'NO LABELS', flush=True); continue
            dt = time.time() - t0
            res = pg.evaluate(CHECK, "letters")
            ok = res['labels'] == res['expected'] and res['ll'] == 0
            print(w, row['id'][:28].ljust(28), res, f"{dt:.1f}s", "" if ok else "<<", flush=True)
            res['secs'] = round(dt, 1)
            if not ok: bad.append((w, row['id'], res))
    print("\nproblems:", len(bad))
    for x in bad: print(" ", x)
    b.close()
