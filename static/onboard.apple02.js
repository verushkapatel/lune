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

  const WELCOME_VERSION = 2;

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
    const p = store()?.prefs() || {};
    return !!p.seenWelcome && Number(p.welcomeVersion) === WELCOME_VERSION;
  }

  function ensureDom() {
    if ($("welcome")) return;
    const welcome = document.createElement("main");
    welcome.id = "welcome";
    welcome.className = "welcome";
    welcome.hidden = true;
    welcome.innerHTML = `
      <section class="welcome-hero" aria-label="Lune">
        <div class="welcome-hero-motif" aria-hidden="true">
          <svg class="welcome-motif-mark" viewBox="0 0 40 40" focusable="false">
            <g stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.35">
              <line x1="5" y1="24" x2="35" y2="24"/><line x1="5" y1="28" x2="35" y2="28"/><line x1="5" y1="32" x2="35" y2="32"/>
            </g>
            <path fill="currentColor" d="M26.2 7.2c-5.9.9-10.4 6-10.4 12.1 0 6.1 4.5 11.2 10.4 12.1A12.2 12.2 0 0 1 14 19.3c0-6.6 5.2-12 11.8-12.2.1 0 .3 0 .4 0z"/>
          </svg>
        </div>
        <div class="welcome-hero-inner">
          <div class="welcome-lockup">
            <svg class="lune-mark welcome-mark" viewBox="0 0 40 40" width="72" height="72" aria-hidden="true">
              <g stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.45">
                <line x1="5" y1="24" x2="35" y2="24"/><line x1="5" y1="28" x2="35" y2="28"/><line x1="5" y1="32" x2="35" y2="32"/>
              </g>
              <path fill="currentColor" d="M26.2 7.2c-5.9.9-10.4 6-10.4 12.1 0 6.1 4.5 11.2 10.4 12.1A12.2 12.2 0 0 1 14 19.3c0-6.6 5.2-12 11.8-12.2.1 0 .3 0 .4 0z"/>
            </svg>
            <p class="welcome-brand">Lune</p>
          </div>
          <h1>Quiet practice.<br>Clear notes.</h1>
          <p class="welcome-lead">A night-studio companion for the hours alone at the piano — scores you can hear, letter names under the staff, falling keys at your tempo, and a plan you write yourself.</p>
          <div class="welcome-cta">
            <button type="button" class="primary big" id="btn-experience-lune">Experience Lune</button>
            <button type="button" class="quiet" id="btn-welcome-signin">I already have an account</button>
          </div>
          <p class="welcome-fine">Free · no ads · sign in later to keep your studio across devices</p>
          <button type="button" class="welcome-scroll" id="btn-welcome-scroll" aria-label="See how Lune works">
            <span>See how it works</span>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </section>

      <section class="welcome-story" id="welcome-story" aria-labelledby="welcome-story-h">
        <header class="welcome-story-head">
          <p class="about-kicker">Inside the studio</p>
          <h2 id="welcome-story-h">Three quiet tools. One place.</h2>
          <p class="welcome-story-lead">Open a score. Hear it. Name every note. Learn the keys. Write a plan for the bars that won’t sit — then keep coming back.</p>
        </header>

        <article class="welcome-chapter">
          <div class="welcome-chapter-copy">
            <p class="welcome-step">01</p>
            <h3>Every note, named</h3>
            <p>Letter names or finger numbers sit in their own lane under the staff — never painted on the heads. Toggle one or the other so the page stays readable.</p>
          </div>
          <figure class="welcome-chapter-visual" aria-hidden="true">
            <svg class="welcome-viz" viewBox="0 0 360 220" focusable="false">
              <rect x="0.5" y="0.5" width="359" height="219" rx="2" fill="#0c0c0c" stroke="#2a2a2a"/>
              <g>
                <rect x="24" y="22" width="64" height="22" rx="11" fill="#f5f5f5"/>
                <text x="40" y="37" fill="#0a0a0a" font-size="11" font-family="Fraunces, Georgia, serif">Letters</text>
                <rect x="96" y="22" width="64" height="22" rx="11" fill="none" stroke="#3a3a3a"/>
                <text x="110" y="37" fill="#757575" font-size="11" font-family="Fraunces, Georgia, serif">Fingers</text>
              </g>
              <g stroke="#3a3a3a" stroke-width="1" fill="none">
                <line x1="28" y1="72" x2="332" y2="72"/><line x1="28" y1="84" x2="332" y2="84"/>
                <line x1="28" y1="96" x2="332" y2="96"/><line x1="28" y1="108" x2="332" y2="108"/>
                <line x1="28" y1="120" x2="332" y2="120"/><line x1="28" y1="148" x2="332" y2="148"/>
                <line x1="28" y1="160" x2="332" y2="160"/><line x1="28" y1="172" x2="332" y2="172"/>
                <line x1="28" y1="184" x2="332" y2="184"/><line x1="28" y1="196" x2="332" y2="196"/>
              </g>
              <g fill="#f0f0f0">
                <ellipse cx="90" cy="102" rx="5.5" ry="4"/><rect x="94.5" y="78" width="1.5" height="24"/>
                <ellipse cx="150" cy="90" rx="5.5" ry="4"/><rect x="154.5" y="66" width="1.5" height="24"/>
                <ellipse cx="210" cy="96" rx="5.5" ry="4"/><rect x="214.5" y="72" width="1.5" height="24"/>
                <ellipse cx="90" cy="184" rx="5.5" ry="4"/><ellipse cx="90" cy="172" rx="5.5" ry="4"/><ellipse cx="90" cy="160" rx="5.5" ry="4"/>
              </g>
              <g fill="#f5f5f5" font-size="11" font-family="Fraunces, Georgia, serif" text-anchor="middle">
                <text x="90" y="136">G♯</text><text x="150" y="124">C♯</text><text x="210" y="130">E</text>
              </g>
            </svg>
          </figure>
        </article>

        <article class="welcome-chapter welcome-chapter-flip">
          <div class="welcome-chapter-copy">
            <p class="welcome-step">02</p>
            <h3>Keys that move with you</h3>
            <p>Play at any tempo. Falling notes land on a real keyboard view — same BPM slider and original-tempo marker as the score.</p>
          </div>
          <figure class="welcome-chapter-visual" aria-hidden="true">
            <svg class="welcome-viz welcome-viz-keys" viewBox="0 0 360 220" focusable="false">
              <rect x="0.5" y="0.5" width="359" height="219" rx="2" fill="#0c0c0c" stroke="#2a2a2a"/>
              <text x="24" y="36" fill="#757575" font-size="10" letter-spacing="2" font-family="Fraunces, Georgia, serif">KEYBOARD · 0.75×</text>
              <g>
                <rect x="24" y="56" width="28" height="120" fill="#f5f5f5" stroke="#0a0a0a"/>
                <rect x="52" y="56" width="28" height="120" fill="#f5f5f5" stroke="#0a0a0a"/>
                <rect class="welcome-key-lit" x="80" y="56" width="28" height="120" fill="#d8d8d8" stroke="#0a0a0a"/>
                <rect x="108" y="56" width="28" height="120" fill="#f5f5f5" stroke="#0a0a0a"/>
                <rect x="136" y="56" width="28" height="120" fill="#f5f5f5" stroke="#0a0a0a"/>
                <rect class="welcome-key-lit" x="164" y="56" width="28" height="120" fill="#d0d0d0" stroke="#0a0a0a"/>
                <rect x="192" y="56" width="28" height="120" fill="#f5f5f5" stroke="#0a0a0a"/>
                <rect x="220" y="56" width="28" height="120" fill="#f5f5f5" stroke="#0a0a0a"/>
                <rect x="248" y="56" width="28" height="120" fill="#f5f5f5" stroke="#0a0a0a"/>
                <rect x="276" y="56" width="28" height="120" fill="#f5f5f5" stroke="#0a0a0a"/>
                <rect x="304" y="56" width="28" height="120" fill="#f5f5f5" stroke="#0a0a0a"/>
                <rect x="42" y="56" width="18" height="72" fill="#111"/><rect x="70" y="56" width="18" height="72" fill="#111"/>
                <rect x="126" y="56" width="18" height="72" fill="#111"/><rect x="154" y="56" width="18" height="72" fill="#111"/>
                <rect x="182" y="56" width="18" height="72" fill="#111"/><rect x="238" y="56" width="18" height="72" fill="#111"/>
                <rect x="266" y="56" width="18" height="72" fill="#111"/>
                <text x="94" y="158" text-anchor="middle" fill="#0a0a0a" font-size="14" font-family="Fraunces, Georgia, serif">2</text>
                <text x="178" y="158" text-anchor="middle" fill="#0a0a0a" font-size="14" font-family="Fraunces, Georgia, serif">5</text>
              </g>
            </svg>
          </figure>
        </article>

        <article class="welcome-chapter">
          <div class="welcome-chapter-copy">
            <p class="welcome-step">03</p>
            <h3>Your plan, not homework</h3>
            <p>Select the bars that won’t sit. Speak or jot a note. Lune summarises a quiet practice plan into your repertoire — yours to keep.</p>
          </div>
          <figure class="welcome-chapter-visual" aria-hidden="true">
            <svg class="welcome-viz" viewBox="0 0 360 220" focusable="false">
              <rect x="0.5" y="0.5" width="359" height="219" rx="2" fill="#0c0c0c" stroke="#2a2a2a"/>
              <text x="24" y="36" fill="#757575" font-size="10" letter-spacing="2" font-family="Fraunces, Georgia, serif">PRACTICE PLAN</text>
              <text x="24" y="72" fill="#f0f0f0" font-size="22" font-family="Fraunces, Georgia, serif">Bars 17–20 · left hand</text>
              <text x="24" y="104" fill="#9a9a9a" font-size="14" font-family="Fraunces, Georgia, serif">Hands separate at 60. Then together, soft.</text>
              <g stroke="#3a3a3a" fill="none">
                <rect x="24" y="128" width="88" height="56" rx="2"/><rect x="124" y="128" width="88" height="56" rx="2"/>
                <rect x="224" y="128" width="88" height="56" rx="2" stroke="#f0f0f0"/>
              </g>
              <text x="268" y="162" text-anchor="middle" fill="#f0f0f0" font-size="12" font-family="Fraunces, Georgia, serif">selected</text>
            </svg>
          </figure>
        </article>
      </section>

      <section class="welcome-diff" aria-labelledby="welcome-diff-h">
        <p class="about-kicker">Why Lune</p>
        <h2 id="welcome-diff-h">Different on purpose.</h2>
        <ul class="welcome-diff-list">
          <li><strong>Notes that stay out of the way</strong><span>Letter names or fingers under the staff — never on the heads.</span></li>
          <li><strong>Piano tutorial, in the room</strong><span>Falling notes onto a keyboard view, same tempo control as the score.</span></li>
          <li><strong>Built for every reader</strong><span>Easy read type, large print, high contrast, braille when a score has one.</span></li>
          <li><strong>No account required to try</strong><span>Experience the full studio first. Sign in only when you want plans and notes to travel with you.</span></li>
        </ul>
      </section>

      <section class="welcome-close" aria-label="Begin">
        <p class="welcome-close-brand">Lune</p>
        <h2>Ready when you are.</h2>
        <p>A short personalisation — composers and grade — then the studio opens. Sign in whenever you want to keep it.</p>
        <div class="welcome-cta">
          <button type="button" class="primary big" id="btn-experience-lune-2">Experience Lune</button>
          <button type="button" class="quiet" id="btn-welcome-signin-2">I already have an account</button>
        </div>
      </section>`;
    document.getElementById("app")?.appendChild(welcome);

    const onboard = document.createElement("main");
    onboard.id = "onboard";
    onboard.className = "onboard";
    onboard.hidden = true;
    onboard.innerHTML = `<div class="onboard-stage" id="onboard-stage"></div>`;
    document.getElementById("app")?.appendChild(onboard);

    const account = document.createElement("dialog");
    account.id = "create-account-dialog";
    account.className = "credits-dialog auth-dialog";
    account.innerHTML = `
      <form method="dialog" class="credits-close-row">
        <button type="submit" class="icon-btn" aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
      </form>
      <p class="auth-kicker">Lune</p>
      <h2 id="auth-title">Make Lune yours</h2>
      <p class="create-account-story">Free forever — no payments, no ads. Built by a fifteen-year-old who wanted piano practice to feel a little easier. Named for <em>Clair de lune</em>: the piece that steadies things when practice feels lost.</p>
      <form class="auth-form" id="create-account-form">
        <div class="auth-step" id="auth-step-email">
          <label for="create-email">Email</label>
          <input id="create-email" type="email" autocomplete="email" required placeholder="you@example.com">
          <button type="submit" class="primary auth-submit" id="auth-send-btn">Email me a code</button>
          <p class="auth-inline-hint dim">One email. We send an 8-digit code — no password.</p>
        </div>
        <div class="auth-step" id="auth-step-code" hidden>
          <p class="auth-code-hint">Enter the 8-digit code we sent to <strong id="auth-email-display"></strong>.</p>
          <label for="create-code">Code</label>
          <input id="create-code" type="text" inputmode="numeric" pattern="[0-9]{6,8}" maxlength="8" autocomplete="one-time-code" placeholder="00000000" spellcheck="false" enterkeyhint="done">
          <button type="submit" class="primary auth-submit" id="auth-verify-btn">Verify &amp; sign in</button>
          <div class="auth-alt">
            <button type="button" class="quiet" id="auth-resend">Resend code</button>
            <button type="button" class="quiet" id="auth-change-email">Different email</button>
          </div>
        </div>
      </form>
      <p class="auth-msg dim" id="create-account-msg" aria-live="polite"></p>
      <p class="auth-foot dim">Under 13? Ask a parent or guardian first. No ads. No tracking. No payments. Reply to the email anytime with feedback.</p>`;
    document.body.appendChild(account);

    const keep = document.createElement("dialog");
    keep.id = "keep-lune-dialog";
    keep.className = "credits-dialog auth-dialog";
    keep.innerHTML = `
      <form method="dialog" class="credits-close-row">
        <button type="submit" class="icon-btn" aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
      </form>
      <p class="auth-kicker">Your studio</p>
      <h2>Make Lune yours</h2>
      <p class="create-account-story">Free forever. Sign in with email so repertoire, bar notes, and practice plans stay with you — no password, just a short code.</p>
      <div class="onboard-nav auth-keep-nav">
        <button type="button" class="quiet" data-keep-later>Keep exploring</button>
        <button type="button" class="primary" data-keep-signin>Get started</button>
      </div>`;
    document.body.appendChild(keep);

    const bindExperience = (sel) =>
      welcome.querySelector(sel)?.addEventListener("click", startExperience);
    const bindSignin = (sel) =>
      welcome.querySelector(sel)?.addEventListener("click", () => openCreateAccount());
    bindExperience("#btn-experience-lune");
    bindExperience("#btn-experience-lune-2");
    bindSignin("#btn-welcome-signin");
    bindSignin("#btn-welcome-signin-2");
    welcome.querySelector("#btn-welcome-scroll")?.addEventListener("click", () => {
      $("welcome-story")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    account.querySelector("#create-account-form")?.addEventListener("submit", onCreateSubmit);
    account.querySelector("#auth-resend")?.addEventListener("click", onAuthResend);
    account.querySelector("#auth-change-email")?.addEventListener("click", () => resetAuthForm({ focus: true }));
    const codeInput = account.querySelector("#create-code");
    const normalizeCodeInput = (el) => {
      if (!el) return "";
      const digits = String(el.value || "").replace(/\D+/g, "").slice(0, 8);
      if (el.value !== digits) el.value = digits;
      return digits;
    };
    codeInput?.addEventListener("input", () => normalizeCodeInput(codeInput));
    codeInput?.addEventListener("paste", (ev) => {
      ev.preventDefault();
      const pasted = (ev.clipboardData || window.clipboardData)?.getData("text") || "";
      codeInput.value = String(pasted).replace(/\D+/g, "").slice(0, 8);
      normalizeCodeInput(codeInput);
    });
    keep.querySelector("[data-keep-later]")?.addEventListener("click", () => {
      keep.close();
      store()?.setPref?.("keepPromptDismissed", true);
    });
    keep.querySelector("[data-keep-signin]")?.addEventListener("click", () => {
      keep.close();
      openCreateAccount();
    });
  }

  let authPendingEmail = "";

  function resetAuthForm({ focus = false } = {}) {
    authPendingEmail = "";
    const emailStep = $("auth-step-email");
    const codeStep = $("auth-step-code");
    const msg = $("create-account-msg");
    const title = $("auth-title");
    const code = $("create-code");
    const email = $("create-email");
    if (emailStep) emailStep.hidden = false;
    if (codeStep) codeStep.hidden = true;
    if (code) {
      code.value = "";
      code.required = false;
      code.removeAttribute("required");
    }
    if (email) email.required = true;
    if (msg) msg.textContent = "";
    if (title) title.textContent = "Make Lune yours";
    if (focus) email?.focus();
  }

  function showAuthCodeStep(email) {
    authPendingEmail = email;
    const emailStep = $("auth-step-email");
    const codeStep = $("auth-step-code");
    const title = $("auth-title");
    const display = $("auth-email-display");
    const msg = $("create-account-msg");
    const emailInput = $("create-email");
    const code = $("create-code");
    if (emailStep) emailStep.hidden = true;
    if (codeStep) codeStep.hidden = false;
    if (emailInput) emailInput.required = false;
    if (title) title.textContent = "Enter your code";
    if (display) display.textContent = email;
    if (msg) msg.textContent = "";
    if (code) {
      code.value = "";
      code.required = true;
      code.focus();
    }
  }

  function startExperience() {
    store()?.setPref?.("seenWelcome", true);
    store()?.setPref?.("welcomeVersion", WELCOME_VERSION);
    showOnboard(0);
  }

  async function onCreateSubmit(e) {
    e.preventDefault();
    const msg = $("create-account-msg");
    const codeStep = $("auth-step-code");
    const verifying = codeStep && !codeStep.hidden;

    if (verifying) {
      const raw = $("create-code");
      const code = String(raw?.value || "").replace(/\D+/g, "").slice(0, 8);
      if (raw) raw.value = code;
      if (msg) msg.textContent = "Checking your code…";
      try {
        await store().verifyOtp(authPendingEmail, code);
        $("create-account-dialog")?.close();
        resetAuthForm();
        afterAuth();
      } catch (err) {
        if (msg) msg.textContent = err.message || String(err);
      }
      return;
    }

    const email = $("create-email")?.value || "";
    if (msg) msg.textContent = "Sending a code…";
    try {
      const res = await store().signIn(email);
      if (res?.mode === "otp") {
        showAuthCodeStep(res.email);
        return;
      }
      $("create-account-dialog")?.close();
      resetAuthForm();
      afterAuth();
    } catch (err) {
      if (msg) msg.textContent = err.message || String(err);
    }
  }

  async function onAuthResend() {
    const msg = $("create-account-msg");
    if (!authPendingEmail) return;
    if (msg) msg.textContent = "Sending another code…";
    try {
      await store().signIn(authPendingEmail);
      if (msg) msg.textContent = "Code sent — check your inbox.";
    } catch (err) {
      if (msg) msg.textContent = err.message || String(err);
    }
  }

  function openCreateAccount() {
    ensureDom();
    resetAuthForm();
    const d = $("create-account-dialog");
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
    if (w) {
      w.hidden = false;
      w.scrollTop = 0;
    }
    document.body.classList.add("is-welcome");
    document.body.classList.remove("is-onboard", "is-home", "is-studio", "is-discover", "is-repertoire");
    window.scrollTo?.(0, 0);
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

  function progressHtml(active) {
    const labels = ["Meet Lune", "Composers", "Grade", "Tonight"];
    return `<ol class="onboard-progress" aria-label="Onboarding progress">
      ${labels
        .map(
          (label, i) =>
            `<li class="${i === active ? "on" : i < active ? "done" : ""}"><span>${i + 1}</span><em>${label}</em></li>`
        )
        .join("")}
    </ol>`;
  }

  function paintOnboard() {
    const stage = $("onboard-stage");
    if (!stage) return;
    if (step === 0) {
      stage.innerHTML = `
        ${progressHtml(0)}
        <p class="eyebrow">A minute with the studio</p>
        <h1>How Lune sits beside you.</h1>
        <p class="onboard-help">Other practice apps drown the page in chrome. Lune stays quiet so you can hear yourself think.</p>
        <div class="onboard-intro">
          <article>
            <span class="onboard-intro-n">01</span>
            <h2>Open a score</h2>
            <p>Public-domain piano music, or your own MusicXML. Letter names or fingers under every note.</p>
          </article>
          <article>
            <span class="onboard-intro-n">02</span>
            <h2>Hear &amp; see the keys</h2>
            <p>Play with a metronome in the piece’s meter. Or open Piano — falling notes onto the keyboard, at the speed you choose.</p>
          </article>
          <article>
            <span class="onboard-intro-n">03</span>
            <h2>Write your own plan</h2>
            <p>Select the bars that won’t sit. Speak or jot a note. Lune summarises a practice plan into your Repertoire.</p>
          </article>
        </div>
        <button type="button" class="primary big" data-next>Personalise my studio</button>
        <p class="onboard-diff">No account needed yet — sign in later to keep plans across devices.</p>`;
    } else if (step === 1) {
      stage.innerHTML = `
        ${progressHtml(1)}
        <p class="eyebrow">Taste</p>
        <h1>Which composers are you into?</h1>
        <p class="onboard-help">Pick a few. We’ll recommend pieces that fit how you play.</p>
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
        ${progressHtml(2)}
        <p class="eyebrow">Level</p>
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
        ${progressHtml(3)}
        <p class="eyebrow">Tonight</p>
        <h1>Start here.</h1>
        <p class="onboard-help">Grade ${selectedGrade}${selectedComposers.size ? ` · ${[...selectedComposers].slice(0, 3).join(", ")}` : ""}. Open one now — or enter the studio and browse. Sign in whenever you want to keep everything.</p>
        <ul class="onboard-recs">
          ${recs
            .map(
              (r, i) => `<li>
              <button type="button" class="onboard-rec${i === 0 ? " onboard-rec-featured" : ""}" data-open-query="${esc(r.query)}" ${r.id ? `data-open-piece="${esc(r.id)}"` : ""}>
                ${i === 0 ? `<span class="onboard-rec-tag">Suggested first</span>` : ""}
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
        const gateId = btn.dataset.openPiece || btn.dataset.openQuery || "";
        if (!requirePieceAccess(gateId)) return;
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
    store().setPref("welcomeVersion", WELCOME_VERSION);
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
        <p>Exploring on this device. <strong>Make Lune yours</strong> when you want plans and notes to stay with you — free forever.</p>
        <button type="button" class="primary" data-lp-create-account>Get started</button>`;
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
    const authed = signedIn();
    document.body.classList.toggle("is-signed-in", authed);
    document.body.classList.toggle("needs-account", !authed && onboarded());
    document.body.classList.toggle("needs-onboard", !onboarded());
    // Guests never see search on the pre-signin landing; studio search returns after sign-in.
    ["btn-repertoire", "btn-search", "btn-home-upload", "file", "top-search"].forEach((id) => {
      const el = $(id);
      if (!el) return;
      if (id === "btn-search" || id === "top-search") {
        el.hidden = !authed;
        el.classList.toggle("gate-disabled", !authed);
        if (id === "btn-search") el.disabled = !authed;
        return;
      }
      if (id === "file") {
        el.classList.toggle("gate-disabled", !ok);
      } else {
        el.disabled = !ok;
      }
    });
    if (!authed) {
      document.body.classList.remove("phone-search-open", "studio-search-open");
      $("btn-search")?.setAttribute("aria-expanded", "false");
    }
    paintKeepBanner();
  }

  /** Admit guests into the studio from the landing — no wall, no redirect. */
  function admitGuest() {
    if (onboarded()) return;
    store()?.setPref?.("onboarded", true);
    store()?.setPref?.("seenWelcome", true);
    store()?.setPref?.("welcomeVersion", WELCOME_VERSION);
    if (store()?.prefs?.()?.grade == null) store()?.setPref?.("grade", selectedGrade || 5);
    applyGateChrome();
    paintKeepBanner();
  }

  function requireUnlock() {
    ensureDom();
    admitGuest();
    return true;
  }

  /** Soft gate for cloud-kept actions (sync, download-my-data, etc.). */
  function requireSignIn(message) {
    if (signedIn()) return true;
    openCreateAccount();
    window.toast?.(message || "Sign in to keep this in your account");
    return false;
  }

  /** Clair de lune (and matching catalogue ids) require a signed-in account to open. */
  function isSignInPiece(pieceOrId) {
    const raw =
      typeof pieceOrId === "string"
        ? pieceOrId
        : [pieceOrId?.id, pieceOrId?.openQuery, pieceOrId?.query, pieceOrId?.title, pieceOrId?.hay]
            .filter(Boolean)
            .join(" ");
    const s = String(raw || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return (
      s.includes("debussy-clair-de-lune") ||
      s.includes("clair de lune") ||
      s.includes("clair-de-lune") ||
      /\bclair\s*de\s*lune\b/.test(s)
    );
  }

  function requirePieceAccess(pieceOrId, message) {
    if (!isSignInPiece(pieceOrId)) return true;
    return requireSignIn(message || "Sign in free to open Clair de lune");
  }

  /** Landing page first. Optional personalise / account — never a gate wall. */
  function route() {
    ensureDom();
    store()?.setPref?.("seenWelcome", true);
    store()?.setPref?.("welcomeVersion", WELCOME_VERSION);
    const w = $("welcome");
    const o = $("onboard");
    if (w) w.hidden = true;
    if (o) o.hidden = true;
    document.body.classList.remove("is-welcome", "is-onboard");
    applyGateChrome();
    return "app";
  }

  const TOUR_STEPS = [
    {
      id: "letters",
      title: "Letter names under the staff",
      body: "Open the score. Toggle Letters — names sit in their own lane under every note, never painted on the heads.",
      panel: "score",
      action: "letters",
    },
    {
      id: "play",
      title: "Hear it at your tempo",
      body: "Press Play. Drag the tempo slider — the marker shows the original bpm. Turn the metronome on if you want the pulse.",
      panel: "score",
      action: "play",
    },
    {
      id: "piano",
      title: "Piano mode — falling keys",
      body: "Open Piano. Notes fall onto the keyboard like MuseScore’s tutorial view. Filter Right / Left hand. Same tempo as the score.",
      panel: "piano",
      action: "piano",
    },
    {
      id: "ask",
      title: "Tap a hard bar",
      body: "Back on Score, click a bar. The coach lists the notes, suggested fingers, and a quiet way to practise it.",
      panel: "score",
      action: "ask",
    },
    {
      id: "access",
      title: "Easy read & braille",
      body: "Tap Aa for Easy read letters (Atkinson Hyperlegible). When this piece has braille, the Braille chip downloads a .brf for an embosser or display.",
      panel: "explain",
      action: "access",
    },
    {
      id: "plan",
      title: "Your practice plan",
      body: "Select bars, speak or jot a note, save a plan into Repertoire. Sign in later if you want it on every device.",
      panel: "score",
      action: "plan",
    },
  ];

  let tourStep = 0;
  let tourActive = false;

  function ensureTourDom() {
    if ($("lune-tour")) return;
    const tip = document.createElement("aside");
    tip.id = "lune-tour";
    tip.className = "lune-tour";
    tip.hidden = true;
    tip.innerHTML = `
      <p class="lune-tour-kicker" id="lune-tour-kicker">Walkthrough</p>
      <h2 id="lune-tour-title"></h2>
      <p id="lune-tour-body"></p>
      <div class="lune-tour-nav">
        <button type="button" class="quiet" id="lune-tour-skip">Skip</button>
        <button type="button" class="quiet" id="lune-tour-back">Back</button>
        <button type="button" class="primary" id="lune-tour-next">Next</button>
      </div>`;
    document.body.appendChild(tip);
    tip.querySelector("#lune-tour-skip")?.addEventListener("click", endTour);
    tip.querySelector("#lune-tour-back")?.addEventListener("click", () => paintTour(Math.max(0, tourStep - 1)));
    tip.querySelector("#lune-tour-next")?.addEventListener("click", () => {
      if (tourStep >= TOUR_STEPS.length - 1) endTour({ done: true });
      else paintTour(tourStep + 1);
    });
  }

  function applyTourAction(step) {
    const tab =
      document.querySelector(`.studio-tab[data-panel="${step.panel}"]`) ||
      document.querySelector(`button[data-panel="${step.panel}"]`);
    if (tab) tab.click();
    if (step.action === "letters") {
      document.getElementById("anno-notes")?.click?.();
    }
    if (step.action === "play") {
      setTimeout(() => {
        const play = document.getElementById("btn-play-range");
        if (play && play.getAttribute("aria-pressed") !== "true") play.click();
      }, 500);
    }
    if (step.action === "piano") {
      document.querySelector('.studio-tab[data-panel="piano"]')?.click?.();
      setTimeout(() => {
        const play = document.getElementById("btn-play-range");
        if (play && play.getAttribute("aria-pressed") !== "true") play.click();
      }, 700);
    }
    if (step.action === "access") {
      document.querySelector('.studio-tab[data-panel="explain"]')?.click?.();
      document.getElementById("btn-dyslexia-explain")?.classList.add("tour-pulse");
      document.getElementById("btn-braille-explain")?.classList.add("tour-pulse");
      document.getElementById("btn-dyslexia-score")?.classList.add("tour-pulse");
      document.getElementById("btn-braille-score")?.classList.add("tour-pulse");
    } else {
      document.querySelectorAll(".tour-pulse").forEach((el) => el.classList.remove("tour-pulse"));
    }
  }

  function paintTour(n) {
    ensureTourDom();
    tourStep = n;
    tourActive = true;
    const step = TOUR_STEPS[n];
    const tip = $("lune-tour");
    if (!tip || !step) return;
    tip.hidden = false;
    const k = $("lune-tour-kicker");
    const t = $("lune-tour-title");
    const b = $("lune-tour-body");
    const next = $("lune-tour-next");
    const back = $("lune-tour-back");
    if (k) k.textContent = `Clair de lune · ${n + 1} / ${TOUR_STEPS.length}`;
    if (t) t.textContent = step.title;
    if (b) b.textContent = step.body;
    if (next) next.textContent = n >= TOUR_STEPS.length - 1 ? "Start practising" : "Next";
    if (back) back.hidden = n === 0;
    applyTourAction(step);
  }

  function endTour({ done = false } = {}) {
    tourActive = false;
    const tip = $("lune-tour");
    if (tip) tip.hidden = true;
    document.querySelectorAll(".tour-pulse").forEach((el) => el.classList.remove("tour-pulse"));
    if (done) {
      window.toast?.("Studio’s yours — sign in anytime to keep plans");
      if (!signedIn()) setTimeout(() => promptKeepAccount(), 1600);
    }
  }

  function startPieceWalkthrough(pieceId = "debussy-clair-de-lune") {
    requireUnlock();
    if (!requirePieceAccess(pieceId)) return;
    const open = () => {
      const chip =
        document.querySelector(`[data-open-piece="${pieceId}"]`) ||
        document.querySelector(`#hero-chips [data-open-piece="${pieceId}"]`);
      if (chip) chip.click();
      else {
        const q = $("q");
        if (q) {
          q.value = pieceId.includes("clair") ? "clair de lune" : pieceId;
          q.form?.requestSubmit?.();
        }
      }
      setTimeout(() => paintTour(0), 900);
    };
    open();
  }

  /* —— Landing simulation (Apple-style product walkthrough) —— */
  /**
   * Two-octave C–B keyboard: 14 whites + 10 blacks in acoustic pattern
   * (C# D# · F# G# A# × 2). --n = white index before each black key.
   */
  const SIM_PIANO_HTML = `
    <div class="sim-piano">
      <div class="sim-piano-chrome">
        <span class="sim-pill on">Both</span>
        <span class="sim-pill">RH</span>
        <span class="sim-pill">LH</span>
        <span class="sim-piano-meta">KEYBOARD · 0.75×</span>
      </div>
      <div class="sim-fall" aria-hidden="true">
        <b class="rh" style="--col:2;--h:48%;--d:0s"></b>
        <b class="lh" style="--col:4;--h:32%;--d:0.35s"></b>
        <b class="rh" style="--col:6;--h:62%;--d:0.7s"></b>
        <b class="rh black-note" style="--col:3;--h:38%;--d:1.05s"></b>
        <b class="lh" style="--col:9;--h:44%;--d:1.4s"></b>
        <b class="rh" style="--col:11;--h:52%;--d:1.75s"></b>
        <div class="sim-fall-hit"></div>
      </div>
      <div class="sim-piano-board" role="img" aria-label="Two-octave piano keyboard">
        <div class="sim-piano-rail"></div>
        <div class="sim-piano-felt"></div>
        <div class="sim-piano-whites">
          <i class="w" data-pc="C"></i><i class="w" data-pc="D"></i><i class="w on" data-pc="E"></i><i class="w" data-pc="F"></i>
          <i class="w" data-pc="G"></i><i class="w on" data-pc="A"></i><i class="w" data-pc="B"></i>
          <i class="w" data-pc="C"></i><i class="w" data-pc="D"></i><i class="w on" data-pc="E"></i><i class="w" data-pc="F"></i>
          <i class="w" data-pc="G"></i><i class="w" data-pc="A"></i><i class="w" data-pc="B"></i>
        </div>
        <div class="sim-piano-blacks" aria-hidden="true">
          <i class="bk" style="--n:0"></i><i class="bk" style="--n:1"></i>
          <i class="bk on" style="--n:3"></i><i class="bk" style="--n:4"></i><i class="bk" style="--n:5"></i>
          <i class="bk" style="--n:7"></i><i class="bk" style="--n:8"></i>
          <i class="bk" style="--n:10"></i><i class="bk" style="--n:11"></i><i class="bk" style="--n:12"></i>
        </div>
      </div>
    </div>`;

  const SIM_SCENES = [
    {
      title: "Letter names under the staff",
      body: "Names sit in their own lane — never painted on the note heads. Toggle Letters or Fingers whenever you like.",
      html: `<div class="sim-card">
          <div class="sim-ui-bar"><span class="sim-pill on">Letters</span><span class="sim-pill">Fingers</span><span class="sim-pill">Off</span></div>
          <div class="sim-staff"><div class="sim-staff-line"></div><div class="sim-staff-line"></div><div class="sim-staff-line"></div><div class="sim-staff-line"></div><div class="sim-staff-line"></div></div>
          <div class="sim-notes"><span><i></i>G♯</span><span><i></i>C♯</span><span><i></i>E</span><span><i></i>B♭</span></div>
        </div>`,
    },
    {
      title: "Hear it at your tempo",
      body: "Press Play. The slider is marked at the original bpm. Turn the metronome on if you want the pulse in the piece’s meter.",
      html: `<div class="sim-card">
          <div class="sim-ui-bar"><span class="sim-pill on">Play</span><span class="sim-pill">72 bpm</span><span class="sim-pill">♩= orig</span></div>
          <div class="sim-staff"><div class="sim-staff-line"></div><div class="sim-staff-line"></div><div class="sim-staff-line"></div><div class="sim-staff-line"></div><div class="sim-staff-line"></div></div>
          <div class="sim-playhead"><em></em></div>
        </div>`,
    },
    {
      title: "Piano mode — falling keys",
      body: "Notes drop onto a real keyboard. Filter right hand, left hand, or both — same tempo as the score.",
      html: SIM_PIANO_HTML,
      full: true,
    },
    {
      title: "Tap a hard bar",
      body: "Click the bar that won’t sit. The coach lists notes, suggested fingers, and a quiet way to practise it.",
      html: `<div class="sim-card sim-ask">
          <div class="sim-ask-score"><div class="sim-ask-hilite"></div></div>
          <div class="sim-ask-panel"><strong>Ask · Bar 7</strong><span>RH · G♯ C♯ E</span><span>Fingers · 2 1 3</span><span>Keep the triad quiet under the melody.</span></div>
        </div>`,
    },
    {
      title: "Easy read & braille",
      body: "Tap Aa for Easy read letters (Atkinson Hyperlegible). When a score has braille, download a .brf for an embosser or display.",
      html: `<div class="sim-card">
          <div class="sim-ui-bar"><span class="sim-pill on">Aa Easy read</span><span class="sim-pill on">Braille</span><span class="sim-pill">Access</span></div>
          <p class="sim-access-sample">G♯ · C♯ · E · B♭</p>
          <div class="sim-access-row"><span class="sim-pill on">Aa</span><span class="sim-pill on">Braille · .brf</span></div>
        </div>`,
    },
    {
      title: "Your practice plan",
      body: "Select bars, speak or jot a note. Lune summarises a plan into your Repertoire — yours to keep.",
      html: `<div class="sim-card"><div class="sim-plan"><strong>Bars 17–20 · left hand</strong><span>Hands separate at 60. Then together, soft. Saved to Repertoire.</span></div></div>`,
    },
  ];

  let simIndex = 0;
  let simTimer = 0;
  let simReady = false;

  function paintSim(n, { auto = false } = {}) {
    const frame = $("sim-frame");
    const title = $("sim-title");
    const body = $("sim-body");
    const kicker = $("sim-kicker");
    const tryBox = $("sim-try");
    const next = $("sim-next");
    const prev = $("sim-prev");
    if (!frame || !SIM_SCENES.length) return;
    simIndex = Math.max(0, Math.min(SIM_SCENES.length - 1, n));
    const scene = SIM_SCENES[simIndex];
    const scenes = frame.querySelectorAll(".sim-scene");
    scenes.forEach((el, i) => el.classList.toggle("on", i === simIndex));
    if (title) title.textContent = scene.title;
    if (body) body.textContent = scene.body;
    if (kicker) kicker.textContent = `${String(simIndex + 1).padStart(2, "0")} / ${String(SIM_SCENES.length).padStart(2, "0")}`;
    $("sim-dots")?.querySelectorAll(".sim-dot").forEach((d, i) => d.classList.toggle("on", i === simIndex));
    if (prev) prev.disabled = simIndex === 0;
    const last = simIndex >= SIM_SCENES.length - 1;
    if (next) next.textContent = last ? "Make Lune yours" : "Next";
    if (tryBox) tryBox.hidden = !last;
    if (!auto) restartSimTimer();
  }

  function restartSimTimer() {
    clearInterval(simTimer);
    simTimer = setInterval(() => {
      if (simIndex < SIM_SCENES.length - 1) paintSim(simIndex + 1, { auto: true });
      else clearInterval(simTimer);
    }, 4200);
  }

  function initSim() {
    const frame = $("sim-frame");
    const dots = $("sim-dots");
    if (!frame || !dots || simReady) return;
    simReady = true;
    frame.innerHTML = SIM_SCENES.map(
      (s, i) =>
        `<div class="sim-scene${i === 0 ? " on" : ""}${s.full ? " sim-scene-full" : ""}" data-sim="${i}">${s.html}</div>`
    ).join("");
    dots.innerHTML = SIM_SCENES.map((_, i) => `<button type="button" class="sim-dot${i === 0 ? " on" : ""}" data-sim-dot="${i}" aria-label="Step ${i + 1}"></button>`).join("");
    $("sim-next")?.addEventListener("click", () => {
      if (simIndex >= SIM_SCENES.length - 1) {
        clearInterval(simTimer);
        $("sim-try")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      paintSim(simIndex + 1);
    });
    $("sim-prev")?.addEventListener("click", () => paintSim(simIndex - 1));
    dots.addEventListener("click", (e) => {
      const b = e.target.closest?.("[data-sim-dot]");
      if (!b) return;
      paintSim(Number(b.dataset.simDot) || 0);
    });
    paintSim(0);
    // Autoplay when the sim scrolls into view
    const root = $("tour");
    if (root && "IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((en) => en.isIntersecting)) restartSimTimer();
          else clearInterval(simTimer);
        },
        { threshold: 0.35 }
      );
      io.observe(root);
    } else restartSimTimer();
  }

  function jumpToSim() {
    initSim();
    $("tour")?.scrollIntoView({ behavior: "smooth", block: "start" });
    paintSim(0);
  }

  function init() {
    ensureDom();
    ensureTourDom();
    initSim();
    store()?.onChange?.(() => {
      applyGateChrome();
      if (signedIn()) {
        $("keep-lune-dialog")?.close?.();
        $("create-account-dialog")?.close?.();
        if (onboarded()) paintKeepBanner();
      }
    });
    document.addEventListener("click", (e) => {
      const b = e.target.closest?.("[data-lp-create-account]");
      if (b) {
        e.preventDefault();
        openCreateAccount();
      }
      const sim = e.target.closest?.("[data-lp-sim]");
      if (sim) {
        e.preventDefault();
        jumpToSim();
      }
      const walk = e.target.closest?.("[data-lp-walkthrough]");
      if (walk) {
        e.preventDefault();
        jumpToSim();
      }
      const personalise = e.target.closest?.("[data-lp-personalise]");
      if (personalise) {
        e.preventDefault();
        showOnboard(1);
      }
    });
  }

  return {
    init,
    route,
    requireUnlock,
    requireSignIn,
    requirePieceAccess,
    isSignInPiece,
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
    startPieceWalkthrough,
    endTour,
  };
})();
