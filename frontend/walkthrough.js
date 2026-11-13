/* Lune — Audio walkthrough: study a piece away from the keyboard.
 *
 * For blind and low-vision pianists (and anyone on a phone with earphones):
 * Lune goes through the piece bar by bar. For each bar it says the notes and
 * fingers for the chosen hand, pauses, plays that bar on the piano at the
 * current tempo (once, or twice with Repeat), pauses, and moves on.
 *
 * Offline by design: speech is the device's own speechSynthesis (never the
 * cloud voice) and playback is the same Salamander piano and timeline as the
 * score, with LunePiano's hand filter for one hand at a time.
 *
 * One generation counter guards everything: Pause, Stop, a new bar, closing
 * the panel or leaving the piece bumps it, and every pending step (speech,
 * timers, the piano) checks it before going on, so nothing overlaps or leaks.
 */
window.LuneWalk = (function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const GAP_BEFORE_PLAY = 400;
  const GAP_AFTER_BAR = 600;
  const GAP_REPEAT = 400;

  const walk = {
    open: false,
    running: false,
    gen: 0,
    bar: 1,
    from: 1,
    to: 1,
    hand: "both", // both | rh | lh
    repeat: false,
    prevFilter: "both",
  };

  const st = () => (typeof state !== "undefined" ? state : null);
  const piece = () => st()?.piece || null;
  const prefs = () => window.LuneStore?.prefs?.() || {};
  const span = () => {
    try {
      return pieceBarSpan();
    } catch {
      return [1, 1];
    }
  };
  const barData = (n) => {
    try {
      return debriefFor(n);
    } catch {
      return null;
    }
  };

  /* ---------------- what is said ---------------- */

  /** "Eb5" → "E flat 5"; "F#4" → "F sharp 4". */
  function sayNote(name) {
    const m = String(name || "").match(/^([A-G])(##|bb|#|b|♯♯|♭♭|♯|♭)?(-?\d+)?$/);
    if (!m) return String(name || "");
    const acc = { "#": " sharp", "♯": " sharp", b: " flat", "♭": " flat", "##": " double sharp", "♯♯": " double sharp", bb: " double flat", "♭♭": " double flat" }[m[2] || ""] || "";
    return `${m[1]}${acc}${m[3] != null ? ` ${m[3]}` : ""}`;
  }
  const fingerOf = (n) => n.edFinger ?? n.fingering ?? null;

  /** One hand's notes as words: single notes "E 5, finger 3"; chords "chord C 4, E 4, G 4, fingers 1, 3, 5". */
  function handWords(notes, label) {
    if (!notes?.length) return `${label}: rest.`;
    // a note shared by two voices is listed twice in the score: say it once
    const seen = new Set();
    const unique = notes.filter((n) => {
      const k = `${n.offset ?? 0}|${n.midi ?? n.pitch}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const groups = [];
    for (const n of [...unique].sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0) || (b.midi ?? 0) - (a.midi ?? 0))) {
      const g = groups[groups.length - 1];
      if (g && Math.abs((g[0].offset ?? 0) - (n.offset ?? 0)) < 1e-6) g.push(n);
      else groups.push([n]);
    }
    const parts = groups.map((g) => {
      if (g.length === 1) {
        const f = fingerOf(g[0]);
        return `${sayNote(g[0].pitch || g[0].letter)}${f ? `, finger ${f}` : ""}`;
      }
      const fs = g.map(fingerOf).filter(Boolean);
      return `chord ${g.map((n) => sayNote(n.pitch || n.letter)).join(", ")}${fs.length ? `, fingers ${fs.join(", ")}` : ""}`;
    });
    return `${label}: ${parts.join("; ")}.`;
  }

  function describe(n) {
    const d = barData(n);
    if (!d) return `Bar ${n}. No notes Lune can read here.`;
    const rh = handWords(d.rh, "Right hand");
    const lh = handWords(d.lh, "Left hand");
    if (walk.hand === "rh") return `Bar ${n}. ${rh}`;
    if (walk.hand === "lh") return `Bar ${n}. ${lh}`;
    return `Bar ${n}. ${rh} ${lh}`;
  }

  /* ---------------- speech (device voice, offline) ---------------- */

  let voiceCache = null;
  function voice() {
    if (!("speechSynthesis" in window)) return null;
    const all = speechSynthesis.getVoices?.() || [];
    if (voiceCache && all.includes(voiceCache)) return voiceCache;
    const en = all.filter((v) => /^en(-|_|$)/i.test(v.lang));
    // local voices first: they work with no connection
    const pick = (list) =>
      list.find((v) => /premium|enhanced|natural|siri/i.test(v.name)) ||
      list.find((v) => /en-GB/i.test(v.lang)) ||
      list[0];
    voiceCache = pick(en.filter((v) => v.localService)) || pick(en) || null;
    return voiceCache;
  }

  /** Say it; resolves when it has been said, or at once if this run was cancelled. */
  function say(text, gen) {
    return new Promise((resolve) => {
      if (gen !== walk.gen || !("speechSynthesis" in window)) return resolve();
      try {
        speechSynthesis.cancel();
      } catch {
        /* nothing queued */
      }
      const u = new SpeechSynthesisUtterance(text);
      const v = voice();
      if (v) {
        u.voice = v;
        u.lang = v.lang;
      } else u.lang = "en-GB";
      const rate = Number(prefs().speechRate) || 1;
      u.rate = rate;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(cap);
        resolve();
      };
      // some phones never report the end of an utterance
      const cap = setTimeout(finish, Math.max(3000, (text.length * 85) / rate) + 2500);
      u.onend = u.onerror = finish;
      speechSynthesis.speak(u);
    });
  }

  const sleep = (ms, gen) =>
    new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      pending.add(t);
      if (gen !== walk.gen) {
        clearTimeout(t);
        resolve();
      }
    });
  const pending = new Set();

  /* ---------------- the piano ---------------- */

  /** Play exactly one bar at the current tempo, for the chosen hand; resolves when it has finished. */
  async function playOne(n, gen) {
    if (gen !== walk.gen) return;
    window.LunePiano?.setHandFilter?.(walk.hand);
    try {
      await playSnippet(n, n);
    } catch {
      return;
    }
    // wait for the bar to start (samples may still be loading), then for it to stop
    await new Promise((resolve) => {
      const t0 = performance.now();
      let started = false;
      const iv = setInterval(() => {
        const now = performance.now();
        const playing = !!window.LunePiano?.isPlaying?.();
        if (playing) started = true;
        if (gen !== walk.gen || (started && !playing) || (!started && now - t0 > 8000) || now - t0 > 60000) {
          clearInterval(iv);
          pending.delete(iv);
          resolve();
        }
      }, 60);
      pending.add(iv);
    });
  }

  function silence() {
    for (const t of pending) {
      clearTimeout(t);
      clearInterval(t);
    }
    pending.clear();
    try {
      speechSynthesis?.cancel();
    } catch {
      /* no speech */
    }
    try {
      const s = st();
      if (s) s.snippetEnd = null;
      if (window.LunePiano?.isPlaying?.()) window.LunePiano.pause();
      syncPlayButton?.();
    } catch {
      /* the piano was not playing */
    }
  }

  /* ---------------- the loop ---------------- */

  async function run() {
    const gen = ++walk.gen;
    walk.running = true;
    paint();
    for (let n = walk.bar; n <= walk.to; n++) {
      if (gen !== walk.gen) return;
      walk.bar = n;
      highlight(n);
      announce(`Bar ${n} of ${walk.to}`);
      paint();
      await say(describe(n), gen); // A: the notes and fingers
      await sleep(GAP_BEFORE_PLAY, gen); // B: a breath, then the bar
      await playOne(n, gen);
      if (walk.repeat) {
        await sleep(GAP_REPEAT, gen);
        await playOne(n, gen);
      }
      await sleep(GAP_AFTER_BAR, gen); // C: and on to the next
    }
    if (gen !== walk.gen) return;
    walk.running = false;
    walk.bar = walk.from;
    restoreFilter();
    paint();
    announce("End of the walkthrough.");
    await say("End of the walkthrough.", gen);
  }

  function pause() {
    walk.gen++;
    walk.running = false;
    silence();
    restoreFilter();
    paint();
    announce(`Paused at bar ${walk.bar}.`);
  }
  function play() {
    silence();
    walk.prevFilter = window.LunePiano?.getHandFilter?.() || "both";
    run();
  }
  function toggle() {
    if (walk.running) pause();
    else play();
  }
  /** Move to another bar; if it was playing, carry on from there. */
  function go(delta) {
    const was = walk.running;
    walk.gen++;
    walk.running = false;
    silence();
    walk.bar = Math.min(walk.to, Math.max(walk.from, walk.bar + delta));
    highlight(walk.bar);
    paint();
    if (was) play();
    else announce(`Bar ${walk.bar} of ${walk.to}`);
  }
  function stop() {
    walk.gen++;
    walk.running = false;
    silence();
    restoreFilter();
    walk.bar = walk.from;
    paint();
  }
  function restoreFilter() {
    window.LunePiano?.setHandFilter?.(walk.prevFilter || "both");
  }

  function highlight(n) {
    try {
      setBarSelection([n], { open: false, primary: n });
      window.LunePractice?.scrollToBar?.(n);
      for (const ms of [450, 1200]) setTimeout(() => walk.open && walk.bar === n && window.LunePractice?.scrollToBar?.(n), ms);
    } catch {
      /* the score is not on the page */
    }
  }
  function announce(text) {
    const live = $("lw-live");
    if (!live) return;
    live.textContent = "";
    // a fresh node each time, so the same words are announced again
    setTimeout(() => (live.textContent = text), 30);
  }

  /* ---------------- the panel ---------------- */

  const ICON = {
    play: '<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path d="M9 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
    prev: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M6.5 5.5v13M18 6v12l-8.5-6z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M17.5 5.5v13M6 6v12l8.5-6z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    stop: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M6.5 6.5h11v11h-11z" fill="currentColor"/></svg>',
  };

  function panel() {
    let el = $("lune-walk");
    if (el) return el;
    el = document.createElement("section");
    el.id = "lune-walk";
    el.className = "lw-panel";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "false");
    el.setAttribute("aria-labelledby", "lw-title");
    el.hidden = true;
    el.innerHTML = `
      <div class="lw-head">
        <div>
          <h2 id="lw-title">Audio walkthrough</h2>
          <p class="lw-piece" id="lw-piece"></p>
        </div>
        <button type="button" class="lw-close" data-lw="close" aria-label="Close the audio walkthrough" title="Close (Esc)"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
      </div>
      <p class="lw-status" id="lw-status" aria-hidden="true"></p>
      <p class="lw-barnum" id="lw-bar" aria-hidden="true"></p>
      <div class="lw-transport" role="group" aria-label="Walkthrough controls">
        <button type="button" class="lw-btn" data-lw="prev" aria-label="Previous bar" aria-keyshortcuts="ArrowLeft" title="Previous bar (←)">${ICON.prev}</button>
        <button type="button" class="lw-btn lw-main" data-lw="toggle" id="lw-toggle" aria-keyshortcuts="Space"></button>
        <button type="button" class="lw-btn" data-lw="next" aria-label="Next bar" aria-keyshortcuts="ArrowRight" title="Next bar (→)">${ICON.next}</button>
      </div>
      <fieldset class="lw-seg">
        <legend>Hands</legend>
        <label><input type="radio" name="lw-hand" value="both" aria-label="Both hands">Both</label>
        <label><input type="radio" name="lw-hand" value="rh" aria-label="Right hand only">Right</label>
        <label><input type="radio" name="lw-hand" value="lh" aria-label="Left hand only">Left</label>
      </fieldset>
      <label class="lw-row"><span>Play each bar twice</span><input type="checkbox" id="lw-repeat" role="switch"><span class="lw-sw" aria-hidden="true"></span></label>
      <div class="lw-range">
        <label for="lw-from">Bars</label><input type="number" id="lw-from" inputmode="numeric" min="1" aria-label="From bar">
        <span aria-hidden="true">to</span><input type="number" id="lw-to" inputmode="numeric" min="1" aria-label="To bar">
      </div>
      <p class="visually-hidden" id="lw-live" aria-live="polite" aria-atomic="true"></p>`;
    document.body.appendChild(el);

    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-lw]");
      if (!b) return;
      const act = b.dataset.lw;
      if (act === "toggle") toggle();
      if (act === "prev") go(-1);
      if (act === "next") go(1);
      if (act === "stop") stop();
      if (act === "close") close();
    });
    el.addEventListener("change", (e) => {
      const t = e.target;
      if (t.name === "lw-hand") {
        walk.hand = t.value;
        savePrefs();
        if (walk.running) {
          // the new hand from the start of this bar
          walk.gen++;
          walk.running = false;
          silence();
          play();
        }
      }
      if (t.id === "lw-repeat") {
        walk.repeat = t.checked;
        savePrefs();
      }
      if (t.id === "lw-from" || t.id === "lw-to") {
        const [lo, hi] = span();
        let from = Math.round(Number($("lw-from").value) || lo);
        let to = Math.round(Number($("lw-to").value) || hi);
        from = Math.min(hi, Math.max(lo, from));
        to = Math.min(hi, Math.max(from, to));
        walk.from = from;
        walk.to = to;
        walk.bar = Math.min(to, Math.max(from, walk.bar));
        paint();
      }
    });
    return el;
  }

  function paint() {
    const el = $("lune-walk");
    if (!el) return;
    const p = piece();
    $("lw-piece").textContent = p ? [p.overview?.title || p.title, p.overview?.composer || p.composer].filter(Boolean).join(" · ") : "";
    $("lw-bar").innerHTML = `${walk.bar}<i>of ${walk.to}</i>`;
    $("lw-status").textContent = walk.running ? "Playing" : walk.bar > walk.from ? "Paused" : "Bar";
    const t = $("lw-toggle");
    t.innerHTML = walk.running ? ICON.pause : ICON.play;
    t.title = walk.running ? "Pause (Space)" : "Play (Space)";
    t.setAttribute("aria-label", walk.running ? "Pause the walkthrough" : `Play the walkthrough from bar ${walk.bar}`);
    t.setAttribute("aria-pressed", walk.running ? "true" : "false");
    for (const r of el.querySelectorAll('input[name="lw-hand"]')) r.checked = r.value === walk.hand;
    $("lw-repeat").checked = walk.repeat;
    const [lo, hi] = span();
    for (const id of ["lw-from", "lw-to"]) {
      $(id).min = lo;
      $(id).max = hi;
    }
    if (document.activeElement !== $("lw-from")) $("lw-from").value = walk.from;
    if (document.activeElement !== $("lw-to")) $("lw-to").value = walk.to;
    document.body.classList.toggle("lw-on", walk.open);
  }

  function savePrefs() {
    try {
      window.LuneStore?.setPref?.("walkHand", walk.hand);
      window.LuneStore?.setPref?.("walkRepeat", walk.repeat);
    } catch {
      /* preferences are optional */
    }
  }

  function open({ from = null, to = null } = {}) {
    if (!piece()) return window.toast?.("Open a piece first, then start the audio walkthrough.");
    const [lo, hi] = span();
    const sel = (() => {
      try {
        return selectedBarsSorted();
      } catch {
        return [];
      }
    })();
    walk.from = Math.max(lo, Number(from) || lo);
    walk.to = Math.min(hi, Math.max(walk.from, Number(to) || hi));
    // start where the pianist is: the selected bar, if there is one
    walk.bar = Math.min(walk.to, Math.max(walk.from, sel[0] || walk.from));
    const p = prefs();
    walk.hand = ["both", "rh", "lh"].includes(p.walkHand) ? p.walkHand : "both";
    walk.repeat = !!p.walkRepeat;
    walk.open = true;
    const el = panel();
    el.hidden = false;
    paint();
    if (st() && st().panel !== "score") document.getElementById("tab-score")?.click();
    setTimeout(() => $("lw-toggle")?.focus(), 60);
    announce(`Audio walkthrough. Bars ${walk.from} to ${walk.to}. Press Play to start.`);
  }

  function close() {
    stop();
    walk.open = false;
    const el = $("lune-walk");
    if (el) el.hidden = true;
    document.body.classList.remove("lw-on");
  }

  /* ---------------- keys, entry points, leaving ---------------- */

  // while the panel is open, its keys win over the score's own arrow-key bar moves:
  // the window's capture phase runs before every handler on the document
  window.addEventListener(
    "keydown",
    (e) => {
      if (!walk.open) return;
      const typing = e.target.closest?.("input[type=number], textarea, [contenteditable]");
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
        return;
      }
      if (typing) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopImmediatePropagation();
        go(e.key === "ArrowRight" ? 1 : -1);
      } else if ((e.key === " " || e.code === "Space") && !e.target.closest?.("button, input, select")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        toggle();
      }
    },
    true
  );

  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-walk-start]");
    if (!b) return;
    e.preventDefault();
    open();
  });

  // leaving the piece, or the page, ends the walkthrough cleanly
  let lastKey = "";
  window.addEventListener("hashchange", () => {
    if (!walk.open) return;
    const key = piece()?.id || piece()?.title || "";
    // the score, Explain and Piano views of the same piece keep it going
    if (!/^#\/[^/]+\/(score|explain|piano)/.test(location.hash) || (lastKey && key && key !== lastKey)) close();
  });
  window.addEventListener("pagehide", () => walk.open && close());
  setInterval(() => {
    // a different piece opened by other means
    const key = piece()?.id || piece()?.title || "";
    if (walk.open && lastKey && key && key !== lastKey) close();
    lastKey = key;
  }, 1000);

  return { open, close, play, pause, stop, next: () => go(1), prev: () => go(-1), describe, active: () => walk.running };
})();
