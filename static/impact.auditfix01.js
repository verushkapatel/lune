/* Lune — practice evidence loop: streak, weekly review, tonight’s plan,
 * shareable progress, invite, owner impact. Additive; calm; no clutter. */
window.LuneImpact = (function () {
  const store = () => window.LuneStore;
  const $ = (id) => document.getElementById(id);
  const INVITE_KEY = "lune.invite";
  const MARK = `<svg class="lune-mark impact-mark" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true" focusable="false"><path fill="currentColor" d="M26.2 7.2c-5.9.9-10.4 6-10.4 12.1 0 6.1 4.5 11.2 10.4 12.1A12.2 12.2 0 0 1 14 19.3c0-6.6 5.2-12 11.8-12.2.1 0 .3 0 .4 0z"/></svg>`;

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
    if (snap.sessions >= 1) return "Hard bars are information, not failure. Meet them again tonight.";
    return "Show up once more this week. Small sessions still count.";
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
    if (streak) streak.textContent = streakLine();

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
        "Use Play along on a score — Lune marks the bars that trip you, then builds a short plan.";
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

  async function openWeeklyReview() {
    const s = store();
    const snap = s.weekSnapshot();
    const stumbles = await topStumbles(5);
    const d = dialog("weekly-review-dialog", "impact-chapter");
    const range = weekRangeLabel(snap.week);
    const stumbleHtml = stumbles.flat.length
      ? `<ul class="impact-list">${stumbles.flat
          .map((x) => `<li><span>${esc(x.title)}</span><em>bar ${x.bar}</em></li>`)
          .join("")}</ul>`
      : `<p class="impact-empty">No stumble map yet this fortnight. Play along on a score to gather one.</p>`;

    const minsLine =
      snap.mins > 0
        ? `About ${snap.mins} minutes logged — best effort when the clock is known.`
        : snap.barsWorked > 0
          ? `${snap.sessions} session marker${snap.sessions === 1 ? "" : "s"} · ${snap.barsWorked} bar${snap.barsWorked === 1 ? "" : "s"} worked (exact minutes aren’t always known).`
          : `${snap.sessions} session marker${snap.sessions === 1 ? "" : "s"} — honest practice signals, not a stopwatch.`;

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
          <div role="listitem"><span class="impact-num">${snap.days}</span><span class="dim">days · goal ${snap.goalDays}</span></div>
          <div role="listitem"><span class="impact-num">${snap.sessions}</span><span class="dim">sessions</span></div>
          <div role="listitem"><span class="impact-num">${snap.good}</span><span class="dim">Good / Easy</span></div>
          <div role="listitem"><span class="impact-num">${snap.hard}</span><span class="dim">Again / Hard</span></div>
        </div>
        <p class="dim impact-mins">${esc(minsLine)}</p>
        <section class="impact-chapter-block">
          <h3 class="impact-h3">Bars that asked for you</h3>
          ${stumbleHtml}
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
      if (includeBars) {
        const top = await topStumbles(6);
        hardBars = top.flat.map((x) => ({ title: x.title, bar: x.bar }));
      }
      return {
        displayName: display,
        week: snap.week,
        weekLabel: weekRangeLabel(snap.week),
        days: snap.days,
        goalDays: snap.goalDays,
        sessions: snap.sessions,
        mins: snap.mins,
        barsWorked: snap.barsWorked || 0,
        pieces: selected(),
        includeBars,
        hardBars,
        madeWith: "Lune",
      };
    };

    d.querySelector("[data-share-copy]")?.addEventListener("click", async () => {
      const p = await payloadOf();
      const text = [
        `${p.displayName} · ${p.weekLabel || `week of ${p.week}`}`,
        `${p.days}/${p.goalDays} days · ${p.sessions} sessions` + (p.mins ? ` · ~${p.mins} min` : ""),
        p.pieces.length ? `Pieces: ${p.pieces.map((x) => x.title).join(", ")}` : "",
        p.hardBars?.length ? `Hard bars: ${p.hardBars.map((x) => `${x.title} ${x.bar}`).join("; ")}` : "",
        "Made with Lune — lune.page",
      ]
        .filter(Boolean)
        .join("\n");
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
      mins: snap.mins,
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
      <p class="dim" id="owner-impact-body">Loading…</p>
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
        body.innerHTML = `
          <div class="impact-stats impact-stats-owner">
            <div><span class="impact-num">${esc(String(res.users ?? "—"))}</span><span class="dim">users</span></div>
            <div><span class="impact-num">${esc(String(res.weeks ?? 0))}</span><span class="dim">week reviews</span></div>
            <div><span class="impact-num">${esc(String(res.plans ?? 0))}</span><span class="dim">plans</span></div>
            <div><span class="impact-num">${esc(String(res.stumbles ?? 0))}</span><span class="dim">stumbles</span></div>
            <div><span class="impact-num">${esc(String(res.shares ?? 0))}</span><span class="dim">shares</span></div>
          </div>
          <p class="dim">Mode: ${esc(res.mode || "local")}${res.note ? ` · ${esc(res.note)}` : ""}${res.users == null ? " · run owner_user_count in Supabase if users show —" : ""}</p>`;
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
          <div><span class="impact-num">${esc(String(p.sessions ?? 0))}</span><span class="dim">sessions</span></div>
          ${p.mins ? `<div><span class="impact-num">${esc(String(p.mins))}</span><span class="dim">minutes (approx.)</span></div>` : ""}
        </div>
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
    init,
    paintHomeImpact,
    openWeeklyReview,
    openShareWeek,
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
