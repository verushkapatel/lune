/* Lune — welcome overview → immersive onboarding → studio, then sign-in to keep.
 * Guests can experience the full product after onboarding. An account keeps
 * repertoire, plans and notes across devices (Supabase when configured).
 */
window.LuneOnboard = (function () {
  const store = () => window.LuneStore;
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const COMPOSERS = [
    "Bach",
    "Mozart",
    "Beethoven",
    "Chopin",
    "Debussy",
    "Satie",
    "Schubert",
    "Schumann",
    "Liszt",
    "Joplin",
    "Tchaikovsky",
    "Clementi",
  ];

  /** Curated ABRSM-ish pools → catalogue query / route ids used by hero chips & search. */
  const GRADE_POOL = {
    1: [
      { title: "Twinkle Twinkle Little Star", composer: "Traditional", query: "twinkle", grade: 1 },
      { title: "Minuet in G", composer: "J. S. Bach", query: "bach minuet", grade: 1 },
      { title: "Ode to Joy (easy)", composer: "Beethoven", query: "ode to joy easy", grade: 1 },
    ],
    2: [
      { title: "Minuet in G", composer: "J. S. Bach", query: "bach minuet", grade: 2 },
      { title: "Greensleeves (easy)", composer: "Traditional", query: "greensleeves easy", grade: 2 },
      { title: "Canon in D (easy)", composer: "Pachelbel", query: "canon in d easy", grade: 2 },
    ],
    3: [
      { title: "Für Elise", composer: "Beethoven", query: "fur elise", id: "beethoven-fur-elise", grade: 3 },
      { title: "Gymnopédie No. 1", composer: "Erik Satie", query: "gymnopedie", id: "satie-gymnopedie-1", grade: 3 },
      { title: "Prelude in C major, BWV 846", composer: "J. S. Bach", query: "bach prelude c", grade: 3 },
    ],
    4: [
      { title: "Für Elise", composer: "Beethoven", query: "fur elise", id: "beethoven-fur-elise", grade: 4 },
      { title: "Invention No. 1", composer: "J. S. Bach", query: "invention 1", grade: 4 },
      { title: "Sonatina (Clementi)", composer: "Muzio Clementi", query: "clementi sonatina", grade: 4 },
      { title: "Nocturne (easy)", composer: "Chopin", query: "nocturne easy", grade: 4 },
    ],
    5: [
      { title: "Moonlight Sonata (1st mov.)", composer: "Beethoven", query: "moonlight", grade: 5 },
      { title: "Prelude in E minor", composer: "Chopin", query: "prelude e minor", grade: 5 },
      { title: "Gnossienne No. 1", composer: "Erik Satie", query: "gnossienne", grade: 5 },
      { title: "Maple Leaf Rag", composer: "Scott Joplin", query: "maple leaf", grade: 5 },
    ],
    6: [
      { title: "Clair de lune", composer: "Claude Debussy", query: "clair de lune", id: "debussy-clair-de-lune", grade: 6 },
      { title: "Nocturne Op. 9 No. 2", composer: "Chopin", query: "nocturne op 9", grade: 6 },
      { title: "Arabesque No. 1", composer: "Debussy", query: "arabesque", grade: 6 },
      { title: "The Entertainer", composer: "Scott Joplin", query: "entertainer", grade: 6 },
    ],
    7: [
      { title: "Clair de lune", composer: "Claude Debussy", query: "clair de lune", id: "debussy-clair-de-lune", grade: 7 },
      { title: "Liebestraum No. 3", composer: "Franz Liszt", query: "liebestraum", grade: 7 },
      { title: "Mazurka Op. 6 No. 2", composer: "Chopin", query: "mazurka 06 2", grade: 7 },
      { title: "Raindrop Prelude", composer: "Chopin", query: "prelude 28 15", grade: 7 },
    ],
    8: [
      { title: "Clair de lune", composer: "Claude Debussy", query: "clair de lune", id: "debussy-clair-de-lune", grade: 8 },
      { title: "Ballade No. 1", composer: "Chopin", query: "ballade", grade: 8 },
      { title: "La Campanella", composer: "Liszt", query: "campanella", grade: 8 },
      { title: "Moonlight Sonata", composer: "Beethoven", query: "moonlight", grade: 8 },
    ],
  };

  let step = 0;
  let selectedComposers = new Set();
  let selectedGrade = 5;
  let keepPromptShown = false;

  function signedIn() {
    return !!store()?.status()?.signedIn;
  }
  function onboarded() {
    return !!store()?.prefs()?.onboarded;
  }
  /** Studio unlock: finish the immersive path (account optional). */
  function unlocked() {
    return onboarded();
  }
  function seenWelcome() {
    return !!store()?.prefs()?.seenWelcome;
  }

  function ensureDom() {
    if ($("welcome")) return;
    const welcome = document.createElement("main");
    welcome.id = "welcome";
    welcome.className = "welcome";
    welcome.hidden = true;
    welcome.innerHTML = `
      <div class="welcome-stage">
        <header class="welcome-hero">
          <svg class="lune-mark welcome-mark" viewBox="0 0 40 40" width="48" height="48" aria-hidden="true">
            <g stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.45">
              <line x1="5" y1="24" x2="35" y2="24"/><line x1="5" y1="28" x2="35" y2="28"/><line x1="5" y1="32" x2="35" y2="32"/>
            </g>
            <path fill="currentColor" d="M26.2 7.2c-5.9.9-10.4 6-10.4 12.1 0 6.1 4.5 11.2 10.4 12.1A12.2 12.2 0 0 1 14 19.3c0-6.6 5.2-12 11.8-12.2.1 0 .3 0 .4 0z"/>
          </svg>
          <p class="welcome-brand">Lune</p>
          <h1>Quiet practice.<br>Clear notes.</h1>
          <p class="welcome-lead">A night-studio companion for the hours alone at the piano — public-domain scores you can hear, letter names under the staff, a falling-key tutorial, and a plan you write yourself.</p>
          <div class="welcome-cta">
            <button type="button" class="primary big" id="btn-experience-lune">Experience Lune</button>
            <button type="button" class="quiet" id="btn-welcome-signin">I already have an account</button>
            <p class="welcome-fine">Free · no ads · sign in later to keep your studio</p>
          </div>
        </header>
        <section class="welcome-diff" aria-labelledby="welcome-diff-h">
          <p class="about-kicker">Why Lune</p>
          <h2 id="welcome-diff-h">Different on purpose.</h2>
          <ul class="welcome-diff-list">
            <li><strong>Notes that stay out of the way</strong><span>Letter names or fingers sit in their own lane under the staff — never painted on the heads.</span></li>
            <li><strong>Piano tutorial, in the room</strong><span>Falling notes onto a real keyboard view, with the same BPM slider and original-tempo marker as the score.</span></li>
            <li><strong>Your plan, not someone else’s homework</strong><span>Select the bars you need. Speak or jot a note. Lune turns it into a quiet practice plan.</span></li>
            <li><strong>Built for every reader</strong><span>Dyslexia-friendly type, large print, high contrast, braille downloads where a score has one.</span></li>
          </ul>
        </section>
        <section class="welcome-strip" aria-label="What you will try">
          <div class="welcome-strip-card"><span>Score</span><p>Hear it. Name every note.</p></div>
          <div class="welcome-strip-card"><span>Piano</span><p>Falling keys at your tempo.</p></div>
          <div class="welcome-strip-card"><span>Plan</span><p>Bars you chose. Summarised.</p></div>
        </section>
      </div>`;
    document.getElementById("app")?.appendChild(welcome);

    const onboard = document.createElement("main");
    onboard.id = "onboard";
    onboard.className = "onboard";
    onboard.hidden = true;
    onboard.innerHTML = `<div class="onboard-stage" id="onboard-stage"></div>`;
    document.getElementById("app")?.appendChild(onboard);

    const account = document.createElement("dialog");
    account.id = "create-account-dialog";
    account.className = "credits-dialog create-account-dialog";
    account.innerHTML = `
      <form method="dialog" class="credits-close-row">
        <button type="submit" class="icon-btn" aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
      </form>
      <h2>Sign in to keep using Lune</h2>
      <p>One email. We send a sign-in link — no password. Your repertoire, bar notes and practice plans sync to your account.</p>
      <form class="lp-signin" id="create-account-form">
        <label for="create-email">Email</label>
        <input id="create-email" type="email" autocomplete="email" required placeholder="you@example.com">
        <button type="submit" class="primary">Email me a link</button>
      </form>
      <p class="lp-signin-msg dim" id="create-account-msg" aria-live="polite"></p>
      <p class="dim">Under 13? Ask a parent or guardian first. No ads. No tracking.</p>`;
    document.body.appendChild(account);

    const keep = document.createElement("dialog");
    keep.id = "keep-lune-dialog";
    keep.className = "credits-dialog create-account-dialog";
    keep.innerHTML = `
      <form method="dialog" class="credits-close-row">
        <button type="submit" class="icon-btn" aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
      </form>
      <h2>Keep your studio</h2>
      <p>You’ve seen how Lune works. Sign in with email so plans and notes stay with you — on this piano tonight, and the next one.</p>
      <div class="onboard-nav">
        <button type="button" class="quiet" data-keep-later>Continue exploring</button>
        <button type="button" class="primary" data-keep-signin>Sign in with email</button>
      </div>`;
    document.body.appendChild(keep);

    welcome.querySelector("#btn-experience-lune")?.addEventListener("click", startExperience);
    welcome.querySelector("#btn-welcome-signin")?.addEventListener("click", () => openCreateAccount());
    account.querySelector("#create-account-form")?.addEventListener("submit", onCreateSubmit);
    keep.querySelector("[data-keep-later]")?.addEventListener("click", () => {
      keep.close();
      store()?.setPref?.("keepPromptDismissed", true);
    });
    keep.querySelector("[data-keep-signin]")?.addEventListener("click", () => {
      keep.close();
      openCreateAccount();
    });
  }

  function startExperience() {
    store()?.setPref?.("seenWelcome", true);
    showOnboard(0);
  }

  async function onCreateSubmit(e) {
    e.preventDefault();
    const email = $("create-email")?.value || "";
    const msg = $("create-account-msg");
    if (msg) msg.textContent = "Sending your sign-in link…";
    try {
      const res = await store().signIn(email);
      if (res?.mode === "otp") {
        if (msg) {
          msg.textContent = `Check ${email} for a link from Lune. Open it on this device to finish signing in.`;
        }
        return;
      }
      $("create-account-dialog")?.close();
      afterAuth();
    } catch (err) {
      if (msg) msg.textContent = err.message || String(err);
    }
  }

  function openCreateAccount() {
    ensureDom();
    const d = $("create-account-dialog");
    const msg = $("create-account-msg");
    if (msg) msg.textContent = "";
    if (d && !d.open) d.showModal();
    $("create-email")?.focus();
  }

  function promptKeepAccount({ force = false } = {}) {
    ensureDom();
    if (signedIn()) return;
    if (!force && store()?.prefs()?.keepPromptDismissed) return;
    if (!force && keepPromptShown) return;
    keepPromptShown = true;
    const d = $("keep-lune-dialog");
    if (d && !d.open) d.showModal();
  }

  function afterAuth() {
    if (!onboarded()) showOnboard(0);
    else enterApp();
  }

  function showWelcome() {
    ensureDom();
    hideAllMains();
    const w = $("welcome");
    if (w) w.hidden = false;
    document.body.classList.add("is-welcome");
    document.body.classList.remove("is-onboard", "is-home", "is-studio", "is-discover", "is-repertoire");
  }

  function hideAllMains() {
    ["home", "studio", "discover", "repertoire", "welcome", "onboard"].forEach((id) => {
      const el = $(id);
      if (el) el.hidden = true;
    });
  }

  function showOnboard(n = 0) {
    ensureDom();
    store()?.setPref?.("seenWelcome", true);
    step = n;
    hideAllMains();
    const o = $("onboard");
    if (o) o.hidden = false;
    document.body.classList.add("is-onboard");
    document.body.classList.remove("is-welcome", "is-home", "is-studio", "is-discover", "is-repertoire");
    paintOnboard();
  }

  function paintOnboard() {
    const stage = $("onboard-stage");
    if (!stage) return;
    const email = store().status().email || "";
    if (step === 0) {
      stage.innerHTML = `
        <p class="eyebrow">Inside Lune</p>
        <h1>How it sits beside you.</h1>
        <div class="onboard-intro">
          <article><h2>1 · Open a score</h2><p>Public-domain piano music, or your own MusicXML. Letter names or fingers under every note.</p></article>
          <article><h2>2 · Hear &amp; see the keys</h2><p>Play with a metronome in the piece’s meter. Or open Piano — falling notes onto the keyboard, speed you choose.</p></article>
          <article><h2>3 · Write your own plan</h2><p>Select the bars that won’t sit. Speak or jot a note. Lune summarises a practice plan into your Repertoire.</p></article>
        </div>
        <p class="onboard-diff">Other apps drown the page in chrome. Lune stays quiet so you can hear yourself think.</p>
        <button type="button" class="primary big" data-next>Personalise my studio</button>`;
    } else if (step === 1) {
      stage.innerHTML = `
        <p class="eyebrow">Step 1 of 3</p>
        <h1>Which composers are you into?</h1>
        <p class="onboard-help">Pick a few. We’ll recommend pieces that fit.</p>
        <div class="onboard-chips" role="group" aria-label="Composers">
          ${COMPOSERS.map(
            (c) =>
              `<button type="button" class="onboard-chip${selectedComposers.has(c) ? " on" : ""}" data-composer="${esc(c)}" aria-pressed="${selectedComposers.has(c)}">${esc(c)}</button>`
          ).join("")}
        </div>
        <div class="onboard-nav">
          <button type="button" class="quiet" data-back>Back</button>
          <button type="button" class="primary" data-next ${selectedComposers.size ? "" : "disabled"}>Continue</button>
        </div>`;
    } else if (step === 2) {
      stage.innerHTML = `
        <p class="eyebrow">Step 2 of 3</p>
        <h1>What grade do you play?</h1>
        <p class="onboard-help">Roughly ABRSM Grade 1–8. Be honest — recommendations stay kinder that way.</p>
        <div class="onboard-grades" role="radiogroup" aria-label="Grade">
          ${[1, 2, 3, 4, 5, 6, 7, 8]
            .map(
              (g) =>
                `<button type="button" class="onboard-grade${selectedGrade === g ? " on" : ""}" data-grade="${g}" aria-pressed="${selectedGrade === g}">${g}</button>`
            )
            .join("")}
        </div>
        <div class="onboard-nav">
          <button type="button" class="quiet" data-back>Back</button>
          <button type="button" class="primary" data-next>See recommendations</button>
        </div>`;
    } else {
      const recs = recommendations();
      stage.innerHTML = `
        <p class="eyebrow">Step 3 of 3</p>
        <h1>Start here tonight.</h1>
        <p class="onboard-help">Grade ${selectedGrade}${selectedComposers.size ? ` · ${[...selectedComposers].slice(0, 3).join(", ")}` : ""}. Open one — or browse from Home. Sign in whenever you want to keep everything.</p>
        <ul class="onboard-recs">
          ${recs
            .map(
              (r) => `<li>
              <button type="button" class="onboard-rec" data-open-query="${esc(r.query)}" ${r.id ? `data-open-piece="${esc(r.id)}"` : ""}>
                <strong>${esc(r.title)}</strong>
                <span>${esc(r.composer)} · about grade ${r.grade}</span>
              </button>
            </li>`
            )
            .join("")}
        </ul>
        <div class="onboard-nav">
          <button type="button" class="quiet" data-back>Back</button>
          <button type="button" class="primary" data-finish>Enter the studio</button>
        </div>`;
    }

    stage.querySelector("[data-next]")?.addEventListener("click", () => {
      if (step === 1 && !selectedComposers.size) return;
      showOnboard(step + 1);
    });
    stage.querySelector("[data-back]")?.addEventListener("click", () => showOnboard(Math.max(0, step - 1)));
    stage.querySelector("[data-finish]")?.addEventListener("click", () => finishOnboard());
    stage.querySelectorAll("[data-composer]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const c = btn.dataset.composer;
        if (selectedComposers.has(c)) selectedComposers.delete(c);
        else selectedComposers.add(c);
        paintOnboard();
      });
    });
    stage.querySelectorAll("[data-grade]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedGrade = Number(btn.dataset.grade) || 5;
        paintOnboard();
      });
    });
    stage.querySelectorAll("[data-open-piece], [data-open-query]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        finishOnboard({ quiet: true, skipKeepPrompt: true });
        if (btn.dataset.openPiece) {
          const chip = document.querySelector(`[data-open-piece="${btn.dataset.openPiece}"]`);
          if (chip) chip.click();
          else {
            const q = $("q");
            if (q) {
              q.value = btn.dataset.openQuery || btn.dataset.openPiece;
              q.form?.requestSubmit?.();
            }
          }
        } else if (btn.dataset.openQuery) {
          const q = $("q");
          if (q) {
            document.body.classList.remove("is-onboard");
            q.value = btn.dataset.openQuery;
            $("btn-search")?.click();
            q.focus();
            q.form?.requestSubmit?.();
          }
        }
        setTimeout(() => promptKeepAccount(), 1800);
      });
    });
  }

  function recommendations() {
    const grade = Math.max(1, Math.min(8, selectedGrade || 5));
    const pool = [...(GRADE_POOL[grade] || []), ...(GRADE_POOL[Math.min(8, grade + 1)] || [])];
    const composers = [...selectedComposers].map((c) => c.toLowerCase());
    const scored = pool.map((p) => {
      let s = 1;
      const blob = `${p.title} ${p.composer}`.toLowerCase();
      for (const c of composers) if (blob.includes(c.toLowerCase())) s += 3;
      if (p.grade === grade) s += 2;
      return { ...p, s };
    });
    scored.sort((a, b) => b.s - a.s);
    const seen = new Set();
    const out = [];
    for (const p of scored) {
      const k = p.title.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p);
      if (out.length >= 4) break;
    }
    return out;
  }

  function finishOnboard({ quiet = false, skipKeepPrompt = false } = {}) {
    store().setPref("onboarded", true);
    store().setPref("seenWelcome", true);
    store().setPref("grade", selectedGrade);
    store().setPref("composers", [...selectedComposers]);
    store().setPref("recommendations", recommendations());
    enterApp();
    if (!quiet) window.toast?.("Your studio is ready");
    if (!skipKeepPrompt && !signedIn()) {
      setTimeout(() => promptKeepAccount(), 1200);
    }
  }

  function enterApp() {
    const o = $("onboard");
    const w = $("welcome");
    if (o) o.hidden = true;
    if (w) w.hidden = true;
    document.body.classList.remove("is-welcome", "is-onboard");
    if (typeof window.goHome === "function") window.goHome({ keepTabs: true });
    else {
      const home = $("home");
      if (home) home.hidden = false;
      document.body.classList.add("is-home");
    }
    paintHomeRecs();
    paintKeepBanner();
    applyGateChrome();
  }

  function paintKeepBanner() {
    let bar = $("keep-account-banner");
    if (signedIn()) {
      if (bar) bar.remove();
      return;
    }
    if (!onboarded()) return;
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "keep-account-banner";
      bar.className = "keep-account-banner";
      bar.innerHTML = `
        <p>Exploring on this device. <strong>Sign in</strong> to keep plans and notes.</p>
        <button type="button" class="primary" data-lp-create-account>Sign in</button>`;
      const app = $("app");
      const header = app?.querySelector?.("header.bar");
      if (header) header.after(bar);
      else app?.prepend?.(bar);
    }
  }

  function paintHomeRecs() {
    const host = $("home-continue");
    const recs = store().prefs()?.recommendations;
    if (!host || !Array.isArray(recs) || !recs.length) return;
    if (!host.hidden && host.querySelector("[data-open]")) return;
    host.hidden = false;
    host.innerHTML = `<p class="home-continue-k">For you</p>
      <div class="home-rec-row">
        ${recs
          .slice(0, 3)
          .map(
            (r) =>
              `<button type="button" class="hero-chip" data-rec-q="${esc(r.query)}" ${r.id ? `data-open-piece="${esc(r.id)}"` : ""}>${esc(r.title)}</button>`
          )
          .join("")}
      </div>`;
    host.querySelectorAll("[data-rec-q]").forEach((b) => {
      if (b.dataset.openPiece) return;
      b.addEventListener("click", () => {
        const q = $("q");
        if (!q) return;
        q.value = b.dataset.recQ;
        q.form?.requestSubmit?.();
      });
    });
  }

  function applyGateChrome() {
    const ok = unlocked();
    document.body.classList.toggle("needs-account", !signedIn() && onboarded());
    document.body.classList.toggle("needs-onboard", !onboarded());
    ["btn-repertoire", "btn-search", "btn-home-upload", "file", "top-search"].forEach((id) => {
      const el = $(id);
      if (!el) return;
      if (id === "top-search" || id === "file") {
        el.classList.toggle("gate-disabled", !ok);
      } else {
        el.disabled = !ok && id !== "btn-search";
      }
    });
    paintKeepBanner();
  }

  /** Call before studio / repertoire actions. Returns false if still in welcome/onboard. */
  function requireUnlock() {
    ensureDom();
    if (!onboarded()) {
      if (!seenWelcome()) showWelcome();
      else showOnboard(0);
      window.toast?.("Finish the short intro to open the studio");
      return false;
    }
    return true;
  }

  /** Soft gate for cloud-kept actions (sync, download-my-data, etc.). */
  function requireSignIn(message) {
    if (signedIn()) return true;
    openCreateAccount();
    window.toast?.(message || "Sign in to keep this in your account");
    return false;
  }

  function route() {
    ensureDom();
    applyGateChrome();
    if (!seenWelcome() && !onboarded() && !signedIn()) {
      showWelcome();
      return "welcome";
    }
    if (!onboarded()) {
      const p = store().prefs();
      selectedGrade = Number(p.grade) || 5;
      selectedComposers = new Set(Array.isArray(p.composers) ? p.composers : []);
      showOnboard(0);
      return "onboard";
    }
    return "app";
  }

  function init() {
    ensureDom();
    store()?.onChange?.(() => {
      applyGateChrome();
      if (signedIn()) {
        $("keep-lune-dialog")?.close?.();
        $("create-account-dialog")?.close?.();
        if (!onboarded() && $("welcome") && !$("welcome").hidden) afterAuth();
        else if (onboarded()) paintKeepBanner();
      }
    });
    document.addEventListener("click", (e) => {
      const b = e.target.closest?.("[data-lp-create-account]");
      if (b) {
        e.preventDefault();
        openCreateAccount();
      }
    });
  }

  return {
    init,
    route,
    requireUnlock,
    requireSignIn,
    unlocked,
    signedIn,
    onboarded,
    openCreateAccount,
    promptKeepAccount,
    showWelcome,
    showOnboard,
    applyGateChrome,
    paintHomeRecs,
    recommendations,
  };
})();
