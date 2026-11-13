/* Lune — Practise with Lune: a guided session on the real score.
 *
 * Lune chooses the bars that need you (those due back; otherwise the bars its
 * own analysis rates hardest), and for each one: plays it, gives one concrete
 * instruction and a short timer for your turn, then asks how it went. The
 * session ends with the practice report. It sits at the bottom of the score,
 * like a mini-player, so the music stays in view.
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
  const TURN_SECONDS = 60;
  let run = null;
  let timer = 0;

  const piece = () => (typeof state !== "undefined" ? state.piece : null);
  const keyOf = (p) => window.LunePractice?.keyFor?.(p) || p?.id || p?.title || "";

  /** The bars for tonight: due back first, then the hardest by Lune's reading. At most four. */
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
    return bars.slice(0, 4);
  }

  /** One instruction for the bar, from Lune's own reading of it. */
  function instructionFor(p, bar) {
    const d = p?.debriefs?.[String(bar)];
    const advice = (Array.isArray(d?.advice) ? d.advice : d?.advice ? [d.advice] : []).find(Boolean);
    const first = advice ? String(advice).split(/(?<=[.!?])\s/)[0] : "";
    return first || "Play it slowly, hands separately first, then together.";
  }

  function panel() {
    let el = $("lune-session");
    if (el) return el;
    el = document.createElement("section");
    el.id = "lune-session";
    el.className = "ls-panel";
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "Practise with Lune");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
    el.addEventListener("click", onClick);
    return el;
  }

  function paint() {
    const el = panel();
    if (!run) return;
    const bar = run.bars[run.i];
    const steps = run.bars.map((b, i) => `<i class="${i < run.i ? "done" : i === run.i ? "on" : ""}"></i>`).join("");
    const body =
      run.stage === "listen"
        ? `<p class="ls-say">Listen first.</p>
           <div class="ls-actions"><button type="button" class="ls-quiet" data-ls="again">Play it again</button><button type="button" class="ls-main" data-ls="turn">My turn</button></div>`
        : run.stage === "turn"
          ? `<p class="ls-say">${esc(instructionFor(piece(), bar))}</p>
             <div class="ls-turn"><span class="ls-clock" style="--p:${run.left / TURN_SECONDS}"><b>${run.left}</b></span>
             <div class="ls-actions"><button type="button" class="ls-quiet" data-ls="again">Hear it</button><button type="button" class="ls-main" data-ls="rate">I've played it</button></div></div>`
          : `<p class="ls-say">How did bar ${bar} go?</p>
             <div class="ls-grades">${GRADES.map(([g, l]) => `<button type="button" data-ls-grade="${g}">${l}</button>`).join("")}</div>`;
    el.innerHTML = `
      <div class="ls-head">
        <span class="ls-moon" aria-hidden="true"></span>
        <span class="ls-title">Practise with Lune</span>
        <span class="ls-steps" aria-label="Bar ${run.i + 1} of ${run.bars.length}">${steps}</span>
        <button type="button" class="ls-x" data-ls="end" aria-label="End the session">×</button>
      </div>
      <h3 class="ls-bar">Bar ${bar}</h3>
      ${body}`;
    el.hidden = false;
    document.body.classList.add("ls-on");
  }

  function playBar(bar) {
    try {
      setBarSelection([bar], { open: true, primary: bar });
    } catch {
      return;
    }
    setTimeout(() => $("btn-hear")?.click(), 350);
  }

  function goTo(i) {
    clearInterval(timer);
    run.i = i;
    run.stage = "listen";
    paint();
    playBar(run.bars[i]);
  }

  function startTurn() {
    run.stage = "turn";
    run.left = TURN_SECONDS;
    paint();
    clearInterval(timer);
    timer = setInterval(() => {
      if (!run) return clearInterval(timer);
      run.left = Math.max(0, run.left - 1);
      const clock = document.querySelector("#lune-session .ls-clock");
      if (clock) {
        clock.style.setProperty("--p", String(run.left / TURN_SECONDS));
        clock.querySelector("b").textContent = run.left;
      }
      if (run.left === 0) {
        clearInterval(timer);
        run.stage = "rate";
        paint();
      }
    }, 1000);
  }

  async function onClick(e) {
    const b = e.target.closest("button");
    if (!b || !run) return;
    const act = b.dataset.ls;
    if (act === "end") return end(false);
    if (act === "again") return playBar(run.bars[run.i]);
    if (act === "turn") return startTurn();
    if (act === "rate") {
      clearInterval(timer);
      run.stage = "rate";
      return paint();
    }
    const g = b.dataset.lsGrade;
    if (g) {
      b.classList.add("on");
      const p = piece();
      const key = keyOf(p);
      try {
        await window.LuneStore?.reviewBar?.(key, run.bars[run.i], g);
        window.LunePlans?.noteActivity?.("rate", { key, title: p?.overview?.title || p?.title || "", bar: run.bars[run.i] });
      } catch {
        /* the rating stays on screen even if saving failed */
      }
      if (run.i + 1 < run.bars.length) setTimeout(() => goTo(run.i + 1), 350);
      else setTimeout(() => end(true), 350);
    }
  }

  async function end(finished) {
    clearInterval(timer);
    run = null;
    const el = $("lune-session");
    if (el) el.hidden = true;
    document.body.classList.remove("ls-on");
    try {
      closeCoach?.();
    } catch {
      /* the bar panel may already be closed */
    }
    // the report: what was worked on and what comes back next
    if (finished) await window.LunePlans?.flushSummary?.();
  }

  async function start() {
    const p = piece();
    if (!p) return window.toast?.("Open a piece first, then Practise with Lune.");
    if (typeof state !== "undefined" && state.panel !== "score") document.getElementById("tab-score")?.click();
    const bars = await chooseBars(p);
    if (!bars.length) return window.toast?.("Lune is still reading this score. Try again in a moment.");
    run = { bars, i: 0, stage: "listen", left: TURN_SECONDS };
    setTimeout(() => goTo(0), 600);
  }

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
      const wait = setInterval(() => {
        if (piece() && document.querySelector("#osmd svg")) {
          clearInterval(wait);
          start();
        }
      }, 500);
      setTimeout(() => clearInterval(wait), 20000);
    }
  } catch {
    /* private mode */
  }

  return { start, end, active: () => !!run };
})();
