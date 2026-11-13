/* Lune — the practice room.
 *
 * Practise opens a quiet room where only the bars being worked on are on
 * screen, drawn large, with every note spelled out underneath (right hand,
 * left hand, finger numbers) and lit in time as Lune plays.
 *
 * It has one purpose: play it clean three times in a row, and the tempo
 * steps up (60% → 70% → 80% → 90% → 100% of the score's tempo). Three clean
 * at 100% and the bars are perfected: rated Strong, and remembered, so next
 * time the room starts at the level reached. With bars selected on the score,
 * the room practises exactly those; with none, Lune lines up the bars that
 * need you, one at a time.
 */
window.LuneSession = (function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const LADDER = [0.6, 0.7, 0.8, 0.9, 1];
  const STREAK = 3;
  const BEST = "lune.room.best";
  const ICON = {
    back: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8.5 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
    stop: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M7 7h10v10H7z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M7 5.5h3.4v13H7zM13.6 5.5H17v13h-3.4z" fill="currentColor"/></svg>',
    restart: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12a7 7 0 1 0 2.05-4.95M5 4.5V8h3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chev: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    loop: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M17 4l3 3-3 3M4 11V9a2 2 0 0 1 2-2h14M7 20l-3-3 3-3M20 13v2a2 2 0 0 1-2 2H4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    click: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 3h6l3 18H6zM12 16l4-9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    prev: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  let room = null;
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
  const readJSON = (k, d) => {
    try {
      return JSON.parse(localStorage.getItem(k) || "null") ?? d;
    } catch {
      return d;
    }
  };
  const writeJSON = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* private mode */
    }
  };
  const unit = () => room.units[room.u];
  const unitKey = (u) => `${u[0]}-${u[u.length - 1]}`;
  const unitLabel = (u) => (u.length === 1 ? `Bar ${u[0]}` : `Bars ${u[0]}–${u[u.length - 1]}`);
  const pct = () => Math.round(LADDER[room.level] * 100);
  const MAX_SPAN = 8;

  /* ---------------- what to practise ---------------- */

  async function lineUp(p, picked = []) {
    // bars selected on the score: exactly those, as one passage (eight at most)
    const sel = picked.filter((b) => barData(b));
    if (sel.length) {
      const from = sel[0];
      const to = Math.min(sel[sel.length - 1], from + MAX_SPAN - 1);
      const span = [];
      for (let b = from; b <= to; b++) if (barData(b)) span.push(b);
      return [span];
    }
    // homework open: the teacher's bars, as one passage (four at most)
    const hw = window.LunePractice?.homework?.();
    if (hw?.bars?.length) {
      const hb = hw.bars.filter((b) => barData(b)).sort((a, b) => a - b);
      const run = hb[hb.length - 1] - hb[0] === hb.length - 1 && hb.length <= 4;
      if (hb.length) return run ? [hb] : hb.slice(0, 4).map((b) => [b]);
    }
    // none: the bars that need you, one at a time (due, then hardest)
    const key = keyOf(p);
    const now = new Date().toISOString();
    let bars = [];
    try {
      const due = ((await window.LuneStore?.listCards?.(key)) || [])
        .filter((c) => c.due_at && c.due_at <= now)
        .sort((a, b) => a.due_at.localeCompare(b.due_at))
        .map((c) => Number(c.bar));
      bars.push(...due);
    } catch {
      /* no history yet */
    }
    let spots = p?.hardSpots || [];
    if (!spots.length && p?.musicxml && window.LuneLite?.analyze) {
      try {
        spots = window.LuneLite.analyze(p.musicxml).hardSpots || [];
      } catch {
        spots = [];
      }
    }
    for (const s of spots) bars.push(Number(typeof s === "object" ? s.measure : s));
    bars = [...new Set(bars)].filter((b) => b > 0 && barData(b)).slice(0, 4);
    return bars.map((b) => [b]);
  }

  /* ---------------- the notes, spelled out ---------------- */

  /** "Eb5" → E♭ with a small octave. */
  function noteName(n) {
    const m = String(n.pitch || n.letter || "").match(/^([A-G])(##|bb|#|b)?(-?\d+)?$/);
    if (!m) return { name: esc(n.pitch || ""), oct: "" };
    const acc = { "#": "♯", b: "♭", "##": "𝄪", bb: "𝄫" }[m[2] || ""] || "";
    return { name: `${m[1]}${acc}`, oct: m[3] || "" };
  }

  /** One hand across the passage: a chip per moment, chords stacked high to low. */
  function handRow(hand) {
    const u = unit();
    const chips = [];
    u.forEach((bar, bi) => {
      const d = barData(bar) || {};
      const notes = (hand === "rh" ? d.rh : d.lh) || [];
      const at = new Map();
      for (const x of notes) {
        const k = Math.round((x.offset ?? 0) * 1000);
        const seen = at.get(k) || [];
        if (!seen.some((y) => y.midi === x.midi)) seen.push(x);
        at.set(k, seen);
      }
      const groups = [...at.entries()].sort((a, b) => a[0] - b[0]);
      if (bi > 0) chips.push(`<span class="lr-barline" aria-hidden="true"></span>`);
      if (!groups.length) chips.push(`<span class="lr-rest">rest</span>`);
      for (const [k, g] of groups) {
        g.sort((a, b) => (b.midi ?? 0) - (a.midi ?? 0));
        const dur = Math.max(...g.map((x) => x.duration || 0.25));
        const stack = g
          .map((x) => {
            const nm = noteName(x);
            const f = x.edFinger ?? x.fingering;
            return `<span class="lr-n"><b>${nm.name}</b><small>${nm.oct}</small>${f ? `<i>${f}</i>` : ""}</span>`;
          })
          .join("");
        chips.push(`<span class="lr-chip" data-bar="${bar}" data-at="${k / 1000}" data-dur="${dur}" data-ql="${d.ql || 4}">${stack}</span>`);
      }
    });
    return chips.join("");
  }

  /* ---------------- the bars, drawn large ---------------- */

  async function drawStage() {
    const host = $("lr-stage");
    if (!host || !room) return;
    const u = unit();
    host.innerHTML = "";
    const p = piece();
    if (!p?.musicxml || !window.opensheetmusicdisplay?.OpenSheetMusicDisplay) {
      host.innerHTML = `<p class="lr-nostage">${esc(unitLabel(u))}</p>`;
      return;
    }
    const box = document.createElement("div");
    box.className = "lr-sheet";
    host.appendChild(box);
    try {
      const light = document.documentElement.dataset.theme === "light" || document.body.classList.contains("lp-contrast");
      const o = new window.opensheetmusicdisplay.OpenSheetMusicDisplay(box, {
        backend: "svg",
        autoResize: false,
        drawTitle: false,
        drawSubtitle: false,
        drawComposer: false,
        drawLyricist: false,
        drawCredits: false,
        drawPartNames: false,
        drawPartAbbreviations: false,
        drawMeasureNumbers: true,
        drawFromMeasureNumber: u[0],
        drawUpToMeasureNumber: u[u.length - 1],
        defaultColorMusic: light ? "#111114" : "#F5F5F7",
        drawingParameters: "compacttight",
      });
      await o.load(p.musicxml);
      if (!room || unit() !== u) return;
      // wait for the room to have its size, then fit the passage: as large as the stage allows
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      o.zoom = 1;
      o.render();
      // crop the drawing to the music itself, then let it scale to the stage: centred, as large as it fits
      const svg = box.querySelector("svg");
      if (svg) {
        const bb = svg.getBBox();
        const pad = 12;
        svg.setAttribute("viewBox", `${bb.x - pad} ${bb.y - pad} ${bb.width + pad * 2} ${bb.height + pad * 2}`);
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        // as large as the stage allows, but never past four times print size
        svg.style.maxHeight = `${Math.round((bb.height + pad * 2) * 4)}px`;
      }
      box.classList.add("in");
    } catch {
      host.innerHTML = `<p class="lr-nostage">${esc(unitLabel(u))}</p>`;
    }
  }

  /* ---------------- playback ---------------- */

  const wait = (ms, g) =>
    new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      timers.add(t);
      if (g !== gen) {
        clearTimeout(t);
        resolve();
      }
    });

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
    document.querySelectorAll("#lune-room .lr-chip.on").forEach((c) => c.classList.remove("on"));
    const f = document.querySelector("#lune-room .lr-meter i");
    if (f) f.style.transform = "scaleX(0)";
  }

  function applyTempo() {
    const r = Math.max(0.3, Math.round((room.baseRate || room.prevRate || 1) * LADDER[room.level] * 100) / 100);
    try {
      setPlayRate(r);
    } catch {
      window.LunePiano?.setRate?.(r);
    }
  }

  function pauseListening() {
    if (!room?.listening || room.paused) return;
    room.paused = true;
    room.pausedEnd = st()?.snippetEnd ?? null;
    try {
      window.LunePiano?.pause?.();
      syncPlayButton?.();
    } catch {
      /* not playing */
    }
    paintControls();
  }
  function resumeListening() {
    if (!room?.paused) return;
    room.paused = false;
    const s = st();
    if (s && room.pausedEnd != null) s.snippetEnd = room.pausedEnd;
    try {
      window.LunePiano?.resume?.();
      syncPlayButton?.();
    } catch {
      /* nothing to resume */
    }
    paintControls();
  }

  async function listen() {
    if (room.listening) return room.paused ? resumeListening() : pauseListening();
    hush();
    const g = gen;
    room.listening = true;
    room.paused = false;
    paintControls();
    const u = unit();
    do {
      window.LunePiano?.setHandFilter?.(room.hand);
      applyTempo();
      try {
        window.LunePiano?.setMetronome?.(!!room.click);
      } catch {
        /* no metronome */
      }
      const marks = window.LunePiano?.barMarkers?.() || [];
      const startOf = (b) => marks.find((m) => Number(m.bar) === Number(b))?.t;
      const endOf = (b) => marks.find((m) => Number(m.bar) > Number(b))?.t ?? window.LunePiano?.duration?.();
      const from = startOf(u[0]) ?? 0;
      const to = endOf(u[u.length - 1]) ?? from + 1;
      const chips = [...document.querySelectorAll("#lune-room .lr-chip")].map((c) => {
        const b = Number(c.dataset.bar);
        const s0 = startOf(b) ?? from;
        const s1 = endOf(b) ?? to;
        const ql = Number(c.dataset.ql) || 4;
        const t0 = s0 + (Number(c.dataset.at) / ql) * (s1 - s0);
        return { c, t0, t1: t0 + (Number(c.dataset.dur) / ql) * (s1 - s0) };
      });
      try {
        await playSnippet(u[0], u[u.length - 1]);
      } catch {
        break;
      }
      await new Promise((resolve) => {
        let t0 = performance.now();
        let started = false;
        const iv = setInterval(() => {
          if (room?.paused && g === gen) {
            t0 += 30;
            return;
          }
          const playing = !!window.LunePiano?.isPlaying?.();
          if (playing) started = true;
          const p = window.LunePiano?.progress?.() || 0;
          if (started) {
            for (const x of chips) x.c.classList.toggle("on", playing && p >= x.t0 - 0.02 && p < x.t1);
            const f = document.querySelector("#lune-room .lr-meter i");
            if (f) f.style.transform = `scaleX(${Math.max(0, Math.min(1, (p - from) / Math.max(0.1, to - from)))})`;
          }
          const dt = performance.now() - t0;
          if (g !== gen || (started && !playing) || (!started && dt > 8000) || dt > 120000) {
            clearInterval(iv);
            timers.delete(iv);
            resolve();
          }
        }, 30);
        timers.add(iv);
      });
      document.querySelectorAll("#lune-room .lr-chip.on").forEach((c) => c.classList.remove("on"));
      if (g !== gen) return;
      if (room.loop) await wait(500, g);
    } while (room && room.loop && g === gen);
    if (g !== gen || !room) return;
    room.listening = false;
    const f = document.querySelector("#lune-room .lr-meter i");
    if (f) f.style.transform = "scaleX(0)";
    paintControls();
  }
  function stopListening() {
    hush();
    if (room) {
      room.listening = false;
      room.paused = false;
    }
    paintControls();
  }

  /* ---------------- the goal ---------------- */

  function saveBest() {
    const all = readJSON(BEST, {});
    const k = keyOf(piece());
    const uk = unitKey(unit());
    all[k] = { ...(all[k] || {}), [uk]: Math.max(all[k]?.[uk] ?? 0, room.level) };
    writeJSON(BEST, all);
  }
  function bestLevel(u) {
    const v = readJSON(BEST, {})[keyOf(piece())]?.[unitKey(u)];
    return Number.isFinite(v) ? v : null;
  }

  async function clean() {
    stopListening();
    room.touched = true;
    room.misses = 0;
    room.streak += 1;
    if (room.streak < STREAK) {
      paintGoal(`Clean. ${STREAK - room.streak} more in a row.`, "good");
      return;
    }
    if (room.level < LADDER.length - 1) {
      room.level += 1;
      room.streak = 0;
      saveBest();
      applyTempo();
      paintGoal(`Up to ${pct()}%. Same again, a little faster.`, "up");
      return;
    }
    saveBest();
    room.perfected = true;
    paintGoal("", "up");
    await rateUnit("strong");
    paintPerfected();
  }
  function notYet() {
    stopListening();
    room.touched = true;
    room.misses = (room.misses || 0) + 1;
    room.streak = 0;
    paintGoal(room.misses >= 3 && room.level > 0 ? "Take it a step slower: tap a lower tempo." : "No rush. Listen once, then play it again.");
  }
  function setLevel(i) {
    room.level = Math.max(0, Math.min(LADDER.length - 1, i));
    room.streak = 0;
    room.misses = 0;
    applyTempo();
    paintGoal(`Tempo ${pct()}%.`);
  }

  async function rateUnit(grade, r = room) {
    const p = piece();
    const key = keyOf(p);
    for (const b of r.units[r.u]) {
      try {
        await window.LuneStore?.reviewBar?.(key, b, grade);
        window.LunePlans?.noteActivity?.("rate", { key, title: p?.overview?.title || p?.title || "", bar: b });
      } catch {
        /* the room still remembers the level */
      }
    }
    r.rated = (r.rated || 0) + 1;
  }

  /* ---------------- the room ---------------- */

  function build() {
    let el = $("lune-room");
    if (el) return el;
    el = document.createElement("section");
    el.id = "lune-room";
    el.className = "lr";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-labelledby", "lr-title");
    el.hidden = true;
    document.body.appendChild(el);
    el.addEventListener("click", onClick);
    return el;
  }

  function paint() {
    const el = build();
    const u = unit();
    const p = piece();
    const best = bestLevel(u);
    el.innerHTML = `
      <header class="lr-top">
        <button type="button" class="lr-back" data-r="close" aria-label="Back to the score">${ICON.back}<span>Score</span></button>
        <div class="lr-id">
          <p class="lr-piece">${esc(p?.overview?.title || p?.title || "")}</p>
          <h2 id="lr-title"><button type="button" class="lr-pickbtn" data-r="pick" aria-expanded="false" aria-controls="lr-picker" title="Choose which bars to practise">${esc(unitLabel(u))}${ICON.chev}</button></h2>
        </div>
        <div class="lr-queue">${
          room.units.length > 1
            ? `<button type="button" class="lr-qbtn" data-r="prev" aria-label="Previous bar"${room.u === 0 ? " disabled" : ""}>${ICON.prev}</button><span>${room.u + 1} of ${room.units.length}</span><button type="button" class="lr-qbtn" data-r="next" aria-label="Next bar"${room.u >= room.units.length - 1 ? " disabled" : ""}>${ICON.next}</button>`
            : ""
        }</div>
      </header>
      <div class="lr-picker" id="lr-picker" role="dialog" aria-label="Choose bars" hidden></div>
      <div class="lr-goal" id="lr-goal"></div>
      <div class="lr-stage" id="lr-stage" role="img" aria-label="${esc(unitLabel(u))}, drawn large"></div>
      <div class="lr-meter" aria-hidden="true"><i></i></div>
      <div class="lr-notes" aria-label="The notes, right hand then left hand">
        <div class="lr-row${room.hand === "lh" ? " is-dim" : ""}" data-hand="rh"><span class="lr-k">Right</span><div class="lr-chips">${handRow("rh")}</div></div>
        <div class="lr-row${room.hand === "rh" ? " is-dim" : ""}" data-hand="lh"><span class="lr-k">Left</span><div class="lr-chips">${handRow("lh")}</div></div>
      </div>
      <div class="lr-controls" id="lr-controls"></div>
      <p class="visually-hidden" id="lr-live" aria-live="polite"></p>`;
    el.classList.remove("is-leaving");
    el.hidden = false;
    document.body.classList.add("lr-on");
    paintGoal(best != null && best > 0 ? `Last time you reached ${Math.round(LADDER[best] * 100)}%. Carry on from there.` : "Listen first, then play it yourself.");
    paintControls();
    requestAnimationFrame(() => drawStage());
    setTimeout(() => room && $("lr-stage") && !$("lr-stage").querySelector("svg") && drawStage(), 700);
    setTimeout(() => el.querySelector(".lr-listen")?.focus({ preventScroll: true }), 60);
  }

  function paintGoal(msg = "", mood = "") {
    const g = $("lr-goal");
    if (!g || !room) return;
    const ladder = LADDER.map(
      (x, i) =>
        `<button type="button" class="lr-step${i < room.level ? " done" : i === room.level ? " on" : ""}" data-level="${i}" aria-label="Tempo ${Math.round(x * 100)} percent"${i === room.level ? ' aria-current="step"' : ""}>${Math.round(x * 100)}</button>`
    ).join("");
    const dots = Array.from({ length: STREAK }, (_, i) => `<i class="${i < room.streak ? "on" : ""}"></i>`).join("");
    g.innerHTML = `
      ${room.teacher ? `<p class="lr-teacher">${esc(room.teacher)}’s homework${room.target ? ` · target ${esc(room.target)}` : ""}${room.goalText && !/^3 clean/i.test(room.goalText) ? ` · ${esc(room.goalText)}` : ""}</p>` : ""}
      <p class="lr-goal-line"><strong>${STREAK} clean in a row</strong> and the tempo steps up.<span class="lr-gl-more"> Reach ${room.target ? "the target" : "100%"} to perfect ${unit().length === 1 ? "it" : "them"}.</span></p>
      <div class="lr-goal-row">
        <div class="lr-ladder" role="group" aria-label="Tempo, percent of the score’s tempo">${ladder}</div>
        <div class="lr-streak" role="img" aria-label="${room.streak} of ${STREAK} clean in a row">${dots}</div>
      </div>
      <p class="lr-msg${mood ? ` is-${mood}` : ""}">${esc(msg)}</p>`;
    const live = $("lr-live");
    if (live && msg) live.textContent = msg;
  }

  function paintControls() {
    const c = $("lr-controls");
    if (!c || !room) return;
    const seg = [["both", "Both"], ["rh", "Right"], ["lh", "Left"]]
      .map(([v, l]) => `<button type="button" data-hand="${v}" aria-pressed="${room.hand === v}">${l}</button>`)
      .join("");
    c.innerHTML = `
      <div class="lr-tools">
        <div class="lr-seg" role="group" aria-label="Hands">${seg}</div>
        <button type="button" class="lr-tog" data-r="loop" aria-pressed="${!!room.loop}" title="Play it again and again">${ICON.loop}<span>Loop</span></button>
        <button type="button" class="lr-tog" data-r="click" aria-pressed="${!!room.click}" title="Metronome">${ICON.click}<span>Click</span></button>
      </div>
      <div class="lr-act">
        <div class="lr-play">
          <button type="button" class="lr-listen${room.listening && !room.paused ? " is-on" : ""}" data-r="listen" aria-keyshortcuts="Space">${room.listening && !room.paused ? ICON.pause : ICON.play}<span>${room.listening ? (room.paused ? "Resume" : "Pause") : "Listen"}</span></button>
          ${room.listening ? `<button type="button" class="lr-restart" data-r="restart" aria-label="Stop and go back to the start" title="Back to the start">${ICON.restart}</button>` : ""}
        </div>
        <button type="button" class="lr-quiet" data-r="miss" aria-keyshortcuts="N">Not yet</button>
        <button type="button" class="lr-main" data-r="clean" aria-keyshortcuts="Enter">Played it clean</button>
      </div>`;
  }

  function paintPerfected() {
    const el = $("lune-room");
    const u = unit();
    const more = room.u < room.units.length - 1;
    el.querySelector(".lr-done")?.remove();
    const card = document.createElement("div");
    card.className = "lr-done";
    card.setAttribute("role", "status");
    card.innerHTML = `
      <div class="lr-done-in">
        <span class="lr-done-mark" aria-hidden="true">✓</span>
        <h3>${esc(unitLabel(u))}, perfected.</h3>
        <p>Three clean in a row at full tempo. Lune will bring ${u.length === 1 ? "it" : "them"} back in a few days, so ${u.length === 1 ? "it stays" : "they stay"} that way.</p>
        <div class="lr-done-act">${more ? `<button type="button" class="lr-main" data-r="next">Next: ${esc(unitLabel(room.units[room.u + 1]))}</button>` : ""}<button type="button" class="${more ? "lr-quiet" : "lr-main"}" data-r="close">Back to the score</button></div>
      </div>`;
    el.appendChild(card);
    setTimeout(() => card.querySelector("button")?.focus(), 60);
  }

  /* ---------------- choosing the bars, in the room ---------------- */

  function allBars() {
    let from = 1;
    let to = 1;
    try {
      [from, to] = pieceBarSpan();
    } catch {
      /* single bar */
    }
    const out = [];
    for (let b = from; b <= to; b++) if (barData(b)) out.push(b);
    return out;
  }
  function togglePicker(force) {
    const pk = $("lr-picker");
    const btn = document.querySelector("#lune-room .lr-pickbtn");
    if (!pk || !room) return;
    const open = force ?? pk.hidden;
    if (!open) {
      pk.hidden = true;
      btn?.setAttribute("aria-expanded", "false");
      room.pk = null;
      return;
    }
    const u = unit();
    room.pk = { a: u[0], b: u[u.length - 1], next: "start" };
    stopListening();
    pk.hidden = false;
    btn?.setAttribute("aria-expanded", "true");
    paintPicker();
    pk.querySelector(".lr-pk-grid .is-a")?.scrollIntoView({ block: "center" });
    setTimeout(() => pk.querySelector(".lr-pk-grid .is-a")?.focus({ preventScroll: true }), 30);
  }
  function paintPicker() {
    const pk = $("lr-picker");
    if (!pk || !room?.pk) return;
    const { a, b, next } = room.pk;
    const n = b - a + 1;
    const hard = new Set();
    try {
      for (const s of piece()?.hardSpots || []) hard.add(Number(typeof s === "object" ? s.measure : s));
    } catch {
      /* none */
    }
    const grid = allBars()
      .map((x) => {
        const cls = [x === a ? "is-a" : "", x === b ? "is-b" : "", x > a && x < b ? "is-in" : "", hard.has(x) ? "is-hard" : ""].filter(Boolean).join(" ");
        return `<button type="button" data-pk="${x}" class="${cls}" aria-pressed="${x >= a && x <= b}" aria-label="Bar ${x}${hard.has(x) ? ", a hard spot" : ""}">${x}</button>`;
      })
      .join("");
    pk.innerHTML = `
      <div class="lr-pk-head">
        <p class="lr-pk-title">Choose bars</p>
        <p class="lr-pk-hint">${next === "end" ? `Now tap the last bar (up to ${MAX_SPAN}).` : "Tap the first bar, then the last."}</p>
      </div>
      <div class="lr-pk-grid">${grid}</div>
      <div class="lr-pk-act">
        <button type="button" class="lr-quiet" data-r="pick-cancel">Cancel</button>
        <button type="button" class="lr-main" data-r="pick-go">Practise ${n === 1 ? `bar ${a}` : `bars ${a}–${b}`}</button>
      </div>`;
  }
  function pickBar(x) {
    if (!room?.pk) return;
    const pk = room.pk;
    if (pk.next === "end" && x !== pk.a) {
      const lo = Math.min(pk.a, x);
      const hi = Math.max(pk.a, x);
      pk.a = lo;
      pk.b = Math.min(hi, lo + MAX_SPAN - 1);
      if (hi - lo + 1 > MAX_SPAN) window.toast?.(`Up to ${MAX_SPAN} bars at a time`);
      pk.next = "start";
    } else {
      pk.a = pk.b = x;
      pk.next = "end";
    }
    const keep = document.activeElement?.dataset?.pk;
    const grid = $("lr-picker")?.querySelector(".lr-pk-grid");
    const top = grid?.scrollTop || 0;
    paintPicker();
    const g2 = $("lr-picker")?.querySelector(".lr-pk-grid");
    if (g2) g2.scrollTop = top;
    if (keep) g2?.querySelector(`[data-pk="${keep}"]`)?.focus({ preventScroll: true });
  }
  function applyPick() {
    if (!room?.pk) return;
    const span = allBars().filter((x) => x >= room.pk.a && x <= room.pk.b);
    if (!span.length) return togglePicker(false);
    room.units = [span];
    go(0);
  }

  function go(i) {
    hush();
    room.listening = false;
    room.paused = false;
    room.pk = null;
    room.u = Math.max(0, Math.min(room.units.length - 1, i));
    const best = bestLevel(unit());
    room.level = best != null ? Math.min(best, LADDER.length - 1) : 0;
    room.streak = 0;
    room.misses = 0;
    room.perfected = false;
    applyTempo();
    paint();
    try {
      setBarSelection(unit(), { open: false, primary: unit()[0] });
    } catch {
      /* fine */
    }
  }

  function onClick(e) {
    const pk = $("lr-picker");
    if (pk && !pk.hidden && !e.target.closest(".lr-picker, .lr-pickbtn")) return togglePicker(false);
    const b = e.target.closest("button");
    if (!b || !room) return;
    const r = b.dataset.r;
    if (r === "close") return close();
    if (r === "listen") return listen();
    if (r === "restart") return stopListening();
    if (r === "pick") return togglePicker();
    if (r === "pick-cancel") return togglePicker(false);
    if (r === "pick-go") return applyPick();
    if (b.dataset.pk) return pickBar(Number(b.dataset.pk));
    if (r === "clean") return clean();
    if (r === "miss") return notYet();
    if (r === "prev") return go(room.u - 1);
    if (r === "next") return go(room.u + 1);
    if (r === "loop") {
      room.loop = !room.loop;
      return paintControls();
    }
    if (r === "click") {
      room.click = !room.click;
      try {
        window.LunePiano?.setMetronome?.(room.click);
      } catch {
        /* none */
      }
      return paintControls();
    }
    if (b.dataset.hand) {
      room.hand = b.dataset.hand;
      $("lune-room").querySelectorAll(".lr-row").forEach((row) => row.classList.toggle("is-dim", room.hand !== "both" && row.dataset.hand !== room.hand));
      const was = room.listening;
      stopListening();
      if (was) listen();
      return;
    }
    if (b.dataset.level) return setLevel(Number(b.dataset.level));
  }

  window.addEventListener(
    "keydown",
    (e) => {
      if (!room || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
      const k = e.key;
      const stop = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (k === "Escape" && !$("lr-picker")?.hidden) return stop(), togglePicker(false);
      if (k === "Escape") return stop(), close();
      if (!$("lr-picker")?.hidden) return;
      if (document.querySelector("#lune-room .lr-done")) return;
      if ((k === " " || e.code === "Space") && !e.target.closest?.("button")) return stop(), listen();
      if (k === "Enter" && !e.target.closest?.("button")) return stop(), clean();
      if (k === "n" || k === "N") return stop(), notYet();
      if (k === "ArrowRight" && room.units.length > 1) return stop(), go(room.u + 1);
      if (k === "ArrowLeft" && room.units.length > 1) return stop(), go(room.u - 1);
    },
    true
  );

  async function close() {
    if (!room) return;
    hush();
    const was = room;
    room = null;
    const el = $("lune-room");
    if (el) {
      // the room settles away rather than vanishing
      el.classList.add("is-leaving");
      setTimeout(() => {
        if (room) return; // reopened meanwhile
        el.hidden = true;
        el.classList.remove("is-leaving");
      }, 220);
    }
    document.body.classList.remove("lr-on");
    window.LunePiano?.setHandFilter?.(was.prevFilter || "both");
    try {
      setPlayRate(was.prevRate || 1);
    } catch {
      window.LunePiano?.setRate?.(was.prevRate || 1);
    }
    try {
      window.LunePiano?.setMetronome?.(!!was.prevClick);
    } catch {
      /* none */
    }
    // practised but not perfected: the level reached decides how soon the bars come back
    if (was.touched && !was.perfected) await rateUnit(was.level >= 3 ? "good" : was.level >= 1 ? "okay" : "hard", was).catch(() => {});
    // homework: the teacher sees that it was practised, and how each bar went
    if (was.touched && was.teacher) await window.LunePractice?.homeworkCheckIn?.().catch?.(() => {});
    if (was.rated) await window.LunePlans?.flushSummary?.();
  }

  async function start() {
    const p = piece();
    if (!p) return window.toast?.("Open a piece first, then Practise.");
    if (room) return;
    // the selection first: closing the bar panel clears it
    let picked = [];
    try {
      picked = selectedBarsSorted();
    } catch {
      picked = [];
    }
    window.LuneWalk?.close?.();
    try {
      closeCoach();
    } catch {
      /* not open */
    }
    if (st() && st().panel !== "score") document.getElementById("tab-score")?.click();
    const units = await lineUp(p, picked);
    if (!units.length || !units[0].length) return window.toast?.("Lune is still reading this score. Try again in a moment.");
    if (window.LunePiano?.isPlaying?.()) window.LunePiano.pause();
    room = {
      units,
      u: 0,
      level: 0,
      streak: 0,
      hand: "both",
      loop: false,
      click: false,
      listening: false,
      prevRate: Number(st()?.playRate) || window.LunePiano?.getRate?.() || 1,
      prevFilter: window.LunePiano?.getHandFilter?.() || "both",
      prevClick: !!window.LunePiano?.isMetronomeOn?.(),
    };
    // the teacher's target tempo is the room's 100%
    const hw = window.LunePractice?.homework?.();
    if (hw?.tb) {
      try {
        room.baseRate = Math.max(0.3, Math.min(2, (hw.tb * (hw.tf || printedBeat().factor || 1)) / practiceTempoBpm()));
        room.target = `${hw.tu || "♩"} = ${hw.tb}`;
      } catch {
        /* the score's own tempo */
      }
    }
    room.teacher = hw?.by || (hw ? "Your teacher" : "");
    room.goalText = hw?.goal || "";
    go(0);
  }

  window.addEventListener("hashchange", () => {
    if (room && !/^#\/[^/]+\/(score|explain|piano)/.test(location.hash)) close();
  });
  window.addEventListener("pagehide", () => room && close());
  let resizeT = 0;
  window.addEventListener("resize", () => {
    if (!room) return;
    clearTimeout(resizeT);
    resizeT = setTimeout(() => room && drawStage(), 200);
  });

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

  return { start, end: close, close, active: () => !!room };
})();
