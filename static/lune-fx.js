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
      const base = w * 0.36 * (1 + pulse * 0.32);
      // soft halo
      const halo = ctx.createRadialGradient(c, c, base * 0.6, c, c, base * 1.45);
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

  function init() {
    spotlight();
    document.querySelectorAll("[data-fx-blur]").forEach(blurText);
    document.querySelectorAll("[data-fx-aurora]").forEach(aurora);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();

  return { orb, typeText, blurText, spotlight, aurora, loaderHtml, reduced };
})();
