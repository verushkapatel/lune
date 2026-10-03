/* Lune — questionnaire first, then email OTP, then recommendations.
 * Soft gate (“Make Lune yours”) opens the immersive path. Guests can open
 * Clair de lune; search stays signed-in-only. Prefs: localStorage + profiles.prefs when cloud.
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

  const COMPOSER_FACE_V = "faces01";
  const COMPOSER_FACES = {
    Bach: "bach.jpg",
    Handel: "handel.jpg",
    Scarlatti: "scarlatti.jpg",
    Vivaldi: "vivaldi.jpg",
    Telemann: "telemann.jpg",
    Purcell: "purcell.jpg",
    Pachelbel: "pachelbel.jpg",
    Haydn: "haydn.jpg",
    Mozart: "mozart.jpg",
    Beethoven: "beethoven.jpg",
    Clementi: "clementi.jpg",
    Czerny: "czerny.jpg",
    Schubert: "schubert.jpg",
    Mendelssohn: "mendelssohn.jpg",
    Schumann: "schumann.jpg",
    Chopin: "chopin.jpg",
    Liszt: "liszt.jpg",
    Brahms: "brahms.jpg",
    Field: "field.jpg",
    Burgmüller: "burgmuller.jpg",
    Weber: "weber.jpg",
    Gluck: "gluck.jpg",
    Franck: "franck.jpg",
    Tchaikovsky: "tchaikovsky.jpg",
    Mussorgsky: "mussorgsky.jpg",
    "Rimsky-Korsakov": "rimsky.jpg",
    Rachmaninoff: "rachmaninoff.jpg",
    Scriabin: "scriabin.jpg",
    Prokofiev: "prokofiev.jpg",
    Debussy: "debussy.jpg",
    Ravel: "ravel.jpg",
    Fauré: "faure.jpg",
    "Saint-Saëns": "saint-saens.jpg",
    Satie: "satie.jpg",
    Poulenc: "poulenc.jpg",
    Grieg: "grieg.jpg",
    Dvořák: "dvorak.jpg",
    Sibelius: "sibelius.jpg",
    Bartók: "bartok.jpg",
    Albéniz: "albeniz.jpg",
    Granados: "granados.jpg",
    Busoni: "busoni.jpg",
    Moszkowski: "moszkowski.jpg",
    Paderewski: "paderewski.jpg",
    MacDowell: "macdowell.jpg",
    Gottschalk: "gottschalk.jpg",
    Joplin: "joplin.jpg",
    Gershwin: "gershwin.jpg",
  };
  const COMPOSERS = Object.keys(COMPOSER_FACES);
  /** Extra names from the live library (silhouette if no portrait). */
  let libraryComposerNames = [];

  const LEVELS = [
    { g: 1, name: "Beginner", blurb: "First pieces · ABRSM 1" },
    { g: 2, name: "Elementary", blurb: "Simple hands together · 2" },
    { g: 3, name: "Early intermediate", blurb: "Short classics · 3" },
    { g: 4, name: "Intermediate", blurb: "Sonatinas & nocturnes · 4" },
    { g: 5, name: "Upper intermediate", blurb: "Moonlight, preludes · 5" },
    { g: 6, name: "Advanced", blurb: "Clair de lune territory · 6" },
    { g: 7, name: "Very advanced", blurb: "Virtuosic studies · 7" },
    { g: 8, name: "Concert / diploma", blurb: "Ballades, Liszt · 8+" },
  ];

  const PRACTICE_DAYS = [2, 3, 4, 5, 6, 7];
  const PRACTICE_MINS = [15, 20, 30, 45, 60, 90];

  const DREAM_SUGGESTIONS = [
    { title: "Clair de lune", composer: "Debussy", query: "clair de lune", id: "debussy-clair-de-lune", grade: 6 },
    { title: "Für Elise", composer: "Beethoven", query: "fur elise", id: "beethoven-fur-elise", grade: 3 },
    { title: "Moonlight Sonata (1st mov.)", composer: "Beethoven", query: "moonlight", grade: 5 },
    { title: "Nocturne Op. 9 No. 2", composer: "Chopin", query: "nocturne op 9", grade: 6 },
    { title: "Gymnopédie No. 1", composer: "Satie", query: "gymnopedie", id: "satie-gymnopedie-1", grade: 3 },
    { title: "Prelude in C major, BWV 846", composer: "Bach", query: "bach prelude c", grade: 3 },
    { title: "Liebestraum No. 3", composer: "Liszt", query: "liebestraum", grade: 7 },
    { title: "Maple Leaf Rag", composer: "Joplin", query: "maple leaf", grade: 5 },
    { title: "Arabesque No. 1", composer: "Debussy", query: "arabesque", grade: 6 },
    { title: "Raindrop Prelude", composer: "Chopin", query: "prelude 28 15", grade: 7 },
    { title: "Ballade No. 1", composer: "Chopin", query: "ballade", grade: 8 },
    { title: "La Campanella", composer: "Liszt", query: "campanella", grade: 8 },
  ];

  /** Curated ABRSM-ish pools → catalogue query / route ids. */
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

  const STEP_LABELS = ["Composers", "Level", "Aspire", "Practice", "Dream", "Account", "Path"];
  const WELCOME_VERSION = 3;
  /** Post-OTP hello moment — bump to re-show after copy changes. */
  const SIGNED_WELCOME_VERSION = 2;
  const DRAFT_KEY = "lune.onboard.draft.v1";
  const SESSION_BACK_KEY = "lune.welcomeBack.session";

  let step = 0;
  let selectedComposers = new Set();
  let selectedGrade = 4;
  let aspireGrade = 6;
  let practiceDays = 4;
  let practiceMins = 30;
  let dreamPiece = null;
  let dreamQuery = "";
  let composerQuery = "";
  let keepPromptShown = false;
  let authPendingEmail = "";
  let authEmbeddedMsg = "";
  /** Set when “Enter the studio” runs before verified sign-in — resume into app after OTP. */
  let pendingEnterStudio = false;
  /** After OTP, show the warm hello once before signed-in home. */
  let pendingSignedWelcome = false;
  /** Returning member — show “Welcome back” instead of first-time hello. */
  let pendingWelcomeBack = false;

  function signedIn() {
    const st = store()?.status?.() || {};
    if (st.awaitingCode) return false;
    return !!st.signedIn;
  }

  /** Mark the account ready for the personal studio home (idempotent). */
  function markStudioReady() {
    store()?.setPref?.("onboarded", true);
    store()?.setPref?.("seenWelcome", true);
    store()?.setPref?.("welcomeVersion", WELCOME_VERSION);
    persistPrefsPartial();
    store()?.syncPrefs?.();
  }

  function restorePendingAuthEmail() {
    if (authPendingEmail) return;
    const st = store()?.status?.() || {};
    if (st.awaitingCode && st.email) authPendingEmail = st.email;
  }
  function onboarded() {
    return !!store()?.prefs()?.onboarded;
  }
  function unlocked() {
    return onboarded();
  }
  function seenWelcome() {
    const p = store()?.prefs() || {};
    return !!p.seenWelcome && Number(p.welcomeVersion) === WELCOME_VERSION;
  }
  function seenSignedWelcome() {
    const p = store()?.prefs() || {};
    return !!p.seenSignedWelcome && Number(p.signedWelcomeVersion) === SIGNED_WELCOME_VERSION;
  }
  function markSignedWelcomeSeen() {
    store()?.setPref?.("seenSignedWelcome", true);
    store()?.setPref?.("signedWelcomeVersion", SIGNED_WELCOME_VERSION);
    store()?.syncPrefs?.();
  }
  function sessionWelcomeBackSeen() {
    try {
      return sessionStorage.getItem(SESSION_BACK_KEY) === "1";
    } catch {
      return false;
    }
  }
  function markSessionWelcomeBack() {
    try {
      sessionStorage.setItem(SESSION_BACK_KEY, "1");
    } catch {
      /* private mode */
    }
  }
  function foldSearch(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }
  function allComposerChoices() {
    if (libraryComposerNames.length) return libraryComposerNames;
    return COMPOSERS;
  }
  function filteredComposers(q) {
    const needle = foldSearch(q);
    // Idle grid stays portrait-first; typing searches the full OpenOpus catalogue.
    if (!needle) return COMPOSERS;
    return allComposerChoices().filter((c) => foldSearch(c).includes(needle));
  }
  function hydrateFromPrefs() {
    const p = store()?.prefs() || {};
    if (Array.isArray(p.composers) && p.composers.length) selectedComposers = new Set(p.composers);
    if (p.grade != null) selectedGrade = Number(p.grade) || selectedGrade;
    if (p.aspireGrade != null) aspireGrade = Number(p.aspireGrade) || aspireGrade;
    if (p.practiceDays != null) practiceDays = Number(p.practiceDays) || practiceDays;
    if (p.practiceMins != null) practiceMins = Number(p.practiceMins) || practiceMins;
    if (p.dreamPiece) dreamPiece = p.dreamPiece;
  }
  /** Completed path in cloud/local — never re-ask taste questions. */
  function hasCompletedOnboarding() {
    const p = store()?.prefs() || {};
    if (p.onboarded) return true;
    const composers = Array.isArray(p.composers) ? p.composers : [];
    const hasPath =
      (Array.isArray(p.progression) && p.progression.length) ||
      (Array.isArray(p.recommendations) && p.recommendations.length);
    // Returning cloud profile may lag the onboarded flag — treat a saved path as done.
    return composers.length > 0 && p.grade != null && !!p.dreamPiece && hasPath;
  }
  async function ensureLibraryComposers() {
    if (libraryComposerNames.length) return;
    const set = new Set();
    const loadJson = async (path) => {
      try {
        const url = typeof window.luneUrl === "function" ? window.luneUrl(path) : path.replace(/^\//, "");
        const res = await fetch(url, { cache: "force-cache" });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    };
    const catalogue = await loadJson("/static/composers-index.json");
    for (const c of catalogue?.composers || []) {
      const name = String(c || "").trim();
      if (name) set.add(name);
    }
    const index = await loadJson("/static/search-index.json");
    for (const it of index?.items || []) {
      const c = String(it.composer || "").trim();
      if (c && c.toLowerCase() !== "traditional") set.add(c);
    }
    // Prefer short portrait keys as the selectable label when they match a full name.
    const preferred = [];
    const used = new Set();
    for (const short of COMPOSERS) {
      const hit = [...set].find(
        (full) => foldSearch(full) === foldSearch(short) || foldSearch(full).includes(foldSearch(short))
      );
      if (hit) {
        preferred.push(short);
        used.add(foldSearch(hit));
        used.add(foldSearch(short));
      }
    }
    for (const full of [...set].sort((a, b) => a.localeCompare(b))) {
      if (used.has(foldSearch(full))) continue;
      preferred.push(full);
    }
    libraryComposerNames = preferred;
  }

  function luneAsset(path) {
    const onPages =
      location.hostname.endsWith(".github.io") ||
      location.hostname === "lune.page" ||
      location.hostname.endsWith(".lune.page") ||
      !!document.querySelector('meta[name="lune-static"][content="1"]');
    const root = onPages
      ? location.pathname.replace(/\/static(?:\/.*)?$/, "").replace(/\/index\.html$/, "").replace(/\/$/, "")
      : "";
    if (!path || /^https?:/i.test(path)) return path;
    if (!path.startsWith("/")) path = `/${path}`;
    return `${root}${path}`;
  }
  function composerFaceUrl(name) {
    if (COMPOSER_FACES[name]) {
      return luneAsset(`/static/assets/composers/${COMPOSER_FACES[name]}?v=${COMPOSER_FACE_V}`);
    }
    const n = foldSearch(name);
    const keys = Object.keys(COMPOSER_FACES).sort((a, b) => b.length - a.length);
    for (const key of keys) {
      if (n.includes(foldSearch(key))) {
        return luneAsset(`/static/assets/composers/${COMPOSER_FACES[key]}?v=${COMPOSER_FACE_V}`);
      }
    }
    return luneAsset(`/static/assets/composers/silhouette.svg?v=${COMPOSER_FACE_V}`);
  }
  function levelName(g) {
    return LEVELS.find((l) => l.g === g)?.name || `Grade ${g}`;
  }

  function saveDraft() {
    const draft = {
      step,
      composers: [...selectedComposers],
      grade: selectedGrade,
      aspireGrade,
      practiceDays,
      practiceMins,
      dreamPiece,
      dreamQuery,
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* private mode */
    }
    persistPrefsPartial();
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (Array.isArray(d.composers)) selectedComposers = new Set(d.composers);
      if (d.grade) selectedGrade = Number(d.grade) || selectedGrade;
      if (d.aspireGrade) aspireGrade = Number(d.aspireGrade) || aspireGrade;
      if (d.practiceDays) practiceDays = Number(d.practiceDays) || practiceDays;
      if (d.practiceMins) practiceMins = Number(d.practiceMins) || practiceMins;
      if (d.dreamPiece) dreamPiece = d.dreamPiece;
      if (d.dreamQuery) dreamQuery = d.dreamQuery;
      if (typeof d.step === "number") step = Math.max(0, Math.min(STEP_LABELS.length - 1, d.step));
    } catch {
      /* ignore */
    }
    const p = store()?.prefs() || {};
    if (Array.isArray(p.composers) && p.composers.length) selectedComposers = new Set(p.composers);
    if (p.grade) selectedGrade = Number(p.grade) || selectedGrade;
    if (p.aspireGrade) aspireGrade = Number(p.aspireGrade) || aspireGrade;
    if (p.practiceDays) practiceDays = Number(p.practiceDays) || practiceDays;
    if (p.practiceMins) practiceMins = Number(p.practiceMins) || practiceMins;
    if (p.dreamPiece) dreamPiece = p.dreamPiece;
  }

  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  }

  /** Reading help chosen during setup: nothing is switched on for people who don't ask. */
  function needOn(kind) {
    const p = store()?.prefs?.() || {};
    return kind === "dyslexia" ? !!p.readableFont : !!(p.largePrint && p.autoRead);
  }
  function setNeed(kind, on) {
    const s = store();
    if (!s?.setPref) return;
    if (kind === "dyslexia") s.setPref("readableFont", on);
    else for (const k of ["largePrint", "highContrast", "autoRead"]) s.setPref(k, on);
    const p = s.prefs();
    document.body.classList.toggle("lp-readable", !!p.readableFont);
    document.body.classList.toggle("lp-large", !!p.largePrint);
    document.body.classList.toggle("lp-contrast", !!p.highContrast);
    s.syncPrefs?.();
  }

  function persistPrefsPartial() {
    const s = store();
    if (!s?.setPref) return;
    s.setPref("composers", [...selectedComposers]);
    s.setPref("grade", selectedGrade);
    s.setPref("aspireGrade", aspireGrade);
    s.setPref("practiceDays", practiceDays);
    s.setPref("practiceMins", practiceMins);
    if (dreamPiece) s.setPref("dreamPiece", dreamPiece);
    s.syncPrefs?.();
  }

  function ensureDom() {
    if (!$("welcome")) {
      const welcome = document.createElement("main");
      welcome.id = "welcome";
      welcome.className = "welcome";
      welcome.hidden = true;
      welcome.innerHTML = `
      <section class="welcome-hero" aria-label="Lune">
        <div class="welcome-hero-inner">
          <div class="welcome-lockup">
            <svg class="lune-mark welcome-mark" viewBox="0 0 40 40" width="72" height="72" aria-hidden="true">
              <path fill="currentColor" d="M26.2 7.2c-5.9.9-10.4 6-10.4 12.1 0 6.1 4.5 11.2 10.4 12.1A12.2 12.2 0 0 1 14 19.3c0-6.6 5.2-12 11.8-12.2.1 0 .3 0 .4 0z"/>
            </svg>
            <p class="welcome-brand">Lune</p>
          </div>
          <h1>When practice feels lost.<br>Find the light again.</h1>
          <p class="welcome-lead">Named for Clair de lune — a night studio that helps practice feel right again.</p>
          <div class="welcome-cta">
            <button type="button" class="primary big" id="btn-experience-lune">Make Lune yours</button>
            <button type="button" class="quiet" id="btn-welcome-signin">I already have an account</button>
          </div>
        </div>
      </section>`;
      document.getElementById("app")?.appendChild(welcome);
      welcome.querySelector("#btn-experience-lune")?.addEventListener("click", startExperience);
      welcome.querySelector("#btn-welcome-signin")?.addEventListener("click", () => openCreateAccount());
    }

    if (!$("hello")) {
      const hello = document.createElement("main");
      hello.id = "hello";
      hello.className = "hello";
      hello.hidden = true;
      hello.innerHTML = `
      <section class="hello-hero" id="hello-hero" aria-label="Welcome to Lune">
        <div class="hello-moon" aria-hidden="true"></div>
        <div class="hello-hero-inner">
          <div class="hello-lockup">
            <svg class="lune-mark hello-mark" viewBox="0 0 40 40" width="64" height="64" aria-hidden="true">
              <path fill="currentColor" d="M26.2 7.2c-5.9.9-10.4 6-10.4 12.1 0 6.1 4.5 11.2 10.4 12.1A12.2 12.2 0 0 1 14 19.3c0-6.6 5.2-12 11.8-12.2.1 0 .3 0 .4 0z"/>
            </svg>
            <p class="hello-brand">Lune</p>
          </div>
          <p class="hello-kicker" id="hello-kicker">You’re in</p>
          <h1 id="hello-title">Welcome.</h1>
          <p class="hello-lead" id="hello-lead">Thank you for choosing Lune.</p>
          <p class="hello-story" id="hello-story">Named for Clair de lune — the piece that settles everything when practice feels lost. Your studio is ready: a quiet night place where practice can feel right again.</p>
          <div class="hello-cta">
            <button type="button" class="primary big" id="btn-hello-enter">Enter your studio</button>
          </div>
        </div>
      </section>`;
      document.getElementById("app")?.appendChild(hello);
      hello.querySelector("#btn-hello-enter")?.addEventListener("click", () => {
        markSignedWelcomeSeen();
        markSessionWelcomeBack();
        pendingSignedWelcome = false;
        pendingWelcomeBack = false;
        enterApp();
        // Start at the top of the home page, not wherever it was last left.
        requestAnimationFrame(() => {
          const home = $("home");
          if (home) home.scrollTop = 0;
          window.scrollTo(0, 0);
        });
      });
    }

    if (!$("onboard")) {
      const onboard = document.createElement("main");
      onboard.id = "onboard";
      onboard.className = "onboard";
      onboard.hidden = true;
      onboard.innerHTML = `<div class="onboard-stage" id="onboard-stage"></div>`;
      document.getElementById("app")?.appendChild(onboard);
    }

    if ($("create-account-dialog")) return;

    const account = document.createElement("dialog");
    account.id = "create-account-dialog";
    account.className = "credits-dialog auth-dialog";
    account.innerHTML = `
      <form method="dialog" class="credits-close-row">
        <button type="submit" class="icon-btn" aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
      </form>
      <p class="auth-kicker">Lune</p>
      <p class="invite-soft-banner" id="auth-invite-banner" hidden>Invited by a pianist on Lune</p>
      <h2 id="auth-title">Sign in</h2>
      <p class="create-account-story">Free forever — no payments, no ads. One email. We send an 8-digit code — no password.</p>
      <form class="auth-form" id="create-account-form">
        <div class="auth-step" id="auth-step-email">
          <label for="create-email">Email</label>
          <input id="create-email" type="email" autocomplete="email" required placeholder="you@example.com">
          <button type="submit" class="primary auth-submit" id="auth-send-btn">Email me a code</button>
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
      <p class="auth-foot dim">Under 13? Ask a parent or guardian first. No ads. No tracking. No payments.</p>`;
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
      <p class="create-account-story">A short questionnaire, then an email code — so repertoire and plans stay with you.</p>
      <div class="onboard-nav auth-keep-nav">
        <button type="button" class="quiet" data-keep-later>Keep exploring</button>
        <button type="button" class="primary" data-keep-signin>Begin</button>
      </div>`;
    document.body.appendChild(keep);

    account.querySelector("#create-account-form")?.addEventListener("submit", onCreateSubmit);
    account.querySelector("#auth-resend")?.addEventListener("click", onAuthResend);
    account.querySelector("#auth-change-email")?.addEventListener("click", () => resetAuthForm({ focus: true }));
    bindCodeInput(account.querySelector("#create-code"));
    keep.querySelector("[data-keep-later]")?.addEventListener("click", () => {
      keep.close();
      store()?.setPref?.("keepPromptDismissed", true);
    });
    keep.querySelector("[data-keep-signin]")?.addEventListener("click", () => {
      keep.close();
      showOnboard(0);
    });
  }

  function bindCodeInput(el) {
    if (!el) return;
    const normalize = () => {
      const digits = String(el.value || "").replace(/\D+/g, "").slice(0, 8);
      if (el.value !== digits) el.value = digits;
      return digits;
    };
    el.addEventListener("input", normalize);
    el.addEventListener("paste", (ev) => {
      ev.preventDefault();
      const pasted = (ev.clipboardData || window.clipboardData)?.getData("text") || "";
      el.value = String(pasted).replace(/\D+/g, "").slice(0, 8);
      normalize();
    });
  }

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
    if (title) title.textContent = "Sign in";
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
    paintInviteBanner();
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

  function paintInviteBanner() {
    const invited = !!window.LuneImpact?.hasInvite?.();
    const authBanner = $("auth-invite-banner");
    if (authBanner) authBanner.hidden = !invited;
    return invited;
  }

  function openCreateAccount() {
    ensureDom();
    resetAuthForm();
    paintInviteBanner();
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

  async function afterAuth() {
    persistPrefsPartial();
    try {
      await store()?.pullPrefs?.({ preferLocal: true });
    } catch {
      /* offline */
    }
    store()?.syncPrefs?.();
    hydrateFromPrefs();
    window.LuneImpact?.clearInvite?.();
    $("create-account-dialog")?.close?.();
    $("keep-lune-dialog")?.close?.();

    // Returning members: never re-open the taste questionnaire.
    if (hasCompletedOnboarding()) {
      markStudioReady();
      clearDraft();
      pendingEnterStudio = false;
      if (!seenSignedWelcome()) {
        pendingSignedWelcome = true;
        pendingWelcomeBack = false;
        showSignedWelcome({ mode: "first" });
        return;
      }
      if (!sessionWelcomeBackSeen()) {
        pendingWelcomeBack = true;
        showSignedWelcome({ mode: "back" });
        return;
      }
      enterApp();
      return;
    }

    if (!seenSignedWelcome()) pendingSignedWelcome = true;
    if (pendingEnterStudio) {
      pendingEnterStudio = false;
      finishOnboard({ quiet: false, skipKeepPrompt: true });
      return;
    }
    // Signed in but questionnaire incomplete → resume questions (never the email step).
    if (selectedComposers.size && dreamPiece) showOnboard(6);
    else showOnboard(Math.min(Math.max(step, 0), 4));
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
    document.body.classList.remove("is-onboard", "is-hello", "is-home", "is-studio", "is-discover", "is-repertoire");
    window.scrollTo?.(0, 0);
  }

  function showSignedWelcome({ mode } = {}) {
    ensureDom();
    hideAllMains();
    const back = mode === "back" || pendingWelcomeBack;
    const h = $("hello");
    const hero = $("hello-hero");
    if (h) {
      h.hidden = false;
      h.scrollTop = 0;
      h.classList.toggle("hello-back", back);
    }
    if (hero) hero.classList.toggle("hello-hero-back", back);
    const kicker = $("hello-kicker");
    const title = $("hello-title");
    const lead = $("hello-lead");
    const story = $("hello-story");
    const cta = $("btn-hello-enter");
    if (back) {
      if (kicker) kicker.textContent = "Again";
      if (title) title.textContent = "Welcome back.";
      if (lead) lead.textContent = "Your studio is as you left it.";
      if (story)
        story.textContent =
          "Same night light, same scores, same path. Pick up wherever practice paused — Clair de lune is still here when you need it.";
      if (cta) cta.textContent = "Continue";
    } else {
      if (kicker) kicker.textContent = "You’re in";
      if (title) title.textContent = "Welcome.";
      if (lead) lead.textContent = "Thank you for choosing Lune.";
      if (story)
        story.textContent =
          "Named for Clair de lune — the piece that settles everything when practice feels lost. Your studio is ready: a quiet night place where practice can feel right again.";
      if (cta) cta.textContent = "Enter your studio";
    }
    document.body.classList.add("is-hello");
    document.body.classList.toggle("is-hello-back", back);
    document.body.classList.remove("is-welcome", "is-onboard", "is-home", "is-studio", "is-discover", "is-repertoire");
    window.scrollTo?.(0, 0);
    setTimeout(() => $("btn-hello-enter")?.focus?.(), 80);
  }

  function hideAllMains() {
    ["home", "studio", "discover", "repertoire", "welcome", "onboard", "hello"].forEach((id) => {
      const el = $(id);
      if (el) el.hidden = true;
    });
  }

  function showOnboard(n = 0) {
    ensureDom();
    loadDraft();
    store()?.setPref?.("seenWelcome", true);
    step = n;
    hideAllMains();
    const o = $("onboard");
    if (o) {
      o.hidden = false;
      o.scrollTop = 0;
    }
    document.body.classList.add("is-onboard");
    document.body.classList.remove("is-welcome", "is-hello", "is-home", "is-studio", "is-discover", "is-repertoire");
    paintOnboard();
    saveDraft();
  }

  function progressHtml(active) {
    return `<ol class="onboard-progress" aria-label="Onboarding progress">
      ${STEP_LABELS.map(
        (label, i) =>
          `<li class="${i === active ? "on" : i < active ? "done" : ""}"><span>${i + 1}</span><em>${label}</em></li>`
      ).join("")}
    </ol>`;
  }

  function navHtml({ back = true, nextLabel = "Continue", nextDisabled = false, nextAttr = "data-next" } = {}) {
    return `<div class="onboard-nav">
      ${back ? `<button type="button" class="quiet" data-back>Back</button>` : `<span></span>`}
      <button type="button" class="primary" ${nextAttr} ${nextDisabled ? "disabled" : ""}>${nextLabel}</button>
    </div>`;
  }

  function filteredDreams(q) {
    const needle = foldSearch(q);
    const pool = [...DREAM_SUGGESTIONS];
    for (const g of Object.values(GRADE_POOL)) {
      for (const p of g) {
        if (!pool.some((x) => x.title === p.title)) pool.push(p);
      }
    }
    // Merge live library titles when the search index has been loaded.
    try {
      const items = window.LuneSearchIndex?.items || window.__LUNE_SEARCH_ITEMS__ || [];
      for (const it of items) {
        if (!it?.title) continue;
        if (pool.some((x) => x.title === it.title && x.composer === it.composer)) continue;
        pool.push({
          title: it.title,
          composer: it.composer || "",
          query: it.query || it.title,
          id: it.id || "",
          grade: it.grade || null,
        });
      }
    } catch {
      /* ignore */
    }
    if (!needle) return pool.slice(0, 12);
    return pool
      .filter((p) => foldSearch(`${p.title} ${p.composer} ${p.query || ""} ${p.hay || ""}`).includes(needle))
      .slice(0, 14);
  }

  function paintOnboard() {
    const stage = $("onboard-stage");
    if (!stage) return;
    stage.className = "onboard-stage";
    if (step === 0) stage.classList.add("onboard-stage-wide");

    if (step === 0) {
      const visible = filteredComposers(composerQuery);
      const selected = [...selectedComposers];
      stage.innerHTML = `
        ${progressHtml(0)}
        <p class="eyebrow">Taste</p>
        <h1>Which composers are you into?</h1>
        <p class="onboard-help">Search the library, then pick a few. Their faces stay with your studio — recommendations lean their way.</p>
        <label class="onboard-search-label" for="composer-q">Search composers</label>
        <div class="onboard-composer-search">
          <svg class="onboard-composer-search-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/>
            <path d="M15.5 15.5L20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          <input id="composer-q" class="onboard-search onboard-composer-q" type="search" autocomplete="off"
            placeholder="Bach, Chopin, Scriabin…" value="${esc(composerQuery)}" aria-label="Search composers">
        </div>
        ${
          selected.length
            ? `<div class="onboard-composer-chips" aria-label="Selected composers">
                ${selected
                  .map(
                    (c) => `<button type="button" class="onboard-composer-chip" data-composer-chip="${esc(c)}" aria-label="Remove ${esc(c)}">
                      <span class="onboard-composer-chip-face" style="background-image:url('${composerFaceUrl(c)}')"></span>
                      ${esc(c)}
                      <span aria-hidden="true">×</span>
                    </button>`
                  )
                  .join("")}
              </div>`
            : ""
        }
        <div class="onboard-composer-grid" role="group" aria-label="Composers">
          ${
            visible.length
              ? visible
                  .map((c) => {
                    const on = selectedComposers.has(c);
                    return `<button type="button" class="onboard-composer${on ? " on" : ""}" data-composer="${esc(c)}" aria-pressed="${on}">
                      <span class="onboard-composer-face" style="background-image:url('${composerFaceUrl(c)}')"></span>
                      <span class="onboard-composer-name">${esc(c)}</span>
                    </button>`;
                  })
                  .join("")
              : `<p class="onboard-composer-empty">No composers match “${esc(composerQuery.trim())}”.</p>`
          }
        </div>
        ${navHtml({ back: false, nextDisabled: !selectedComposers.size })}
        <p class="onboard-already">
          <button type="button" class="quiet" data-already>I already have an account</button>
        </p>`;
    } else if (step === 1) {
      stage.innerHTML = `
        ${progressHtml(1)}
        <p class="eyebrow">Where you are</p>
        <h1>What level do you play at?</h1>
        <p class="onboard-help">Be honest — the path stays kinder that way. Roughly ABRSM grades.</p>
        <div class="onboard-levels" role="radiogroup" aria-label="Current level">
          ${LEVELS.map(
            (l) => `<button type="button" class="onboard-level${selectedGrade === l.g ? " on" : ""}" data-grade="${l.g}" aria-pressed="${selectedGrade === l.g}">
              <strong>${esc(l.name)}</strong>
              <span>${esc(l.blurb)}</span>
            </button>`
          ).join("")}
        </div>
        ${navHtml()}`;
    } else if (step === 2) {
      stage.innerHTML = `
        ${progressHtml(2)}
        <p class="eyebrow">Where you’re headed</p>
        <h1>What level do you aspire to?</h1>
        <p class="onboard-help">We’ll build a stepping-stone path from ${esc(levelName(selectedGrade))} toward here.</p>
        <div class="onboard-levels" role="radiogroup" aria-label="Aspire level">
          ${LEVELS.map(
            (l) => `<button type="button" class="onboard-level${aspireGrade === l.g ? " on" : ""}${l.g < selectedGrade ? " dim" : ""}" data-aspire="${l.g}" aria-pressed="${aspireGrade === l.g}">
              <strong>${esc(l.name)}</strong>
              <span>${esc(l.blurb)}</span>
            </button>`
          ).join("")}
        </div>
        ${navHtml()}`;
    } else if (step === 3) {
      stage.innerHTML = `
        ${progressHtml(3)}
        <p class="eyebrow">Cadence</p>
        <h1>How do you want to practise?</h1>
        <p class="onboard-help">A calm weekly rhythm — not a streak counter.</p>
        <div class="onboard-practice">
          <div>
            <p class="onboard-practice-label">Days per week</p>
            <div class="onboard-grades" role="radiogroup" aria-label="Days per week">
              ${PRACTICE_DAYS.map(
                (d) =>
                  `<button type="button" class="onboard-grade${practiceDays === d ? " on" : ""}" data-days="${d}" aria-pressed="${practiceDays === d}">${d}</button>`
              ).join("")}
            </div>
          </div>
          <div>
            <p class="onboard-practice-label">Minutes per session</p>
            <div class="onboard-grades" role="radiogroup" aria-label="Minutes per session">
              ${PRACTICE_MINS.map(
                (m) =>
                  `<button type="button" class="onboard-grade${practiceMins === m ? " on" : ""}" data-mins="${m}" aria-pressed="${practiceMins === m}">${m}</button>`
              ).join("")}
            </div>
          </div>
          <p class="onboard-practice-sum">${practiceDays} days · ${practiceMins} min · about <strong>${practiceDays * practiceMins} minutes</strong> a week</p>
        </div>
        <div class="onboard-needs" role="group" aria-label="Reading help">
          <p class="onboard-practice-label">Would either of these help you read? Skip if not.</p>
          ${[
            ["dyslexia", "I have dyslexia", "Letter names in a typeface where every letter shape is distinct."],
            ["vision", "I’m blind or have low vision", "Large print, high contrast, and every bar described aloud. Lune also works with your device’s own screen reader."],
          ]
            .map(([k, label, hint]) => {
              const on = needOn(k);
              return `<button type="button" class="onboard-need${on ? " on" : ""}" data-need="${k}" aria-pressed="${on}"><strong>${label}</strong><span>${hint}</span></button>`;
            })
            .join("")}
        </div>
        ${navHtml()}`;
    } else if (step === 4) {
      const suggestions = filteredDreams(dreamQuery);
      stage.innerHTML = `
        ${progressHtml(4)}
        <p class="eyebrow">North star</p>
        <h1>What’s your dream piano piece?</h1>
        <p class="onboard-help">Search or pick one. We’ll chart a path you can actually play toward.</p>
        <label class="onboard-search-label" for="dream-q">Search pieces</label>
        <input id="dream-q" class="onboard-search" type="search" autocomplete="off" placeholder="Clair de lune, Moonlight, Ballade…" value="${esc(dreamQuery)}">
        <div class="onboard-dreams" role="listbox" aria-label="Dream pieces">
          ${suggestions
            .map((p) => {
              const selected =
                dreamPiece &&
                ((dreamPiece.id && dreamPiece.id === p.id) ||
                  (dreamPiece.title === p.title && dreamPiece.composer === p.composer));
              return `<button type="button" class="onboard-dream${selected ? " on" : ""}" role="option" aria-selected="${!!selected}"
                data-dream-title="${esc(p.title)}" data-dream-composer="${esc(p.composer)}" data-dream-query="${esc(p.query || p.title)}"
                ${p.id ? `data-dream-id="${esc(p.id)}"` : ""} data-dream-grade="${p.grade || ""}">
                <strong>${esc(p.title)}</strong>
                <span>${esc(p.composer)}${p.grade ? ` · about grade ${p.grade}` : ""}</span>
              </button>`;
            })
            .join("")}
        </div>
        ${
          dreamQuery.trim() && !suggestions.some((p) => p.title.toLowerCase() === dreamQuery.trim().toLowerCase())
            ? `<button type="button" class="onboard-dream onboard-dream-custom" data-dream-custom>
                <strong>Use “${esc(dreamQuery.trim())}”</strong>
                <span>Free text — we’ll still build a path from your level</span>
              </button>`
            : ""
        }
        ${navHtml({ nextDisabled: !dreamPiece, nextLabel: "Continue to account" })}`;
    } else if (step === 5) {
      if (signedIn()) {
        showOnboard(6);
        return;
      }
      restorePendingAuthEmail();
      const codePhase = !!authPendingEmail;
      const invited = !!window.LuneImpact?.hasInvite?.();
      stage.innerHTML = `
        ${progressHtml(5)}
        ${invited ? `<p class="invite-soft-banner">Invited by a pianist on Lune</p>` : ""}
        <p class="eyebrow">Save your studio</p>
        <h1>${codePhase ? "Enter your code" : "Keep this with you."}</h1>
        <p class="onboard-help">${
          codePhase
            ? `We sent an 8-digit code to <strong>${esc(authPendingEmail)}</strong>.`
            : "Email and an 8-digit code — no password. Your answers sync so the path stays yours."
        }</p>
        <form class="onboard-auth" id="onboard-auth-form">
          ${
            codePhase
              ? `<label for="onboard-code">Code</label>
                 <input id="onboard-code" class="onboard-code" type="text" inputmode="numeric" maxlength="8" autocomplete="one-time-code" placeholder="00000000" spellcheck="false" required>
                 <button type="submit" class="primary big auth-submit">Verify &amp; see my path</button>
                 <div class="auth-alt">
                   <button type="button" class="quiet" data-ob-resend>Resend code</button>
                   <button type="button" class="quiet" data-ob-change-email>Different email</button>
                 </div>`
              : `<label for="onboard-email">Email</label>
                 <input id="onboard-email" type="email" autocomplete="email" required placeholder="you@example.com">
                 <button type="submit" class="primary big auth-submit">Email me a code</button>
                 <p class="onboard-diff">Free forever. No ads. No payments.</p>`
          }
          <p class="auth-msg dim" id="onboard-auth-msg" aria-live="polite">${esc(authEmbeddedMsg)}</p>
        </form>
        <div class="onboard-nav">
          <button type="button" class="quiet" data-back>Back</button>
          <button type="button" class="quiet" data-already>I already have an account</button>
        </div>`;
    } else {
      const pack = buildRecommendations();
      stage.innerHTML = `
        ${progressHtml(6)}
        <p class="eyebrow">Your path</p>
        <h1>How you’ll get there.</h1>
        <p class="onboard-help">${esc(levelName(selectedGrade))} → ${esc(levelName(aspireGrade))}
          ${dreamPiece ? ` · dream: <em>${esc(dreamPiece.title)}</em>` : ""}
          · ${practiceDays}×${practiceMins} min / week</p>
        <section class="onboard-cadence" aria-label="Practice cadence">
          <p class="onboard-cadence-k">Suggested cadence</p>
          <p>${practiceDays} sessions a week, ${practiceMins} minutes each.
            Warm up on tonight’s piece, then one stepping-stone toward your dream.</p>
        </section>
        <section class="onboard-path" aria-label="Piece progression">
          <p class="onboard-cadence-k">Stepping stones</p>
          <ol class="onboard-path-list">
            ${pack.progression
              .map(
                (p, i) => `<li class="onboard-path-step">
                  <span class="onboard-path-n">${String(i + 1).padStart(2, "0")}</span>
                  <button type="button" class="onboard-path-card" data-open-query="${esc(p.query)}" ${p.id ? `data-open-piece="${esc(p.id)}"` : ""}>
                    <strong>${esc(p.title)}</strong>
                    <span>${esc(p.composer)} · grade ${p.grade}${p.role ? ` · ${esc(p.role)}` : ""}</span>
                  </button>
                </li>`
              )
              .join("")}
          </ol>
        </section>
        <p class="onboard-cadence-k" style="margin-top:28px">Also for you</p>
        <ul class="onboard-recs">
          ${pack.also
            .map(
              (r, i) => `<li>
              <button type="button" class="onboard-rec${i === 0 ? " onboard-rec-featured" : ""}" data-open-query="${esc(r.query)}" ${r.id ? `data-open-piece="${esc(r.id)}"` : ""}>
                ${i === 0 ? `<span class="onboard-rec-tag">Start tonight</span>` : ""}
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

    bindOnboardEvents(stage);
  }

  function bindOnboardEvents(stage) {
    stage.querySelectorAll("[data-need]").forEach((b) =>
      b.addEventListener("click", () => {
        const on = b.getAttribute("aria-pressed") !== "true";
        setNeed(b.dataset.need, on);
        b.setAttribute("aria-pressed", String(on));
        b.classList.toggle("on", on);
      })
    );
    stage.querySelector("[data-next]")?.addEventListener("click", () => {
      if (step === 0 && !selectedComposers.size) return;
      if (step === 4 && !dreamPiece) return;
      if (step === 2 && aspireGrade < selectedGrade) aspireGrade = selectedGrade;
      showOnboard(Math.min(STEP_LABELS.length - 1, step + 1));
    });
    stage.querySelector("[data-back]")?.addEventListener("click", () => showOnboard(Math.max(0, step - 1)));
    stage.querySelector("[data-finish]")?.addEventListener("click", () => finishOnboard());
    stage.querySelector("[data-already]")?.addEventListener("click", () => openCreateAccount());

    const composerInput = stage.querySelector("#composer-q");
    composerInput?.addEventListener("input", () => {
      composerQuery = composerInput.value || "";
      paintOnboard();
      const again = $("composer-q");
      if (again) {
        again.focus();
        const len = again.value.length;
        again.setSelectionRange(len, len);
      }
    });
    stage.querySelectorAll("[data-composer-chip]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedComposers.delete(btn.dataset.composerChip);
        paintOnboard();
        saveDraft();
      });
    });
    stage.querySelectorAll("[data-composer]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const c = btn.dataset.composer;
        if (selectedComposers.has(c)) selectedComposers.delete(c);
        else selectedComposers.add(c);
        paintOnboard();
        saveDraft();
      });
    });
    stage.querySelectorAll("[data-grade]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedGrade = Number(btn.dataset.grade) || 4;
        if (aspireGrade < selectedGrade) aspireGrade = selectedGrade;
        paintOnboard();
        saveDraft();
      });
    });
    stage.querySelectorAll("[data-aspire]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const g = Number(btn.dataset.aspire) || selectedGrade;
        aspireGrade = Math.max(selectedGrade, g);
        paintOnboard();
        saveDraft();
      });
    });
    stage.querySelectorAll("[data-days]").forEach((btn) => {
      btn.addEventListener("click", () => {
        practiceDays = Number(btn.dataset.days) || 4;
        paintOnboard();
        saveDraft();
      });
    });
    stage.querySelectorAll("[data-mins]").forEach((btn) => {
      btn.addEventListener("click", () => {
        practiceMins = Number(btn.dataset.mins) || 30;
        paintOnboard();
        saveDraft();
      });
    });

    const dreamInput = stage.querySelector("#dream-q");
    dreamInput?.addEventListener("input", () => {
      dreamQuery = dreamInput.value || "";
      paintOnboard();
      const again = $("dream-q");
      if (again) {
        again.focus();
        const len = again.value.length;
        again.setSelectionRange(len, len);
      }
    });
    stage.querySelectorAll("[data-dream-title]").forEach((btn) => {
      btn.addEventListener("click", () => {
        dreamPiece = {
          title: btn.dataset.dreamTitle,
          composer: btn.dataset.dreamComposer,
          query: btn.dataset.dreamQuery,
          id: btn.dataset.dreamId || "",
          grade: Number(btn.dataset.dreamGrade) || null,
        };
        dreamQuery = dreamPiece.title;
        paintOnboard();
        saveDraft();
      });
    });
    stage.querySelector("[data-dream-custom]")?.addEventListener("click", () => {
      const t = dreamQuery.trim();
      if (!t) return;
      dreamPiece = { title: t, composer: "", query: t, id: "", grade: aspireGrade };
      paintOnboard();
      saveDraft();
    });

    const authForm = stage.querySelector("#onboard-auth-form");
    authForm?.addEventListener("submit", onEmbeddedAuthSubmit);
    bindCodeInput(stage.querySelector("#onboard-code"));
    stage.querySelector("[data-ob-resend]")?.addEventListener("click", async () => {
      if (!authPendingEmail) return;
      authEmbeddedMsg = "Sending another code…";
      paintOnboard();
      try {
        await store().signIn(authPendingEmail);
        authEmbeddedMsg = "Code sent — check your inbox.";
      } catch (err) {
        authEmbeddedMsg = err.message || String(err);
      }
      paintOnboard();
    });
    stage.querySelector("[data-ob-change-email]")?.addEventListener("click", () => {
      authPendingEmail = "";
      authEmbeddedMsg = "";
      paintOnboard();
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
      });
    });
  }

  async function onEmbeddedAuthSubmit(e) {
    e.preventDefault();
    const msgEl = () => $("onboard-auth-msg");
    if (authPendingEmail) {
      const raw = $("onboard-code");
      const code = String(raw?.value || "").replace(/\D+/g, "").slice(0, 8);
      if (raw) raw.value = code;
      authEmbeddedMsg = "Checking your code…";
      paintOnboard();
      try {
        await store().verifyOtp(authPendingEmail, code);
        authEmbeddedMsg = "";
        authPendingEmail = "";
        persistPrefsPartial();
        window.LuneImpact?.clearInvite?.();
        // Single gateway — skips questionnaire for returning members.
        await afterAuth();
      } catch (err) {
        authEmbeddedMsg = err.message || String(err);
        paintOnboard();
      }
      return;
    }
    const email = $("onboard-email")?.value || "";
    authEmbeddedMsg = "Sending a code…";
    paintOnboard();
    try {
      const res = await store().signIn(email);
      if (res?.mode === "otp") {
        authPendingEmail = res.email;
        authEmbeddedMsg = "";
        paintOnboard();
        $("onboard-code")?.focus();
        return;
      }
      authEmbeddedMsg = "";
      if (!seenSignedWelcome()) pendingSignedWelcome = true;
      afterAuth();
    } catch (err) {
      authEmbeddedMsg = err.message || String(err);
      paintOnboard();
      if (msgEl()) msgEl().textContent = authEmbeddedMsg;
    }
  }

  function scorePool(grade) {
    const pool = [...(GRADE_POOL[grade] || []), ...(GRADE_POOL[Math.min(8, grade + 1)] || [])];
    const composers = [...selectedComposers].map((c) => c.toLowerCase());
    return pool.map((p) => {
      let s = 1;
      const blob = `${p.title} ${p.composer}`.toLowerCase();
      for (const c of composers) if (blob.includes(c)) s += 3;
      if (p.grade === grade) s += 2;
      if (dreamPiece?.composer && blob.includes(String(dreamPiece.composer).toLowerCase())) s += 2;
      return { ...p, s };
    });
  }

  function dedupeTake(scored, n) {
    scored.sort((a, b) => b.s - a.s);
    const seen = new Set();
    const out = [];
    for (const p of scored) {
      const k = p.title.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p);
      if (out.length >= n) break;
    }
    return out;
  }

  function recommendations() {
    return buildRecommendations().also;
  }

  function buildRecommendations() {
    const from = Math.max(1, Math.min(8, selectedGrade || 4));
    let to = Math.max(from, Math.min(8, aspireGrade || from));
    if (dreamPiece?.grade) to = Math.max(to, Math.min(8, dreamPiece.grade));

    const progression = [];
    const seen = new Set();
    const grades = [];
    for (let g = from; g <= to; g++) grades.push(g);
    if (grades.length === 1 && from < 8) grades.push(Math.min(8, from + 1));

    for (const g of grades) {
      const pick = dedupeTake(scorePool(g), 1)[0];
      if (!pick) continue;
      const k = pick.title.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      progression.push({
        ...pick,
        role: g === from ? "Tonight" : g === to ? "Toward your goal" : `Grade ${g} bridge`,
      });
      if (progression.length >= 5) break;
    }

    if (dreamPiece) {
      const k = dreamPiece.title.toLowerCase();
      if (!seen.has(k)) {
        progression.push({
          title: dreamPiece.title,
          composer: dreamPiece.composer || "—",
          query: dreamPiece.query || dreamPiece.title,
          id: dreamPiece.id || "",
          grade: dreamPiece.grade || to,
          role: "Dream piece",
          s: 99,
        });
      } else {
        const hit = progression.find((p) => p.title.toLowerCase() === k);
        if (hit) hit.role = "Dream piece";
      }
    }

    const also = dedupeTake(scorePool(from), 4).filter(
      (p) => !progression.slice(0, 1).some((x) => x.title === p.title) || progression[0]?.title === p.title
    );
    if (!also.length) also.push(...progression.slice(0, 3));

    return { progression, also: also.slice(0, 4) };
  }

  function finishOnboard({ quiet = false, skipKeepPrompt = false } = {}) {
    const pack = buildRecommendations();
    // Always keep questionnaire / path answers — even if we still need OTP.
    store().setPref("grade", selectedGrade);
    store().setPref("aspireGrade", aspireGrade);
    store().setPref("composers", [...selectedComposers]);
    store().setPref("practiceDays", practiceDays);
    store().setPref("practiceMins", practiceMins);
    store().setPref("dreamPiece", dreamPiece);
    store().setPref("recommendations", pack.also);
    store().setPref("progression", pack.progression);
    store().setPref("seenWelcome", true);
    store().setPref("welcomeVersion", WELCOME_VERSION);
    store().syncPrefs?.();

    if (!signedIn()) {
      // Never restart the landing simulation from “Enter the studio”.
      pendingEnterStudio = true;
      showOnboard(5);
      if (!quiet) window.toast?.("Sign in with your email to enter the studio");
      return;
    }

    pendingEnterStudio = false;
    markStudioReady();
    clearDraft();
    $("create-account-dialog")?.close?.();
    $("keep-lune-dialog")?.close?.();
    // First verified sign-in → warm hello, then signed-in home (not guest sim).
    if (pendingSignedWelcome || !seenSignedWelcome()) {
      pendingSignedWelcome = true;
      showSignedWelcome();
      if (!quiet) window.toast?.("Welcome to Lune");
      return;
    }
    enterApp();
    if (!quiet) window.toast?.("Your studio is ready");
    if (!skipKeepPrompt && !signedIn()) {
      setTimeout(() => promptKeepAccount(), 1200);
    }
  }

  function enterApp() {
    markStudioReady();
    const o = $("onboard");
    const w = $("welcome");
    const h = $("hello");
    if (o) o.hidden = true;
    if (w) w.hidden = true;
    if (h) h.hidden = true;
    document.body.classList.remove("is-welcome", "is-onboard", "is-hello", "is-hello-back");
    document.body.classList.add("is-signed-in");
    $("hello")?.classList.remove("hello-back");
    $("create-account-dialog")?.close?.();
    $("keep-lune-dialog")?.close?.();
    // Always land on the personal home — do not re-enter the soft gate.
    if (typeof window.showView === "function") window.showView("home");
    else {
      const home = $("home");
      if (home) home.hidden = false;
      document.body.classList.add("is-home");
    }
    if (typeof window.goHome === "function") {
      try {
        window.goHome({ keepTabs: true, forceApp: true });
      } catch {
        /* showView already revealed home */
      }
    }
    paintSignedHome();
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
        <p>Exploring on this device. <strong>Make Lune yours</strong> — a short questionnaire, then an email code.</p>
        <button type="button" class="primary" data-lp-personalise>Begin</button>`;
      const app = $("app");
      const header = app?.querySelector?.("header.bar");
      if (header) header.after(bar);
      else app?.prepend?.(bar);
    }
  }

  function paintHomeRecs() {
    paintSignedHome();
  }

  function paintSignedHome() {
    const authed = signedIn();
    const guest = $("home-guest");
    const member = $("home-member");
    if (guest) guest.hidden = !!authed;
    if (member) member.hidden = !authed;
    document.body.classList.toggle("is-signed-in", authed);

    if (!authed) {
      // Guests keep the marketing landing; leave #home-continue alone for practice.js.
      return;
    }

    const prefs = store()?.prefs() || {};
    // Ensure recommendations exist from prefs / draft answers.
    let path = Array.isArray(prefs.progression) ? prefs.progression : [];
    let recs = Array.isArray(prefs.recommendations) ? prefs.recommendations : [];
    if (!path.length && !recs.length) {
      // Rebuild from prefs / in-memory onboarding answers when nothing stored yet.
      if (Array.isArray(prefs.composers) && prefs.composers.length && !selectedComposers.size) {
        selectedComposers = new Set(prefs.composers);
      }
      if (prefs.grade) selectedGrade = Number(prefs.grade) || selectedGrade;
      if (prefs.aspireGrade) aspireGrade = Number(prefs.aspireGrade) || aspireGrade;
      if (prefs.dreamPiece) dreamPiece = prefs.dreamPiece;
      if (selectedComposers.size || prefs.grade || dreamPiece) {
        const pack = buildRecommendations();
        path = pack.progression;
        recs = pack.also;
        store()?.setPref?.("recommendations", recs);
        store()?.setPref?.("progression", path);
        store()?.syncPrefs?.();
      }
    }

    const lead = $("member-lead");
    if (lead) {
      const composers = Array.isArray(prefs.composers) ? prefs.composers : [...selectedComposers];
      const dream = prefs.dreamPiece || dreamPiece;
      const days = prefs.practiceDays || practiceDays;
      const mins = prefs.practiceMins || practiceMins;
      const bits = [];
      if (composers.length) bits.push(composers.slice(0, 3).join(", "));
      if (dream?.title) bits.push(`toward ${dream.title}`);
      bits.push(`${days}×${mins} min a week`);
      lead.textContent = bits.length
        ? `Named for Clair de lune — ${bits.join(" · ")}.`
        : "Named for Clair de lune — a night studio shaped around you.";
    }

    const grid = $("member-rec-grid");
    const recsLead = $("member-recs-lead");
    if (grid) {
      const show = [];
      const seen = new Set();
      for (const p of [...path, ...recs]) {
        if (!p?.title) continue;
        const k = String(p.title).toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        show.push(p);
        if (show.length >= 6) break;
      }
      if (!show.length) {
        // Fallback: Clair de lune + a few catalogue staples so the home never feels empty.
        show.push(
          { title: "Clair de lune", composer: "Debussy", query: "clair de lune", id: "debussy-clair-de-lune", role: "Open tonight" },
          { title: "Für Elise", composer: "Beethoven", query: "fur elise", role: "Also for you" },
          { title: "Gymnopédie no. 1", composer: "Satie", query: "gymnopedie", role: "Also for you" }
        );
      }
      if (recsLead) {
        const g = prefs.grade || selectedGrade;
        const a = prefs.aspireGrade || aspireGrade;
        recsLead.textContent =
          g && a && a !== g
            ? `Stepping stones from ${levelName(g)} toward ${levelName(a)} — and a few more for tonight.`
            : "From the composers, level, and dream piece you shared.";
      }
      const recHtml = show
        .map((r, i) => {
          const role = r.role || (i === 0 ? "Start tonight" : "For you");
          const openAttrs = r.id
            ? `data-open-piece="${esc(r.id)}"`
            : `data-rec-q="${esc(r.query || r.title)}"`;
          return `<button type="button" class="member-rec${i === 0 ? " member-rec-featured" : ""}" ${openAttrs}>
            <span class="member-rec-role">${esc(role)}</span>
            <span class="member-rec-title">${esc(r.title)}</span>
            <span class="member-rec-by">${esc(r.composer || "")}</span>
          </button>`;
        })
        .join("");
      // Repainting identical buttons would swallow a click that is in progress.
      if (grid.dataset.painted !== recHtml) {
        grid.dataset.painted = recHtml;
        grid.innerHTML = recHtml;
      }
      grid.querySelectorAll("[data-rec-q]").forEach((b) => {
        if (b.dataset.bound) return;
        b.dataset.bound = "1";
        b.addEventListener("click", () => {
          const q = $("q");
          if (!q) return;
          q.value = b.dataset.recQ;
          q.form?.requestSubmit?.();
        });
      });
    }

    // Guest continue host stays empty while signed in (member uses #member-continue).
    const guestCont = $("home-continue");
    if (guestCont) {
      guestCont.hidden = true;
      guestCont.innerHTML = "";
    }
    window.LuneImpact?.paintHomeImpact?.();
  }

  function applyGateChrome() {
    const ok = unlocked();
    const authed = signedIn();
    document.body.classList.toggle("is-signed-in", authed);
    document.body.classList.toggle("needs-account", !authed && onboarded());
    document.body.classList.toggle("needs-onboard", !onboarded());
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
    // Top-bar auth: guests only — signed-in users keep Account via More menu.
    const barAuth = $("btn-bar-auth");
    if (barAuth) {
      barAuth.hidden = !!authed;
      barAuth.setAttribute("aria-hidden", authed ? "true" : "false");
    }
    if (!authed) {
      document.body.classList.remove("phone-search-open", "studio-search-open");
      $("btn-search")?.setAttribute("aria-expanded", "false");
    }
    paintKeepBanner();
    // Keep guest/member home panes in sync whenever auth chrome updates.
    if ($("home") && !$("home").hidden) paintSignedHome();
  }

  function admitGuest() {
    if (onboarded()) return;
    store()?.setPref?.("onboarded", true);
    store()?.setPref?.("seenWelcome", true);
    store()?.setPref?.("welcomeVersion", WELCOME_VERSION);
    if (store()?.prefs?.()?.grade == null) store()?.setPref?.("grade", selectedGrade || 4);
    applyGateChrome();
    paintKeepBanner();
  }

  function requireUnlock() {
    ensureDom();
    admitGuest();
    return true;
  }

  function requireSignIn(message) {
    if (signedIn()) return true;
    openCreateAccount();
    window.toast?.(message || "Sign in to keep this in your account");
    return false;
  }

  /**
   * Every library piece opens without an account — Clair de lune included, so
   * a first visit can see the real studio. Sign-in keeps plans and syncs them.
   */
  function requirePieceAccess() {
    return true;
  }

  function route() {
    ensureDom();
    store()?.setPref?.("seenWelcome", true);
    store()?.setPref?.("welcomeVersion", WELCOME_VERSION);
    const w = $("welcome");
    const o = $("onboard");
    const h = $("hello");
    if (w) w.hidden = true;
    if (o) o.hidden = true;
    if (h) h.hidden = true;
    document.body.classList.remove("is-welcome", "is-onboard", "is-hello");
    // Returning signed-in visitors land on their studio home, not the guest gate.
    if (signedIn()) {
      hydrateFromPrefs();
      if (hasCompletedOnboarding()) markStudioReady();
      document.body.classList.add("is-signed-in");
      if (hasCompletedOnboarding()) {
        if (!seenSignedWelcome()) {
          pendingSignedWelcome = true;
          showSignedWelcome({ mode: "first" });
          return "hello";
        }
        if (!sessionWelcomeBackSeen()) {
          pendingWelcomeBack = true;
          showSignedWelcome({ mode: "back" });
          return "hello";
        }
      } else if (!seenSignedWelcome()) {
        pendingSignedWelcome = true;
        showSignedWelcome({ mode: "first" });
        return "hello";
      }
    }
    applyGateChrome();
    paintSignedHome();
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
      body: "Open Piano. Notes fall onto the keyboard. Filter Right / Left hand. Same tempo as the score.",
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
      body: "Tap Aa for Easy read letters. When this piece has braille, the Braille chip downloads a .brf.",
      panel: "explain",
      action: "access",
    },
    {
      id: "plan",
      title: "Your practice plan",
      body: "Select bars, speak or jot a note, save a plan into Repertoire.",
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

  function applyTourAction(stepObj) {
    const tab =
      document.querySelector(`.studio-tab[data-panel="${stepObj.panel}"]`) ||
      document.querySelector(`button[data-panel="${stepObj.panel}"]`);
    if (tab) tab.click();
    if (stepObj.action === "letters") document.getElementById("anno-notes")?.click?.();
    if (stepObj.action === "play") {
      setTimeout(() => {
        const play = document.getElementById("btn-play-range");
        if (play && play.getAttribute("aria-pressed") !== "true") play.click();
      }, 500);
    }
    if (stepObj.action === "piano") {
      document.querySelector('.studio-tab[data-panel="piano"]')?.click?.();
      setTimeout(() => {
        const play = document.getElementById("btn-play-range");
        if (play && play.getAttribute("aria-pressed") !== "true") play.click();
      }, 700);
    }
    if (stepObj.action === "access") {
      document.querySelector('.studio-tab[data-panel="explain"]')?.click?.();
      ["btn-dyslexia-explain", "btn-braille-explain", "btn-dyslexia-score", "btn-braille-score"].forEach((id) =>
        document.getElementById(id)?.classList.add("tour-pulse")
      );
    } else {
      document.querySelectorAll(".tour-pulse").forEach((el) => el.classList.remove("tour-pulse"));
    }
  }

  function paintTour(n) {
    ensureTourDom();
    tourStep = n;
    tourActive = true;
    const stepObj = TOUR_STEPS[n];
    const tip = $("lune-tour");
    if (!tip || !stepObj) return;
    tip.hidden = false;
    const k = $("lune-tour-kicker");
    const t = $("lune-tour-title");
    const b = $("lune-tour-body");
    const next = $("lune-tour-next");
    const back = $("lune-tour-back");
    if (k) k.textContent = `Clair de lune · ${n + 1} / ${TOUR_STEPS.length}`;
    if (t) t.textContent = stepObj.title;
    if (b) b.textContent = stepObj.body;
    if (next) next.textContent = n >= TOUR_STEPS.length - 1 ? "Start practising" : "Next";
    if (back) back.hidden = n === 0;
    applyTourAction(stepObj);
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
  }

  function jumpToSim() {
    const target = $("tour") || $("features") || $("feat-letters");
    const home = $("home");
    if (home && target && home.contains(target)) {
      const delta = target.getBoundingClientRect().top - home.getBoundingClientRect().top;
      home.scrollTo({ top: Math.max(0, home.scrollTop + delta - 8), behavior: "smooth" });
      return;
    }
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function init() {
    ensureDom();
    ensureTourDom();
    loadDraft();
    ensureLibraryComposers().then(() => {
      if (step === 0 && !$("onboard")?.hidden) paintOnboard();
    });
    // Expose search-index items for dream-piece filtering when app.js loads them.
    fetch(
      typeof window.luneUrl === "function" ? window.luneUrl("/static/search-index.json") : "static/search-index.json"
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.items) window.__LUNE_SEARCH_ITEMS__ = data.items;
      })
      .catch(() => {});
    // Cloud prefs are fetched once per sign-in, not on every store change
    // (the fetch itself reports a change, which used to start it again).
    let prefsPulled = false;
    store()?.onChange?.(() => {
      applyGateChrome();
      if (signedIn()) {
        $("keep-lune-dialog")?.close?.();
        $("create-account-dialog")?.close?.();
        paintKeepBanner();
        if (!prefsPulled) {
          prefsPulled = true;
          // Prefer local onboarding flags so a background pull cannot re-lock the gate.
          store()
            ?.pullPrefs?.({ preferLocal: true })
            ?.then?.(() => {
              paintSignedHome();
              applyGateChrome();
            });
        }
        paintSignedHome();
      } else {
        prefsPulled = false;
        // Next sign-in should get a fresh welcome-back moment.
        try {
          sessionStorage.removeItem(SESSION_BACK_KEY);
        } catch {
          /* private mode */
        }
        pendingWelcomeBack = false;
        paintSignedHome();
      }
    });
    document.addEventListener("click", (e) => {
      const signinOnly = e.target.closest?.("[data-lp-signin-only]");
      if (signinOnly) {
        e.preventDefault();
        openCreateAccount();
        return;
      }
      const personalise = e.target.closest?.("[data-lp-personalise], [data-lp-create-account]");
      if (personalise) {
        e.preventDefault();
        showOnboard(0);
        return;
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
    });
    $("btn-member-search")?.addEventListener("click", () => {
      const q = $("q");
      if (!q) return;
      q.focus();
      if (window.matchMedia?.("(max-width: 720px)")?.matches) {
        document.body.classList.add("phone-search-open");
        $("btn-search")?.setAttribute("aria-expanded", "true");
      }
    });
  }

  return {
    init,
    route,
    requireUnlock,
    requireSignIn,
    requirePieceAccess,
    unlocked,
    signedIn,
    onboarded,
    openCreateAccount,
    promptKeepAccount,
    showWelcome,
    showSignedWelcome,
    showOnboard,
    applyGateChrome,
    paintHomeRecs,
    paintSignedHome,
    recommendations,
    buildRecommendations,
    startPieceWalkthrough,
    endTour,
  };
})();
