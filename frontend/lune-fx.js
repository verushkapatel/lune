/* Lune FX: the small set of motion effects Lune uses.
 *
 * Written for Lune in plain JavaScript, in the spirit of React Bits
 * (https://reactbits.dev, MIT + Commons Clause, by David Haz): an orb that
 * listens and speaks, text that sharpens into place, a slow aurora, a
 * spotlight under the finger, and words that arrive as if typed. Every
 * effect stands still for people who ask their device for reduced motion.
 */
window.LuneFX = (function () {
  const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  /* ---------- the orb: Lune AI's face while it listens, thinks and speaks ---------- */
  function orb(host, { size = 160 } = {}) {
    const canvas = document.createElement("canvas");
    canvas.className = "lune-orb-canvas";
    canvas.setAttribute("aria-hidden", "true");
    host.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    let mode = "idle";
    let level = 0;
    let shown = 0;
    let raf = 0;
    let t0 = performance.now();
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const px = host.clientWidth || size;
      canvas.width = canvas.height = Math.round(px * dpr);
      canvas.style.width = canvas.style.height = `${px}px`;
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(host);
    const blobs = [
      { hue: 222, sat: 62, light: 46, r: 0.62, sp: 0.00031, ph: 0 },
      { hue: 228, sat: 70, light: 70, r: 0.48, sp: -0.00043, ph: 2.1 },
      { hue: 210, sat: 30, light: 92, r: 0.34, sp: 0.00057, ph: 4.2 },
    ];
    function draw(now) {
      const w = canvas.width;
      const c = w / 2;
      const t = (now - t0) * (mode === "thinking" ? 2.4 : 1);
      // the level eases toward what the microphone or the voice reports
      shown += (level - shown) * 0.18;
      const pulse = mode === "speaking" || mode === "listening" ? shown : mode === "thinking" ? 0.18 + 0.12 * Math.sin(t * 0.004) : 0.06 + 0.04 * Math.sin(t * 0.0015);
      ctx.clearRect(0, 0, w, w);
      const base = Math.min(w * 0.36 * (1 + pulse * 0.32), c * 0.8);
      // soft halo
      // the glow fades out before the canvas edge, so no square corner ever shows
      const halo = ctx.createRadialGradient(c, c, base * 0.6, c, c, Math.min(base * 1.45, c * 0.98));
      halo.addColorStop(0, "rgba(120,150,230,0.22)");
      halo.addColorStop(1, "rgba(120,150,230,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, w);
      ctx.save();
      ctx.beginPath();
      ctx.arc(c, c, base, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "#0b1226";
      ctx.fillRect(0, 0, w, w);
      ctx.globalCompositeOperation = "lighter";
      for (const b of blobs) {
        const a = t * b.sp + b.ph;
        const x = c + Math.cos(a) * base * 0.42;
        const y = c + Math.sin(a * 1.3) * base * 0.38;
        const r = base * (b.r + pulse * 0.25);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `hsla(${b.hue},${b.sat}%,${b.light}%,0.85)`);
        g.addColorStop(1, `hsla(${b.hue},${b.sat}%,${b.light}%,0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, w);
      }
      ctx.restore();
      // a fine rim
      ctx.beginPath();
      ctx.arc(c, c, base, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(200,212,255,0.35)";
      ctx.lineWidth = Math.max(1, w / 220);
      ctx.stroke();
      if (!reduced()) raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return {
      setMode(m) {
        mode = m;
        host.dataset.mode = m;
        if (reduced()) requestAnimationFrame(draw);
      },
      setLevel(v) {
        level = Math.max(0, Math.min(1, Number(v) || 0));
      },
      destroy() {
        cancelAnimationFrame(raf);
        ro?.disconnect();
        canvas.remove();
      },
    };
  }

  /* ---------- words that arrive as if typed (screen readers get the finished text) ---------- */
  function typeText(el, text, { speed = 18 } = {}) {
    el.textContent = "";
    if (reduced() || !text) {
      el.textContent = text;
      return Promise.resolve();
    }
    el.setAttribute("aria-busy", "true");
    const words = String(text).split(/(\s+)/);
    let i = 0;
    return new Promise((resolve) => {
      const step = () => {
        // a few words per frame keeps long answers quick
        const n = Math.max(1, Math.round(words.length / 60));
        for (let k = 0; k < n && i < words.length; k++) el.textContent += words[i++];
        if (i < words.length) setTimeout(step, speed);
        else {
          el.removeAttribute("aria-busy");
          resolve();
        }
      };
      step();
    });
  }

  /* ---------- headings that sharpen into place, word by word, when they come into view ---------- */
  function blurText(el) {
    if (el.dataset.fxDone || reduced()) return;
    el.dataset.fxDone = "1";
    const label = el.textContent;
    const walk = (node) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) {
          const frag = document.createDocumentFragment();
          for (const part of child.textContent.split(/(\s+)/)) {
            if (!part) continue;
            if (/^\s+$/.test(part)) frag.appendChild(document.createTextNode(part));
            else {
              const s = document.createElement("span");
              s.className = "fx-word";
              s.setAttribute("aria-hidden", "true");
              s.textContent = part;
              frag.appendChild(s);
            }
          }
          child.replaceWith(frag);
        } else if (child.nodeType === 1 && child.tagName !== "BR") walk(child);
      }
    };
    walk(el);
    el.setAttribute("aria-label", label.replace(/\s+/g, " ").trim());
    [...el.querySelectorAll(".fx-word")].forEach((w, i) => w.style.setProperty("--fx-i", i));
    el.classList.add("fx-blur");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          el.classList.add("fx-in");
          io.disconnect();
        }
      },
      { threshold: 0.2 }
    );
    io.observe(el);
  }

  /* ---------- a spotlight that follows the finger or pointer across a card ---------- */
  function spotlight(root = document) {
    root.addEventListener(
      "pointermove",
      (e) => {
        const card = e.target.closest?.(".fx-spot");
        if (!card) return;
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${e.clientX - r.left}px`);
        card.style.setProperty("--my", `${e.clientY - r.top}px`);
      },
      { passive: true }
    );
  }

  /* ---------- a slow aurora behind a section ---------- */
  function aurora(host) {
    if (!host || host.querySelector(".fx-aurora")) return;
    const layer = document.createElement("div");
    layer.className = "fx-aurora";
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML = "<i></i><i></i><i></i>";
    host.prepend(layer);
  }

  /* ---------- the loading screen: keys playing a little phrase ---------- */
  function loaderHtml() {
    return `<div class="lune-loader-stage">
        <div class="lune-loader-keys" aria-hidden="true">${Array.from({ length: 8 }, (_, i) => `<span style="--k:${i}"></span>`).join("")}</div>
        <p class="lune-loader-text" id="lune-loader-text">Opening</p>
      </div>`;
  }

  /*
   * Every dialog closes the way it opened: a short fade and drop, never a cut.
   * close() is wrapped, and Escape and "Done" (method="dialog" forms) are routed
   * through it, so code that closes a dialog needs no changes.
   */
  function smoothDialogs() {
    const proto = window.HTMLDialogElement?.prototype;
    if (!proto || proto.__luneSmooth) return;
    const realClose = proto.close;
    proto.__luneSmooth = true;
    proto.close = function (value) {
      if (!this.open || this.__closing) return;
      if (reduced()) return realClose.call(this, value);
      this.__closing = true;
      this.classList.add("is-closing");
      const done = () => {
        clearTimeout(timer);
        this.removeEventListener("animationend", onEnd);
        this.classList.remove("is-closing");
        this.__closing = false;
        if (this.open) realClose.call(this, value);
      };
      const onEnd = (e) => e.target === this && done();
      const timer = setTimeout(done, 200);
      this.addEventListener("animationend", onEnd);
    };
    document.addEventListener(
      "cancel",
      (e) => {
        const d = e.target;
        if (!(d instanceof HTMLDialogElement) || reduced()) return;
        // the native close is held back; if the dialog's own handler does not stop it, it closes animated
        const hold = Event.prototype.preventDefault;
        let kept = false;
        e.preventDefault = () => {
          kept = true;
          hold.call(e);
        };
        hold.call(e);
        setTimeout(() => {
          if (!kept && d.open) d.close();
        }, 0);
      },
      true
    );
    document.addEventListener(
      "submit",
      (e) => {
        const form = e.target;
        if (!(form instanceof HTMLFormElement) || (form.getAttribute("method") || "").toLowerCase() !== "dialog" || reduced()) return;
        const d = form.closest("dialog");
        if (!d) return;
        e.preventDefault();
        d.close(e.submitter?.value || "");
      },
      true
    );
  }
  smoothDialogs();

  /* The Lune AI examples on the landing page: swipe cards with dots that follow and jump. */
  function aiCarousel() {
    const track = document.querySelector("#ai .ai-scenes");
    const dots = document.getElementById("ai-dots");
    if (!track || !dots || dots.childElementCount) return;
    const cards = [...track.querySelectorAll(".ai-scene")];
    cards.forEach((c, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-label", `Example ${i + 1} of ${cards.length}`);
      b.addEventListener("click", () => track.scrollTo({ left: c.offsetLeft - (track.clientWidth - c.clientWidth) / 2, behavior: reduced() ? "auto" : "smooth" }));
      dots.appendChild(b);
    });
    const mark = () => {
      const mid = track.scrollLeft + track.clientWidth / 2;
      let best = 0;
      cards.forEach((c, i) => {
        if (Math.abs(c.offsetLeft + c.clientWidth / 2 - mid) < Math.abs(cards[best].offsetLeft + cards[best].clientWidth / 2 - mid)) best = i;
      });
      [...dots.children].forEach((d, i) => d.setAttribute("aria-current", String(i === best)));
    };
    track.addEventListener("scroll", () => requestAnimationFrame(mark), { passive: true });
    track.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      track.scrollBy({ left: (e.key === "ArrowRight" ? 1 : -1) * (cards[0]?.clientWidth || 300), behavior: reduced() ? "auto" : "smooth" });
    });
    mark();
  }

  function init() {
    aiCarousel();
    spotlight();
    document.querySelectorAll("[data-fx-blur]").forEach(blurText);
    document.querySelectorAll("[data-fx-aurora]").forEach(aurora);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();

  return { orb, typeText, blurText, spotlight, aurora, loaderHtml, reduced };
})();

/* Landing nav: jump smoothly inside the landing's own scroller, and light the
   section in view. */
(function () {
  const nav = document.getElementById("lp-nav");
  if (!nav) return;
  const scroller = () => document.getElementById("home");
  nav.addEventListener("click", (e) => {
    const a = e.target.closest("[data-lp-jump]");
    if (!a) return;
    e.preventDefault();
    const el = document.getElementById(a.dataset.lpJump);
    const sc = scroller();
    if (!el || !sc) return;
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    // demos above may finish loading and change height mid-glide: settle again a few
    // times, unless the reader has started scrolling on their own
    let manual = false;
    const mark = () => { manual = true; };
    sc.addEventListener("wheel", mark, { passive: true, once: true });
    sc.addEventListener("touchmove", mark, { passive: true, once: true });
    [900, 1800, 2700].forEach((ms, i) => setTimeout(() => {
      if (manual) return;
      const off = el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 12;
      if (Math.abs(off) > 24) el.scrollIntoView({ behavior: "auto", block: "start" });
      if (i === 2) { sc.removeEventListener("wheel", mark); sc.removeEventListener("touchmove", mark); }
    }, smooth ? ms : 50 * (i + 1)));
  });
  const links = [...nav.querySelectorAll("[data-lp-jump]")];
  if (!("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      links.forEach((l) => {
        const on = l.dataset.lpJump === en.target.id;
        l.classList.toggle("on", on);
        if (on) l.setAttribute("aria-current", "true"); else l.removeAttribute("aria-current");
      });
    }
  }, { rootMargin: "-40% 0px -55% 0px" });
  links.forEach((l) => { const t = document.getElementById(l.dataset.lpJump); if (t) io.observe(t); });
})();

/* The hero's Lune AI panel opens onto the Lune AI chapter */
document.addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-lp-jump-ai]");
  if (!b) return;
  const el = document.getElementById("ai");
  if (el) el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
});

/* the landing bar frosts once the page scrolls */
(function () {
  const sc = document.getElementById("home");
  if (!sc) return;
  let on = false;
  sc.addEventListener("scroll", () => {
    const next = sc.scrollTop > 24;
    if (next !== on) { on = next; document.body.classList.toggle("lp-scrolled", on); }
  }, { passive: true });
})();

/*
 * A button that starts work shows the Lune moon until that work is done:
 * requests begun within a moment of the tap belong to the button.
 */
(function () {
  if (!window.fetch || window.fetch.__lune) return;
  const raw = window.fetch;
  let arming = null;
  const done = (g) => {
    if (g.over) return;
    g.over = true;
    clearTimeout(g.cap);
    g.btn.classList.remove("is-busy");
    g.btn.removeAttribute("aria-busy");
  };
  const wrapped = function (...args) {
    const p = raw.apply(this, args);
    const g = arming;
    if (g && !g.over) {
      g.set.add(p);
      if (!g.btn.classList.contains("is-busy")) {
        g.btn.classList.add("is-busy");
        g.btn.setAttribute("aria-busy", "true");
      }
      const end = () => {
        g.set.delete(p);
        if (!g.set.size) done(g);
      };
      p.then(end, end);
    }
    return p;
  };
  wrapped.__lune = true;
  window.fetch = wrapped;
  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.("button");
    if (!btn || btn.closest(".lune-kbd, #osmd, .lp-nav, .studio-seg")) return;
    const g = { btn, set: new Set(), over: false };
    arming = g;
    setTimeout(() => { if (arming === g) arming = null; }, 600);
    g.cap = setTimeout(() => done(g), 20000);
  }, true);
})();
