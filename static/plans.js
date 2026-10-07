/* Progress, practice summaries and the week's plan.
 *
 * - Progress: how far through a piece the pianist says they are ("I can play up
 *   to bar 24"). Shown as a bar on each Repertoire card.
 * - Practice summaries: after a session where the pianist asked Lune questions
 *   or left remarks, Lune writes a short summary onto the piece in Repertoire.
 * - The week's plan: a few questions, then a day-by-day plan across the
 *   Repertoire, which can be shared as a Lune link.
 * Lune AI writes the summary and the plan when it is on; otherwise Lune's
 * built-in rules do, and each says which.
 */
window.LunePlans = (function () {
  const $ = (id) => document.getElementById(id);
  const store = () => window.LuneStore;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const toast = (m) => window.toast?.(m);
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const DAY_NAMES = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

  /* ---------------- progress ---------------- */
  function allProgress() {
    return store()?.prefs?.()?.pieceProgress || {};
  }
  function progressOf(key) {
    const p = allProgress()[key];
    if (!p) return null;
    const pct = p.of ? Math.round((Math.min(p.upTo, p.of) / p.of) * 100) : Math.round(p.pct || 0);
    return { ...p, pct: Math.max(0, Math.min(100, pct)) };
  }
  function setProgress(key, { upTo = null, of = null, pct = null } = {}) {
    if (!key) return;
    const all = { ...allProgress() };
    const prev = all[key] || {};
    all[key] = {
      upTo: upTo != null ? Math.max(0, Math.round(upTo)) : prev.upTo ?? null,
      of: of != null ? Math.round(of) : prev.of ?? null,
      pct: pct != null ? Math.round(pct) : null,
      at: new Date().toISOString(),
    };
    store().setPref("pieceProgress", all);
    store().syncPrefs?.();
  }
  function progressLabel(p) {
    if (!p) return "";
    if (p.of && p.upTo != null) return p.upTo >= p.of ? "Whole piece" : `Up to bar ${p.upTo} of ${p.of}`;
    return `${p.pct}% learned`;
  }

  /* ---------------- practice summaries ---------------- */
  let session = null; // { key, title, start, questions, notes }
  function noteActivity(kind, { key, title } = {}) {
    if (!key) return;
    if (session && session.key !== key) flushSummary();
    if (!session) session = { key, title, start: Date.now(), questions: 0, notes: 0 };
    if (kind === "question") session.questions += 1;
    if (kind === "note") session.notes += 1;
  }
  async function flushSummary() {
    const s = session;
    session = null;
    if (!s || !(s.questions + s.notes)) return null;
    let asked = [];
    try {
      asked = JSON.parse(localStorage.getItem(`lune.ask.${s.key}`) || "[]").filter((h) => h.t >= s.start);
    } catch {
      asked = [];
    }
    const notes = ((await store().listNotes(s.key).catch(() => [])) || []).filter((n) => Date.parse(n.created_at) >= s.start - 1000);
    const bars = [...new Set([...asked.map((h) => h.bar), ...notes.map((n) => n.bar)].filter((b) => b > 0))].sort((a, b) => a - b);
    let text = "";
    let via = "rules";
    const model = window.LuneAIProvider?.connected?.();
    if (model && (asked.length || notes.length)) {
      try {
        const ctx = {
          piece: s.title,
          questionsAndAnswers: asked.slice(-8).map((h) => ({ bar: h.bar || null, question: h.q, answer: String(h.a || "").slice(0, 400) })),
          remarks: notes.slice(-10).map((n) => ({ bar: n.bar, text: n.body })),
        };
        text = await window.LuneAsk.askModel(
          "Write two short sentences to the pianist, addressing them as you: what you worked on (with bar numbers) and one concrete next step. Use only the facts given. Never mention context, data or missing information. If there is nothing to summarise, reply with the single word NONE.",
          ctx
        );
        if (!usableSummary(text)) text = "";
        if (text) via = "model";
      } catch {
        text = "";
      }
    }
    if (!text && !asked.length && !notes.length) return null;
    if (!text) {
      const parts = [];
      if (asked.length) parts.push(`${asked.length} question${asked.length === 1 ? "" : "s"}`);
      if (notes.length) parts.push(`${notes.length} remark${notes.length === 1 ? "" : "s"}`);
      const last = notes[notes.length - 1];
      text = `${parts.join(" and ")}${bars.length ? ` on bar${bars.length === 1 ? "" : "s"} ${bars.slice(0, 6).join(", ")}` : ""}.${last ? ` Last remark: “${String(last.body).slice(0, 120)}”` : ""}`;
      text = text[0].toUpperCase() + text.slice(1);
    }
    const all = { ...(store().prefs()?.pieceSummaries || {}) };
    all[s.key] = { text: String(text).slice(0, 600), at: new Date().toISOString(), via, bars };
    store().setPref("pieceSummaries", all);
    store().syncPrefs?.();
    return all[s.key];
  }
  // a model reply that talks about itself or its inputs is not a summary
  function usableSummary(t) {
    const x = String(t || "").trim();
    return !!x && !/^none\b/i.test(x) && !/\bcontext\b|does not (have|contain)|no information|not specified|not provided|the pianist|as an ai/i.test(x);
  }
  function summaryOf(key) {
    const s = store()?.prefs?.()?.pieceSummaries?.[key] || null;
    return s && usableSummary(s.text) ? s : null;
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSummary();
  });

  /* ---------------- the week's plan ---------------- */
  function weekStart() {
    return store()?.weekStartKey?.() || "";
  }
  function currentPlan() {
    const p = store()?.prefs?.()?.weekPlan;
    return p && p.week === weekStart() ? p : null;
  }

  async function builtInPlan({ goal, days, mins }) {
    const pieces = ((await store().listPieces().catch(() => [])) || []).filter((p) => (p.status || "learning") !== "ready");
    const cards = (await store().listCards().catch(() => [])) || [];
    const hardOf = (key) => cards.filter((c) => c.piece_key === key && /again|hard/i.test(String(c.last_grade || ""))).map((c) => c.bar).sort((a, b) => a - b);
    const list = pieces.length ? pieces : [];
    const plan = days.map((d, i) => {
      if (!list.length) return { day: d, items: [{ text: `${mins} minutes on your goal: ${goal}` }] };
      const p = list[i % list.length];
      const prog = progressOf(p.piece_key);
      const hard = hardOf(p.piece_key);
      const items = [];
      if (hard.length) items.push({ piece_key: p.piece_key, title: p.title, bars: hard.slice(0, 3), text: `Hard bar${hard.length === 1 ? "" : "s"} ${hard.slice(0, 3).join(", ")}, slowly, hands separately` });
      if (prog?.upTo != null && (!prog.of || prog.upTo < prog.of)) {
        const a = prog.upTo + 1;
        const b = prog.of ? Math.min(prog.of, a + 7) : a + 7;
        items.push({ piece_key: p.piece_key, title: p.title, bars: [a, b], text: `New: bars ${a} to ${b}, a phrase at a time` });
      } else items.push({ piece_key: p.piece_key, title: p.title, text: "Play it through once, then fix the first bar that breaks" });
      return { day: d, items };
    });
    return plan;
  }

  function parseModelPlan(text, days) {
    const out = [];
    for (const line of String(text || "").split(/\n+/)) {
      const m = line.match(/^\s*\**\s*(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\.?\**\s*[:\-–]\s*(.+)$/i);
      if (!m) continue;
      const d = DAYS.find((x) => x.toLowerCase() === m[1].slice(0, 3).toLowerCase());
      if (!days.includes(d) || out.some((o) => o.day === d)) continue;
      out.push({ day: d, items: m[2].split(/;\s*/).filter(Boolean).map((t) => ({ text: t.trim() })) });
    }
    return out.length >= Math.max(1, days.length - 1) ? days.map((d) => out.find((o) => o.day === d) || { day: d, items: [{ text: "Rest, or play something you love" }] }) : null;
  }

  async function makePlan(answers) {
    let days = null;
    let via = "rules";
    if (window.LuneAIProvider?.connected?.()) {
      try {
        const ctx = await window.LuneAsk.buildChatContext([]);
        ctx.progress = Object.fromEntries(Object.entries(allProgress()).map(([k, v]) => [k, progressLabel(progressOf(k))]));
        const text = await window.LuneAsk.askModel(
          `Make this pianist's practice plan for this week. Their goal: "${answers.goal}". They can practise on ${answers.days.map((d) => DAY_NAMES[d]).join(", ")}, about ${answers.mins} minutes each day. Use their Repertoire, progress, plans and bars still hard from CONTEXT. Write exactly one line per practice day, in the form "Mon: task; task", naming pieces and bar numbers from CONTEXT. No other text.`,
          ctx
        );
        days = parseModelPlan(text, answers.days);
        if (days) via = "model";
      } catch {
        days = null;
      }
    }
    if (!days) days = await builtInPlan(answers);
    const plan = { week: weekStart(), goal: answers.goal, mins: answers.mins, days, via, done: {}, at: new Date().toISOString() };
    store().setPref("weekPlan", plan);
    store().syncPrefs?.();
    return plan;
  }

  function toggleDay(day) {
    const p = currentPlan();
    if (!p) return;
    p.done = { ...(p.done || {}), [day]: !p.done?.[day] };
    store().setPref("weekPlan", p);
    store().syncPrefs?.();
  }

  /** The week plan, drawn into a host (Repertoire). */
  function planHtml(p) {
    if (!p) return "";
    const today = DAYS[(new Date().getDay() + 6) % 7];
    return `<div class="wp">
      <p class="wp-goal">${esc(p.goal)}</p>
      <p class="wp-by">${p.via === "model" ? "Planned with Lune AI" : "Planned by Lune"} · ${esc(p.mins)} min a day</p>
      <ol class="wp-days">${p.days
        .map(
          (d) => `<li class="wp-day${d.day === today ? " today" : ""}${p.done?.[d.day] ? " done" : ""}">
            <button type="button" class="wp-check" data-wp-day="${d.day}" aria-pressed="${!!p.done?.[d.day]}" aria-label="${DAY_NAMES[d.day]} done"></button>
            <div><p class="wp-dname">${DAY_NAMES[d.day]}${d.day === today ? " · today" : ""}</p>
            <ul>${d.items.map((it) => `<li>${it.title ? `<strong>${esc(it.title)}</strong> · ` : ""}${esc(it.text)}</li>`).join("")}</ul></div>
          </li>`
        )
        .join("")}</ol>
      <div class="wp-actions"><button type="button" class="quiet" data-wp-share>Share plan</button><button type="button" class="link-btn" data-wp-new>Make a new plan</button></div>
    </div>`;
  }

  /** "Make my week's plan": two short questions, then the plan. */
  function openWizard() {
    let d = $("wp-dialog");
    if (!d) {
      d = document.createElement("dialog");
      d.id = "wp-dialog";
      d.className = "wp-dialog";
      d.setAttribute("aria-labelledby", "wp-h");
      document.body.appendChild(d);
    }
    const prefs = store().prefs() || {};
    const n = Number(prefs.practiceDays) || 4;
    const pick = new Set(DAYS.slice(0, n));
    const mins = Number(prefs.practiceMins) || 30;
    d.innerHTML = `<form method="dialog" class="wp-form" id="wp-form">
        <span class="lune-orb-sm" aria-hidden="true"></span>
        <h2 id="wp-h">Plan my week</h2>
        <label for="wp-goal">What do you want to get done this week?</label>
        <textarea id="wp-goal" rows="3" required maxlength="300" placeholder="e.g. Für Elise up to bar 30, hands together"></textarea>
        <p class="wp-q">Which days?</p>
        <div class="wp-daypick" role="group" aria-label="Practice days">${DAYS.map((x) => `<button type="button" data-day="${x}" aria-pressed="${pick.has(x)}">${x[0]}${x[1]}</button>`).join("")}</div>
        <label for="wp-mins">Minutes a day</label>
        <select id="wp-mins">${[10, 15, 20, 30, 45, 60, 90].map((m) => `<option ${m === mins ? "selected" : ""}>${m}</option>`).join("")}</select>
        <div class="wp-go"><button type="button" class="quiet" value="cancel" data-wp-cancel>Cancel</button><button type="submit" class="primary">Make my plan</button></div>
      </form>`;
    d.querySelector(".wp-daypick").addEventListener("click", (e) => {
      const b = e.target.closest("[data-day]");
      if (b) b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true");
    });
    d.querySelector("[data-wp-cancel]").addEventListener("click", () => d.close());
    d.querySelector("#wp-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const goal = d.querySelector("#wp-goal").value.trim();
      const days = [...d.querySelectorAll("[data-day][aria-pressed=true]")].map((b) => b.dataset.day);
      if (!goal) return d.querySelector("#wp-goal").focus();
      if (!days.length) return toast("Pick at least one day");
      const go = d.querySelector("[type=submit]");
      go.disabled = true;
      go.textContent = "Planning…";
      try {
        await makePlan({ goal, days, mins: Number(d.querySelector("#wp-mins").value) || 30 });
        d.close();
        toast("Your week is planned");
        window.LunePractice?.showRepertoire?.();
      } finally {
        go.disabled = false;
        go.textContent = "Make my plan";
      }
    });
    if (!d.open) d.showModal();
    setTimeout(() => d.querySelector("#wp-goal")?.focus(), 40);
  }

  /* ---------------- sharing ---------------- */
  async function shareLink(payload, title) {
    if (store().status?.().mode !== "cloud") {
      toast("Sharing a link needs a free account. Sign in from Settings.");
      return null;
    }
    const row = await store().createShareLink({ ...payload, madeWith: "Lune", displayName: store().prefs()?.displayName || "A Lune pianist" });
    const url = `${location.origin}${location.pathname.replace(/\/$/, "")}/#share/${row.token}`;
    try {
      if (navigator.share) await navigator.share({ title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast("Link copied");
      }
    } catch {
      /* the share sheet was closed */
    }
    return url;
  }
  async function sharePlan() {
    const p = currentPlan();
    if (!p) return;
    await shareLink({ kind: "weekplan", goal: p.goal, mins: p.mins, days: p.days, week: p.week, done: p.done }, "My practice week on Lune");
  }
  /** Share how far through a piece: asks only when Lune doesn't already know. */
  async function shareProgress(key, title, ofBars) {
    let p = progressOf(key);
    if (!p) {
      const ans = await askUpTo(title, ofBars);
      if (ans == null) return;
      setProgress(key, ans);
      p = progressOf(key);
    }
    const s = summaryOf(key);
    await shareLink({ kind: "piece", title, progress: progressLabel(p), pct: p.pct, summary: s?.text || "" }, `${title} on Lune`);
  }
  function askUpTo(title, ofBars, { button = "Save and share" } = {}) {
    return new Promise((resolve) => {
      let d = $("wp-upto");
      if (!d) {
        d = document.createElement("dialog");
        d.id = "wp-upto";
        d.className = "wp-dialog";
        document.body.appendChild(d);
      }
      const of = Number(ofBars) || 0;
      d.innerHTML = `<form class="wp-form" id="wp-upto-form">
          <h2>How far through ${esc(title)}?</h2>
          ${of ? `<label for="wp-upto-bar">I can play up to bar <output id="wp-upto-out">${Math.round(of / 3)}</output> of ${of}</label><input id="wp-upto-bar" type="range" min="0" max="${of}" value="${Math.round(of / 3)}">` : `<label for="wp-upto-pct">About <output id="wp-upto-out">30</output>% of it</label><input id="wp-upto-pct" type="range" min="0" max="100" step="5" value="30">`}
          <div class="wp-go"><button type="button" class="quiet" data-x>Cancel</button><button type="submit" class="primary">${esc(button)}</button></div>
        </form>`;
      const range = d.querySelector("input[type=range]");
      range.addEventListener("input", () => (d.querySelector("#wp-upto-out").textContent = range.value));
      d.querySelector("[data-x]").addEventListener("click", () => {
        d.close();
        resolve(null);
      });
      d.querySelector("form").addEventListener("submit", (e) => {
        e.preventDefault();
        d.close();
        resolve(of ? { upTo: Number(range.value), of } : { pct: Number(range.value) });
      });
      d.showModal();
    });
  }

  /** Mark how far through a piece, from Repertoire. */
  async function editProgress(key, title) {
    const p = progressOf(key);
    const ans = await askUpTo(title, p?.of || 0, { button: "Save" });
    if (ans == null) return false;
    setProgress(key, ans);
    return true;
  }

  /** The public page for a shared plan or piece. Returns true when it drew one. */
  function renderShare(page, p) {
    const MARK = '<svg class="lune-mark" viewBox="0 0 40 40" width="36" height="36" aria-hidden="true"><path fill="currentColor" d="M17.61 4.58A12 12 0 1 0 27.70 24.77A11.4 11.4 0 1 1 17.61 4.58Z"/></svg>';
    if (p.kind === "weekplan") {
      page.innerHTML = `<section class="share-inner">${MARK}<p class="share-kicker">Practice week</p><h1>${esc(p.displayName || "A Lune pianist")}</h1>
        ${planHtml({ ...p, via: "rules" }).replace(/<div class="wp-actions">[\s\S]*?<\/div>/, "").replace(/<p class="wp-by">[\s\S]*?<\/p>/, `<p class="wp-by">${esc(p.mins)} min a day</p>`)}
        <p class="share-foot"><a href="${esc(location.pathname)}">Made with Lune</a> · free, no ads</p></section>`;
      page.querySelectorAll(".wp-check").forEach((b) => (b.disabled = true));
      return true;
    }
    if (p.kind === "piece") {
      page.innerHTML = `<section class="share-inner">${MARK}<p class="share-kicker">${esc(p.displayName || "A Lune pianist")} is learning</p><h1>${esc(p.title)}</h1>
        <div class="rp-bar rp-bar-lg" role="img" aria-label="${esc(p.progress)}"><i style="width:${Number(p.pct) || 0}%"></i></div>
        <p class="share-lead">${esc(p.progress)}</p>
        ${p.summary ? `<p class="share-lead">${esc(p.summary)}</p>` : ""}
        <p class="share-foot"><a href="${esc(location.pathname)}">Made with Lune</a> · free, no ads</p></section>`;
      return true;
    }
    return false;
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest?.("[data-wp-open], [data-wp-new]")) {
      e.preventDefault();
      openWizard();
    }
    const day = e.target.closest?.("[data-wp-day]");
    if (day && !day.disabled) {
      toggleDay(day.dataset.wpDay);
      day.setAttribute("aria-pressed", day.getAttribute("aria-pressed") === "true" ? "false" : "true");
      day.closest(".wp-day")?.classList.toggle("done");
    }
    if (e.target.closest?.("[data-wp-share]")) sharePlan();
  });

  return { editProgress, progressOf, setProgress, progressLabel, noteActivity, flushSummary, summaryOf, currentPlan, makePlan, planHtml, openWizard, sharePlan, shareProgress, renderShare, builtInPlan, parseModelPlan };
})();
