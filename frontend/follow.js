/* Lune — play along: listen through the microphone, follow the score,
 * flag wrong notes and hesitations, and leave a stumble map.
 *
 * Method (all in the browser, nothing recorded or uploaded):
 *   1. Onsets: spectral flux on a log-magnitude spectrum, adaptive threshold.
 *   2. What was just played: the chroma (12 pitch classes) of the spectrum's
 *      *increase* at the onset, so notes still ringing from before don't count.
 *   3. Where you are: compare that chroma with the next few expected chords of
 *      the score (each with its overtones) and advance to the best match.
 *      A clear onset that matches none of them is a wrong note; a long gap
 *      compared with your own recent tempo is a hesitation.
 */
window.LuneFollow = (function () {
  const LOOKAHEAD = 4; // expected events considered at each onset
  const MATCH_T = 0.62; // cosine similarity to accept a match
  const WRONG_T = 0.42; // below this (for every candidate) it's a wrong note
  const MIN_GAP_MS = 100; // onsets closer than this are one attack

  let run = null;

  /* ---------- expected events from the score ---------- */

  function buildEvents() {
    const [from, to] = pieceBarSpan();
    const ts = String(state.piece?.timeSignature || "4/4").split("/").map(Number);
    const barQl = (ts[0] * 4) / (ts[1] || 4) || 4;
    const events = [];
    let q0 = 0;
    for (let b = from; b <= to; b++) {
      const d = debriefFor(b);
      if (!d) continue;
      const pack = d.playback || [...(d.rh || []), ...(d.lh || [])];
      const byOff = new Map();
      let end = 0;
      for (const n of pack) {
        const midi = Number(n.midi);
        if (!midi) continue;
        const off = Math.round((Number(n.offset) || 0) * 1000) / 1000;
        end = Math.max(end, off + (Number(n.duration) || 0));
        if (!byOff.has(off)) byOff.set(off, new Set());
        byOff.get(off).add(midi);
      }
      for (const off of [...byOff.keys()].sort((a, b) => a - b)) {
        events.push({ bar: b, q: q0 + off, midis: [...byOff.get(off)], tpl: template([...byOff.get(off)]) });
      }
      q0 += Math.max(barQl, end);
    }
    return events;
  }
  function template(midis) {
    const v = new Float32Array(12);
    for (const m of midis) {
      const pc = ((m % 12) + 12) % 12;
      const low = m < 48 ? 0.6 : 1; // weak fundamentals in the bass
      v[pc] += low;
      v[(pc + 7) % 12] += 0.32; // 3rd harmonic
      v[(pc + 4) % 12] += 0.12; // 5th harmonic
    }
    return normalize(v);
  }
  function normalize(v) {
    let s = 0;
    for (const x of v) s += x * x;
    s = Math.sqrt(s) || 1;
    return v.map((x) => x / s);
  }
  function cosine(a, b) {
    let s = 0;
    for (let i = 0; i < 12; i++) s += a[i] * b[i];
    return s;
  }

  /* ---------- audio ---------- */

  async function start() {
    if (run) return;
    if (!state.piece || !state.osmd) return toast("Open a score first.");
    if (!navigator.mediaDevices?.getUserMedia) return toast("This browser can’t use the microphone.");
    const events = buildEvents();
    if (events.length < 4) return toast("This score has too few notes to follow.");
    stopAll(); // Lune's own playback would be heard by the mic
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      toast("Lune needs microphone permission to listen. Nothing is recorded.");
      return;
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 4096; // ~90 ms window: short enough for quick notes
    an.smoothingTimeConstant = 0;
    src.connect(an);
    const n = an.frequencyBinCount;
    const binHz = ctx.sampleRate / an.fftSize;
    // bin → pitch class (only bins near a semitone centre count)
    const binPc = new Int8Array(n).fill(-1);
    const lo = Math.floor(55 / binHz);
    const hi = Math.min(n - 1, Math.ceil(2200 / binHz));
    // pitch classes from ~F3 up: lower bins are wider than a semitone, and
    // bass notes show up through their overtones there anyway
    for (let k = Math.ceil(170 / binHz); k <= hi; k++) {
      const midi = 69 + 12 * Math.log2((k * binHz) / 440);
      if (Math.abs(midi - Math.round(midi)) < 0.38) binPc[k] = ((Math.round(midi) % 12) + 12) % 12;
    }
    const sel = selectedBarsSorted()[0];
    let pos = 0;
    if (sel) {
      const i = events.findIndex((e) => e.bar >= sel);
      if (i >= 0) pos = i;
    }
    run = {
      key: window.LunePractice?.keyFor(state.piece),
      stream,
      ctx,
      an,
      db: new Float32Array(n),
      mag: new Float32Array(n),
      prevLog: new Float32Array(n),
      hist: [new Float32Array(n), new Float32Array(n), new Float32Array(n)],
      floor: null,
      post: new Float32Array(n),
      postN: 0,
      binPc,
      lo,
      hi,
      flux: [],
      lastOnset: 0,
      pendingAt: 0,
      events,
      pos,
      startPos: pos,
      lastMatch: null, // {t, q}
      secPerQ: [],
      stats: {}, // bar → {wrong, hesitations}
      lastWrongAt: 0,
      tots: [],
      matched: 0,
      onsets: 0,
      log: [],
      t0: performance.now(),
    };
    run.timer = setInterval(tick, 20);
    showPanel();
    showBar(events[pos].bar);
    const btn = $("btn-follow");
    btn?.classList.add("on");
    btn?.setAttribute("aria-pressed", "true");
  }

  function tick() {
    const r = run;
    if (!r) return;
    const now = performance.now();
    r.an.getFloatFrequencyData(r.db);
    let flux = 0;
    let energy = 0;
    for (let k = r.lo; k <= r.hi * 2 && k < r.db.length; k++) {
      const m = Math.pow(10, r.db[k] / 20);
      r.mag[k] = m;
      const l = Math.log1p(1000 * m);
      const d = l - r.prevLog[k];
      if (d > 0) flux += d;
      r.prevLog[k] = l;
      energy += m * m;
    }
    r.flux.push(flux);
    if (r.flux.length > 40) r.flux.shift();
    meter(energy);

    // noise floor per bin: follows quiet moments down, creeps up slowly
    if (!r.floor) r.floor = r.mag.slice();
    for (let k = r.lo; k <= r.hi; k++) r.floor[k] = r.mag[k] < r.floor[k] ? r.mag[k] : r.floor[k] * 1.003;

    const sorted = [...r.flux].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)] || 0;
    const thr = med * 1.8 + 6;
    const isOnset = flux > thr && energy > 1e-6 && now - r.lastOnset > MIN_GAP_MS;
    // what was played: the spectrum 30–70 ms after the attack, averaged
    if (r.pendingAt) {
      if (now >= r.pendingAt - 40) {
        for (let k = r.lo; k <= r.hi; k++) r.post[k] += r.mag[k];
        r.postN++;
      }
      if (now >= r.pendingAt || isOnset) {
        r.pendingAt = 0;
        if (r.postN) judge(now);
      }
    }
    if (isOnset && !r.pendingAt) {
      r.lastOnset = now;
      r.onsets++;
      r.pendingAt = now + 70;
      r.post.fill(0);
      r.postN = 0;
      // before the attack: average of the last three frames
      const pre = (r.preCopy = new Float32Array(r.mag.length));
      for (const h of r.hist) for (let k = r.lo; k <= r.hi; k++) pre[k] += h[k] / r.hist.length;
    }
    const oldest = r.hist.shift();
    oldest.set(r.mag);
    r.hist.push(oldest);
    // hesitation that is still going on: show it live
    if (r.lastMatch && r.pos < r.events.length) {
      const ev = r.events[r.pos];
      const gapQ = ev.q - r.lastMatch.q;
      const spq = median(r.secPerQ) || 0.6;
      const limit = Math.max(1.6, 2.6 * gapQ * spq) * 1000;
      if (gapQ > 0 && now - r.lastMatch.t > limit && !r.lastMatch.hes) {
        r.lastMatch.hes = true;
        bump(ev.bar, "hesitations");
        const entry = { t: Math.round(now - r.t0), kind: "hesitation", bar: ev.bar };
        r.log.push(entry);
        r.openHes = entry; // only counts if playing resumes (else you just stopped)
      }
    }
  }

  function judge(now) {
    const r = run;
    const pre = r.preCopy;
    const chroma = new Float32Array(12);
    for (let k = r.lo; k <= r.hi; k++) {
      const pc = r.binPc[k];
      if (pc < 0) continue;
      const post = r.post[k] / r.postN;
      const d = post - Math.max(pre[k], 2 * r.floor[k]) * 1.15;
      if (d > 0) chroma[pc] += d;
    }
    let tot = 0;
    for (const x of chroma) tot += x;
    if (tot < 1e-5) return; // nothing new and tonal (a knock, a page turn)
    const obs = normalize(chroma);
    // the whole sound after the attack (ringing notes included): a repeated
    // or held pitch barely shows in the increase, but is plainly here
    const whole = new Float32Array(12);
    for (let k = r.lo; k <= r.hi; k++) {
      const pc = r.binPc[k];
      if (pc >= 0) whole[pc] += Math.max(0, r.post[k] / r.postN - 2 * r.floor[k]);
    }
    const wholeN = normalize(whole);
    let wholeSim = 0;
    for (let k = 0; k < LOOKAHEAD && r.pos + k < r.events.length; k++) wholeSim = Math.max(wholeSim, cosine(wholeN, r.events[r.pos + k].tpl));
    let best = -1;
    let bestSim = 0;
    for (let k = 0; k < LOOKAHEAD && r.pos + k < r.events.length; k++) {
      const sim = cosine(obs, r.events[r.pos + k].tpl) - 0.04 * k;
      if (sim > bestSim) {
        bestSim = sim;
        best = r.pos + k;
      }
    }
    const t = Math.round(now - r.t0);
    if (best >= 0 && bestSim >= MATCH_T) {
      const ev = r.events[best];
      r.tots.push(tot);
      if (r.tots.length > 16) r.tots.shift();
      if (r.lastMatch && ev.q > r.lastMatch.q) {
        const spq = (now - r.lastMatch.t) / 1000 / (ev.q - r.lastMatch.q);
        if (!r.lastMatch.hes && spq > 0.08 && spq < 3) {
          r.secPerQ.push(spq);
          if (r.secPerQ.length > 12) r.secPerQ.shift();
        }
      }
      if (r.openHes && r.openHes.bar !== ev.bar) {
        // the pause belongs to the note you were reaching for
        r.stats[r.openHes.bar].hesitations--;
        r.openHes.bar = ev.bar;
        bump(ev.bar, "hesitations");
      }
      r.lastMatch = { t: now, q: ev.q };
      r.openHes = null;
      r.pos = best + 1;
      r.matched++;
      r.log.push({ t, kind: "match", bar: ev.bar, sim: +bestSim.toFixed(2) });
      showBar(ev.bar);
      if (r.pos >= r.events.length) setTimeout(() => stop(), 600);
    } else if (bestSim < WRONG_T && wholeSim < 0.6 && r.matched > 0 && r.postN >= 2 && now - r.lastWrongAt > 250 && tot > 0.25 * (median(r.tots) || 0)) {
      // (quiet clicks and knocks are far weaker than the notes you've been playing)
      const bar = r.events[Math.min(r.pos, r.events.length - 1)].bar;
      r.lastWrongAt = now;
      bump(bar, "wrong");
      r.log.push({ t, kind: "wrong", bar, sim: +bestSim.toFixed(2), whole: +wholeSim.toFixed(2) });
      flashWrong();
    } else {
      r.log.push({ t, kind: "unsure", sim: +bestSim.toFixed(2), whole: +wholeSim.toFixed(2) });
    }
    updatePanel();
  }

  function median(a) {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  }
  function bump(bar, k) {
    const s = (run.stats[bar] = run.stats[bar] || { wrong: 0, hesitations: 0 });
    s[k]++;
    updatePanel();
  }

  /* ---------- UI ---------- */

  function showPanel() {
    let p = $("lf-panel");
    if (!p) {
      p = document.createElement("div");
      p.id = "lf-panel";
      p.className = "lf-panel";
      p.setAttribute("role", "status");
      p.setAttribute("aria-live", "polite");
      $("panel-score")?.appendChild(p);
    }
    p.hidden = false;
    p.innerHTML = `<span class="lf-dot" aria-hidden="true"></span>
      <span class="lf-text"><strong>Listening</strong> · start playing <span class="lf-where"></span></span>
      <span class="lf-meter" aria-hidden="true"><i></i></span>
      <button type="button" class="primary lf-stop">Stop</button>`;
    p.querySelector(".lf-stop").onclick = () => stop();
  }
  function meter(energy) {
    const i = $("lf-panel")?.querySelector(".lf-meter i");
    if (i) i.style.transform = `scaleX(${Math.min(1, Math.sqrt(energy) * 40).toFixed(3)})`;
  }
  function updatePanel() {
    const p = $("lf-panel");
    if (!p || !run) return;
    const totals = Object.values(run.stats).reduce((a, s) => ((a.w += s.wrong), (a.h += s.hesitations), a), { w: 0, h: 0 });
    const bar = run.events[Math.min(run.pos, run.events.length - 1)].bar;
    p.querySelector(".lf-text").innerHTML = `<strong>Listening</strong> · bar ${bar}${
      totals.w || totals.h ? ` · ${totals.w} wrong · ${totals.h} pause${totals.h === 1 ? "" : "s"}` : ""
    }`;
  }
  function flashWrong() {
    const p = $("lf-panel");
    if (!p) return;
    p.classList.remove("lf-wrong");
    void p.offsetWidth;
    p.classList.add("lf-wrong");
  }
  let lastShownBar = null;
  function showBar(bar) {
    if (bar === lastShownBar && $("lf-hilite")) return;
    lastShownBar = bar;
    const scroll = $("score-scroll");
    const b = LuneAnnotate.measureBoundsInHost?.(state.osmd, $("osmd"), bar);
    if (!scroll || !b) return;
    let h = $("lf-hilite");
    if (!h) {
      h = document.createElement("div");
      h.id = "lf-hilite";
      h.className = "lf-hilite";
      scroll.appendChild(h);
    }
    h.hidden = false;
    h.style.cssText = `left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px`;
    window.LunePractice?.scrollToBar(bar);
  }

  async function stop({ quiet = false } = {}) {
    const r = run;
    if (!r) return;
    run = null;
    clearInterval(r.timer);
    if (r.openHes) {
      // the last "pause" was the end of playing, not a stumble
      const st = r.stats[r.openHes.bar];
      if (st) st.hesitations = Math.max(0, st.hesitations - 1);
      r.log.splice(r.log.indexOf(r.openHes), 1);
    }
    try {
      r.stream.getTracks().forEach((t) => t.stop());
      await r.ctx.close();
    } catch {
      /* already closed */
    }
    const btn = $("btn-follow");
    btn?.classList.remove("on");
    btn?.setAttribute("aria-pressed", "false");
    $("lf-hilite")?.remove();
    lastShownBar = null;
    window.__luneFollowLast = { log: r.log, stats: r.stats, matched: r.matched, onsets: r.onsets, events: r.events.length, startPos: r.startPos, pos: r.pos };
    const p = $("lf-panel");
    const played = r.pos - r.startPos;
    if (quiet || played < 2) {
      if (p) p.hidden = true;
      return;
    }
    const bars = Object.entries(r.stats).filter(([, s]) => s.wrong + s.hesitations > 0);
    if (r.key) {
      try {
        await LuneStore.addStumbles(r.key, r.stats);
        await LuneStore.markPractised(r.key);
        const map = await LuneStore.stumbleMap(r.key);
        state.lpHeat = { key: r.key, map };
      } catch {
        state.lpHeat = { key: r.key, map: r.stats };
      }
    }
    const first = r.events[r.startPos]?.bar;
    const last = r.events[Math.max(r.startPos, r.pos - 1)]?.bar;
    if (!p) return;
    p.innerHTML = `<span class="lf-text"><strong>${first === last ? `Bar ${first}` : `Bars ${first}–${last}`}</strong> · ${
      bars.length
        ? `${bars.length} bar${bars.length === 1 ? "" : "s"} to look at: ${bars
            .sort((a, b) => b[1].wrong + 2 * b[1].hesitations - (a[1].wrong + 2 * a[1].hesitations))
            .slice(0, 5)
            .map(([b]) => b)
            .join(", ")}`
        : "clean run — nothing to flag"
    }</span>
      ${bars.length ? `<button type="button" class="primary lf-review">Review these bars</button>` : ""}
      <button type="button" class="quiet ink lf-map" aria-pressed="true">Stumble map</button>
      <button type="button" class="quiet ink lf-close" aria-label="Close">×</button>`;
    p.querySelector(".lf-review")?.addEventListener("click", async (e) => {
      for (const [b] of bars) await LuneStore.queueBar(r.key, Number(b));
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = "In Today’s bars";
      window.LunePractice?.refreshBadge();
    });
    p.querySelector(".lf-map").addEventListener("click", (e) => {
      const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
      e.currentTarget.setAttribute("aria-pressed", String(on));
      if (!on) state.lpHeat = null;
      else LuneStore.stumbleMap(r.key).then((map) => (state.lpHeat = { key: r.key, map })).then(() => window.LunePractice?.paintScoreMarks());
      window.LunePractice?.paintScoreMarks();
    });
    p.querySelector(".lf-close").addEventListener("click", () => (p.hidden = true));
    window.LunePractice?.paintScoreMarks();
  }

  function toggle() {
    if (run) stop();
    else start();
  }

  return { start, stop, toggle, isOn: () => !!run, __buildEvents: buildEvents, __template: template };
})();
