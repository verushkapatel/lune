#!/usr/bin/env python3
"""Render every converted library score with Lune's own engraver (OSMD) and
record which ones draw. Only scores that render go into the library.

Usage: python3 scripts/pdmx_check.py <results.jsonl> <out-dir> <check.json>
(needs Lune served at http://127.0.0.1:8137/lune/)
"""
import json
import os
import sys
import zipfile

from playwright.sync_api import sync_playwright

res, out_dir, check_path = sys.argv[1:4]
done = json.load(open(check_path)) if os.path.exists(check_path) else {}
todo = []
for line in open(res):
    r = json.loads(line)
    if r.get("ok") and r["id"] not in done:
        todo.append(r)
print(len(todo), "to check", flush=True)
JS = """async (xml) => { const div = document.createElement('div'); div.style.width = '1000px'; document.body.appendChild(div);
  try { const o = new opensheetmusicdisplay.OpenSheetMusicDisplay(div, { autoResize: false, drawingParameters: 'compact' }); await o.load(xml); o.render();
    const n = div.querySelectorAll('.vf-stavenote').length; div.remove(); return n > 0 ? 'ok' : 'empty'; }
  catch (e) { div.remove(); return 'ERR ' + String(e && e.message || e).slice(0, 100); } }"""
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1100, "height": 800})
    pg.goto("http://127.0.0.1:8137/lune/", wait_until="networkidle")
    for i, r in enumerate(todo):
        try:
            xml = zipfile.ZipFile(os.path.join(out_dir, r["file"])).read("score.musicxml").decode("utf-8")
            done[r["id"]] = pg.evaluate(JS, xml)
        except Exception as e:  # noqa: BLE001
            done[r["id"]] = "ERR " + str(e)[:100]
            pg = b.new_page(viewport={"width": 1100, "height": 800})
            pg.goto("http://127.0.0.1:8137/lune/", wait_until="networkidle")
        if i % 200 == 0:
            json.dump(done, open(check_path, "w"))
            print(i, flush=True)
    b.close()
json.dump(done, open(check_path, "w"))
bad = {k: v for k, v in done.items() if v != "ok"}
print(len(done) - len(bad), "render,", len(bad), "do not")
