/* Lune — practice evidence loop: streak, weekly review, tonight’s plan,
 * shareable progress, invite, owner impact. Additive; calm; no clutter. */
window.LuneImpact = (function () {
  const store = () => window.LuneStore;
  const $ = (id) => document.getElementById(id);
  const INVITE_KEY = "lune.invite";
  const MARK = `<svg class="lune-mark impact-mark" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17.61 4.58A12 12 0 1 0 27.70 24.77A11.4 11.4 0 1 1 17.61 4.58Z"/></svg>`;

  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  function toast(msg) {
    window.toast?.(msg);
  }

  function dialog(id, className) {
    let d = $(id);
    if (!d) {
      d = document.createElement("dialog");
      d.id = id;
      document.body.appendChild(d);
    }
    d.className = className || "credits-dialog auth-dialog impact-dialog";
    return d;
  }

  const closeRow = `<form method="dialog" class="credits-close-row">
    <button type="submit" class="icon-btn" aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
  </form>`;

  function markInvite() {
    try {
      sessionStorage.setItem(INVITE_KEY, "1");
    } catch {
      /* private mode */
    }
  }

  function clearInvite() {
    try {
      sessionStorage.removeItem(INVITE_KEY);
    } catch {
      /* ignore */
    }
  }

  function hasInvite() {
    try {
      return sessionStorage.getItem(INVITE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function weekRangeLabel(weekKey) {
    const start = new Date(`${weekKey}T12:00:00`);
    if (Number.isNaN(start.getTime())) return weekKey || "";
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${fmt(start)} – ${fmt(end)}`;
  }

  function encouragement(snap) {
    if (!snap.days) return "The week is still open. One quiet session is enough to begin.";
    if (snap.days >= snap.goalDays) return "You met the rhythm you set. That is how pieces settle.";
    if (snap.good > snap.hard) return "More bars moving toward Good than Hard — keep the light on.";
    if (snap.hard >= 1) return "Hard bars are information, not failure. Meet them again tonight.";
    return "Show up once more this week. Small sessions still count.";
  }

  /** No schedule: the pieces in progress, with where each stands and Lune AI's last summary. */
  async function piecesOverviewHtml() {
    const s = store();
    const pieces = ((await s?.listPieces?.().catch?.(() => [])) || []).filter((p) => (p.status || "learning") !== "ready").slice(0, 4);
    if (!pieces.length) return `<span class="wk-k">Your pieces</span><span class="wk-q">Open any score and press Save to keep it here.</span>`;
    const label = { learning: "Learning", polishing: "Polishing", ready: "Ready", paused: "Paused" };
    return `<span class="wk-k">Your pieces</span><span class="po">${pieces
      .map((p) => {
        const sum = window.LunePlans?.summaryOf?.(p.piece_key);
        const prog = window.LunePlans?.progressOf?.(p.piece_key);
        return `<button type="button" class="po-piece" data-open="${esc(p.piece_key)}">
          <span class="po-top"><span class="po-title">${esc(p.title)}</span><span class="po-st">${esc(label[p.status] || "Learning")}</span></span>
          <span class="po-bar"><i style="width:${prog?.pct ?? 0}%"></i></span>
          ${sum ? `<span class="po-sum"><span class="la-tag">${sum.via === "model" ? "@Lune AI" : "@Last session"}</span> ${esc(sum.text)}</span>` : `<span class="po-sum po-dim">No session summary yet. It appears after you practise.</span>`}
        </button>`;
      })
      .join("")}</span>`;
  }
  document.addEventListener("lune:plan-mode", () => paintHomeImpact().catch?.(() => {}));
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.(".po-piece[data-open]");
    if (b) window.LunePractice?.openFromRepertoire?.(b.dataset.open);
  });
  /** This week as a bar: days practised (or ticked off in the plan) out of the goal. */
  function weekBarHtml() {
    const s = store();
    const snap = s?.weekSnapshot?.() || { days: 0, goalDays: 4 };
    const plan = window.LunePlans?.currentPlan?.();
    const ticked = plan ? Object.values(plan.done || {}).filter(Boolean).length : 0;
    const goal = Math.max(1, plan?.days?.length || snap.goalDays || 4);
    const done = Math.min(goal, Math.max(snap.days || 0, ticked));
    const pct = Math.round((done / goal) * 100);
    return `<span class="wk-top"><span class="wk-k">This week</span><span class="wk-n">${done} of ${goal} day${goal === 1 ? "" : "s"}</span></span>
      <span class="wk-bar" role="progressbar" aria-label="Practice days this week" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${done}"><i style="width:${pct}%"></i></span>
      <span class="wk-days" aria-hidden="true">${Array.from({ length: goal }, (_, i) => `<b class="${i < done ? "on" : ""}"></b>`).join("")}</span>`;
  }
  function streakLine() {
    const s = store();
    if (!s?.weekSnapshot) return "";
    const snap = s.weekSnapshot();
    const goal = snap.goalDays || 4;
    return `${snap.days} day${snap.days === 1 ? "" : "s"} this week · goal ${goal}`;
  }

  async function topStumbles(limit = 5) {
    const s = store();
    const pieces = (await s.listPieces?.().catch?.(() => [])) || [];
    // Prefer recently practised pieces first.
    const sorted = [...pieces].sort((a, b) =>
      String(b.last_practised_at || "").localeCompare(String(a.last_practised_at || ""))
    );
    const byPiece = {};
    for (const p of sorted) {
      const map = (await s.stumbleMap?.(p.piece_key).catch?.(() => ({}))) || {};
      const ranked = Object.entries(map)
        .map(([bar, v]) => ({
          piece_key: p.piece_key,
          title: p.title,
          bar: Number(bar),
          score: (v.wrong || 0) + 2 * (v.hesitations || 0),
        }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
      if (ranked[0]) byPiece[p.piece_key] = ranked;
    }
    const flat = Object.values(byPiece).flat().sort((a, b) => b.score - a.score);
    return { flat: flat.slice(0, limit), byPiece };
  }

  async function ensurePiece({ pieceKey, title, composer } = {}) {
    const s = store();
    if (!pieceKey || !s?.addPiece) return;
    try {
      const existing = await s.getPiece?.(pieceKey);
      if (existing) return;
      await s.addPiece({
        piece_key: pieceKey,
        title: title || pieceKey,
        composer: composer || "",
        source: "catalogue",
      });
    } catch {
      /* non-fatal */
    }
  }

  async function openTonightPractice(made) {
    if (!made?.piece_key) return;
    const practice = window.LunePractice;
    if (!practice?.openFromRepertoire) {
      toast("Tonight’s plan is in your Repertoire");
      return;
    }
    try {
      await practice.openFromRepertoire(made.piece_key, { bars: made.bars || [] });
    } catch (err) {
      toast(err?.message || "Open the piece from Repertoire to begin");
    }
  }

  async function buildTonightPlan({ pieceKey, title, composer, stats, open = true } = {}) {
    const s = store();
    const mins = Number(s.prefs?.()?.practiceMins) || 30;
    let key = pieceKey;
    let t = title;
    let c = composer;
    let map = stats;

    if (!key) {
      const pieces = (await s.listPieces?.()) || [];
      const sorted = [...pieces].sort((a, b) =>
        String(b.last_practised_at || "").localeCompare(String(a.last_practised_at || ""))
      );
      for (const p of sorted) {
        const m = await s.stumbleMap?.(p.piece_key);
        const hits = Object.entries(m || {}).filter(([, v]) => (v.wrong || 0) + (v.hesitations || 0) > 0);
        if (hits.length) {
          key = p.piece_key;
          t = p.title;
          c = p.composer;
          map = m;
          break;
        }
      }
    }
    if (!key || !map) return null;

    const hard = Object.entries(map)
      .map(([bar, v]) => ({ bar: Number(bar), score: (v.wrong || 0) + 2 * (v.hesitations || 0) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!hard.length) return null;

    const pick = hard.slice(0, 4).map((x) => x.bar);
    const easy = Math.max(1, Math.min(...pick) - 1);
    if (!pick.includes(easy)) pick.push(easy);
    pick.sort((a, b) => a - b);

    await ensurePiece({ pieceKey: key, title: t, composer: c });

    const notes = `Tonight’s ${mins} minutes — hear once, then work the hard bars slowly. Confidence bar ${easy} included.`;
    const task = s.addTask({
      piece_key: key,
      title: t || "Practice",
      composer: c || "",
      bars: pick.slice(0, 5),
      notes,
      plan: {
        source: "tonight",
        mins,
        steps: [
          { kind: "hear", label: "Hear once" },
          { kind: "hard", bars: pick.filter((b) => b !== easy), label: "Hard bars slowly" },
          { kind: "easy", bars: [easy], label: "Confidence bar" },
        ],
        created_at: new Date().toISOString(),
      },
    });
    s.logActivity?.({ kind: "tonight", piece_key: key, mins: 0 });
    const made = { task, mins, bars: pick, title: t, piece_key: key };
    if (open) await openTonightPractice(made);
    return made;
  }

  async function suggestTonightCard() {
    const s = store();
    const pieces = (await s.listPieces?.()) || [];
    const mins = Number(s.prefs?.()?.practiceMins) || 30;
    const sorted = [...pieces].sort((a, b) =>
      String(b.last_practised_at || "").localeCompare(String(a.last_practised_at || ""))
    );
    for (const p of sorted) {
      const map = await s.stumbleMap?.(p.piece_key);
      const hard = Object.entries(map || {})
        .map(([bar, v]) => ({ bar: Number(bar), score: (v.wrong || 0) + 2 * (v.hesitations || 0) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);
      if (hard.length) {
        return {
          pieceKey: p.piece_key,
          title: p.title,
          composer: p.composer,
          stats: map,
          bars: hard.map((h) => h.bar),
          mins,
        };
      }
    }
    return null;
  }

  async function paintHomeImpact() {
    if (!window.LuneOnboard?.signedIn?.()) return;
    const streak = $("member-streak");
    if (streak) {
      const mode = window.LunePlans?.planMode?.();
      if (mode === "plan") {
        streak.innerHTML = weekBarHtml() + `<button type="button" class="link-btn wk-change" data-wp-new>Change plan</button>`;
        // a week without a plan gets one, made from the goal set at the start
        window.LunePlans?.ensureWeekPlan?.().then((made) => { if (made) streak.innerHTML = weekBarHtml() + `<button type="button" class="link-btn wk-change" data-wp-new>Change plan</button>`; }).catch(() => {});
      } else if (mode === "free") {
        streak.innerHTML = await piecesOverviewHtml();
      } else {
        streak.innerHTML = `<span class="wk-choose"><span class="wk-k">Your week</span>
          <span class="wk-q">Should Lune plan your week around your goal, or would you rather play whenever it suits you?</span>
          <span class="wk-opts"><button type="button" class="quiet wk-go" data-wp-choose="plan">Plan my week</button><button type="button" class="quiet" data-wp-choose="free">No schedule</button></span></span>`;
      }
    }

    const tonight = $("member-tonight");
    const tonightBody = $("member-tonight-body");
    const tonightBtn = $("btn-member-tonight");
    const tonightH = $("member-tonight-h");
    if (!tonight || !tonightBody) return;

    const plan = await suggestTonightCard();
    if (plan) {
      tonight.hidden = false;
      if (tonightH) tonightH.textContent = "Tonight";
      tonightBody.innerHTML = `Bars ${esc(plan.bars.join(", "))} on <em>${esc(plan.title)}</em>`;
      if (tonightBtn) {
        tonightBtn.hidden = false;
        tonightBtn.textContent = `Make tonight’s ${plan.mins} minutes`;
        tonightBtn.onclick = async () => {
          tonightBtn.disabled = true;
          try {
            const made = await buildTonightPlan({ ...plan, open: true });
            if (made) {
              toast("Tonight’s plan is ready — opening the score");
              paintHomeImpact();
            }
          } finally {
            tonightBtn.disabled = false;
          }
        };
      }
    } else {
      tonight.hidden = false;
      if (tonightH) tonightH.textContent = "When practice feels lost";
      tonightBody.textContent =
        "Rate a bar after you practise it, or ask Lune to add it to your plan. The bars that need you come back here.";
      if (tonightBtn) {
        tonightBtn.hidden = false;
        tonightBtn.textContent = "Open a recommended piece";
        tonightBtn.onclick = () => {
          const first = document.querySelector("#member-rec-grid .member-rec");
          if (first) first.click();
          else $("btn-member-search")?.click();
        };
      }
    }
  }

  function persistWeekSnap(snap) {
    const s = store();
    const rolls = Array.isArray(s.prefs()?.weekRollups) ? [...s.prefs().weekRollups] : [];
    const i = rolls.findIndex((r) => r.week === snap.week);
    if (i >= 0) rolls[i] = snap;
    else rolls.unshift(snap);
    s.setPref("weekRollups", rolls.slice(0, 26));
    s.syncPrefs?.();
  }

  /* ---------- the week's plan: what it holds, what is done, what is left, and why ---------- */

  const RATING = { again: "Again", hard: "Hard", okay: "Okay", good: "Good", strong: "Strong", easy: "Strong" };
  const shortDate = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  };
  const barsLabel = (bars) => {
    const b = (bars || []).map(Number).filter((n) => n > 0);
    if (!b.length) return "";
    const runs = [];
    for (const n of b) {
      const last = runs[runs.length - 1];
      if (last && n === last[1] + 1) last[1] = n;
      else runs.push([n, n]);
    }
    const text = runs.map(([a, z]) => (a === z ? `${a}` : `${a}–${z}`)).join(", ");
    return b.length === 1 ? `bar ${text}` : `bars ${text}`;
  };

  function weekBounds(week) {
    const start = new Date(`${week}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { startIso: start.toISOString(), endIso: end.toISOString() };
  }

  /** Why a plan task is on the list, in the pianist's terms. */
  function taskWhy(t, startIso) {
    const when = shortDate(t.created_at);
    const src = t.plan?.source;
    let why;
    if (src === "ask") why = `You asked Lune for a plan on ${when}`;
    else if (src === "tonight") why = `Tonight’s plan from ${when}, made from the bars you found hardest`;
    else if (src === "repertoire") why = `You added it from Work on this piece on ${when}`;
    else if (src === "teacher") why = `From your teacher’s link, saved on ${when}`;
    else why = `You set it yourself on ${when}`;
    if (t.plan?.summary) why += `: ${String(t.plan.summary).replace(/\.$/, "")}`;
    if (t.created_at < startIso && !t.done) why += ". Carried over from an earlier week";
    return `${why}.`;
  }

  /**
   * Everything this week asks for: plan tasks (open ones, and those made or
   * finished this week) and bars due for review before the week ends (or
   * reviewed during it). Each item says whether it is done and why it exists.
   */
  async function weekPlan(week) {
    const s = store();
    const { startIso, endIso } = weekBounds(week);
    const pieces = (await s.listPieces?.().catch?.(() => [])) || [];
    const titleOf = (key) => pieces.find((p) => p.piece_key === key)?.title || "A piece";
    const items = [];
    for (const t of s.listTasks?.() || []) {
      const thisWeek = t.created_at >= startIso || (t.done && (t.done_at || "") >= startIso);
      if (t.done && !thisWeek) continue;
      if (!t.done && t.created_at >= endIso) continue;
      items.push({ kind: "task", piece_key: t.piece_key, title: t.title || titleOf(t.piece_key), bars: t.bars || [], done: !!t.done, why: taskWhy(t, startIso), id: t.id });
    }
    const cards = (await s.listCards?.().catch?.(() => [])) || [];
    for (const c of cards) {
      const ratedThisWeek = (c.updated_at || "") >= startIso && !!c.last_grade;
      const dueThisWeek = c.due_at < endIso;
      if (!ratedThisWeek && !dueThisWeek) continue;
      const done = !dueThisWeek;
      const rating = RATING[c.last_grade] || "";
      const why = rating
        ? done
          ? `You rated it ${rating} on ${shortDate(c.updated_at)}. Lune brings it back ${shortDate(c.due_at)}.`
          : `You rated it ${rating} on ${shortDate(c.updated_at)}, so it is due again ${c.due_at <= new Date().toISOString() ? "now" : shortDate(c.due_at)}.`
        : "Queued for review: rate it after you play it.";
      items.push({ kind: "review", piece_key: c.piece_key, title: titleOf(c.piece_key), bars: [c.bar], done, why });
    }
    // what is left comes first, then what is done
    items.sort((a, b) => Number(a.done) - Number(b.done) || (a.kind === b.kind ? 0 : a.kind === "task" ? -1 : 1));
    return { items, done: items.filter((x) => x.done).length, left: items.filter((x) => !x.done).length };
  }

  /** Bars rated Again or Hard this week (and any older stumble records). */
  async function weekHardBars(week, limit = 6) {
    const s = store();
    const pieces = (await s.listPieces?.().catch?.(() => [])) || [];
    const titleOf = (key) => pieces.find((p) => p.piece_key === key)?.title || "A piece";
    const tally = new Map();
    for (const r of s.listActivity?.({ week }) || []) {
      const g = s.normGrade ? s.normGrade(r.grade) : r.grade;
      if (r.kind !== "review" || !(g === "again" || g === "hard") || !(r.bar > 0)) continue;
      const k = `${r.piece_key}:${r.bar}`;
      const row = tally.get(k) || { piece_key: r.piece_key, title: titleOf(r.piece_key), bar: Number(r.bar), times: 0 };
      row.times += 1;
      tally.set(k, row);
    }
    const rated = [...tally.values()].sort((a, b) => b.times - a.times);
    const stumbled = (await topStumbles(limit)).flat.filter((x) => !tally.has(`${x.piece_key}:${x.bar}`));
    return [...rated, ...stumbled].slice(0, limit);
  }

  const itemLine = (x) => `${x.title}${x.bars?.length ? `, ${barsLabel(x.bars)}` : ""}${x.kind === "review" ? " (review)" : ""}`;

  async function openWeeklyReview() {
    const s = store();
    const snap = s.weekSnapshot();
    const plan = await weekPlan(snap.week);
    const hardBars = await weekHardBars(snap.week, 5);
    const d = dialog("weekly-review-dialog", "impact-chapter");
    const range = weekRangeLabel(snap.week);
    const shown = plan.items.slice(0, 14);
    const itemsHtml = plan.items.length
      ? `<p class="week-progress" id="week-progress">${plan.done} of ${plan.items.length} done · ${plan.left} left</p>
        <ul class="week-items" aria-describedby="week-progress">${shown
          .map(
            (x) => `<li class="week-item ${x.done ? "is-done" : "is-left"}">
              <span class="week-status">${x.done ? "Done" : "To do"}</span>
              <span class="week-what">${esc(x.title)}${x.bars?.length ? ` · ${esc(barsLabel(x.bars))}` : ""}${x.kind === "review" ? ` <em>review</em>` : ""}</span>
              <span class="week-why">${esc(x.why)}</span>
            </li>`
          )
          .join("")}</ul>${plan.items.length > shown.length ? `<p class="dim">And ${plan.items.length - shown.length} more.</p>` : ""}`
      : `<p class="impact-empty">Nothing is planned for this week yet. Make tonight’s plan from your home page, add bars to your plan from a score, or rate a bar after you practise it so Lune can bring it back.</p>`;
    const hardHtml = hardBars.length
      ? `<ul class="impact-list">${hardBars
          .map((x) => `<li><span>${esc(x.title)}</span><em>bar ${x.bar}${x.times ? ` · rated Again or Hard ${x.times === 1 ? "once" : `${x.times} times`}` : ""}</em></li>`)
          .join("")}</ul>`
      : `<p class="impact-empty">No bars rated Again or Hard this week.</p>`;

    const minsLine = "A practice day is a day you rated a bar or finished a task in Lune, on any of your devices. Opening a piece or pressing Play does not count, and Lune does not time your practice.";

    d.innerHTML = `
      ${closeRow}
      <article class="impact-chapter-inner">
        <header class="impact-chapter-head">
          ${MARK}
          <p class="impact-kicker">This week</p>
          <p class="impact-range">${esc(range)}</p>
          <h2>A quiet review</h2>
          <p class="impact-voice">${esc(encouragement(snap))}</p>
        </header>
        <div class="impact-stats impact-stats-chapter" role="list">
          <div role="listitem"><span class="impact-num">${snap.days}</span><span class="dim">practice days · goal ${snap.goalDays}</span></div>
          <div role="listitem"><span class="impact-num">${snap.ratings}</span><span class="dim">bar${snap.ratings === 1 ? "" : "s"} rated${snap.ratings ? ` · ${snap.good} Good or Strong, ${snap.hard} Again or Hard` : ""}</span></div>
          <div role="listitem"><span class="impact-num">${snap.tasksDone}</span><span class="dim">task${snap.tasksDone === 1 ? "" : "s"} finished</span></div>
        </div>
        <p class="dim impact-mins">${esc(minsLine)}</p>
        <section class="impact-chapter-block" aria-labelledby="week-plan-h">
          <h3 class="impact-h3" id="week-plan-h">What this week holds</h3>
          ${itemsHtml}
        </section>
        <section class="impact-chapter-block" aria-labelledby="week-hard-h">
          <h3 class="impact-h3" id="week-hard-h">Bars that asked for you</h3>
          ${hardHtml}
        </section>
        <div class="onboard-nav auth-keep-nav impact-chapter-nav">
          <button type="button" class="quiet" data-impact-share>Share this week</button>
          <button type="button" class="primary" data-impact-close>Done</button>
        </div>
      </article>`;
    if (!d.open) d.showModal();
    d.querySelector("[data-impact-close]")?.addEventListener("click", () => d.close());
    d.querySelector("[data-impact-share]")?.addEventListener("click", () => {
      d.close();
      openShareWeek();
    });
    persistWeekSnap(snap);
  }

  /** The plain-text summary for Copy summary: readable on its own in a message or email. */
  function summaryText(p) {
    const lines = [`${p.displayName}: practice week ${p.weekLabel || `of ${p.week}`}`];
    lines.push(
      p.ratings != null
        ? `Practised on ${p.days} of the ${p.goalDays} days planned. ${p.ratings} bar${p.ratings === 1 ? "" : "s"} rated, ${p.tasksDone || 0} task${p.tasksDone === 1 ? "" : "s"} finished.`
        : `Practised on ${p.days} of the ${p.goalDays} days planned, ${p.sessions} session${p.sessions === 1 ? "" : "s"}.`
    );
    if (p.items?.length) {
      const done = p.items.filter((x) => x.done);
      const left = p.items.filter((x) => !x.done);
      lines.push(`${done.length} of ${p.items.length} planned things done.`);
      if (done.length) lines.push(`Done: ${done.map(itemLine).join("; ")}.`);
      if (left.length) lines.push(`Still to do: ${left.map(itemLine).join("; ")}.`);
    }
    if (p.pieces?.length) lines.push(`Pieces: ${p.pieces.map((x) => x.title).join(", ")}.`);
    if (p.hardBars?.length) lines.push(`Hard bars: ${p.hardBars.map((x) => `${x.title}, bar ${x.bar}`).join("; ")}.`);
    lines.push("Made with Lune: lune.page");
    return lines.join("\n");
  }

  async function openShareWeek() {
    const s = store();
    const snap = s.weekSnapshot();
    const pieces = (await s.listPieces?.()) || [];
    const d = dialog("share-week-dialog", "credits-dialog auth-dialog impact-dialog");
    const name = s.prefs()?.displayName || "A Lune pianist";
    const active = (s.listShareLinks?.() || []).filter((x) => !x.revoked);
    d.innerHTML = `
      ${closeRow}
      <p class="auth-kicker">Share</p>
      <h2>Share this week</h2>
      <p class="create-account-story">A read-only page for a teacher or parent. No email. No note text. Revoke anytime.</p>
      <label for="share-display-name">Display name</label>
      <input id="share-display-name" type="text" maxlength="60" value="${esc(name)}" placeholder="A Lune pianist">
      <fieldset class="impact-fieldset">
        <legend>Pieces to include</legend>
        ${
          pieces.length
            ? pieces
                .slice(0, 12)
                .map(
                  (p, idx) =>
                    `<label class="impact-check"><input type="checkbox" data-share-piece="${esc(p.piece_key)}" data-share-title="${esc(p.title)}" ${idx < 3 ? "checked" : ""}> ${esc(p.title)}</label>`
                )
                .join("")
            : `<p class="dim">Add pieces to your Repertoire first.</p>`
        }
      </fieldset>
      <label class="impact-check"><input type="checkbox" id="share-include-bars"> Include hard bar numbers</label>
      ${
        active.length
          ? `<p class="dim impact-active-links">${active.length} active link${active.length === 1 ? "" : "s"} — revoke below after you create a new one.</p>`
          : ""
      }
      <div class="onboard-nav auth-keep-nav">
        <button type="button" class="quiet" data-share-copy>Copy summary</button>
        <button type="button" class="primary" data-share-link>Create link</button>
      </div>
      <p class="auth-msg dim" id="share-week-msg" aria-live="polite"></p>`;
    if (!d.open) d.showModal();

    const selected = () =>
      [...d.querySelectorAll("[data-share-piece]:checked")].map((el) => ({
        piece_key: el.dataset.sharePiece,
        title: el.dataset.shareTitle,
      }));

    const payloadOf = async () => {
      const display = String($("share-display-name")?.value || "").trim() || "A Lune pianist";
      s.setPref("displayName", display);
      const includeBars = !!$("share-include-bars")?.checked;
      let hardBars = [];
      if (includeBars) hardBars = (await weekHardBars(snap.week, 6)).map((x) => ({ title: x.title, bar: x.bar }));
      // titles, bars and done or not only: no note text leaves the device
      const plan = await weekPlan(snap.week);
      const picked = new Set(selected().map((x) => x.piece_key));
      const items = plan.items
        .filter((x) => !picked.size || picked.has(x.piece_key))
        .slice(0, 20)
        .map((x) => ({ title: x.title, bars: x.bars, done: x.done, kind: x.kind }));
      return {
        displayName: display,
        week: snap.week,
        weekLabel: weekRangeLabel(snap.week),
        days: snap.days,
        goalDays: snap.goalDays,
        sessions: snap.sessions,
        ratings: snap.ratings,
        tasksDone: snap.tasksDone,
        barsWorked: snap.barsWorked || 0,
        pieces: selected(),
        includeBars,
        hardBars,
        items,
        madeWith: "Lune",
      };
    };

    d.querySelector("[data-share-copy]")?.addEventListener("click", async () => {
      const p = await payloadOf();
      const text = summaryText(p);
      try {
        await navigator.clipboard.writeText(text);
        $("share-week-msg").textContent = "Summary copied.";
      } catch {
        $("share-week-msg").textContent = text;
      }
    });

    d.querySelector("[data-share-link]")?.addEventListener("click", async () => {
      const p = await payloadOf();
      const row = await s.createShareLink(p);
      const url = `${location.origin}${location.pathname.replace(/\/$/, "")}/#share/${row.token}`;
      const cloudNote = row.cloud
        ? " Saved to the cloud — works in another browser."
        : row.cloudError
          ? ` Local link only — cloud save failed (${row.cloudError}).`
          : s.configured?.() && !s.status?.()?.signedIn
            ? " Sign in to save the link to the cloud."
            : " Local link (this browser).";
      try {
        await navigator.clipboard.writeText(url);
        $("share-week-msg").innerHTML = `Link copied.${esc(cloudNote)} <a href="${esc(url)}">Open</a> · <button type="button" class="link-btn" data-revoke="${esc(row.token)}">Revoke</button>`;
      } catch {
        $("share-week-msg").textContent = url + cloudNote;
      }
      $("share-week-msg")
        ?.querySelector?.("[data-revoke]")
        ?.addEventListener("click", async (e) => {
          await s.revokeShareLink(e.currentTarget.dataset.revoke);
          $("share-week-msg").textContent = "Link revoked.";
        });
      s.syncPrefs?.();
    });
  }

  async function openInvite() {
    const s = store();
    const name = s.prefs()?.displayName || "A Lune pianist";
    const snap = s.weekSnapshot();
    const row = await s.createShareLink({
      displayName: name,
      week: snap.week,
      weekLabel: weekRangeLabel(snap.week),
      days: snap.days,
      goalDays: snap.goalDays,
      sessions: snap.sessions,
      ratings: snap.ratings,
      tasksDone: snap.tasksDone,
      pieces: [],
      invite: true,
      madeWith: "Lune",
    });
    const url = `${location.origin}${location.pathname.replace(/\/$/, "")}/#share/${row.token}`;
    const d = dialog("invite-dialog", "credits-dialog auth-dialog impact-dialog");
    d.innerHTML = `
      ${closeRow}
      <p class="auth-kicker">Invite</p>
      <h2>Invite a teacher or friend</h2>
      <p class="create-account-story">They’ll land on: “You’ve been invited to see ${esc(name)}’s practice week” — then can make Lune theirs with the same free email code.</p>
      <p class="impact-link"><code>${esc(url)}</code></p>
      <div class="onboard-nav auth-keep-nav">
        <button type="button" class="quiet" data-inv-close>Close</button>
        <button type="button" class="primary" data-inv-copy>Copy invite link</button>
      </div>`;
    if (!d.open) d.showModal();
    d.querySelector("[data-inv-close]")?.addEventListener("click", () => d.close());
    d.querySelector("[data-inv-copy]")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(url);
        toast("Invite link copied");
      } catch {
        toast(url);
      }
    });
  }

  async function openOwnerImpact() {
    const s = store();
    if (!s.isOwner?.()) {
      toast("Owner sign-in required");
      return;
    }
    const d = dialog("owner-impact-dialog", "credits-dialog auth-dialog impact-dialog");
    const pub = await s.fetchPublicImpact?.().catch?.(() => null);
    const pubOn = !!pub?.enabled || !!s.prefs()?.impactPublic?.enabled;
    d.innerHTML = `${closeRow}<p class="auth-kicker">Impact</p><h2>Anonymous impact</h2>
      <div id="owner-impact-body"><p class="dim">Loading…</p></div>
      <p class="dim">Private to the owner until you publish. No names, no emails. Public page: /#impact — see docs/IMPACT.md.</p>
      <div class="onboard-nav auth-keep-nav">
        <button type="button" class="quiet" data-impact-pub>${pubOn ? "Turn public snapshot off" : "Publish public snapshot"}</button>
        <button type="button" class="primary" data-impact-done>Done</button>
      </div>
      <p class="auth-msg dim" id="owner-impact-msg" aria-live="polite"></p>`;
    if (!d.open) d.showModal();
    d.querySelector("[data-impact-done]")?.addEventListener("click", () => d.close());
    try {
      const res = await s.ownerImpactStats();
      const body = d.querySelector("#owner-impact-body");
      if (body) {
        const usersNote =
          res.users == null
            ? `<p class="dim">User count unavailable — run <code>owner_user_count</code> from supabase/schema.sql in the Supabase SQL editor.</p>`
            : "";
        body.innerHTML = `
          <div class="impact-users-hero">
            <span class="impact-num">${esc(String(res.users ?? "—"))}</span>
            <span class="dim">signed-up users</span>
          </div>
          <div class="impact-stats impact-stats-owner">
            <div><span class="impact-num">${esc(String(res.weeks ?? 0))}</span><span class="dim">week reviews</span></div>
            <div><span class="impact-num">${esc(String(res.plans ?? 0))}</span><span class="dim">plans</span></div>
            <div><span class="impact-num">${esc(String(res.stumbles ?? 0))}</span><span class="dim">stumbles</span></div>
            <div><span class="impact-num">${esc(String(res.shares ?? 0))}</span><span class="dim">shares</span></div>
          </div>
          ${usersNote}
          <p class="dim">Mode: ${esc(res.mode || "local")}${res.note ? ` · ${esc(res.note)}` : ""}</p>`;
      }
      const snapshot = {
        users: res.users,
        weeks: res.weeks,
        plans: res.plans,
        stumbles: res.stumbles,
        shares: res.shares,
        updated_at: new Date().toISOString(),
      };
      d.querySelector("[data-impact-pub]")?.addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const msg = d.querySelector("#owner-impact-msg");
        const cur = !!(await s.fetchPublicImpact?.().catch?.(() => null))?.enabled || !!s.prefs()?.impactPublic?.enabled;
        btn.disabled = true;
        try {
          if (!s.publishImpactSnapshot) {
            s.setPref("impactPublic", { enabled: !cur, ...snapshot });
            s.syncPrefs?.();
          } else {
            await s.publishImpactSnapshot(snapshot, !cur);
          }
          btn.textContent = !cur ? "Turn public snapshot off" : "Publish public snapshot";
          if (msg) {
            msg.textContent = !cur
              ? "Published — anyone can open /#impact (anonymous aggregates only)."
              : "Public snapshot turned off.";
          }
          toast(!cur ? "Public snapshot on — open /#impact" : "Public snapshot off");
        } catch (err) {
          if (msg) msg.textContent = err.message || String(err);
          toast(err.message || "Couldn’t update public snapshot");
        } finally {
          btn.disabled = false;
        }
      });
    } catch (err) {
      const body = d.querySelector("#owner-impact-body");
      if (body) body.textContent = err.message || String(err);
    }
  }

  function hideAppViews() {
    ["home", "studio", "discover", "repertoire", "welcome", "onboard", "hello"].forEach((id) => {
      const el = $(id);
      if (el) el.hidden = true;
    });
  }

  async function showSharePage(token) {
    const row = await store().fetchShareByToken?.(token);
    const app = $("app");
    let page = $("share-page");
    if (!page) {
      page = document.createElement("main");
      page.id = "share-page";
      page.className = "share-page";
      app?.appendChild(page);
    }
    hideAppViews();
    document.body.classList.add("is-share");
    document.body.classList.remove("is-home", "is-welcome", "is-onboard");
    page.hidden = false;

    if (!row?.payload) {
      page.innerHTML = `<section class="share-inner">
        ${MARK}
        <p class="share-kicker">Lune</p>
        <h1>This link isn’t available</h1>
        <p class="share-lead">It may have been revoked.</p>
        <p class="share-cta-row"><a class="primary" href="${esc(location.pathname)}">Open Lune</a></p>
        <p class="share-foot"><a href="https://lune.page/">Made with Lune</a></p>
      </section>`;
      return;
    }
    const p = row.payload;
    // a shared week plan or a piece's progress has its own page
    if (p.kind && window.LunePlans?.renderShare?.(page, p)) return;
    const invited = !!p.invite;
    if (invited) markInvite();
    const range = p.weekLabel || weekRangeLabel(p.week) || p.week || "";
    page.innerHTML = `
      <section class="share-inner">
        <div class="share-lockup">${MARK}<p class="share-brand">Lune</p></div>
        <p class="share-kicker">${invited ? "You’ve been invited" : "Practice week"}</p>
        <h1>${esc(p.displayName || "A Lune pianist")}</h1>
        <p class="share-lead">${
          invited
            ? `to see ${esc(p.displayName || "a pianist")}’s practice week — calm numbers only, nothing private.`
            : esc(range)
        }</p>
        ${invited && range ? `<p class="dim share-range">${esc(range)}</p>` : ""}
        <div class="impact-stats">
          <div><span class="impact-num">${esc(String(p.days ?? 0))}</span><span class="dim">days · goal ${esc(String(p.goalDays ?? "—"))}</span></div>
          ${
            p.ratings != null
              ? `<div><span class="impact-num">${esc(String(p.ratings))}</span><span class="dim">bars rated</span></div>
          <div><span class="impact-num">${esc(String(p.tasksDone ?? 0))}</span><span class="dim">tasks finished</span></div>`
              : `<div><span class="impact-num">${esc(String(p.sessions ?? 0))}</span><span class="dim">sessions</span></div>`
          }
        </div>
        ${
          p.items?.length
            ? `<h2 class="impact-h3">This week’s plan: ${p.items.filter((x) => x.done).length} of ${p.items.length} done</h2><ul class="week-items">${p.items
                .map(
                  (x) => `<li class="week-item ${x.done ? "is-done" : "is-left"}"><span class="week-status">${x.done ? "Done" : "To do"}</span><span class="week-what">${esc(itemLine(x))}</span></li>`
                )
                .join("")}</ul>`
            : ""
        }
        ${
          p.pieces?.length
            ? `<h2 class="impact-h3">Pieces</h2><ul class="impact-list">${p.pieces
                .map((x) => `<li>${esc(x.title)}</li>`)
                .join("")}</ul>`
            : ""
        }
        ${
          p.hardBars?.length
            ? `<h2 class="impact-h3">Hard bars</h2><ul class="impact-list">${p.hardBars
                .map((x) => `<li><span>${esc(x.title)}</span><em>bar ${esc(String(x.bar))}</em></li>`)
                .join("")}</ul>`
            : ""
        }
        <p class="share-cta-note">Invited by a pianist on Lune — free forever. No ads. No payments.</p>
        <div class="share-cta-row">
          <button type="button" class="primary" id="share-join">Make Lune yours</button>
          <a class="quiet" href="${esc(location.pathname)}">Back to Lune</a>
        </div>
        <p class="share-foot"><a href="https://lune.page/">Made with Lune</a> · so practice feels right again</p>
      </section>`;
    page.querySelector("#share-join")?.addEventListener("click", () => {
      markInvite();
      page.hidden = true;
      document.body.classList.remove("is-share");
      history.replaceState({}, "", location.pathname);
      window.LuneOnboard?.showOnboard?.(0);
    });
  }

  async function showPublicImpact() {
    let page = $("impact-page");
    if (!page) {
      page = document.createElement("main");
      page.id = "impact-page";
      page.className = "share-page impact-public-page";
      $("app")?.appendChild(page);
    }
    hideAppViews();
    document.body.classList.add("is-share");
    page.hidden = false;
    page.innerHTML = `<section class="share-inner">
      ${MARK}
      <p class="share-kicker">Lune</p>
      <h1>Impact</h1>
      <p class="share-lead">Loading…</p>
    </section>`;

    const pub = (await store().fetchPublicImpact?.().catch?.(() => null)) || store().prefs?.()?.impactPublic;

    if (!pub?.enabled) {
      page.innerHTML = `<section class="share-inner">
        ${MARK}
        <p class="share-kicker">Lune</p>
        <h1>Impact</h1>
        <p class="share-lead">The owner hasn’t published a snapshot yet.</p>
        <p class="share-cta-row"><a class="quiet" href="${esc(location.pathname)}">Back to Lune</a></p>
      </section>`;
      return;
    }
    const updated = pub.updated_at
      ? new Date(pub.updated_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
      : "";
    page.innerHTML = `<section class="share-inner">
      <div class="share-lockup">${MARK}<p class="share-brand">Lune</p></div>
      <p class="share-kicker">Anonymous</p>
      <h1>Impact</h1>
      <p class="share-lead">Quiet proof that pianists use Lune. No names. No emails.</p>
      <div class="impact-stats">
        <div><span class="impact-num">${esc(String(pub.users ?? "—"))}</span><span class="dim">users</span></div>
        <div><span class="impact-num">${esc(String(pub.weeks ?? 0))}</span><span class="dim">week reviews</span></div>
        <div><span class="impact-num">${esc(String(pub.plans ?? 0))}</span><span class="dim">plans</span></div>
        <div><span class="impact-num">${esc(String(pub.stumbles ?? 0))}</span><span class="dim">stumbles</span></div>
        <div><span class="impact-num">${esc(String(pub.shares ?? 0))}</span><span class="dim">shares</span></div>
      </div>
      <p class="dim">Updated ${esc(updated)}. Aggregates only — built free, forever.</p>
      <p class="share-foot"><a href="https://lune.page/">Made with Lune</a></p>
    </section>`;
  }

  function handleRoute() {
    const hash = location.hash || "";
    const share = hash.match(/^#share\/([A-Za-z0-9]+)/);
    if (share) {
      showSharePage(share[1]);
      return true;
    }
    if (hash === "#impact") {
      showPublicImpact();
      return true;
    }
    const sharePage = $("share-page");
    const impactPage = $("impact-page");
    if (sharePage) sharePage.hidden = true;
    if (impactPage) impactPage.hidden = true;
    document.body.classList.remove("is-share");
    return false;
  }

  function init() {
    $("btn-member-week")?.addEventListener("click", () => openWeeklyReview());
    $("btn-member-week-example")?.addEventListener("click", () => window.LunePractice?.openExampleWeek?.());
    $("btn-footer-share")?.addEventListener("click", () => openShareWeek());
    $("btn-footer-invite")?.addEventListener("click", () => openInvite());
    window.addEventListener("hashchange", () => handleRoute());
    store()?.onChange?.(() => {
      if (window.LuneOnboard?.signedIn?.()) paintHomeImpact();
    });
    if (!handleRoute()) {
      setTimeout(() => paintHomeImpact(), 200);
    }
  }

  return {
    weekBarHtml,
    init,
    paintHomeImpact,
    openWeeklyReview,
    openShareWeek,
    weekPlan,
    summaryText,
    openInvite,
    openOwnerImpact,
    buildTonightPlan,
    streakLine,
    handleRoute,
    hasInvite,
    clearInvite,
    markInvite,
  };
})();
