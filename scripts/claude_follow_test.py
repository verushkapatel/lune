"""Play-along check with a synthetic performance fed in as the microphone.

Builds a WAV of the opening of Für Elise from Lune's own bar data (piano-like
tones), with one deliberate wrong note and one long pause, then runs Chromium
with that file as its fake microphone and checks that Lune follows to the end,
flags the wrong note in the right bar and the pause as a hesitation.

    python3 scripts/claude_follow_test.py [base-url]
"""
import json
import math
import struct
import sys
import wave

import numpy as np
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8100/lune/"
WAV = "/tmp/lune_follow_take.wav"
SR = 44100
SPQ = float(__import__("os").environ.get("SPQ", "1.1"))  # seconds per quarter


def tone(midi, dur, amp=0.18):
    f = 440 * 2 ** ((midi - 69) / 12)
    t = np.arange(int(SR * dur)) / SR
    env = np.minimum(1, t / 0.005) * np.exp(-t / 0.7)
    sig = sum((1 / n) * np.sin(2 * math.pi * f * n * t) * np.exp(-t * (n - 1) * 0.8) for n in range(1, 7))
    return amp * env * sig


def synth(events, wrong_index, pause_before):
    total = 1.0 + events[-1]["q"] * SPQ + 6 + 4
    buf = np.zeros(int(SR * total))
    t0 = 1.0
    shift = 0.0
    q0 = events[0]["q"]
    for i, ev in enumerate(events):
        if i == pause_before:
            shift += 3.5
        start = t0 + (ev["q"] - q0) * SPQ + shift
        midis = ev["midis"]
        if i == wrong_index:
            midis = [m + 6 for m in midis]  # a tritone off: clearly wrong
        for m in midis:
            s = tone(m, 1.6)
            a = int(start * SR)
            buf[a : a + len(s)] += s[: len(buf) - a]
    end = t0 + (events[-1]["q"] - q0) * SPQ + shift + 1.5
    buf = buf[: int(end * SR)]
    buf /= max(1e-9, np.abs(buf).max()) / 0.6
    noise = float(__import__("os").environ.get("NOISE", "0"))
    if noise:  # room noise, relative to peak level
        buf += np.random.default_rng(1).normal(0, noise, len(buf))
        buf = np.clip(buf, -1, 1)
    with wave.open(WAV, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", int(x * 32767)) for x in buf))
    return end


out = []


def check(name, ok, detail=""):
    out.append(("PASS" if ok else "FAIL", name, str(detail)[:300]))


with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page()
    pg.goto(BASE + "#/beethoven-fur-elise/score", wait_until="networkidle")
    pg.wait_for_function("() => document.querySelectorAll('#osmd .lane-letter').length > 50", timeout=60000)
    events = pg.evaluate("() => LuneFollow.__buildEvents().map(e => ({bar: e.bar, q: e.q, midis: e.midis}))")
    b.close()

    take = [e for e in events if e["bar"] <= 8]
    wrong_i = next(i for i, e in enumerate(take) if e["bar"] == 4)
    pause_i = next(i for i, e in enumerate(take) if e["bar"] == 7)
    length = synth(take, wrong_i, pause_i)

    b = p.chromium.launch(
        headless=True,
        args=[
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            f"--use-file-for-fake-audio-capture={WAV}%noloop",
            "--autoplay-policy=no-user-gesture-required",
        ],
    )
    ctx = b.new_context()
    ctx.grant_permissions(["microphone"])
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE + "#/beethoven-fur-elise/score", wait_until="networkidle")
    pg.wait_for_function("() => document.querySelectorAll('#osmd .lane-letter').length > 50", timeout=60000)
    pg.click("#btn-follow")
    pg.wait_for_selector("#lf-panel:not([hidden])")
    pg.wait_for_timeout(int(length * 1000) + 800)
    pg.evaluate("() => LuneFollow.isOn() && LuneFollow.stop()")
    pg.wait_for_timeout(500)
    res = pg.evaluate("() => window.__luneFollowLast")
    summary = pg.inner_text("#lf-panel")
    b.close()

reached = max([e["bar"] for e in res["log"] if e["kind"] == "match"] or [0])
n_take = len(take)
check(f"follows the performance to bar 8 ({res['matched']}/{n_take} events matched)", reached >= 8 and res["matched"] >= 0.8 * n_take, res["matched"])
wrong_bars = sorted({e["bar"] for e in res["log"] if e["kind"] == "wrong"})
check("wrong note flagged in bar 4", 4 in wrong_bars, wrong_bars)
check("no wrong notes flagged elsewhere", set(wrong_bars) <= {4}, wrong_bars)
hes = sorted({e["bar"] for e in res["log"] if e["kind"] == "hesitation"})
check("pause before bar 7 flagged as a hesitation", 7 in hes, hes)
check("no other hesitations", set(hes) <= {7}, hes)
check("summary names the bars", "4" in summary and "7" in summary, summary)
check("no page errors", not errs, errs[:2])
w = max(len(n) for _, n, _ in out)
for s, n, d in out:
    print(f"{s}  {n.ljust(w)}  {d if s == 'FAIL' else ''}")
print(f"\n{sum(s == 'PASS' for s, _, _ in out)}/{len(out)} passed")
json.dump(res, open("/tmp/lune_follow_log.json", "w"))
