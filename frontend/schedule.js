/* Lune — Plan my schedule.
 *
 * One sheet, two steps. First the pianist says what they want: a goal, which
 * pieces and what to do with each (learn new bars, polish, keep fresh), which
 * days, how long (the same every day, or day by day), what every session
 * includes (warm-up, technique, sight-reading, hard bars first) and, if they
 * like, an email on practice days. Lune builds a timed week from their
 * Repertoire, progress and the bars still hard. Then every block can be
 * fine-tuned: its minutes, its words, its place, or removed; blocks can be
 * added. Saving keeps the week (weekPlan) and the settings (schedule), so
 * each new week is built the same way without asking again.
 */
window.LuneSchedule = (function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const store = () => window.LuneStore;
  const plans = () => window.LunePlans;
  const toast = (m) => window.toast?.(m);
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const DAY_NAMES = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
  const FOCUS = [["learn", "Learn"], ["polish", "Polish"], ["fresh", "Keep fresh"]];
  const INCLUDE = [
    ["warmup", "Warm-up", "A few calm minutes before the pieces"],
    ["technique", "Scales and technique", "Scales, arpeggios and a little technique"],
    ["sight", "Sight-reading", "Something new each day, without stopping"],
    ["hardFirst", "Hard bars first", "The bars still hard come before the rest"],
  ];
  const TECHNIQUE = [
    "Scales and arpeggios, hands separately then together",
    "Broken chords, slowly and evenly",
    "Contrary-motion and chromatic scales",
    "Trills and repeated notes, light and even",
    "Scales in thirds, legato",
  ];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const r5 = (x) => Math.max(5, Math.round(x / 5) * 5);
  const sum = (items) => items.reduce((n, it) => n + (Number(it.mins) || 0), 0);
  const signedIn = () => !!window.LuneOnboard?.signedIn?.() || store()?.status?.()?.signedIn;

  let s = null; // settings being edited
  let week = null; // the built week being fine-tuned

  /* ---------------- settings ---------------- */

  function defaults(pieces) {
    const prefs = store()?.prefs?.() || {};
    const old = plans()?.currentPlan?.();
    const n = clamp(Number(prefs.practiceDays) || 4, 1, 7);
    const spread = { 1: ["Sat"], 2: ["Tue", "Sat"], 3: ["Mon", "Wed", "Fri"], 4: ["Mon", "Tue", "Thu", "Sat"], 5: DAYS.slice(0, 5), 6: DAYS.slice(0, 6), 7: [...DAYS] }[n];
    return {
      goal: old?.goal || (prefs.dreamPiece?.title ? `Towards ${prefs.dreamPiece.title}` : ""),
      pieces: pieces.slice(0, 3).map((p, i) => ({ key: p.key, title: p.title, focus: i === 0 ? "learn" : "polish", on: true })),
      days: old?.days?.map((d) => d.day) || spread,
      mins: Number(old?.mins) || Number(prefs.practiceMins) || 30,
      perDay: null,
      include: { warmup: true, technique: false, sight: false, hardFirst: true },
      remind: { on: false, hour: 17 },
    };
  }
  async function repertoire() {
    try {
      return ((await store()?.listPieces?.()) || [])
        .map((p) => ({ key: p.piece_key, title: p.title || "Untitled", composer: p.composer || "", status: p.status || "learning" }));
    } catch {
      return [];
    }
  }
  /** The saved settings, joined with the current Repertoire (new pieces start off). */
  async function load() {
    const pieces = await repertoire();
    const saved = store()?.prefs?.()?.schedule;
    if (!saved) return { ...defaults(pieces), all: pieces };
    const known = new Map((saved.pieces || []).map((p) => [p.key, p]));
    return {
      ...defaults(pieces),
      ...saved,
      include: { ...defaults(pieces).include, ...(saved.include || {}) },
      remind: { ...defaults(pieces).remind, ...(saved.remind || {}) },
      pieces: pieces.map((p) => ({ key: p.key, title: p.title, focus: known.get(p.key)?.focus || "polish", on: !!known.get(p.key)?.on })),
      all: pieces,
    };
  }
  const minsFor = (st, day) => Number(st.perDay?.[day]) || st.mins;

  /* ---------------- building the week ---------------- */

  async function build(st) {
    let cards = [];
    try {
      cards = (await store()?.listCards?.()) || [];
    } catch {
      cards = [];
    }
    const hardOf = (key) => [...new Set(cards.filter((c) => c.piece_key === key && /again|hard/i.test(String(c.last_grade || ""))).map((c) => Number(c.bar)))].sort((a, b) => a - b);
    const chosen = (st.pieces || []).filter((p) => p.on);
    const days = DAYS.filter((d) => st.days.includes(d));
    const cursor = {}; // where "learn" carries on from, day to day
    for (const p of chosen) {
      const prog = plans()?.progressOf?.(p.key);
      cursor[p.key] = prog?.upTo != null ? prog.upTo + 1 : 1;
    }
    const out = days.map((day, i) => {
      const M = minsFor(st, day);
      const items = [];
      const add = (kind, mins, text, extra = {}) => items.push({ kind, mins: Math.max(2, Math.round(mins)), text, ...extra });
      if (st.include.warmup) add("warmup", clamp(r5(M * 0.12), 5, 10), "Warm-up: slow five-finger patterns, then a scale you know well");
      if (st.include.technique) add("technique", clamp(r5(M * 0.15), 5, 15), TECHNIQUE[i % TECHNIQUE.length]);
      const sight = st.include.sight ? clamp(r5(M * 0.12), 5, 10) : 0;
      const last = i === days.length - 1 && days.length >= 3 && chosen.length;
      const perform = last ? 5 : 0;
      let left = M - sum(items) - sight - perform;
      // two pieces a day at most, taking turns, so each gets real time
      const today = chosen.length <= 2 ? chosen : [0, 1].map((k) => chosen[(i * 2 + k) % chosen.length]).filter((p, k, a) => a.indexOf(p) === k);
      const pieceBlocks = [];
      if (!today.length) {
        if (left > 0) pieceBlocks.push({ kind: "goal", mins: left, text: st.goal ? `Your goal: ${st.goal}` : "Play the music you love, slowly and well" });
      } else {
        const each = Math.max(5, Math.floor(left / today.length));
        for (const p of today) {
          const hard = hardOf(p.key);
          if (p.focus === "learn") {
            const a = cursor[p.key] || 1;
            const span = each >= 20 ? 8 : each >= 12 ? 4 : 2;
            const b = a + span - 1;
            cursor[p.key] = b + 1;
            pieceBlocks.push({ kind: "learn", mins: each, piece_key: p.key, title: p.title, bars: [a, b], text: `New: bars ${a}–${b}, a phrase at a time. Hands separately, then together` });
          } else if (p.focus === "polish") {
            pieceBlocks.push(
              hard.length
                ? { kind: "polish", hard: true, mins: each, piece_key: p.key, title: p.title, bars: hard.slice(0, 4), text: `Hard ${hard.length === 1 ? "bar" : "bars"} ${hard.slice(0, 4).join(", ")}: slowly with the metronome, then in context` }
                : { kind: "polish", mins: each, piece_key: p.key, title: p.title, text: "Play it through, mark where it breaks, then fix that bar until it’s clean three times" }
            );
          } else {
            pieceBlocks.push({ kind: "fresh", mins: each, piece_key: p.key, title: p.title, text: "Play it through once at performance tempo, as if someone is listening" });
          }
        }
        if (st.include.hardFirst) pieceBlocks.sort((x, y) => (y.hard ? 1 : 0) - (x.hard ? 1 : 0));
      }
      items.push(...pieceBlocks);
      if (sight) add("sight", sight, "Sight-read something new: one page, a steady tempo, no stopping");
      if (perform) add("perform", perform, "Play-through: this week’s music start to finish, as a performance");
      // the minutes add up to the day exactly
      const diff = M - sum(items);
      if (diff && items.length) {
        const big = items.reduce((a, b) => (b.mins > a.mins ? b : a));
        big.mins = Math.max(2, big.mins + diff);
      }
      return { day, mins: M, items };
    });
    return out;
  }

  /* ---------------- the sheet ---------------- */

  function sheet() {
    let d = $("sch");
    if (d) return d;
    d = document.createElement("dialog");
    d.id = "sch";
    d.className = "sch";
    d.setAttribute("aria-labelledby", "sch-h");
    document.body.appendChild(d);
    d.addEventListener("click", onClick);
    d.addEventListener("input", onInput);
    d.addEventListener("change", onInput);
    d.addEventListener("cancel", (e) => {
      if (week && !confirmLeave()) e.preventDefault();
    });
    return d;
  }
  const confirmLeave = () => !week?.dirty || confirm("Leave without saving your schedule?");

  async function open() {
    const d = sheet();
    s = await load();
    week = null;
    paintSetup();
    if (!d.open) d.showModal();
    d.scrollTop = 0;
  }

  function head(title, sub) {
    return `<header class="sch-head">
      <div><h2 id="sch-h">${esc(title)}</h2>${sub ? `<p class="sch-sub">${esc(sub)}</p>` : ""}</div>
      <button type="button" class="sch-x" data-sch="close" aria-label="Close"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
    </header>`;
  }
  const stepper = (name, val, label, min = 5, max = 120, step = 5) =>
    `<span class="sch-step" role="group" aria-label="${esc(label)}"><button type="button" data-step="${name}" data-d="-${step}" aria-label="${esc(label)}: less"${val <= min ? " disabled" : ""}>−</button><output>${val} min</output><button type="button" data-step="${name}" data-d="${step}" aria-label="${esc(label)}: more"${val >= max ? " disabled" : ""}>+</button></span>`;

  function paintSetup() {
    const d = sheet();
    const suggestions = [
      ...s.all.slice(0, 2).map((p) => `${p.title}, ready to play through`),
      "Exam pieces secure at full tempo",
      "Sight-read a little every day",
    ].slice(0, 4);
    const total = s.days.reduce((n, day) => n + minsFor(s, day), 0);
    d.innerHTML = `<div class="sch-in">
      ${head("Plan my schedule", "Tell Lune what you want. You can fine-tune every day after.")}

      <section class="sch-sec">
        <h3>What are you working towards?</h3>
        <textarea id="sch-goal" rows="2" maxlength="300" placeholder="e.g. Clair de lune up to bar 27, hands together">${esc(s.goal)}</textarea>
        <div class="sch-chips">${suggestions.map((t) => `<button type="button" data-goal="${esc(t)}">${esc(t)}</button>`).join("")}</div>
      </section>

      <section class="sch-sec">
        <h3>Pieces</h3>
        ${
          s.pieces.length
            ? `<ul class="sch-pieces">${s.pieces
                .map(
                  (p, i) => `<li class="${p.on ? "is-on" : ""}">
                  <label class="sch-check"><input type="checkbox" data-piece-on="${i}"${p.on ? " checked" : ""}><span class="sch-box" aria-hidden="true"></span><span class="sch-pt">${esc(p.title)}<small>${esc(s.all[i]?.composer || "")}</small></span></label>
                  <span class="sch-seg" role="radiogroup" aria-label="${esc(p.title)}: what to do">${FOCUS.map(([v, l]) => `<button type="button" role="radio" data-focus="${i}" data-v="${v}" aria-checked="${p.focus === v}"${p.on ? "" : " disabled"}>${l}</button>`).join("")}</span>
                </li>`
                )
                .join("")}</ul>
              <p class="sch-note">Learn carries on from where you’re up to. Polish works on the bars still hard. Keep fresh is a play-through.</p>`
            : `<p class="sch-note">No pieces in your Repertoire yet. Lune plans around your goal for now; open a score and add it, and it appears here.</p>`
        }
      </section>

      <section class="sch-sec">
        <h3>Days</h3>
        <div class="sch-days" role="group" aria-label="Practice days">${DAYS.map((x) => `<button type="button" data-day="${x}" aria-pressed="${s.days.includes(x)}" aria-label="${DAY_NAMES[x]}">${x.slice(0, 2)}</button>`).join("")}</div>
      </section>

      <section class="sch-sec">
        <h3>Time</h3>
        <div class="sch-seg sch-seg-wide" role="radiogroup" aria-label="Time each day">
          <button type="button" role="radio" data-perday="0" aria-checked="${!s.perDay}">Same every day</button>
          <button type="button" role="radio" data-perday="1" aria-checked="${!!s.perDay}">Day by day</button>
        </div>
        ${
          s.perDay
            ? `<ul class="sch-rows">${DAYS.filter((x) => s.days.includes(x)).map((x) => `<li><span>${DAY_NAMES[x]}</span>${stepper(`day-${x}`, minsFor(s, x), DAY_NAMES[x], 5, 180)}</li>`).join("")}</ul>`
            : `<ul class="sch-rows"><li><span>Each practice day</span>${stepper("mins", s.mins, "Minutes each day", 5, 180)}</li></ul>`
        }
        <p class="sch-note" id="sch-total">${s.days.length ? `${s.days.length} ${s.days.length === 1 ? "day" : "days"}, ${fmtMins(total)} this week.` : "Pick at least one day."}</p>
      </section>

      <section class="sch-sec">
        <h3>Every session includes</h3>
        <ul class="sch-rows">${INCLUDE.map(([k, l, hint]) => `<li><label class="sch-toggle"><span>${l}<small>${hint}</small></span><input type="checkbox" role="switch" data-inc="${k}"${s.include[k] ? " checked" : ""}><span class="sch-sw" aria-hidden="true"></span></label></li>`).join("")}</ul>
      </section>

      <section class="sch-sec">
        <h3>Reminder</h3>
        ${
          signedIn()
            ? `<ul class="sch-rows"><li><label class="sch-toggle"><span>Email me on practice days<small>The day’s plan, at the time you choose</small></span><input type="checkbox" role="switch" id="sch-remind"${s.remind.on ? " checked" : ""}><span class="sch-sw" aria-hidden="true"></span></label></li>
              <li class="sch-hour"${s.remind.on ? "" : " hidden"}><span>At</span><select id="sch-hour" aria-label="Reminder time">${Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === s.remind.hour ? " selected" : ""}>${String(h).padStart(2, "0")}:00</option>`).join("")}</select></li></ul>`
            : `<p class="sch-note">Sign in and Lune can email you the day’s plan.</p>`
        }
      </section>

      <footer class="sch-foot">
        <button type="button" class="sch-quiet" data-sch="close">Cancel</button>
        <button type="button" class="sch-primary" data-sch="build"${s.days.length ? "" : " disabled"}>Build my schedule</button>
      </footer>
    </div>`;
  }

  const fmtMins = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);
  const KIND = { warmup: "Warm-up", technique: "Technique", learn: "Learn", polish: "Polish", fresh: "Keep fresh", sight: "Sight-reading", perform: "Play-through", goal: "Goal", custom: "Your own" };

  function paintWeek() {
    const d = sheet();
    const total = week.days.reduce((n, x) => n + sum(x.items), 0);
    const pcs = (s.pieces || []).filter((p) => p.on).length;
    const today = DAYS[(new Date().getDay() + 6) % 7];
    d.innerHTML = `<div class="sch-in sch-wide">
      ${head("My schedule", `${week.days.length} ${week.days.length === 1 ? "day" : "days"} · ${fmtMins(total)} this week${pcs ? ` · ${pcs} ${pcs === 1 ? "piece" : "pieces"}` : ""}`)}
      ${s.goal ? `<p class="sch-goal">${esc(s.goal)}</p>` : ""}
      <p class="sch-note sch-tune">Change any block: its minutes, its words or its place. Add your own.</p>
      <div class="sch-week">${week.days
        .map(
          (x, di) => `<article class="sch-day${x.day === today ? " is-today" : ""}" data-di="${di}">
          <header><h3>${DAY_NAMES[x.day]}${x.day === today ? "<span>Today</span>" : ""}</h3><p class="sch-dt">${fmtMins(sum(x.items))}</p></header>
          <ol>${x.items
            .map(
              (it, ii) => `<li class="sch-item k-${it.kind}" data-ii="${ii}">
              <div class="sch-item-top"><span class="sch-kind">${esc(KIND[it.kind] || "")}${it.title ? ` · ${esc(it.title)}` : ""}</span>
                <span class="sch-ops"><button type="button" data-op="up" aria-label="Move up"${ii === 0 ? " disabled" : ""}><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button type="button" data-op="down" aria-label="Move down"${ii === x.items.length - 1 ? " disabled" : ""}><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button type="button" data-op="del" aria-label="Remove this block"><svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></span></div>
              <textarea rows="2" maxlength="200" data-text aria-label="What to do">${esc(it.text)}</textarea>
              ${stepper(`item`, it.mins, "Minutes", 2, 120, it.mins <= 5 ? 1 : 5)}
            </li>`
            )
            .join("")}</ol>
          <button type="button" class="sch-add" data-op="add">+ Add a block</button>
        </article>`
        )
        .join("")}</div>
      <footer class="sch-foot">
        <button type="button" class="sch-quiet" data-sch="back">Back to settings</button>
        <button type="button" class="sch-primary" data-sch="save">Save schedule</button>
      </footer>
    </div>`;
    d.querySelectorAll(".sch-item textarea").forEach(grow);
  }
  function grow(t) {
    t.style.height = "auto";
    const h = t.scrollHeight;
    if (h) t.style.height = `${Math.min(140, h)}px`;
    else requestAnimationFrame(() => t.scrollHeight && grow(t));
  }

  /* ---------------- events ---------------- */

  function readGoal() {
    const g = $("sch-goal");
    if (g) s.goal = g.value.trim();
  }
  async function onClick(e) {
    const d = sheet();
    if (e.target === d) {
      if (confirmLeave()) d.close();
      return;
    }
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    const act = b.dataset.sch;
    if (act === "close") {
      if (confirmLeave()) d.close();
      return;
    }
    if (act === "back") {
      paintSetup();
      return;
    }
    if (act === "build") {
      readGoal();
      b.disabled = true;
      b.textContent = "Building…";
      const days = await build(s);
      week = { days, dirty: false };
      paintWeek();
      d.scrollTop = 0;
      return;
    }
    if (act === "save") return save(b);
    if (b.dataset.goal) {
      s.goal = b.dataset.goal;
      const g = $("sch-goal");
      if (g) g.value = s.goal;
      return;
    }
    if (b.dataset.day) {
      readGoal();
      const x = b.dataset.day;
      s.days = s.days.includes(x) ? s.days.filter((y) => y !== x) : DAYS.filter((y) => y === x || s.days.includes(y));
      return paintKeep(paintSetup);
    }
    if (b.dataset.perday != null) {
      readGoal();
      s.perDay = b.dataset.perday === "1" ? Object.fromEntries(s.days.map((x) => [x, minsFor(s, x)])) : null;
      return paintKeep(paintSetup);
    }
    if (b.dataset.focus != null) {
      s.pieces[Number(b.dataset.focus)].focus = b.dataset.v;
      b.parentElement.querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      return;
    }
    if (b.dataset.step) {
      const dlt = Number(b.dataset.d);
      if (b.dataset.step === "item") {
        const [di, ii] = where(b);
        const it = week.days[di].items[ii];
        it.mins = clamp(it.mins + dlt, 2, 120);
        week.dirty = true;
        return paintKeep(paintWeek);
      }
      readGoal();
      if (b.dataset.step === "mins") s.mins = clamp(s.mins + dlt, 5, 180);
      else {
        const x = b.dataset.step.slice(4);
        s.perDay[x] = clamp(minsFor(s, x) + dlt, 5, 180);
      }
      return paintKeep(paintSetup);
    }
    if (b.dataset.op) {
      const [di, ii] = where(b);
      const items = week.days[di].items;
      if (b.dataset.op === "add") {
        items.push({ kind: "custom", mins: 5, text: "" });
        week.dirty = true;
        paintKeep(paintWeek);
        const t = sheet().querySelector(`.sch-day[data-di="${di}"] .sch-item:last-child textarea`);
        t?.focus();
        return;
      }
      if (b.dataset.op === "del") items.splice(ii, 1);
      if (b.dataset.op === "up" && ii > 0) [items[ii - 1], items[ii]] = [items[ii], items[ii - 1]];
      if (b.dataset.op === "down" && ii < items.length - 1) [items[ii + 1], items[ii]] = [items[ii], items[ii + 1]];
      week.dirty = true;
      return paintKeep(paintWeek);
    }
  }
  function where(el) {
    return [Number(el.closest("[data-di]")?.dataset.di), Number(el.closest("[data-ii]")?.dataset.ii)];
  }
  /** Repaint without losing the reader's place. */
  function paintKeep(fn) {
    const d = sheet();
    const top = d.scrollTop;
    const focusSel = document.activeElement?.closest?.("#sch") ? selectorFor(document.activeElement) : null;
    fn();
    d.scrollTop = top;
    if (focusSel) d.querySelector(focusSel)?.focus({ preventScroll: true });
  }
  function selectorFor(el) {
    const ds = el.dataset || {};
    for (const k of ["day", "perday", "step", "focus", "op", "goal"]) {
      if (ds[k] != null) {
        const di = el.closest("[data-di]")?.dataset.di;
        const ii = el.closest("[data-ii]")?.dataset.ii;
        const scope = di != null ? `.sch-day[data-di="${di}"] ${ii != null ? `.sch-item[data-ii="${ii}"] ` : ""}` : "";
        const extra = ds.d ? `[data-d="${ds.d}"]` : ds.v ? `[data-v="${ds.v}"]` : "";
        return `${scope}[data-${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}="${CSS.escape(ds[k])}"]${extra}`;
      }
    }
    return null;
  }
  function onInput(e) {
    const t = e.target;
    if (t.id === "sch-goal") s.goal = t.value;
    if (t.dataset.pieceOn != null) {
      readGoal();
      s.pieces[Number(t.dataset.pieceOn)].on = t.checked;
      return paintKeep(paintSetup);
    }
    if (t.dataset.inc) s.include[t.dataset.inc] = t.checked;
    if (t.id === "sch-remind") {
      s.remind.on = t.checked;
      const row = sheet().querySelector(".sch-hour");
      if (row) row.hidden = !t.checked;
    }
    if (t.id === "sch-hour") s.remind.hour = Number(t.value);
    if (t.matches?.("[data-text]")) {
      const [di, ii] = where(t);
      week.days[di].items[ii].text = t.value;
      week.dirty = true;
      grow(t);
    }
  }

  /** Keep a week and the settings it was built from. */
  function persist(st, builtDays) {
    const days = builtDays.map((x) => ({ ...x, items: x.items.filter((it) => String(it.text || "").trim()) })).map((x) => ({ ...x, mins: sum(x.items) }));
    const avg = Math.round(days.reduce((n, x) => n + x.mins, 0) / Math.max(1, days.length));
    const plan = { week: store()?.weekStartKey?.() || "", goal: st.goal || "This week’s practice", mins: avg, days, via: "schedule", done: plans()?.currentPlan?.()?.done || {}, at: new Date().toISOString() };
    const { all, ...settings } = st;
    store()?.setPref?.("weekPlan", plan);
    store()?.setPref?.("schedule", { ...settings, pieces: (settings.pieces || []).map(({ key, title, focus, on }) => ({ key, title, focus, on })) });
    if (plans()?.planMode?.() !== "plan") plans()?.setPlanMode?.("plan");
    store()?.syncPrefs?.()?.catch?.(() => {});
    document.dispatchEvent(new CustomEvent("lune:plan-mode", { detail: { mode: "plan" } }));
    return plan;
  }
  /** Open the planner on a week already built (from Lune AI), ready to fine-tune. */
  async function openWeek(st, days) {
    const d = sheet();
    s = st.all ? st : { ...(await load()), ...st };
    week = { days: JSON.parse(JSON.stringify(days)), dirty: false };
    if (!d.open) d.showModal();
    paintWeek(); // after it opens, so each block's text is measured at its real size
    d.scrollTop = 0;
  }

  async function save(btn) {
    btn.disabled = true;
    btn.textContent = "Saving…";
    persist(s, week.days);
    if (signedIn()) {
      const idx = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      try {
        await store()?.setDailyEmail?.(!!s.remind.on, { hour: s.remind.hour, kind: "student", days: s.days.map((x) => idx[x]) });
      } catch (err) {
        if (s.remind.on) toast(err?.message || "The schedule is saved; the reminder couldn’t be set just now.");
      }
    }
    week.dirty = false;
    sheet().close();
    toast("Your schedule is saved");
    document.dispatchEvent(new CustomEvent("lune:plan-mode", { detail: { mode: "plan" } }));
    try {
      window.LuneOnboard?.paintSignedHome?.();
    } catch {
      /* not on the home */
    }
    if (/repertoire/.test(location.hash)) window.LunePractice?.showRepertoire?.();
  }

  /** A new week, built the way the pianist set it up last time. */
  async function rebuildForWeek() {
    const saved = store()?.prefs?.()?.schedule;
    if (!saved) return false;
    const st = await load();
    const days = await build(st);
    const avg = Math.round(days.reduce((n, x) => n + sum(x.items), 0) / Math.max(1, days.length));
    store()?.setPref?.("weekPlan", { week: store()?.weekStartKey?.() || "", goal: st.goal || "This week’s practice", mins: avg, days: days.map((x) => ({ ...x, mins: sum(x.items) })), via: "schedule", done: {}, at: new Date().toISOString() });
    store()?.syncPrefs?.()?.catch?.(() => {});
    return true;
  }

  return { open, openWeek, build, persist, rebuildForWeek, load, fmtMins: (m) => fmtMins(m) };
})();
