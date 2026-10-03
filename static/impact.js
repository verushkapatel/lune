/* Lune — practice evidence loop: streak, weekly review, tonight’s plan,
 * shareable progress, invite, owner impact. Additive; no clutter. */
window.LuneImpact = (function () {
  const store = () => window.LuneStore;
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  function toast(msg) {
    window.toast?.(msg);
  }

  function dialog(id) {
    let d = $(id);
    if (!d) {
      d = document.createElement("dialog");
      d.id = id;
      d.className = "credits-dialog auth-dialog impact-dialog";
      document.body.appendChild(d);
    }
    return d;
  }

  const closeRow = `<form method="dialog" class="credits-close-row">
    <button type="submit" class="icon-btn" aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
  </form>`;

  function encouragement(snap) {
    if (!snap.days) return "The week is still open. One quiet session is enough to begin.";
    if (snap.days >= snap.goalDays) return "You met the rhythm you set. That is how pieces settle.";
    if (snap.good > snap.hard) return "More bars moving toward Good than Hard — keep the light on.";
    return "Hard bars are information, not failure. Meet them again tonight.";
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
    const rows = s.listActivity?.({ sinceDays: 14 }) || [];
    const pieces = await s.listPieces?.().catch?.(() => []) || [];
    const byPiece = {};
    for (const p of pieces) {
      const map = await s.stumbleMap?.(p.piece_key).catch?.(() => ({}));
      const ranked = Object.entries(map || {})
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
    return { flat: flat.slice(0, limit), byPiece, recentActivity: rows.length };
  }

  async function buildTonightPlan({ pieceKey, title, composer, stats } = {}) {
    const s = store();
    const mins = Number(s.prefs?.()?.practiceMins) || 30;
    let key = pieceKey;
    let t = title;
    let c = composer;
    let map = stats;

    if (!key) {
      const pieces = (await s.listPieces?.()) || [];
      for (const p of pieces) {
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

    const notes = `Tonight’s ${mins} minutes — hear once, then work the hard bars slowly. Confidence bar ${easy} included.`;
    const task = s.addTask({
      piece_key: key,
      title: t || "Practice",
      composer: c || "",
      bars: pick.slice(0, 5),
      notes,
      plan: { source: "tonight", mins, created_at: new Date().toISOString() },
    });
    s.logActivity?.({ kind: "tonight", piece_key: key, mins: 0 });
    return { task, mins, bars: pick, title: t, piece_key: key };
  }

  async function paintHomeImpact() {
    if (!window.LuneOnboard?.signedIn?.()) return;
    const streak = $("member-streak");
    if (streak) streak.textContent = streakLine();

    const tonight = $("member-tonight");
    const tonightBody = $("member-tonight-body");
    const tonightBtn = $("btn-member-tonight");
    if (!tonight || !tonightBody) return;

    const plan = await suggestTonightCard();
    if (plan) {
      tonight.hidden = false;
      tonightBody.innerHTML = `<strong>Tonight:</strong> bars ${esc(plan.bars.join(", "))} on <em>${esc(plan.title)}</em>`;
      if (tonightBtn) {
        tonightBtn.hidden = false;
        tonightBtn.textContent = `Make tonight’s ${plan.mins} minutes`;
        tonightBtn.onclick = async () => {
          const made = await buildTonightPlan(plan);
          if (made) {
            toast("Tonight’s plan is in your Repertoire");
            window.LunePractice?.refreshBadge?.();
            paintHomeImpact();
          }
        };
      }
    } else {
      tonight.hidden = false;
      tonightBody.innerHTML =
        `<strong>Tonight:</strong> Use <em>Play along</em> on a score — Lune marks the bars that trip you, then builds a short plan.`;
      if (tonightBtn) {
        tonightBtn.hidden = false;
        tonightBtn.textContent = "Open a recommended piece";
        tonightBtn.onclick = () => {
          const first = document.querySelector("#member-rec-grid .member-rec");
          first?.click?.();
        };
      }
    }
  }

  async function suggestTonightCard() {
    const s = store();
    const pieces = (await s.listPieces?.()) || [];
    const mins = Number(s.prefs?.()?.practiceMins) || 30;
    for (const p of pieces) {
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

  async function openWeeklyReview() {
    const s = store();
    const snap = s.weekSnapshot();
    const stumbles = await topStumbles(5);
    const d = dialog("weekly-review-dialog");
    const stumbleHtml = stumbles.flat.length
      ? `<ul class="impact-list">${stumbles.flat
          .map((x) => `<li>${esc(x.title)} · bar ${x.bar}</li>`)
          .join("")}</ul>`
      : `<p class="dim">No stumble map yet this fortnight. Play along on a score to gather one.</p>`;

    const minsLine =
      snap.mins > 0
        ? `${snap.mins} minutes logged (best-effort)`
        : `${snap.sessions} session marker${snap.sessions === 1 ? "" : "s"} (exact minutes aren’t always known — we count honest practice signals)`;

    d.innerHTML = `
      ${closeRow}
      <p class="auth-kicker">This week</p>
      <h2>A quiet review</h2>
      <p class="create-account-story">${esc(encouragement(snap))}</p>
      <div class="impact-stats">
        <div><span class="impact-num">${snap.days}</span><span class="dim">days · goal ${snap.goalDays}</span></div>
        <div><span class="impact-num">${snap.sessions}</span><span class="dim">sessions</span></div>
        <div><span class="impact-num">${snap.good}</span><span class="dim">Good / Easy</span></div>
        <div><span class="impact-num">${snap.hard}</span><span class="dim">Again / Hard</span></div>
      </div>
      <p class="dim impact-mins">${esc(minsLine)}</p>
      <h3 class="impact-h3">Bars that asked for you</h3>
      ${stumbleHtml}
      <div class="onboard-nav auth-keep-nav">
        <button type="button" class="quiet" data-impact-share>Share this week</button>
        <button type="button" class="primary" data-impact-close>Done</button>
      </div>`;
    if (!d.open) d.showModal();
    d.querySelector("[data-impact-close]")?.addEventListener("click", () => d.close());
    d.querySelector("[data-impact-share]")?.addEventListener("click", () => {
      d.close();
      openShareWeek();
    });
    // Persist snapshot for admissions trends
    const rolls = Array.isArray(s.prefs()?.weekRollups) ? [...s.prefs().weekRollups] : [];
    const i = rolls.findIndex((r) => r.week === snap.week);
    if (i >= 0) rolls[i] = snap;
    else rolls.unshift(snap);
    s.setPref("weekRollups", rolls.slice(0, 26));
    s.syncPrefs?.();
  }

  async function openShareWeek() {
    const s = store();
    const snap = s.weekSnapshot();
    const pieces = (await s.listPieces?.()) || [];
    const d = dialog("share-week-dialog");
    const name = s.prefs()?.displayName || "A Lune pianist";
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

    const payloadOf = () => {
      const display = String($("share-display-name")?.value || "").trim() || "A Lune pianist";
      s.setPref("displayName", display);
      return {
        displayName: display,
        week: snap.week,
        days: snap.days,
        goalDays: snap.goalDays,
        sessions: snap.sessions,
        mins: snap.mins,
        pieces: selected(),
        includeBars: !!$("share-include-bars")?.checked,
        hardBars: [],
        madeWith: "Lune",
      };
    };

    d.querySelector("[data-share-copy]")?.addEventListener("click", async () => {
      const p = payloadOf();
      if (p.includeBars) {
        const top = await topStumbles(6);
        p.hardBars = top.flat.map((x) => ({ title: x.title, bar: x.bar }));
      }
      const text = [
        `${p.displayName} · week of ${p.week}`,
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
      const p = payloadOf();
      if (p.includeBars) {
        const top = await topStumbles(6);
        p.hardBars = top.flat.map((x) => ({ title: x.title, bar: x.bar }));
      }
      const row = await s.createShareLink(p);
      const url = `${location.origin}${location.pathname.replace(/\/$/, "")}/#share/${row.token}`;
      try {
        await navigator.clipboard.writeText(url);
        $("share-week-msg").innerHTML = `Link copied. <a href="${esc(url)}">Open</a> · <button type="button" class="link-btn" data-revoke="${esc(row.token)}">Revoke</button>`;
      } catch {
        $("share-week-msg").textContent = url;
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
    // Reuse latest share or create a light invite payload
    let links = s.listShareLinks?.().filter((x) => !x.revoked) || [];
    if (!links.length) {
      const snap = s.weekSnapshot();
      const row = await s.createShareLink({
        displayName: name,
        week: snap.week,
        days: snap.days,
        goalDays: snap.goalDays,
        sessions: snap.sessions,
        mins: snap.mins,
        pieces: [],
        invite: true,
        madeWith: "Lune",
      });
      links = [row];
    }
    const token = links[0].token;
    const url = `${location.origin}${location.pathname.replace(/\/$/, "")}/#share/${token}`;
    const d = dialog("invite-dialog");
    d.innerHTML = `
      ${closeRow}
      <p class="auth-kicker">Invite</p>
      <h2>Invite a teacher or friend</h2>
      <p class="create-account-story">They’ll see a calm practice-week page — then can make Lune theirs with the same free email code.</p>
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
    const d = dialog("owner-impact-dialog");
    d.innerHTML = `${closeRow}<p class="auth-kicker">Impact</p><h2>Anonymous impact</h2>
      <p class="dim" id="owner-impact-body">Loading…</p>
      <p class="dim">Private to the owner. No names, no emails. Use for applications and documentation — see docs/IMPACT.md.</p>
      <div class="onboard-nav auth-keep-nav">
        <button type="button" class="quiet" data-impact-pub>Toggle public snapshot</button>
        <button type="button" class="primary" data-impact-done>Done</button>
      </div>`;
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
          <p class="dim">Mode: ${esc(res.mode || "local")}</p>`;
      }
      // Keep a publishable snapshot in prefs for /#impact
      const pub = {
        users: res.users,
        weeks: res.weeks,
        plans: res.plans,
        stumbles: res.stumbles,
        shares: res.shares,
        updated_at: new Date().toISOString(),
      };
      d.querySelector("[data-impact-pub]")?.addEventListener("click", () => {
        const cur = !!s.prefs()?.impactPublic?.enabled;
        s.setPref("impactPublic", { enabled: !cur, ...pub });
        s.syncPrefs?.();
        toast(!cur ? "Public snapshot on — open /#impact" : "Public snapshot off");
      });
    } catch (err) {
      const body = d.querySelector("#owner-impact-body");
      if (body) body.textContent = err.message || String(err);
    }
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
    ["home", "studio", "discover", "repertoire", "welcome", "onboard", "hello"].forEach((id) => {
      const el = $(id);
      if (el) el.hidden = true;
    });
    document.body.classList.add("is-share");
    page.hidden = false;

    if (!row?.payload) {
      page.innerHTML = `<section class="share-inner"><h1>This link isn’t available</h1>
        <p class="dim">It may have been revoked.</p>
        <p><a class="primary" href="${esc(location.pathname)}">Open Lune</a></p></section>`;
      return;
    }
    const p = row.payload;
    const invited = !!p.invite;
    page.innerHTML = `
      <section class="share-inner">
        <p class="share-kicker">${invited ? "You’ve been invited" : "Practice week"}</p>
        <h1>${esc(p.displayName || "A Lune pianist")}</h1>
        <p class="share-lead">${
          invited
            ? `to see a calm week of piano practice on Lune.`
            : `Week of ${esc(p.week || "")}`
        }</p>
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
                .map((x) => `<li>${esc(x.title)} · bar ${esc(String(x.bar))}</li>`)
                .join("")}</ul>`
            : ""
        }
        <p class="share-cta-note dim">Invited by a pianist on Lune — free, no ads, no payments.</p>
        <div class="share-cta-row">
          <button type="button" class="primary" id="share-join">Make Lune yours</button>
          <a class="quiet" href="${esc(location.pathname)}">Back to Lune</a>
        </div>
        <p class="share-foot"><a href="https://lune.page/">Made with Lune</a></p>
      </section>`;
    page.querySelector("#share-join")?.addEventListener("click", () => {
      page.hidden = true;
      document.body.classList.remove("is-share");
      history.replaceState({}, "", location.pathname);
      window.LuneOnboard?.showOnboard?.(0);
    });
  }

  function showPublicImpact() {
    const pub = store().prefs?.()?.impactPublic;
    const page = dialog("public-impact-dialog");
    if (!pub?.enabled) {
      page.innerHTML = `${closeRow}<h2>Impact</h2><p class="dim">The owner hasn’t published a snapshot yet.</p>`;
      if (!page.open) page.showModal();
      return;
    }
    page.innerHTML = `${closeRow}<p class="auth-kicker">Lune</p><h2>Anonymous impact</h2>
      <div class="impact-stats">
        <div><span class="impact-num">${esc(String(pub.users ?? "—"))}</span><span class="dim">users</span></div>
        <div><span class="impact-num">${esc(String(pub.weeks ?? 0))}</span><span class="dim">week reviews</span></div>
        <div><span class="impact-num">${esc(String(pub.plans ?? 0))}</span><span class="dim">plans</span></div>
      </div>
      <p class="dim">Updated ${esc(pub.updated_at || "")}. No personal data.</p>`;
    if (!page.open) page.showModal();
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
    return false;
  }

  function init() {
    $("btn-member-week")?.addEventListener("click", () => openWeeklyReview());
    $("btn-member-tonight")?.addEventListener("click", () => {});
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
  };
})();
