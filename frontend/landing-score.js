/* Lune — the landing page's live score.
 *
 * The feature chapters used to show empty staff lines. They now engrave the
 * opening bars of Clair de lune with the same engraver and label lane as the
 * studio, so a first visit sees real notation: note heads, letter names,
 * finger numbers, a playhead that follows the sound, and bars you can tap.
 *
 * Data: static/assets/clair-excerpt.json (scripts/build_landing_excerpt.py).
 * Each host is <div class="fx-paper"><div class="fx-score" data-live-score>.
 */
window.LuneLanding = (function () {
  const $$ = (root, sel) => [...root.querySelectorAll(sel)];
  const FLAT = { b: "♭", "#": "♯" };

  let dataPromise = null;
  let playingHost = null;
  const engraved = new WeakMap(); // host → { osmd, width, mode }

  function assetUrl(path) {
    return typeof window.luneUrl === "function" ? window.luneUrl(path) : path.replace(/^\//, "");
  }

  function load() {
    if (!dataPromise) {
      dataPromise = fetch(assetUrl("/static/assets/clair-excerpt.json"))
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("excerpt missing"))))
        .catch((err) => {
          dataPromise = null;
          throw err;
        });
    }
    return dataPromise;
  }

  /** "Ab4" → "A♭" */
  function letter(name) {
    const m = /^([A-G])([b#]*)/.exec(String(name || ""));
    return m ? m[1] + [...m[2]].map((c) => FLAT[c] || "").join("") : "";
  }

  function barQuarters(d) {
    const [beats, type] = String(d.timeSignature || "4/4").split("/").map(Number);
    return beats && type ? (beats * 4) / type : 4;
  }

  /** The excerpt as the notes the studio's piano plays. */
  function playbackNotes(d) {
    const perBar = barQuarters(d);
    const seen = new Set();
    const out = [];
    for (let bar = 1; bar <= d.bars; bar++) {
      const deb = d.debriefs[String(bar)] || {};
      for (const n of [...(deb.rh || []), ...(deb.lh || [])]) {
        // two voices sharing a key sound once
        const key = `${bar}:${n.midi}:${n.offset}`;
        if (!n.midi || seen.has(key)) continue;
        seen.add(key);
        out.push({ ...n, bar, absOffset: (bar - 1) * perBar + (Number(n.offset) || 0) });
      }
    }
    return out;
  }

  /* ---------- engraving ---------- */

  async function engrave(host) {
    if (!window.opensheetmusicdisplay || !window.LuneLane) return;
    const d = await load();
    const width = Math.round(host.clientWidth);
    if (!width) return;
    const mode = host.dataset.lane || "off";
    const prev = engraved.get(host);
    if (prev && prev.width === width && prev.mode === mode) return;

    const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(host, {
      autoResize: false,
      backend: "svg",
      drawTitle: false,
      drawComposer: false,
      drawCredits: false,
      drawPartNames: false,
      drawMeasureNumbers: false,
      drawLyrics: true, // the letter / finger lane
      drawFingerings: false,
      newSystemFromXML: true, // the excerpt breaks every two bars
    });
    try {
      const R = osmd.EngravingRules;
      R.StretchLastSystemLine = true;
      // same label lane as the studio (app.js renderScore)
      R.LyricsHeight = 2.15;
      R.LyricsYOffsetToStaffHeight = 0.9;
      R.VerticalBetweenLyricsDistance = 0.35;
      R.LyricsUseXPaddingForLongLyrics = true;
      R.HorizontalBetweenLyricsDistance = 0.45;
      R.BetweenSyllableMinimumDistance = 0.6;
      R.RenderLyricist = false;
      R.PageLeftMargin = 1;
      R.PageRightMargin = 1;
      R.PageTopMargin = 1;
      R.PageBottomMargin = 1;
      R.MetronomeMarksDrawn = false;
    } catch {
      /* older OSMD */
    }
    const xml = LuneLane.build(LuneLane.printed(d.musicxml), { mode, debriefs: d.debriefs });
    await osmd.load(xml);
    // Two bars a line at any width: the page scales, the music does not reflow.
    osmd.zoom = Math.max(0.36, Math.min(0.8, width / 760));
    host.innerHTML = "";
    osmd.render();
    for (const t of $$(host, "g.lyrics text")) {
      if ((t.textContent || "").trim() === LuneLane.SPARE) t.setAttribute("visibility", "hidden");
      else t.classList.add(mode === "fingers" ? "lane-finger" : "lane-letter");
    }
    const svg = host.querySelector("svg");
    if (svg) {
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", `Opening ${d.bars} bars of ${d.title}, ${d.composer}`);
    }
    engraved.set(host, { osmd, width, mode });
    host.dataset.ready = "1";
    paintMarks(host);
  }

  function barBounds(host, bar) {
    const e = engraved.get(host);
    if (!e) return null;
    return window.LuneAnnotate?.measureBoundsInHost?.(e.osmd, host, bar) || null;
  }

  function barAtPoint(host, x, y) {
    const e = engraved.get(host);
    if (!e) return null;
    const n = Number(window.LuneAnnotate?.measureAtPoint?.(e.osmd, host, x, y));
    return n >= 1 ? n : null;
  }

  /* ---------- overlays: bar highlights, markers, playhead ---------- */

  function overlay(host, cls) {
    const paper = host.parentElement;
    let el = paper.querySelector(`:scope > .${cls.split(" ")[0]}[data-for-score]`);
    if (!el) {
      el = document.createElement("div");
      el.dataset.forScore = "1";
      el.setAttribute("aria-hidden", "true");
      paper.appendChild(el);
    }
    el.className = cls;
    return el;
  }

  function place(el, b, pad = 3) {
    if (!b) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.style.left = `${b.left - pad}px`;
    el.style.top = `${b.top - pad}px`;
    el.style.width = `${b.width + pad * 2}px`;
    el.style.height = `${b.height + pad * 2}px`;
  }

  /** Static marks declared on the host: data-hilite="2" data-stumble="3" data-marker="3". */
  function paintMarks(host) {
    const paper = host.parentElement;
    $$(paper, ":scope > .fx-bar-mark").forEach((el) => el.remove());
    const add = (bar, cls, text) => {
      const b = barBounds(host, Number(bar));
      if (!b) return;
      const el = document.createElement("div");
      el.className = `fx-bar-mark ${cls}`;
      el.setAttribute("aria-hidden", "true");
      if (text) el.innerHTML = `<span>${text}</span>`;
      paper.appendChild(el);
      place(el, b);
    };
    if (host.dataset.hilite) add(host.dataset.hilite, "is-here");
    if (host.dataset.stumble) add(host.dataset.stumble, "is-stumble");
    if (host.dataset.marker) add(host.dataset.marker, "is-note", host.dataset.marker);
    if (host.dataset.selected) selectBar(host, Number(host.dataset.selected), { quiet: true });
  }

  /* ---------- 01 Annotate: Notes / Fingers / Off ---------- */

  function bindLane(figure) {
    const host = figure.querySelector("[data-live-score]");
    const buttons = $$(figure, "[data-lane-set]");
    buttons.forEach((b) =>
      b.addEventListener("click", () => {
        host.dataset.lane = b.dataset.laneSet;
        buttons.forEach((x) => {
          const on = x === b;
          x.classList.toggle("on", on);
          x.setAttribute("aria-pressed", on ? "true" : "false");
        });
        engrave(host).catch(() => {});
      })
    );
    const aa = figure.querySelector("[data-easy-toggle]");
    aa?.addEventListener("click", () => {
      const on = !figure.classList.contains("fx-readable");
      figure.classList.toggle("fx-readable", on);
      aa.classList.toggle("on", on);
      aa.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  /* ---------- 02 Hear: play the excerpt, playhead on the page ---------- */

  function stopPlay() {
    if (!playingHost) return;
    const figure = playingHost.closest(".home-feat-device");
    playingHost = null;
    try {
      window.LunePiano?.stop?.(true);
    } catch {
      /* not started */
    }
    setPlayUi(figure, false);
  }

  function setPlayUi(figure, on, label) {
    const btn = figure?.querySelector("[data-play]");
    if (btn) {
      btn.classList.toggle("on", !!on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.textContent = label || (on ? "Stop" : "Play");
    }
    const line = figure?.querySelector(".fx-live-playhead");
    if (line && !on) line.hidden = true;
  }

  function bindPlay(figure) {
    const host = figure.querySelector("[data-live-score]");
    const btn = figure.querySelector("[data-play]");
    const slider = figure.querySelector("[data-tempo]");
    const readout = figure.querySelector("[data-tempo-out]");
    if (!btn) return;

    // The slider counts the printed beat (dotted crotchet in 9/8); the piano counts crotchets.
    const beatQ = (d) => (/\/8$/.test(d.timeSignature) && parseInt(d.timeSignature, 10) % 3 === 0 ? 1.5 : 1);
    const paintTempo = () => {
      if (readout && slider) readout.textContent = `${slider.value} bpm`;
    };
    slider?.addEventListener("input", async () => {
      paintTempo();
      if (playingHost !== host) return;
      const d = await load();
      window.LunePiano?.setTempoBpm?.(Number(slider.value) * beatQ(d));
    });
    paintTempo();

    btn.addEventListener("click", async () => {
      if (playingHost === host) {
        stopPlay();
        return;
      }
      stopPlay();
      if (!window.LunePiano) return;
      setPlayUi(figure, false, "Loading piano");
      btn.disabled = true;
      try {
        const d = await load();
        await engrave(host);
        await LunePiano.ensure();
        const perBar = barQuarters(d);
        const line = overlay(host, "fx-live-playhead");
        playingHost = host;
        setPlayUi(figure, true);
        const bpm = Number(slider?.value || d.bpm) * beatQ(d);
        await LunePiano.play(playbackNotes(d), {
          baseBpm: d.bpm * beatQ(d),
          tempoBpm: bpm,
          onTick: ({ progress, total }) => {
            if (playingHost !== host || !total) return;
            const q = (progress / total) * d.bars * perBar;
            const bar = Math.min(d.bars, Math.floor(q / perBar) + 1);
            const b = barBounds(host, bar);
            if (!b) return;
            const within = Math.max(0, Math.min(1, q / perBar - (bar - 1)));
            line.hidden = false;
            line.style.left = `${b.left + b.width * within}px`;
            line.style.top = `${b.top - 4}px`;
            line.style.height = `${b.height + 8}px`;
          },
          onEnd: () => {
            if (playingHost === host) {
              playingHost = null;
              setPlayUi(figure, false);
            }
          },
        });
      } catch {
        playingHost = null;
        setPlayUi(figure, false);
        window.toast?.("Could not load the piano sound — check the connection and try again");
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ---------- 05 Ask: tap a bar, read what is in it ---------- */

  async function selectBar(host, bar, { quiet = false } = {}) {
    const d = await load();
    const deb = d.debriefs[String(bar)];
    if (!deb) return;
    host.dataset.selected = String(bar);
    const sel = overlay(host, "fx-bar-mark is-selected");
    sel.innerHTML = `<span>Bar ${bar}</span>`;
    place(sel, barBounds(host, bar));
    const panel = host.closest(".home-feat-device")?.querySelector("[data-ask-panel]");
    if (!panel) return;
    const notes = [...(deb.rh || []), ...(deb.lh || [])].sort((a, b) => a.offset - b.offset || b.midi - a.midi);
    const top = notes.filter((n, i) => i === 0 || n.offset !== notes[i - 1].offset); // the melody line
    const names = top.slice(0, 6).map((n) => letter(n.letter));
    const fingers = top.slice(0, 6).map((n) => n.fingering || "–");
    const advice = Array.isArray(deb.focus) ? deb.focus[0] : deb.focus;
    panel.innerHTML = "";
    const row = (tag, text, cls) => {
      if (!text) return;
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      el.textContent = text;
      panel.appendChild(el);
    };
    row("strong", `Ask · Bar ${bar}`);
    row("span", names.length ? `Top line · ${names.join(" ")}` : "");
    row("span", fingers.length ? `Fingers · ${fingers.join(" ")}` : "");
    row("span", advice ? String(advice).split(/(?<=[.!?])\s/)[0] : "", "dim");
    if (!quiet) panel.setAttribute("aria-live", "polite");
  }

  function bindAsk(figure) {
    const host = figure.querySelector("[data-live-score]");
    host.classList.add("is-tappable");
    host.addEventListener("click", (e) => {
      const bar = barAtPoint(host, e.clientX, e.clientY);
      if (bar) selectBar(host, bar);
    });
    // keyboard: the same choice as buttons, one per bar
    $$(figure, "[data-ask-bar]").forEach((b) =>
      b.addEventListener("click", () => selectBar(host, Number(b.dataset.askBar)))
    );
  }

  /* ---------- lifecycle ---------- */

  function init() {
    const hosts = $$(document, "[data-live-score]");
    if (!hosts.length) return;
    $$(document, ".home-feat-device").forEach((figure) => {
      if (!figure.querySelector("[data-live-score]")) return;
      if (figure.querySelector("[data-lane-set], [data-easy-toggle]")) bindLane(figure);
      if (figure.querySelector("[data-play]")) bindPlay(figure);
      if (figure.querySelector("[data-ask-panel]")) bindAsk(figure);
    });

    // Engrave a chapter as it comes near the viewport, not all at once.
    const io =
      "IntersectionObserver" in window
        ? new IntersectionObserver(
            (entries) => {
              for (const en of entries) {
                if (!en.isIntersecting) continue;
                io.unobserve(en.target);
                engrave(en.target).catch(() => {});
              }
            },
            { root: document.getElementById("home"), rootMargin: "400px 0px" }
          )
        : null;
    hosts.forEach((h) => (io ? io.observe(h) : engrave(h).catch(() => {})));

    let timer = 0;
    const again = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        hosts.forEach((h) => {
          if (h.dataset.ready && h.clientWidth) engrave(h).catch(() => {});
        });
      }, 180);
    };
    if ("ResizeObserver" in window) {
      const ro = new ResizeObserver(again);
      hosts.forEach((h) => ro.observe(h));
    } else window.addEventListener("resize", again);

    // Leaving the landing (opening the studio, signing in) ends the excerpt.
    document.addEventListener("click", (e) => {
      if (playingHost && e.target.closest?.("[data-open-piece], [data-lp-personalise], [data-lp-signin-only]")) stopPlay();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();

  return { engrave, stopPlay };
})();
