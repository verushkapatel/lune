/* Lune — the first-run tour.
 *
 * The first time someone opens a score, three steps light up the real
 * controls: tap a bar, rate how it went, ask Lune about it. Each step moves on
 * when the person actually does the thing (or presses Next); Skip or Escape
 * ends it. It runs once per browser and can be started again from Settings or
 * the menu ("Show me around").
 */
window.LuneTour = (function () {
  const KEY = "lune.tour.v2";
  const $ = (s) => document.querySelector(s);
  const seen = () => {
    try {
      return localStorage.getItem(KEY) === "done";
    } catch {
      return false;
    }
  };
  const markSeen = () => {
    try {
      localStorage.setItem(KEY, "done");
    } catch {
      /* private mode: it may show again next visit */
    }
  };

  const STEPS = [
    {
      title: "Tap any bar",
      body: "Every bar in the score can be opened. Tap one and Lune shows its notes, the fingering and what makes it tricky.",
      target: () => $("#score-page") || $("#osmd"),
      done: () => (typeof state !== "undefined" && state.selectedBars?.length > 0) || !!$("#coach:not([hidden]) .lp-grades"),
      place: "inside-top",
    },
    {
      title: "Say how it went",
      body: "After you play the bar, rate it. Lune brings shaky bars back sooner and leaves secure ones for later.",
      target: () => $("#coach:not([hidden]) .lp-grades"),
      done: (clicked) => !!clicked?.closest?.(".lp-grade"),
      place: "auto",
    },
    {
      title: "Ask Lune about it",
      body: "Ask anything about this bar, typed or spoken. Lune answers from the notes on the page, like a teacher sitting beside you.",
      target: () => $("#coach:not([hidden]) #lp-ask-input")?.closest("form, .lp-ask, div") || $("#btn-tell") || $("#st-bottom .st-ask"),
      done: () => false,
      place: "auto",
      last: true,
    },
  ];

  let step = -1;
  let ring = null;
  let card = null;
  let poll = 0;

  function build() {
    if (ring) return;
    ring = document.createElement("div");
    ring.className = "lt-ring";
    ring.setAttribute("aria-hidden", "true");
    card = document.createElement("div");
    card.className = "lt-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-live", "polite");
    card.setAttribute("aria-label", "Getting started");
    card.innerHTML = `
      <p class="lt-count"></p>
      <h2 class="lt-title"></h2>
      <p class="lt-body"></p>
      <div class="lt-nav">
        <button type="button" class="lt-skip">Skip tour</button>
        <button type="button" class="lt-next">Next</button>
      </div>`;
    document.body.append(ring, card);
    card.querySelector(".lt-skip").addEventListener("click", () => end());
    card.querySelector(".lt-next").addEventListener("click", () => advance());
    document.addEventListener("keydown", (e) => {
      if (step >= 0 && e.key === "Escape") end();
    });
    document.addEventListener(
      "click",
      (e) => {
        if (step < 0 || card.contains(e.target)) return;
        if (STEPS[step]?.done(e.target)) setTimeout(advance, 450);
      },
      true
    );
    window.addEventListener("resize", place, { passive: true });
    document.addEventListener("scroll", place, { passive: true, capture: true });
  }

  function place() {
    if (step < 0 || !ring) return;
    const s = STEPS[step];
    const el = s.target();
    if (!el) {
      ring.style.opacity = "0";
      return;
    }
    const r = el.getBoundingClientRect();
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const box = {
      left: Math.max(6, r.left - pad),
      top: Math.max(6, r.top - pad),
      right: Math.min(vw - 6, r.right + pad),
      bottom: Math.min(vh - 6, r.bottom + pad),
    };
    Object.assign(ring.style, {
      opacity: "1",
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.right - box.left}px`,
      height: `${box.bottom - box.top}px`,
    });
    // the card sits where it covers least: inside the top of a large target, else above or below it
    const cw = Math.min(360, vw - 32);
    const ch = card.offsetHeight || 190;
    let left = Math.min(Math.max(16, (box.left + box.right) / 2 - cw / 2), vw - cw - 16);
    let top;
    if (s.place === "inside-top" && box.bottom - box.top > ch + 60) top = box.top + 20;
    else if (box.top - ch - 16 > 12) top = box.top - ch - 16;
    else if (box.bottom + ch + 16 < vh - 12) top = box.bottom + 16;
    else top = Math.max(12, vh - ch - 16);
    Object.assign(card.style, { width: `${cw}px`, left: `${left}px`, top: `${top}px` });
  }

  function show(n) {
    build();
    step = n;
    const s = STEPS[n];
    card.querySelector(".lt-count").textContent = `${n + 1} of ${STEPS.length}`;
    card.querySelector(".lt-title").textContent = s.title;
    card.querySelector(".lt-body").textContent = s.body;
    card.querySelector(".lt-next").textContent = s.last ? "Start practising" : "Next";
    document.body.classList.add("lt-on");
    ring.hidden = false;
    card.hidden = false;
    s.target()?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    requestAnimationFrame(place);
    setTimeout(place, 350);
    clearInterval(poll);
    // a step done by other means (a bar selected from the keyboard) moves on too
    poll = setInterval(() => {
      place();
      if (step === 0 && STEPS[0].done()) {
        clearInterval(poll);
        setTimeout(advance, 600);
      }
    }, 400);
    setTimeout(() => card.querySelector(".lt-next")?.focus({ preventScroll: true }), 50);
  }

  function advance() {
    if (step < 0) return;
    if (step >= STEPS.length - 1) return end(true);
    // step two needs a bar open: open one if the person pressed Next without tapping
    if (step === 0 && !STEPS[0].done()) {
      try {
        setBarSelection([1], { open: true, primary: 1 });
      } catch {
        /* the score is not on the page */
      }
    }
    const next = step + 1;
    setTimeout(() => show(next), step === 0 ? 500 : 0);
  }

  function end(finished = false) {
    clearInterval(poll);
    step = -1;
    markSeen();
    document.body.classList.remove("lt-on");
    if (ring) ring.hidden = true;
    if (card) card.hidden = true;
    if (finished) window.toast?.("That’s the studio. Every score works the same way.");
  }

  /** Start on the score: from the first visit, or from "Show me around". */
  function start({ force = false } = {}) {
    if (!force && seen()) return;
    const go = () => {
      if (typeof state === "undefined" || !state.piece) return;
      if (state.panel !== "score") document.getElementById("tab-score")?.click();
      const wait = setInterval(() => {
        if (document.querySelector("#osmd svg")) {
          clearInterval(wait);
          setTimeout(() => show(0), 400);
        }
      }, 300);
      setTimeout(() => clearInterval(wait), 15000);
    };
    go();
  }

  // the first time a score is on screen, the tour starts by itself, once
  const watch = setInterval(() => {
    if (seen()) return clearInterval(watch);
    if (step >= 0) return;
    if (document.body.classList.contains("is-panel-score") && document.querySelector("#osmd svg") && !document.querySelector("dialog[open]")) {
      clearInterval(watch);
      setTimeout(() => start(), 900);
    }
  }, 1500);

  return { start, end, seen };
})();
