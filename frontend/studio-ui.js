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

  function init() {
    apply();
    narrow.addEventListener?.("change", apply);
    injectTopBar();
    trackDock();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
  return { openMenu, closeMenu, openSearch };
})();
