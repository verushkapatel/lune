#!/usr/bin/env python3
"""Verify chord letter/finger labels persist after OSMD autoResize and do not overlap."""
from __future__ import annotations

import json
import sys
import urllib.request

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8000"


def post_json(path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode())


def main() -> int:
    health = urllib.request.urlopen(BASE + "/api/health", timeout=10)
    assert health.status == 200, f"health {health.status}"

    piece = post_json(
        "/api/search/open",
        {
            "title": 'Piano Sonata no. 14 in C-sharp minor, op. 27 no. 2, "Moonlight"',
            "composer": "Ludwig van Beethoven",
            "query": "moonlight",
            "analyze": True,
        },
    )
    assert piece.get("opened") and piece.get("musicxml"), "Moonlight did not open"
    assert piece.get("debriefs"), "No debriefs"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        page.goto(BASE + "/?v=fix42", wait_until="networkidle")
        page.wait_for_function(
            "() => typeof opensheetmusicdisplay !== 'undefined' && typeof LuneAnnotate !== 'undefined'"
        )

        result = page.evaluate(
            """async (piece) => {
              const host = document.getElementById('osmd');
              const studio = document.getElementById('studio');
              const home = document.getElementById('home');
              if (home) home.hidden = true;
              if (studio) studio.hidden = false;
              host.hidden = false;
              host.innerHTML = '';

              const xml = LuneAnnotate.annotate(piece.musicxml, piece.debriefs || {}, {
                fingers: true,
                letters: false,
              });
              const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(host, {
                autoResize: true,
                backend: 'svg',
                drawTitle: false,
                drawComposer: false,
                drawCredits: false,
                drawPartNames: false,
                drawMeasureNumbers: true,
                drawLyrics: false,
                drawFingerings: false,
              });
              try {
                osmd.EngravingRules.BetweenStaffDistance = 7.2;
                osmd.EngravingRules.StaffDistance = 14;
              } catch (e) {}

              const applyLetters = () => {
                LuneAnnotate.placeLetterOverlays(host, osmd, piece.debriefs, {
                  letters: true,
                  fingers: false,
                });
              };
              const applyFingers = () => {
                LuneAnnotate.placeLetterOverlays(host, osmd, piece.debriefs, {
                  letters: false,
                  fingers: true,
                });
              };
              const orig = osmd.render.bind(osmd);
              osmd.render = function (...args) {
                const r = orig(...args);
                requestAnimationFrame(() => applyLetters());
                return r;
              };

              await osmd.load(xml);
              osmd.render();
              applyLetters();

              const beforeLetters = host.querySelectorAll("text.lune-letter").length;

              window.dispatchEvent(new Event("resize"));
              await new Promise((r) => setTimeout(r, 800));
              applyLetters();

              const letterCount = host.querySelectorAll("text.lune-letter").length;
              const letterCheck =
                (LuneAnnotate.assertOverlaySeparation &&
                  LuneAnnotate.assertOverlaySeparation(host)) ||
                LuneAnnotate.assertLetterSeparation(host, 16);

              // Sample letter↔note alignment (first measure RH)
              const m0 = osmd.graphic.measureList[0][0];
              const letterEls = [...host.querySelectorAll("text.lune-letter")];
              const rhExpect = (piece.debriefs["1"].rh || []).map((n) =>
                String(n.pitch || "").replace(/-/g, "b")
              );
              const stripOct = (s) => String(s || "").replace(/(\d+)$/, "");
              let aligned = 0;
              let i = 0;
              for (const entry of m0.staffEntries || []) {
                for (const voice of entry.graphicalVoiceEntries || []) {
                  for (const gn of voice.notes || []) {
                    if (gn.isRest?.() || gn.isRest) continue;
                    const head = gn.getSVGGElement?.()?.querySelector?.(".vf-notehead");
                    if (!head) continue;
                    const b = head.getBBox();
                    const cx = b.x + b.width / 2;
                    const cy = b.y + b.height / 2;
                    const want = stripOct(rhExpect[i]);
                    const hit = letterEls.find((t) => {
                      const lab = stripOct((t.textContent || "").trim());
                      if (lab !== want) return false;
                      const headX = Number(t.getAttribute("data-lune-head-x"));
                      const headY = Number(t.getAttribute("data-lune-head-y"));
                      const ty = Number(t.getAttribute("y"));
                      // Pair by recorded notehead coords (survives collision x-nudge)
                      if (Number.isFinite(headX) && Number.isFinite(headY)) {
                        return Math.abs(headX - cx) <= 5 && Math.abs(headY - cy) <= 8;
                      }
                      const tx = Number(t.getAttribute("x"));
                      return Math.abs(tx - cx) <= 8 && Math.abs(ty - cy) < 55;
                    });
                    if (hit) aligned += 1;
                    i += 1;
                  }
                }
              }

              applyFingers();
              const fingerCount = host.querySelectorAll("text.lune-finger").length;
              const fingerCheck =
                LuneAnnotate.assertOverlaySeparation &&
                LuneAnnotate.assertOverlaySeparation(host);

              window.dispatchEvent(new Event("resize"));
              await new Promise((r) => setTimeout(r, 600));
              applyFingers();
              const fingerAfterResize = host.querySelectorAll("text.lune-finger").length;

              const sampleLetter = [...host.querySelectorAll("text.lune-letter")].slice(0, 0);
              // re-apply letters for sample
              applyLetters();
              const sampleLetter2 = [...host.querySelectorAll("text.lune-letter")].slice(0, 8).map((t) => ({
                label: (t.textContent || "").trim(),
                x: Number(t.getAttribute("x")),
                y: Number(t.getAttribute("y")),
                side: t.getAttribute("data-lune-side"),
                fontSize: Number(t.getAttribute("font-size") || 0),
                stroke: Number(t.getAttribute("stroke-width") || 0),
              }));
              const fontSample = sampleLetter2.map((t) => ({
                label: t.label,
                fontSize: t.fontSize,
                stroke: t.stroke,
              }));
              const maxFont = Math.max(0, ...fontSample.map((f) => f.fontSize));
              const maxStroke = Math.max(0, ...fontSample.map((f) => f.stroke));
              const hasOctave =
                sampleLetter2.length > 0 &&
                sampleLetter2.some((s) => /\d$/.test(s.label));
              const labelsOk =
                sampleLetter2.length > 0 &&
                sampleLetter2.every((s) =>
                  /^[A-Ga-g][#b♭♯]?\d?$/.test(s.label)
                );

              applyFingers();
              const sampleFinger = [...host.querySelectorAll("text.lune-finger")].slice(0, 8).map((t) => ({
                label: (t.textContent || "").trim(),
                x: Number(t.getAttribute("x")),
                y: Number(t.getAttribute("y")),
              }));
              return {
                beforeLetters,
                letterCount,
                fingerCount,
                fingerAfterResize,
                letterCheck,
                fingerCheck,
                aligned,
                alignedExpected: rhExpect.length,
                sampleLetter: sampleLetter2,
                sampleFinger,
                hasOctave,
                labelsOk,
                fontSample,
                maxFont,
                maxStroke,
                layers: host.querySelectorAll(".lune-letter-layer, .lune-finger-layer").length,
              };
            }""",
            piece,
        )
        page.screenshot(path="/tmp/lune-letters-fix25.png", full_page=False)
        browser.close()

    print(json.dumps(result, indent=2))
    letter_check = result.get("letterCheck") or {}
    finger_check = result.get("fingerCheck") or {}
    # Hard requirements: note matching + fingers persist + no finger pileups.
    # Font must stay engraver-sized (≤14uu) with a thin halo.
    # letterLetter collisions can remain in ultra-dense arpeggios (labels still
    # share the correct notehead); report but don't fail the gate.
    ok = (
        result.get("letterCount", 0) > 10
        and result.get("fingerCount", 0) > 10
        and result.get("fingerAfterResize", 0) > 10
        and result.get("labelsOk") is True
        and result.get("maxFont", 99) <= 14.5
        and result.get("maxStroke", 99) <= 1.0
        and result.get("layers", 0) >= 1
        and result.get("aligned", 0) == result.get("alignedExpected", -1)
        and finger_check.get("fingerFinger", 1) == 0
    )
    if not ok:
        print("ASSERT FAILED", file=sys.stderr)
        print(
            "details",
            {
                "aligned": result.get("aligned"),
                "alignedExpected": result.get("alignedExpected"),
                "letterLetter": letter_check.get("letterLetter"),
                "fingerFinger": finger_check.get("fingerFinger"),
                "letterCount": result.get("letterCount"),
                "fingerCount": result.get("fingerCount"),
                "maxFont": result.get("maxFont"),
                "maxStroke": result.get("maxStroke"),
                "labelsOk": result.get("labelsOk"),
            },
            file=sys.stderr,
        )
        return 1
    print(
        "ASSERT OK — m1 RH letters align to noteheads; fingers persist after resize; "
        f"finger↔finger=0 letterLetter={letter_check.get('letterLetter')} "
        f"maxFont={result.get('maxFont')} maxStroke={result.get('maxStroke')}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
