/* Lune — Practise with Lune: a short lesson on the bars that need you.
 *
 * The method a teacher uses on a hard bar, one bar at a time:
 *   1. Right hand alone: Lune plays it slowly, then it is your turn.
 *   2. Left hand alone: the same.
 *   3. Hands together: Lune plays it, then you do.
 *   4. How did it go? Again or Hard offers "Once more, slower"; otherwise on.
 * A hand with nothing to play in a bar is skipped. There is no timer: the
 * pianist moves on when they have played it. Each demo is exactly one bar,
 * played through the score's own timeline with the hand filter and a slower
 * tempo, and it stops on the bar line. The session ends with the report.
 */
window.LuneSession = (function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const GRADES = [
    ["again", "Again"],
    ["hard", "Hard"],
    ["okay", "Okay"],
    ["good", "Good"],
    ["strong", "Strong"],
  ];
  const SLOW = 0.75; // the demo tempo for hands separately, as a share of the current tempo
  const ICON = {
    replay: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    skip: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M17.5 5.5v13M6 6v12l8.5-6z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    ear: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  };

  let run = null; // { bars, i, steps, s, phase: "demo" | "turn" | "rate" | "again", slower, prevRate, prevFilter }
  let gen = 0;
  const timers = new Set();

  const st = () => (typeof state !== "undefined" ? state : null);
  const piece = () => st()?.piece || null;
  const keyOf = (p) => window.LunePractice?.keyFor?.(p) || p?.id || p?.title || "";
  const barData = (n) => {
    try {
      return debriefFor(n);
    } catch {
      return null;
    }
  };

  /** The bars for today: those due back first, then the hardest by Lune's reading. At most four. */
  async function chooseBars(p) {
    const key = keyOf(p);
    const now = new Date().toISOString();
    let bars = [];
    try {
      bars = ((await window.LuneStore?.listCards?.(key)) || [])
        .filter((c) => c.due_at && c.due_at <= now)
        .sort((a, b) => a.due_at.localeCompare(b.due_at))
        .map((c) => Number(c.bar));
    } catch {
      bars = [];
    }
    // the teacher's homework comes before anything Lune would pick
    const hw = window.LunePractice?.homework?.()?.bars || [];
    bars = [...new Set([...hw, ...bars])];
    let spots = p?.hardSpots || [];
    if (!spots.length && p?.musicxml && window.LuneLite?.analyze) {
      try {
        spots = window.LuneLite.analyze(p.musicxml).hardSpots || [];
      } catch {
        spots = [];
      }
    }
    for (const s of spots) {
      const b = Number(typeof s === "object" ? s.measure : s);
      if (b > 0 && !bars.includes(b)) bars.push(b);
    }
    return bars.filter((b) => barData(b)).slice(0, 4);
  }

  /** The steps for one bar: each hand that has notes, then both. */
  function stepsFor(bar) {
    const d = barData(bar) || {};
    const steps = [];
    if (d.rh?.length) steps.push({ hand: "rh", label: "Right hand", short: "Right" });
    if (d.lh?.length) steps.push({ hand: "lh", label: "Left hand", short: "Left" });
    if (steps.length > 1 || !steps.length) steps.push({ hand: "both", label: "Hands together", short: "Together" });
    return steps;
  }

  /** One clear instruction for this bar and step, from Lune's own reading of it. */
  function instruction(bar, step) {
    const d = barData(bar) || {};
    const first = (v) => String((Array.isArray(v) ? v : v ? [v] : []).find(Boolean) || "").split(/(?<=[.!?])\s/)[0];
    if (step.hand !== "both") {
      const notes = (step.hand === "rh" ? d.rh : d.lh) || [];
      const who = step.hand === "rh" ? "Right" : "Left";
      const at = new Map();
      for (const x of notes) at.set(x.offset ?? 0, [...(at.get(x.offset ?? 0) || []), x]);
      const groups = [...at.values()];
      const chords = groups.some((g) => g.length > 1);
      if (chords) return `${who} hand only, slowly. Set each chord shape over the keys before you play it.`;
      const fingers = groups.map((g) => g[0].edFinger ?? g[0].fingering).filter(Boolean);
      // a short run reads well as numbers; a long one is better as one idea
      if (fingers.length && fingers.length <= 5) return `${who} hand only, slowly. Fingers ${fingers.join(" ")}.`;
      return `${who} hand only, slowly. Keep every note even.`;
    }
    // the hands have just been practised alone, so skip advice that says to do that first
    const useful = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).split(/(?<=[.!?])\s/)[0]).find((x) => x && !/separately|alone|each hand/i.test(x));
    const tip = useful(d.lineAdvice?.together) || useful(d.advice) || "Hands together, at a tempo where nothing breaks.";
    return run?.slower ? `A little slower this time. ${tip}` : tip;
  }

  /* ---------------- the piano: exactly one bar ---------------- */

  const wait = (ms, g) =>
    new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      timers.add(t);
      if (g !== gen) {
        clearTimeout(t);
        resolve();
      }
    });

  async function demo(bar, hand, rate, g) {
    if (g !== gen) return;
    window.LunePiano?.setHandFilter?.(hand);
    try {
      setPlayRate(rate);
    } catch {
      window.LunePiano?.setRate?.(rate);
    }
    try {
      await playSnippet(bar, bar);
    } catch {
      return;
    }
    const marks = window.LunePiano?.barMarkers?.() || [];
    const from = marks.find((m) => Number(m.bar) === Number(bar))?.t ?? 0;
    const to = marks.find((m) => Number(m.bar) > Number(bar))?.t ?? window.LunePiano?.duration?.() ?? from + 1;
    const fill = () => document.querySelector("#lune-session .ls2-meter i");
    await new Promise((resolve) => {
      const t0 = performance.now();
      let started = false;
      const iv = setInterval(() => {
        const playing = !!window.LunePiano?.isPlaying?.();
        if (playing) started = true;
        const f = fill();
        if (f && started) f.style.transform = `scaleX(${Math.max(0, Math.min(1, ((window.LunePiano?.progress?.() || 0) - from) / Math.max(0.1, to - from)))})`;
        const dt = performance.now() - t0;
        if (g !== gen || (started && !playing) || (!started && dt > 8000) || dt > 60000) {
          clearInterval(iv);
          timers.delete(iv);
          resolve();
        }
      }, 50);
      timers.add(iv);
    });
  }

  function hush() {
    gen++;
    for (const t of timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    timers.clear();
    try {
      const s = st();
      if (s) s.snippetEnd = null;
      if (window.LunePiano?.isPlaying?.()) window.LunePiano.pause();
      syncPlayButton?.();
    } catch {
      /* not playing */
    }
  }

  /* ---------------- the lesson ---------------- */

  const step = () => run.steps[run.s];
  const bar = () => run.bars[run.i];
  const rateFor = () => {
    const base = run.prevRate || 1;
    const r = step().hand === "both" ? base : base * SLOW;
    return Math.max(0.4, Math.round(r * (1 - run.slower * 0.15) * 100) / 100);
  };

  async function playStep() {
    hush();
    const g = gen;
    run.phase = "demo";
    paint();
    await wait(250, g);
    await demo(bar(), step().hand, rateFor(), g);
    if (g !== gen || !run) return;
    run.phase = "turn";
    paint();
  }

  function startBar(i) {
    run.i = i;
    run.steps = stepsFor(bar());
    run.s = 0;
    run.slower = 0;
    highlight(bar());
    playStep();
  }

  function next() {
    if (!run) return;
    if (run.phase === "demo") {
      // the pianist is ready before the demo has finished: go straight to their turn
      hush();
      run.phase = "turn";
      return paint();
    }
    if (run.s + 1 < run.steps.length) {
      run.s += 1;
      return playStep();
    }
    hush();
    run.phase = "rate";
    paint();
  }

  async function rate(g) {
    const p = piece();
    const key = keyOf(p);
    try {
      await window.LuneStore?.reviewBar?.(key, bar(), g);
      window.LunePlans?.noteActivity?.("rate", { key, title: p?.overview?.title || p?.title || "", bar: bar() });
    } catch {
      /* the rating still counts for this session */
    }
    run.rated = (run.rated || 0) + 1;
    if (g === "again" || g === "hard") {
      run.phase = "again";
      return paint();
    }
    run.phase = "nice";
    paint();
    const gg = gen;
    await wait(900, gg);
    if (gg === gen && run) nextBar();
  }

  function nextBar() {
    if (run.i + 1 < run.bars.length) startBar(run.i + 1);
    else end(true);
  }

  function slower() {
    run.slower += 1;
    run.s = run.steps.length - 1; // straight to hands together, slower
    playStep();
  }

  function highlight(n) {
    try {
      setBarSelection([n], { open: false, primary: n });
      window.LunePractice?.scrollToBar?.(n);
      // the score re-lays itself out when the card makes room for it: find the bar again once it has
      for (const ms of [450, 1200]) setTimeout(() => run && bar() === n && window.LunePractice?.scrollToBar?.(n), ms);
    } catch {
      /* the score is not on the page */
    }
  }

  /* ---------------- the card ---------------- */

  function panel() {
    let el = $("lune-session");
    if (el) return el;
    el = document.createElement("section");
    el.id = "lune-session";
    el.className = "ls-panel ls2";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "false");
    el.setAttribute("aria-labelledby", "ls-title");
    document.body.appendChild(el);
    el.addEventListener("click", onClick);
    return el;
  }

  function paint() {
    const el = panel();
    if (!run) return;
    const n = bar();
    const s = step();
    const dots = run.bars.map((_, k) => `<i class="${k < run.i ? "done" : k === run.i ? "on" : ""}"></i>`).join("");
    const trail = run.steps
      .map((x, k) => `<span class="${k < run.s || run.phase === "rate" || run.phase === "again" ? "done" : k === run.s ? "on" : ""}">${x.short}</span>`)
      .join("");
    let body = "";
    if (run.phase === "demo" || run.phase === "turn") {
      const listening = run.phase === "demo";
      body = `
        <p class="ls2-say">${listening ? `<span class="ls2-live">${ICON.ear}Listen: ${esc(s.label.toLowerCase())}${run.slower ? ", slower" : s.hand === "both" ? "" : ", slowly"}</span>` : esc(instruction(n, s))}</p>
        <div class="ls2-transport">
          <button type="button" class="ls2-btn" data-ls="replay" aria-label="Hear it again" title="Hear it again (R)">${ICON.replay}</button>
          <button type="button" class="ls2-main" data-ls="next" aria-keyshortcuts="Space">${listening ? "I’m ready" : run.s + 1 < run.steps.length ? "Played it" : "Played it together"}</button>
          <button type="button" class="ls2-btn" data-ls="skip" aria-label="Skip to the next bar" title="Skip this bar">${ICON.skip}</button>
        </div>`;
    } else if (run.phase === "rate") {
      body = `
        <p class="ls2-say">How did bar ${n} go?</p>
        <div class="ls2-grades" role="group" aria-label="How it went">${GRADES.map(([g, l]) => `<button type="button" data-grade="${g}">${l}</button>`).join("")}</div>`;
    } else if (run.phase === "nice") {
      const last = run.i + 1 >= run.bars.length;
      body = `<p class="ls2-say ls2-nice"><span class="ls2-tick" aria-hidden="true">✓</span> ${last ? "Lovely. That’s the last bar." : `Nice. Next, bar ${run.bars[run.i + 1]}.`}</p>`;
    } else {
      body = `
        <p class="ls2-say">That’s normal for a hard bar. Once more, a little slower?</p>
        <div class="ls2-transport">
          <button type="button" class="ls2-quiet" data-ls="move">Next bar</button>
          <button type="button" class="ls2-main" data-ls="slower" aria-keyshortcuts="Space">Once more, slower</button>
        </div>`;
    }
    el.innerHTML = `
      <div class="ls2-head">
        <h2 id="ls-title">Practise with Lune</h2>
        <span class="ls2-dots" aria-label="Bar ${run.i + 1} of ${run.bars.length}">${dots}</span>
        <button type="button" class="ls2-x" data-ls="end" aria-label="End the session" title="End (Esc)">${ICON.close}</button>
      </div>
      <p class="ls2-bar${run.lastBar !== n ? " is-new" : ""}">Bar ${n}</p>
      <div class="ls2-trail" aria-hidden="true">${trail}</div>
      <div class="ls2-meter${run.phase === "demo" ? " on" : ""}" aria-hidden="true"><i></i></div>
      <div class="ls2-body" data-phase="${run.phase}-${run.s}">${body}</div>
      <p class="visually-hidden" aria-live="polite">${run.phase === "demo" ? `Bar ${n}. ${s.label}. Listen.` : run.phase === "turn" ? `Your turn. ${esc(instruction(n, s))}` : run.phase === "rate" ? `How did bar ${n} go?` : run.phase === "nice" ? "Nice." : "Once more, slower?"}</p>`;
    run.lastBar = n;
    el.hidden = false;
    document.body.classList.add("ls-on");
    const main = el.querySelector(".ls2-main, .ls2-grades button");
    if (main && !el.contains(document.activeElement)) setTimeout(() => main.focus({ preventScroll: true }), 30);
  }

  function onClick(e) {
    const b = e.target.closest("button");
    if (!b || !run) return;
    const act = b.dataset.ls;
    if (act === "end") return end(false);
    if (act === "next") return next();
    if (act === "replay") return playStep();
    if (act === "skip") {
      hush();
      return nextBar();
    }
    if (act === "slower") return slower();
    if (act === "move") return nextBar();
    if (b.dataset.grade) {
      b.classList.add("on");
      return rate(b.dataset.grade);
    }
  }

  // Space: the main action; R: hear it again; Esc: end. The window's capture phase runs before the score's own keys.
  window.addEventListener(
    "keydown",
    (e) => {
      if (!run || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
      const el = $("lune-session");
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        end(false);
      } else if ((e.key === " " || e.code === "Space") && !e.target.closest?.("button")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        el?.querySelector(".ls2-main")?.click();
      } else if ((e.key === "r" || e.key === "R") && (run.phase === "demo" || run.phase === "turn")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        playStep();
      }
    },
    true
  );

  async function end(finished) {
    hush();
    const was = run;
    run = null;
    const el = $("lune-session");
    if (el) el.hidden = true;
    document.body.classList.remove("ls-on");
    if (was) {
      window.LunePiano?.setHandFilter?.(was.prevFilter || "both");
      try {
        setPlayRate(was.prevRate || 1);
      } catch {
        window.LunePiano?.setRate?.(was.prevRate || 1);
      }
    }
    // the report: what was worked on and what comes back next
    if (finished && was?.rated) await window.LunePlans?.flushSummary?.();
  }

  async function start() {
    const p = piece();
    if (!p) return window.toast?.("Open a piece first, then Practise with Lune.");
    if (run) return;
    window.LuneWalk?.close?.();
    try {
      closeCoach();
    } catch {
      /* not open */
    }
    if (st() && st().panel !== "score") document.getElementById("tab-score")?.click();
    const bars = await chooseBars(p);
    if (!bars.length) return window.toast?.("Lune is still reading this score. Try again in a moment.");
    if (window.LunePiano?.isPlaying?.()) window.LunePiano.pause();
    run = {
      bars,
      i: 0,
      steps: [],
      s: 0,
      phase: "demo",
      slower: 0,
      rated: 0,
      prevRate: Number(st()?.playRate) || window.LunePiano?.getRate?.() || 1,
      prevFilter: window.LunePiano?.getHandFilter?.() || "both",
    };
    setTimeout(() => run && startBar(0), 350);
  }

  // leaving the piece or the page ends the lesson cleanly
  window.addEventListener("hashchange", () => {
    if (run && !/^#\/[^/]+\/(score|explain|piano)/.test(location.hash)) end(false);
  });
  window.addEventListener("pagehide", () => run && end(false));

  // entry points: any button marked data-session-start, and a start carried over from the home page
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-session-start]");
    if (!b) return;
    e.preventDefault();
    start();
  });
  try {
    if (sessionStorage.getItem("lune.session.start") === "1") {
      sessionStorage.removeItem("lune.session.start");
      const w = setInterval(() => {
        if (piece() && document.querySelector("#osmd svg")) {
          clearInterval(w);
          start();
        }
      }, 500);
      setTimeout(() => clearInterval(w), 20000);
    }
  } catch {
    /* private mode */
  }

  return { start, end, active: () => !!run };
})();
