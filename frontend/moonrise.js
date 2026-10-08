/* Lune: the landing page's moonrise.
 *
 * A night sky over a piano. The moon waxes from a crescent to full as the page
 * scrolls, the opening bars of Clair de lune fall onto the keys as light (the
 * real notes, from static/assets/clair-excerpt.json), and the keys play when
 * touched. Below, the idea lights up word by word as it is read, and a thin
 * line at the top shows how far down the page you are.
 *
 * Reduced motion: the sky is drawn once, nothing falls, the words are all lit.
 */
(function () {
  const home = document.getElementById("home");
  const hero = document.getElementById("hero");
  if (!home || !hero || !hero.classList.contains("mr-hero")) return;

  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  const isBlack = (m) => [1, 3, 6, 8, 10].includes(m % 12);
  const noteName = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);

  /* ---------- the sky ---------- */
  const sky = hero.querySelector(".mr-sky");
  const ctx = sky.getContext("2d");
  let stars = [];
  let skyW = 0;
  let skyH = 0;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  function sizeSky() {
    const r = hero.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    skyW = Math.max(1, r.width);
    skyH = Math.max(1, r.height);
    sky.width = Math.round(skyW * dpr);
    sky.height = Math.round(skyH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed = 7;
    const n = Math.round((skyW * skyH) / 4200);
    stars = Array.from({ length: n }, () => ({
      x: rnd() * skyW,
      y: rnd() * skyH * 0.78,
      r: rnd() < 0.08 ? 1.25 : 0.35 + rnd() * 0.6,
      a: 0.25 + rnd() * 0.6,
      tw: 0.4 + rnd() * 1.6,
      ph: rnd() * Math.PI * 2,
    }));
  }

  function drawSky(t) {
    ctx.clearRect(0, 0, skyW, skyH);
    const lift = scrollP * 40;
    for (const s of stars) {
      const a = still ? s.a : s.a * (0.65 + 0.35 * Math.sin(t * 0.001 * s.tw + s.ph));
      ctx.globalAlpha = a;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(s.x, s.y - lift * (s.r > 1 ? 0.6 : 0.25), s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- the moon waxes as you scroll ---------- */
  let scrollP = 0;
  function onScroll() {
    const vh = window.innerHeight || 800;
    scrollP = Math.max(0, Math.min(1, home.scrollTop / (vh * 1.1)));
    hero.style.setProperty("--mr-p", scrollP.toFixed(3));
    const max = Math.max(1, home.scrollHeight - home.clientHeight);
    bar.style.transform = `scaleX(${(home.scrollTop / max).toFixed(4)})`;
    readAlong();
  }

  /* ---------- a line at the top: how far down the page ---------- */
  const bar = document.createElement("div");
  bar.className = "mr-progress";
  bar.setAttribute("aria-hidden", "true");
  document.body.appendChild(bar);

  /* ---------- the keys ---------- */
  const keysHost = hero.querySelector(".mr-keys");
  const wide = () => (window.innerWidth || 0) >= 820;
  let keyEls = new Map();
  let lo = 60;
  let hi = 83;

  function buildKeys() {
    lo = wide() ? 48 : 60;
    hi = wide() ? 95 : 83;
    keysHost.innerHTML = "";
    keyEls = new Map();
    const whites = [];
    for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites.push(m);
    const w = 100 / whites.length;
    for (let m = lo; m <= hi; m++) {
      const k = document.createElement("span");
      k.className = isBlack(m) ? "mr-k mr-bk" : "mr-k mr-wk";
      k.dataset.midi = String(m);
      k.setAttribute("aria-hidden", "true");
      if (isBlack(m)) {
        const left = whites.indexOf(m + 1) * w;
        k.style.left = `calc(${left}% - ${w * 0.3}%)`;
        k.style.width = `${w * 0.6}%`;
      } else {
        k.style.left = `${whites.indexOf(m) * w}%`;
        k.style.width = `${w}%`;
      }
      keysHost.appendChild(k);
      keyEls.set(m, k);
    }
  }

  function keyBox(m) {
    const el = keyEls.get(m);
    if (!el) return null;
    const host = keysHost.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - host.left, w: r.width };
  }

  /* touch a key and it plays, with the studio's own piano */
  let sampler = null;
  let loading = null;
  function piano() {
    if (sampler) return Promise.resolve(sampler);
    if (!loading) {
      loading = (window.LunePiano?.ensure?.() || Promise.reject(new Error("no piano")))
        .then((s) => (sampler = s))
        .catch(() => {
          loading = null;
          return null;
        });
    }
    return loading;
  }

  function strike(m, vel = 0.55) {
    const el = keyEls.get(m);
    if (!el) return;
    el.classList.remove("is-hit");
    void el.offsetWidth;
    el.classList.add("is-hit");
    ripple(m);
    hero.classList.add("has-played");
    piano().then((s) => {
      try {
        s?.triggerAttackRelease(noteName(m), 1.6, undefined, vel);
      } catch {}
    });
  }

  function ripple(m) {
    const b = keyBox(m);
    if (!b) return;
    const r = document.createElement("i");
    r.className = "mr-ripple";
    r.style.left = `${b.x + b.w / 2}px`;
    stage.appendChild(r);
    setTimeout(() => r.remove(), 1400);
  }

  let down = false;
  let lastKey = null;
  const keyAt = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".mr-k");
    return el && keysHost.contains(el) ? Number(el.dataset.midi) : null;
  };
  keysHost.addEventListener("pointerdown", (e) => {
    const m = keyAt(e);
    if (m == null) return;
    down = true;
    lastKey = m;
    strike(m);
    keysHost.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  keysHost.addEventListener("pointermove", (e) => {
    if (!down) return;
    const m = keyAt(e);
    if (m != null && m !== lastKey) {
      lastKey = m;
      strike(m, 0.45);
    }
  });
  const up = () => {
    down = false;
    lastKey = null;
  };
  keysHost.addEventListener("pointerup", up);
  keysHost.addEventListener("pointercancel", up);

  /* ---------- the opening of Clair de lune falls onto the keys ---------- */
  const stage = hero.querySelector(".mr-stage");
  let phrase = [];
  const QUARTER = 0.62; // seconds per quarter note: slow, as the piece asks
  const BAR = 4.5; // 9/8 is four and a half quarters
  const FALL = 2.6; // seconds a note takes to fall

  function loadPhrase() {
    const url = typeof window.luneUrl === "function" ? window.luneUrl("/static/assets/clair-excerpt.json") : "static/assets/clair-excerpt.json";
    return fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        const seen = new Set();
        const out = [];
        for (const [bar, v] of Object.entries(d.debriefs || {})) {
          for (const n of [...(v.rh || []), ...(v.lh || [])]) {
            const at = ((Number(bar) - 1) * BAR + n.offset) * QUARTER;
            const key = `${at}:${n.midi}`;
            if (!n.midi || seen.has(key)) continue;
            seen.add(key);
            out.push({ at, midi: n.midi, dur: Math.max(0.25, n.duration * QUARTER) });
          }
        }
        phrase = out.sort((a, b) => a.at - b.at);
      })
      .catch(() => {
        phrase = [];
      });
  }

  let loopStart = 0;
  let nextIdx = 0;
  const lit = new Map();
  function fallTick(now) {
    if (!phrase.length || !visible) return;
    const t = (now - loopStart) / 1000;
    const end = phrase[phrase.length - 1].at + 4;
    if (t > end) {
      loopStart = now;
      nextIdx = 0;
      return;
    }
    while (nextIdx < phrase.length && phrase[nextIdx].at - FALL <= t) dropNote(phrase[nextIdx++], now);
  }

  function dropNote(n, now) {
    const b = keyBox(n.midi);
    if (!b) return;
    const lane = stage.querySelector(".mr-fall") || stage.insertBefore(Object.assign(document.createElement("div"), { className: "mr-fall" }), keysHost);
    const laneH = lane.clientHeight || 160;
    const px = laneH / FALL; // pixels per second
    const h = Math.max(6, n.dur * px);
    const el = document.createElement("i");
    el.className = isBlack(n.midi) ? "mr-n mr-nb" : "mr-n";
    el.style.left = `${b.x + b.w * 0.18}px`;
    el.style.width = `${b.w * 0.64}px`;
    el.style.height = `${h}px`;
    lane.appendChild(el);
    const wait = Math.max(0, n.at * 1000 - (now - loopStart) - FALL * 1000);
    const anim = el.animate(
      [{ transform: `translateY(${-h}px)` }, { transform: `translateY(${laneH}px)` }],
      { duration: ((laneH + h) / px) * 1000, delay: wait, easing: "linear", fill: "both" }
    );
    const hitAt = wait + FALL * 1000;
    setTimeout(() => light(n.midi, n.dur), hitAt);
    anim.onfinish = () => el.remove();
  }

  function light(m, dur) {
    const el = keyEls.get(m);
    if (!el) return;
    el.classList.add("is-lit");
    clearTimeout(lit.get(m));
    lit.set(m, setTimeout(() => el.classList.remove("is-lit"), Math.max(260, dur * 1000)));
  }

  /* ---------- the idea, lit word by word as it is read ---------- */
  const read = document.querySelector("[data-mr-read]");
  let words = [];
  if (read) {
    const text = read.textContent.trim();
    read.innerHTML = `<span class="visually-hidden">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>` + text
      .split(/\s+/)
      .map((w) => `<span aria-hidden="true">${w.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>`)
      .join(" ");
    words = [...read.children].slice(1);
    if (still) words.forEach((w) => w.classList.add("on"));
  }
  function readAlong() {
    if (!read || still) return;
    const r = read.getBoundingClientRect();
    const vh = window.innerHeight || 800;
    const p = Math.max(0, Math.min(1, (vh * 0.82 - r.top) / (r.height + vh * 0.35)));
    const n = Math.round(p * words.length);
    words.forEach((w, i) => w.classList.toggle("on", i < n));
  }

  /* ---------- Lune AI writes its plan when it comes into view ---------- */
  const typed = document.querySelector("[data-mr-type]");
  if (typed && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          typed.classList.add("is-typing");
          io.disconnect();
        }
      },
      { root: home, threshold: 0.35 }
    );
    io.observe(typed);
  } else typed?.classList.add("is-typing");

  /* ---------- moonlight follows the pointer ---------- */
  hero.addEventListener("pointermove", (e) => {
    const r = hero.getBoundingClientRect();
    hero.style.setProperty("--mx", `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
    hero.style.setProperty("--my", `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
  });

  /* ---------- run only while the hero is on screen ---------- */
  let visible = true;
  let raf = 0;
  function frame(now) {
    raf = 0;
    if (!visible || document.hidden || !home.offsetParent) return;
    drawSky(now);
    if (!still) fallTick(now);
    raf = requestAnimationFrame(frame);
  }
  const kick = () => {
    if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame);
  };
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(
      (es) => {
        visible = es.some((e) => e.isIntersecting);
        if (visible) {
          loopStart = performance.now();
          nextIdx = 0;
          kick();
        }
      },
      { root: home, threshold: 0.05 }
    ).observe(hero);
  }
  document.addEventListener("visibilitychange", kick);
  window.addEventListener("hashchange", () => setTimeout(kick, 60));

  let resizeT = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      const had = keyEls.size;
      sizeSky();
      if ((wide() ? 48 : 60) !== lo || !had) buildKeys();
      stage.querySelector(".mr-fall")?.replaceChildren();
      loopStart = performance.now();
      nextIdx = 0;
      if (still) drawSky(0);
    }, 150);
  });

  home.addEventListener("scroll", onScroll, { passive: true });
  sizeSky();
  buildKeys();
  onScroll();
  if (still) drawSky(0);
  else
    loadPhrase().then(() => {
      loopStart = performance.now();
      nextIdx = 0;
      kick();
    });
  kick();
})();

/* The same night, inside the app: a still starfield behind the signed-in home
 * and the setup, and a moon on the home that fills as the week's practice does. */
window.LuneMoon = (function () {
  function stars(host) {
    if (!host || host.querySelector(":scope > .lune-stars")) return;
    const c = document.createElement("canvas");
    c.className = "lune-stars";
    c.setAttribute("aria-hidden", "true");
    host.prepend(c);
    const draw = () => {
      const r = host.getBoundingClientRect();
      if (!r.width) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const h = Math.min(r.height, 1400);
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(h * dpr);
      c.style.height = `${h}px`;
      const ctx = c.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      let seed = 11;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const n = Math.round((r.width * h) / 5200);
      for (let i = 0; i < n; i++) {
        ctx.globalAlpha = 0.15 + rnd() * 0.55;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(rnd() * r.width, rnd() * h, rnd() < 0.07 ? 1.15 : 0.3 + rnd() * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    draw();
    let t = 0;
    window.addEventListener("resize", () => {
      clearTimeout(t);
      t = setTimeout(draw, 200);
    });
    new MutationObserver(draw).observe(host, { attributes: true, attributeFilter: ["hidden"] });
  }

  /** The home moon: a crescent with nothing practised, full once the week's goal is met. */
  function paintMember() {
    const host = document.getElementById("home-member");
    if (!host) return;
    stars(host);
    const s = window.LuneStore;
    const snap = s?.weekSnapshot?.() || { days: 0, goalDays: 4 };
    const plan = window.LunePlans?.currentPlan?.();
    const ticked = plan ? Object.values(plan.done || {}).filter(Boolean).length : 0;
    const goal = Math.max(1, plan?.days?.length || snap.goalDays || 4);
    const done = Math.min(goal, Math.max(snap.days || 0, ticked));
    const p = done / goal;
    host.style.setProperty("--wk-p", p.toFixed(3));
    const cap = document.getElementById("mh-phase");
    if (cap)
      cap.textContent =
        done >= goal ? `Full moon. ${goal} of ${goal} days this week.` : `${done} of ${goal} days this week. The moon fills as you practise.`;
  }

  document.addEventListener("DOMContentLoaded", () => stars(document.getElementById("onboard")));
  setTimeout(() => stars(document.getElementById("onboard")), 0);
  return { stars, paintMember };
})();
