/* The compact studio, for phones and small tablets.
 *
 * The top bar keeps three things: the menu, Play or Pause, and + to open
 * another piece in a new tab. Everything else waits in the menu. The bottom
 * holds the piano, or the metronome and speed when the piano is hidden.
 * The menu's buttons press the studio's own controls, so behaviour stays in
 * one place (app.js and practice.js).
 */
window.LuneStudioUI = (function () {
  const $ = (id) => document.getElementById(id);
  const narrow = window.matchMedia("(max-width: 900px)");
  const press = (id) => $(id)?.click();
  const ICON = {
    menu: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
    add: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };

  function apply() {
    const was = document.body.classList.contains("studio-compact");
    document.body.classList.toggle("studio-compact", narrow.matches);
    // the tab strip differs between phone and computer: redraw it when the width crosses over
    if (was !== narrow.matches) window.renderPieceTabs?.();
  }

  function injectTopBar() {
    const bar = document.querySelector("header.bar");
    if (!bar || $("st-menu")) return;
    const make = (id, cls, label, html) => {
      const b = document.createElement("button");
      b.type = "button";
      b.id = id;
      b.className = `st-btn ${cls}`;
      b.setAttribute("aria-label", label);
      b.innerHTML = html;
      return b;
    };
    const menu = make("st-menu", "st-menu", "Menu", ICON.menu);
    const play = make("st-play", "st-play", "Play", ICON.play);
    const add = make("st-add", "st-add", "Open another piece in a new tab", ICON.add);
    bar.prepend(menu);
    bar.appendChild(play);
    bar.appendChild(add);
    menu.addEventListener("click", openMenu);
    play.addEventListener("click", () => press("btn-play-range"));
    // after this tap is over, so the page's "tap outside closes search" does not close it again
    add.addEventListener("click", () => setTimeout(openSearch, 0));
    // the title opens the menu too: it is where the open pieces are
    $("studio-piece-quiet")?.addEventListener("click", () => document.body.classList.contains("studio-compact") && openMenu());
    // Play reflects the player's own button
    const src = $("btn-play-range");
    const sync = () => {
      const playing = /pause/i.test(src?.textContent || "");
      play.innerHTML = playing ? ICON.pause : ICON.play;
      play.setAttribute("aria-label", playing ? "Pause" : src?.textContent?.trim() || "Play");
      play.classList.toggle("on", playing);
    };
    if (src) new MutationObserver(sync).observe(src, { childList: true, characterData: true, subtree: true });
    sync();
  }

  function openSearch() {
    closeMenu();
    document.body.classList.add("studio-search-open", "phone-search-open");
    // opening another piece works for everyone, signed in or not
    const form = $("top-search");
    if (form) form.hidden = false;
    $("btn-search")?.setAttribute("aria-expanded", "true");
    const q = $("q");
    if (q) {
      q.value = "";
      q.placeholder = "Open another piece…";
      q.focus();
    }
  }

  /* ---------- the menu: a sheet from the bottom ---------- */
  function sheet() {
    let d = $("studio-menu");
    if (d) return d;
    d = document.createElement("dialog");
    d.id = "studio-menu";
    d.className = "studio-menu";
    d.setAttribute("aria-label", "Score menu");
    document.body.appendChild(d);
    d.addEventListener("click", (e) => {
      if (e.target === d) return closeMenu();
      const b = e.target.closest("[data-m]");
      if (!b) return;
      const act = b.dataset.m;
      const keepOpen = ["anno", "access", "kbd"].includes(act);
      if (act === "panel") press(`tab-${b.dataset.v}`);
      if (act === "anno") {
        const r = $(`anno-${b.dataset.v}`);
        if (r) {
          r.checked = true;
          r.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
      if (act === "access") press("btn-dyslexia-score");
      if (act === "kbd") press("btn-toggle-kbd");
      if (act === "tab") window.activateSession?.(b.dataset.v);
      if (act === "close-tab") {
        e.stopPropagation();
        window.closeSession?.(b.dataset.v)?.then?.(() => paint());
        return;
      }
      if (act === "new") return openSearch();
      if (act === "save") press("btn-bookmark");
      if (act === "share") press("btn-share");
      if (act === "settings") press("btn-settings");
      if (act === "ask") window.LuneAsk?.open?.();
      if (act === "ai") window.LuneAsk?.goAiPage?.();
      if (act === "home") press("btn-home");
      if (keepOpen) setTimeout(paint, 60);
      else closeMenu();
    });
    return d;
  }

  function paint() {
    const d = sheet();
    // app.js keeps its state in a top-level const, visible here by name
    const st = typeof state !== "undefined" ? state : {};
    const panel = st.panel || "score";
    const anno = st.scoreFingers ? "fingers" : st.scoreLetters ? "notes" : "off";
    const easy = $("btn-dyslexia-score")?.getAttribute("aria-pressed") === "true";
    const kbd = !!st.keyboardVisible;
    const braille = $("btn-braille-score");
    const saved = $("btn-bookmark")?.getAttribute("aria-pressed") === "true";
    const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const sessions = (st.sessions || []).filter((s) => s.piece || s.lazy);
    const seg = (act, value, items) =>
      `<div class="sm-seg" role="group">${items
        .map(([v, label]) => `<button type="button" data-m="${act}" data-v="${v}" aria-pressed="${v === value}">${label}</button>`)
        .join("")}</div>`;
    d.innerHTML = `
      <div class="sm-grip" aria-hidden="true"></div>
      ${seg("panel", panel, [["score", "Score"], ["explain", "Explain"], ["piano", "Piano"]])}
      <p class="sm-h">Open pieces</p>
      <div class="sm-tabs">
        ${sessions
          .map(
            (s) => `<div class="sm-tab${s.id === st.activeSessionId ? " on" : ""}">
              <button type="button" data-m="tab" data-v="${esc(s.id)}">${esc(s.shortTitle)}</button>
              ${sessions.length > 1 ? `<button type="button" class="sm-x" data-m="close-tab" data-v="${esc(s.id)}" aria-label="Close ${esc(s.shortTitle)}">${ICON.close}</button>` : ""}
            </div>`
          )
          .join("")}
        <button type="button" class="sm-new" data-m="new">${ICON.add}<span>Open another piece</span></button>
      </div>
      <p class="sm-h">On the score</p>
      ${seg("anno", anno, [["notes", "Notes"], ["fingers", "Fingers"], ["off", "Off"]])}
      <div class="sm-toggles">
        <button type="button" data-m="kbd" aria-pressed="${kbd}">Piano keys</button>
        <button type="button" data-m="access" aria-pressed="${easy}">Easy-read letters</button>
        ${braille && !braille.hidden ? `<a class="sm-link" href="${esc(braille.getAttribute("href"))}" download>Braille music</a>` : ""}
      </div>
      <div class="sm-actions">
        <button type="button" data-m="ask"><span class="lune-orb-sm" aria-hidden="true"></span>Ask about this bar</button>
        <button type="button" data-m="ai">Lune AI chat</button>
        <button type="button" data-m="save">${saved ? "Saved" : "Save"}</button>
        <button type="button" data-m="share">Share</button>
        <button type="button" data-m="settings">Settings</button>
        <button type="button" data-m="home">Home</button>
      </div>`;
  }

  function openMenu() {
    const d = sheet();
    paint();
    if (!d.open) d.showModal();
  }
  function closeMenu() {
    const d = $("studio-menu");
    if (d?.open) d.close();
  }

  /** Keep Ask Lune just above whatever sits at the bottom: the piano, or the speed controls. */
  function trackDock() {
    const measure = () => {
      const h = ["studio-dock", "piano-dock"].reduce((n, id) => {
        const el = $(id);
        return n + (el && !el.hidden ? el.getBoundingClientRect().height : 0);
      }, 0);
      document.body.style.setProperty("--dock-h", `${Math.round(h)}px`);
    };
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      ["studio-dock", "piano-dock"].forEach((id) => $(id) && ro.observe($(id)));
    }
    new MutationObserver(measure).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    measure();
  }

  /**
   * A slim rail on the right edge: tap the handle and the playback tools
   * (metronome, speed, back to the start) slide out; tap again and they hide.
   * Each one presses the studio's own control.
   */
  function injectRail() {
    if ($("st-rail")) return;
    const rail = document.createElement("div");
    rail.className = "st-rail";
    rail.id = "st-rail";
    rail.innerHTML = `
      <button type="button" class="st-rail-handle" id="st-rail-handle" aria-expanded="false" aria-controls="st-rail-tools" aria-label="Playback tools">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M14.5 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="st-rail-tools" id="st-rail-tools" role="group" aria-label="Playback tools">
        <button type="button" class="st-rail-btn" data-rail="metro" aria-pressed="false" aria-label="Metronome">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 20h8l-3.2-14h-1.6L8 20z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10.2 11.5l5.2-3.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
        <button type="button" class="st-rail-btn" data-rail="faster" aria-label="Faster">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 6v12M6 12h12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
        <span class="st-rail-bpm" id="st-rail-bpm" aria-live="polite"><b>72</b><small>bpm</small></span>
        <button type="button" class="st-rail-btn" data-rail="slower" aria-label="Slower">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 12h12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
        <span class="st-rail-sep" aria-hidden="true"></span>
        <button type="button" class="st-rail-btn" data-rail="restart" aria-label="Back to the start">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M7 6v12M18 6.5v11L9.5 12z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>
        </button>
      </div>`;
    document.body.appendChild(rail);
    const handle = $("st-rail-handle");
    const set = (open) => {
      rail.classList.toggle("open", open);
      handle.setAttribute("aria-expanded", open ? "true" : "false");
      handle.setAttribute("aria-label", open ? "Hide playback tools" : "Playback tools");
    };
    handle.addEventListener("click", () => set(!rail.classList.contains("open")));
    const slider = $("bpm-slider");
    const paintRail = () => {
      const metro = $("btn-metro");
      const b = rail.querySelector('[data-rail="metro"]');
      const on = metro?.getAttribute("aria-pressed") === "true";
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.classList.toggle("on", on);
      const v = slider?.value || $("bpm-readout")?.textContent || "";
      rail.querySelector("#st-rail-bpm b").textContent = v;
    };
    const nudge = (d) => {
      if (!slider) return;
      const v = Math.max(+slider.min || 40, Math.min(+slider.max || 160, (+slider.value || 72) + d));
      slider.value = String(v);
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      slider.dispatchEvent(new Event("change", { bubbles: true }));
      paintRail();
    };
    rail.addEventListener("click", (e) => {
      const b = e.target.closest("[data-rail]");
      if (!b) return;
      const k = b.dataset.rail;
      if (k === "metro") press("btn-metro");
      else if (k === "faster") nudge(4);
      else if (k === "slower") nudge(-4);
      else if (k === "restart") press("btn-stop");
      setTimeout(paintRail, 30);
    });
    const metro = $("btn-metro");
    if (metro) new MutationObserver(paintRail).observe(metro, { attributes: true, attributeFilter: ["aria-pressed"] });
    const read = $("bpm-readout");
    if (read) new MutationObserver(paintRail).observe(read, { childList: true, characterData: true, subtree: true });
    slider?.addEventListener("input", paintRail);
    // tapping the score hides the rail again
    $("score-scroll")?.addEventListener("pointerdown", () => set(false), { passive: true });
    paintRail();
  }

  function init() {
    apply();
    narrow.addEventListener?.("change", apply);
    injectTopBar();
    injectRail();
    trackDock();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
  return { openMenu, closeMenu, openSearch };
})();
