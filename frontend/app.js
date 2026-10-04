/* Lune — multi-piece studio: Score · Explain · Piano */

const $ = (id) => document.getElementById(id);

// Project Pages live at /lune/. Absolute /static and /api URLs would miss that prefix.
// Static export (GitHub Pages, or any host serving the export flagged with
// <meta name="lune-static">): no Python server, everything runs in the browser.
const LUNE_ON_PAGES =
  location.hostname.endsWith(".github.io") ||
  location.hostname === "lune.page" ||
  location.hostname.endsWith(".lune.page") ||
  !!document.querySelector('meta[name="lune-static"][content="1"]');
const LUNE_ROOT = LUNE_ON_PAGES
  ? location.pathname.replace(/\/static(?:\/.*)?$/, "").replace(/\/index\.html$/, "").replace(/\/$/, "")
  : "";
function luneUrl(path) {
  if (!path || /^https?:/i.test(path)) return path;
  if (!path.startsWith("/")) path = `/${path}`;
  return `${LUNE_ROOT}${path}`;
}

pdfjsLib.GlobalWorkerOptions.workerSrc = luneUrl("/static/vendor/pdf.worker.min.js");

const COMPOSER_FACE_FILES = {
  chopin: "chopin.jpg",
  beethoven: "beethoven.jpg",
  bach: "bach.jpg",
  mozart: "mozart.jpg",
  debussy: "debussy.jpg",
  liszt: "liszt.jpg",
  schubert: "schubert.jpg",
  schumann: "schumann.jpg",
  brahms: "brahms.jpg",
  tchaikovsky: "tchaikovsky.jpg",
  joplin: "joplin.jpg",
  satie: "satie.jpg",
  haydn: "haydn.jpg",
  handel: "handel.jpg",
  rimsky: "rimsky.jpg",
  "rimsky-korsakov": "rimsky.jpg",
  ravel: "ravel.jpg",
  rachmaninoff: "rachmaninoff.jpg",
  rachmaninov: "rachmaninoff.jpg",
  mendelssohn: "mendelssohn.jpg",
  grieg: "grieg.jpg",
  faure: "faure.jpg",
  "fauré": "faure.jpg",
  "saint-saens": "saint-saens.jpg",
  "saint-saëns": "saint-saens.jpg",
  mussorgsky: "mussorgsky.jpg",
  scarlatti: "scarlatti.jpg",
  clementi: "clementi.jpg",
  czerny: "czerny.jpg",
  burgmuller: "burgmuller.jpg",
  "burgmüller": "burgmuller.jpg",
  granados: "granados.jpg",
  albeniz: "albeniz.jpg",
  "albéniz": "albeniz.jpg",
  gershwin: "gershwin.jpg",
  macdowell: "macdowell.jpg",
  field: "field.jpg",
  pachelbel: "pachelbel.jpg",
  purcell: "purcell.jpg",
  vivaldi: "vivaldi.jpg",
  telemann: "telemann.jpg",
  busoni: "busoni.jpg",
  gluck: "gluck.jpg",
  weber: "weber.jpg",
  dvorak: "dvorak.jpg",
  "dvořák": "dvorak.jpg",
  sibelius: "sibelius.jpg",
  scriabin: "scriabin.jpg",
  franck: "franck.jpg",
  bartok: "bartok.jpg",
  "bartók": "bartok.jpg",
  poulenc: "poulenc.jpg",
  prokofiev: "prokofiev.jpg",
  paderewski: "paderewski.jpg",
  moszkowski: "moszkowski.jpg",
  gottschalk: "gottschalk.jpg",
};
const COMPOSER_FACE_V = "faces01";
const COMPOSER_SILHOUETTE = luneUrl(`/static/assets/composers/silhouette.svg?v=${COMPOSER_FACE_V}`);

/** Last-name / alias → era when search-index or overview lacks one. */
const COMPOSER_ERA_FALLBACK = {
  bach: "Baroque",
  handel: "Baroque",
  scarlatti: "Baroque",
  pachelbel: "Baroque",
  purcell: "Baroque",
  vivaldi: "Baroque",
  telemann: "Baroque",
  mozart: "Classical",
  haydn: "Classical",
  clementi: "Classical",
  czerny: "Classical",
  hummel: "Classical",
  gluck: "Classical",
  beethoven: "Early Romantic",
  schubert: "Early Romantic",
  field: "Early Romantic",
  weber: "Early Romantic",
  chopin: "Romantic",
  schumann: "Romantic",
  liszt: "Romantic",
  brahms: "Romantic",
  mendelssohn: "Romantic",
  grieg: "Romantic",
  tchaikovsky: "Romantic",
  mussorgsky: "Romantic",
  rimsky: "Romantic",
  korsakov: "Romantic",
  dvorak: "Romantic",
  franck: "Romantic",
  faure: "Romantic",
  "saint-saens": "Romantic",
  gottschalk: "Romantic",
  moszkowski: "Romantic",
  paderewski: "Romantic",
  macdowell: "Romantic",
  burgmuller: "Romantic",
  albeniz: "Romantic",
  granados: "Romantic",
  scriabin: "Late Romantic",
  rachmaninoff: "Late Romantic",
  rachmaninov: "Late Romantic",
  sibelius: "Late Romantic",
  busoni: "Late Romantic",
  leontovych: "Romantic",
  debussy: "Impressionist",
  ravel: "Impressionist",
  satie: "Impressionist",
  joplin: "Modern",
  bartok: "Modern",
  gershwin: "Modern",
  poulenc: "Modern",
  traditional: "Folk",
};

function composerEraFallback(name) {
  const key = composerFaceKey(name);
  if (key && COMPOSER_ERA_FALLBACK[key]) return COMPOSER_ERA_FALLBACK[key];
  const n = String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ");
  if (n.includes("rimsky") || n.includes("korsakov")) return "Romantic";
  if (n.includes("saint") && n.includes("saen")) return "Romantic";
  for (const k of Object.keys(COMPOSER_ERA_FALLBACK).sort((a, b) => b.length - a.length)) {
    if (n.includes(k)) return COMPOSER_ERA_FALLBACK[k];
  }
  return "";
}

const state = {
  piece: null,
  selected: null,
  selectedBars: [],
  pendingMeta: null,
  osmd: null,
  rawMusicxml: "",
  showFingers: false,
  lettersOnly: false,
  overlaySpacePass: 0,
  overlaySpaceKey: "",
  overlaySpacingLock: false,
  scoreLetters: true,
  scoreFingers: false,
  showTips: true,
  showLines: true,
  mode: "home",
  panel: "explain", // score | explain | piano
  scrubbing: false,
  resumeAfterScrub: false,
  scrubRatio: 0,
  timelineKind: null, // "piece" | null — transport always plays the whole piece
  snippetEnd: null, // timeline seconds where a bar/line snippet auto-pauses
  keyboard: null,
  keyboardVisible: false,
  playRate: 1,
  practiceBpm: 72,
  markedBpm: 72,
  sessions: [],
  activeSessionId: null,
  sessionSeq: 0,
  scoreReady: false,
  coachOpen: false,
};

function toast(msg) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  // long messages stay long enough to read
  toast.t = setTimeout(() => (el.hidden = true), Math.max(2800, String(msg).length * 55));
}

/* ---------- piano loader (shown while scores / samples load) ---------- */

let _loaderCount = 0;

function showLoader(text) {
  const el = $("lune-loader");
  if (!el) return;
  _loaderCount += 1;
  const label = $("lune-loader-text");
  if (label && text) label.textContent = text;
  el.hidden = false;
}

function hideLoader() {
  const el = $("lune-loader");
  if (!el) return;
  _loaderCount = Math.max(0, _loaderCount - 1);
  if (_loaderCount === 0) el.hidden = true;
}

/** Run an async task under the piano loader; always hides it afterwards. */
async function withLoader(text, task) {
  showLoader(text);
  try {
    return await task();
  } finally {
    hideLoader();
  }
}

/** Load piano samples, showing the loader only on the slow first load. */
async function ensureSamplesWithLoader() {
  if (LunePiano.isReady?.()) return LunePiano.ensure();
  return withLoader("Warming up the piano", () => LunePiano.ensure());
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function showView(name) {
  if (
    (name === "studio" || name === "discover" || name === "repertoire") &&
    window.LuneOnboard &&
    !LuneOnboard.unlocked()
  ) {
    LuneOnboard.requireUnlock();
    return;
  }
  // Leaving the studio closes the microphone.
  if (name !== "studio") window.LuneFollow?.stop?.({ quiet: true });
  const home = $("home");
  const discover = $("discover");
  const studio = $("studio");
  if (home) home.hidden = name !== "home";
  if (discover) discover.hidden = name !== "discover";
  if (studio) studio.hidden = name !== "studio";
  const rep = $("repertoire");
  if (rep) rep.hidden = name !== "repertoire";
  const study = $("study");
  if (study) study.hidden = name !== "study";
  const welcome = $("welcome");
  const onboard = $("onboard");
  const hello = $("hello");
  if (welcome) welcome.hidden = true;
  if (onboard) onboard.hidden = true;
  if (hello) hello.hidden = true;
  document.body.classList.toggle("is-repertoire", name === "repertoire");
  document.body.classList.toggle("is-study", name === "study");
  document.body.classList.toggle("is-home", name === "home");
  document.body.classList.toggle("is-discover", name === "discover");
  document.body.classList.toggle("is-studio", name === "studio");
  document.body.classList.remove("is-welcome", "is-onboard", "is-hello", "phone-search-open");
  if (name === "home") window.LuneOnboard?.paintSignedHome?.();
  $("btn-search")?.setAttribute("aria-expanded", "false");
  const studioNav = $("studio-nav");
  if (studioNav) studioNav.hidden = name !== "studio";
  if (name !== "studio") {
    closeCoach();
    document.body.classList.remove("studio-search-open");
    const seg = $("studio-seg");
    if (seg) seg.hidden = true;
    const dock = $("studio-dock");
    if (dock) dock.hidden = true;
    const quiet = $("studio-piece-quiet");
    if (quiet) quiet.hidden = true;
  } else {
    const seg = $("studio-seg");
    if (seg) seg.hidden = false;
    refreshStudioNav();
  }
  // Never leave the results popup hanging over discover/studio
  if (name !== "home") closeSearchResults({ blur: true });
}

function closeSearchResults({ blur = false } = {}) {
  const box = $("results");
  if (box) {
    box.hidden = true;
    box.innerHTML = "";
  }
  if (blur) {
    const q = $("q");
    if (q && document.activeElement === q) q.blur();
  }
}

/* ---------- search ---------- */

const SEARCH_LIMIT = 8;
// Paint on the next frame only — coalesces burst keystrokes, ~0–16ms feel (no 100ms lag).
const SEARCH_DEBOUNCE_MS = 0;
const SEARCH_INDEX_URL = luneUrl("/static/search-index.json?v=catalog03");
/** Composers whose piano works are typically still under copyright — honest empty state. */
const COPYRIGHT_ERA_COMPOSERS = [
  "ginastera", "prokofiev", "shostakovich", "khachaturian", "kabalevsky",
  "barber", "copland", "bernstein", "britten", "messiaen", "boulez",
  "stockhausen", "cage", "ligeti", "penderecki", "piazzolla", "villa-lobos",
  "villalobos", "bartok", "bartók", "stravinsky", "hindemith", "poulenc",
  "milhaud", "schnittke", "takemitsu",
];

function copyrightEraHint(query) {
  const q = String(query || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  for (const name of COPYRIGHT_ERA_COMPOSERS) {
    const needle = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (q.includes(needle)) {
      if (needle === "ginastera") {
        return (
          "Ginastera’s Suite de danzas criollas is still under copyright — " +
          "not available in Lune’s free public-domain library."
        );
      }
      const pretty = name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      return (
        `No free public-domain score for “${pretty}” in Lune’s library ` +
        "(many 20th-century works remain under copyright)."
      );
    }
  }
  return "";
}

// Large curated list available synchronously at module load — first key never waits on network.
const SEARCH_FALLBACK = [
  { title: "Mazurka op. 6 no. 2", composer: "Frédéric Chopin", query: "mazurka 06 2", group: "Featured", hay: "mazurka op 6 no 2 frederic chopin mazurka 06 2 featured mazurka 06 2 mazurka op 6 no 2 op 6 no 2 mazurka chopin mazurka chopin" },
  { title: "Piano Sonata no. 14 in C-sharp minor, op. 27 no. 2, \"Moonlight\"", composer: "Ludwig van Beethoven", query: "moonlight", group: "Featured", hay: "piano sonata no 14 in c sharp minor op 27 no 2 moonlight ludwig van beethoven moonlight featured moonlight sonata 14 sonata no 14 op 27 no 2 opus 27 no 2 beethoven" },
  { title: "Bagatelle no. 25 in A minor, WoO 59 \"Für Elise\"", composer: "Ludwig van Beethoven", query: "fur elise", group: "Featured", hay: "bagatelle no 25 in a minor woo 59 fur elise ludwig van beethoven fur elise featured fur elise fur elise elise woo 59 bagatelle 25 beethoven" },
  { title: "Prelude in C major, BWV 846", composer: "Johann Sebastian Bach", query: "bwv 846", group: "Featured", hay: "prelude in c major bwv 846 johann sebastian bach bwv 846 featured bwv 846 bwv846 prelude in c well tempered wtc bach" },
  { title: "Suite bergamasque — Clair de lune", composer: "Claude Debussy", query: "clair de lune", group: "Open MusicXML · Debussy", hay: "suite bergamasque clair de lune claude debussy clair de lune open musicxml debussy clair de lune clair de luna bergamasque debussy" },
  { title: "Prelude op. 28 no. 15 \"Raindrop\"", composer: "Frédéric Chopin", query: "chopin prelude 15", group: "Chopin preludes", hay: "prelude op 28 no 15 raindrop frederic chopin chopin prelude 15 chopin preludes prelude 15 raindrop chopin" },
  { title: "The Entertainer", composer: "Scott Joplin", query: "the entertainer", group: "Joplin rags", hay: "the entertainer scott joplin the entertainer joplin rags the entertainer entertainer joplin joplin" },
  { title: "Maple Leaf Rag", composer: "Scott Joplin", query: "maple leaf rag", group: "Joplin rags", hay: "maple leaf rag scott joplin maple leaf rag joplin rags maple leaf rag mapleleaf joplin joplin" },
  { title: "Piano Sonata no. 8 \"Pathétique\"", composer: "Ludwig van Beethoven", query: "beethoven sonata 8", group: "Beethoven piano sonatas", hay: "piano sonata no 8 pathetique ludwig van beethoven beethoven sonata 8 beethoven piano sonatas sonata 8 sonata no 8 pathetique beethoven" },
  { title: "Piano Sonata no. 23 \"Appassionata\"", composer: "Ludwig van Beethoven", query: "beethoven sonata 23", group: "Beethoven piano sonatas", hay: "piano sonata no 23 appassionata ludwig van beethoven beethoven sonata 23 beethoven piano sonatas sonata 23 sonata no 23 appassionata beethoven" },
  { title: "Gymnopédie no. 1", composer: "Erik Satie", query: "gymnopedie", group: "Open MusicXML · Satie", hay: "gymnopedie no 1 erik satie gymnopedie open musicxml satie gymnopedie gymnopedie gymnopedie 1 satie" },
  { title: "Arabesque no. 1 in E major, L.66", composer: "Claude Debussy", query: "arabesque", group: "Open MusicXML · Debussy", hay: "arabesque no 1 in e major l 66 claude debussy arabesque open musicxml debussy arabesque arabesque 1 l 66 debussy" },
  { title: "Liebestraum no. 3 in A-flat major, S.541/3", composer: "Franz Liszt", query: "liebestraum", group: "Open MusicXML · Liszt", hay: "liebestraum no 3 in a flat major s 541 3 franz liszt liebestraum open musicxml liszt liebestraum liebestraume dream of love s 541 liszt" },
  { title: "Nocturne op. 9 no. 2 in E-flat major", composer: "Frédéric Chopin", query: "nocturne op 9 no 2", group: "Open MusicXML · Chopin", hay: "nocturne op 9 no 2 in e flat major frederic chopin nocturne op 9 no 2 open musicxml chopin nocturne op 9 no 2 nocturne 9 2 nocturne e flat chopin" },
  { title: "Minuet in G major, BWV Anh. 114", composer: "Johann Sebastian Bach", query: "minuet in g", group: "Open MusicXML · Bach", hay: "minuet in g major bwv anh 114 johann sebastian bach minuet in g open musicxml bach minuet in g bwv anh 114 anna magdalena bach" },
  { title: "Grandes études de Paganini no. 3 \"La Campanella\"", composer: "Franz Liszt", query: "campanella", group: "Open MusicXML · Liszt", hay: "grandes etudes de paganini no 3 la campanella franz liszt campanella open musicxml liszt campanella la campanella paganini 3 etudes de paganini liszt" },
  { title: "Ave Maria, D.839 (piano)", composer: "Franz Schubert", query: "ave maria", group: "Open MusicXML · Schubert", hay: "ave maria d 839 piano franz schubert ave maria open musicxml schubert ave maria d 839 ellens dritter gesang schubert" },
  { title: "Gnossienne no. 1", composer: "Erik Satie", query: "gnossienne", group: "Open MusicXML · Satie", hay: "gnossienne no 1 erik satie gnossienne open musicxml satie gnossienne gnossienne 1 satie" },
  { title: "Piano Sonata no. 14 \"Moonlight\"", composer: "Ludwig van Beethoven", query: "beethoven sonata 14", group: "Beethoven piano sonatas", hay: "piano sonata no 14 moonlight ludwig van beethoven beethoven sonata 14 beethoven piano sonatas sonata 14 sonata no 14 moonlight beethoven" },
  { title: "Piano Sonata no. 11, K.331 — Rondo alla Turca", composer: "Wolfgang Amadeus Mozart", query: "alla turca", group: "Open MusicXML · Mozart", hay: "piano sonata no 11 k 331 rondo alla turca wolfgang amadeus mozart alla turca open musicxml mozart alla turca turkish march rondo alla turca k 331 mozart" },
  { title: "Twinkle Twinkle Little Star", composer: "Traditional", query: "twinkle", group: "Featured", hay: "twinkle twinkle little star traditional twinkle featured twinkle little star abc song traditional" },
  { title: "Piano Sonata no. 16 in C major, K.545 — Movement 1", composer: "Wolfgang Amadeus Mozart", query: "k 545", group: "Featured", hay: "piano sonata no 16 in c major k 545 movement 1 wolfgang amadeus mozart k 545 featured k 545 k545 sonata facile mozart sonata 16 mozart" },
  { title: "Ballade no. 1 in G minor, op. 23", composer: "Frédéric Chopin", query: "ballade 1", group: "Open MusicXML · Chopin", hay: "ballade no 1 in g minor op 23 frederic chopin ballade 1 open musicxml chopin ballade 1 ballade no 1 op 23 chopin" },
  { title: "Nocturne no. 20 in C-sharp minor, op. posth.", composer: "Frédéric Chopin", query: "nocturne 20", group: "Open MusicXML · Chopin", hay: "nocturne no 20 in c sharp minor op posth frederic chopin nocturne 20 open musicxml chopin nocturne 20 nocturne c sharp nocturne posthumous chopin" },
  { title: "Waltz in A minor, B.150", composer: "Frédéric Chopin", query: "waltz in a minor", group: "Open MusicXML · Chopin", hay: "waltz in a minor b 150 frederic chopin waltz in a minor open musicxml chopin waltz in a minor waltz a minor b 150 chopin" },
  { title: "Waltz op. 64 no. 2 in C-sharp minor", composer: "Frédéric Chopin", query: "waltz op 64 no 2", group: "Open MusicXML · Chopin", hay: "waltz op 64 no 2 in c sharp minor frederic chopin waltz op 64 no 2 open musicxml chopin waltz op 64 no 2 waltz 64 2 chopin" },
  { title: "Prelude op. 28 no. 4 in E minor", composer: "Frédéric Chopin", query: "prelude 4", group: "Open MusicXML · Chopin", hay: "prelude op 28 no 4 in e minor frederic chopin prelude 4 open musicxml chopin prelude 4 prelude op 28 no 4 chopin" },
  { title: "Hungarian Dance no. 5 in G minor", composer: "Johannes Brahms", query: "hungarian dance", group: "Open MusicXML · Brahms", hay: "hungarian dance no 5 in g minor johannes brahms hungarian dance open musicxml brahms hungarian dance hungarian dance 5 brahms 5 brahms" },
  { title: "Flight of the Bumblebee (piano)", composer: "Nikolai Rimsky-Korsakov", query: "bumblebee", group: "Open MusicXML · Rimsky-Korsakov", hay: "flight of the bumblebee piano nikolai rimsky korsakov bumblebee open musicxml rimsky korsakov bumblebee flight of the bumblebee korsakov" },
  { title: "Dance of the Sugar Plum Fairy", composer: "Pyotr Ilyich Tchaikovsky", query: "sugar plum", group: "Open MusicXML · Tchaikovsky", hay: "dance of the sugar plum fairy pyotr ilyich tchaikovsky sugar plum open musicxml tchaikovsky sugar plum sugar plum fairy tchaikovsky" },
  { title: "Canon in D", composer: "Johann Pachelbel", query: "canon in d", group: "Open MusicXML · Pachelbel", hay: "canon in d johann pachelbel canon in d open musicxml pachelbel canon in d pachelbel pachelbel" },
  { title: "Elite Syncopations", composer: "Scott Joplin", query: "elite syncopations", group: "Joplin rags", hay: "elite syncopations scott joplin elite syncopations joplin rags elite syncopations elite joplin joplin" },
  { title: "Solace", composer: "Scott Joplin", query: "solace", group: "Joplin rags", hay: "solace scott joplin solace joplin rags solace solace joplin joplin" },
  { title: "Ständchen (Schubert) — Liszt transcription", composer: "Franz Liszt", query: "standchen", group: "Open MusicXML · Liszt", hay: "standchen schubert liszt transcription franz liszt standchen open musicxml liszt standchen standchen serenade schubert liszt schubert serenade liszt" },
  { title: "Nocturne op. 9 no. 1", composer: "Frédéric Chopin", query: "nocturne op 9 no 1", group: "Open MusicXML · Chopin", hay: "nocturne op 9 no 1 frederic chopin nocturne op 9 no 1 open musicxml chopin nocturne op 9 no 1 nocturne 9 1 chopin" },
  { title: "Prelude in C minor, BWV 847", composer: "Johann Sebastian Bach", query: "bwv 847", group: "Open MusicXML · Bach", hay: "prelude in c minor bwv 847 johann sebastian bach bwv 847 open musicxml bach bwv 847 prelude c minor bach" },
  { title: "Piano Sonata no. 8 \"Pathétique\" — Movement 2", composer: "Ludwig van Beethoven", query: "pathetique 2", group: "Open MusicXML · Beethoven", hay: "piano sonata no 8 pathetique movement 2 ludwig van beethoven pathetique 2 open musicxml beethoven pathetique 2 pathetique movement 2 sonata 8 movement 2 beethoven" },
  { title: "Piano Sonata no. 14 \"Moonlight\" — Movement 3", composer: "Ludwig van Beethoven", query: "moonlight 3", group: "Open MusicXML · Beethoven", hay: "piano sonata no 14 moonlight movement 3 ludwig van beethoven moonlight 3 open musicxml beethoven moonlight 3 moonlight movement 3 moonlight mvt 3 beethoven" },
  { title: "Piano Sonata no. 1", composer: "Ludwig van Beethoven", query: "beethoven sonata 1", group: "Beethoven piano sonatas", hay: "piano sonata no 1 ludwig van beethoven beethoven sonata 1 beethoven piano sonatas sonata 1 sonata no 1 beethoven" },
  { title: "Piano Sonata no. 16", composer: "Wolfgang Amadeus Mozart", query: "mozart sonata 16", group: "Mozart piano sonatas", hay: "piano sonata no 16 wolfgang amadeus mozart mozart sonata 16 mozart piano sonatas mozart sonata 16 sonata 16 mozart" },
  { title: "Sonatinas (Clementi)", composer: "Muzio Clementi", query: "clementi", group: "Featured", hay: "sonatinas clementi muzio clementi clementi featured clementi sonatina sonatinas clementi" },
  { title: "Dichterliebe no. 2", composer: "Robert Schumann", query: "dichterliebe", group: "Featured", hay: "dichterliebe no 2 robert schumann dichterliebe featured dichterliebe schumann" },
  { title: "Piano Sonata no. 21 \"Waldstein\"", composer: "Ludwig van Beethoven", query: "beethoven sonata 21", group: "Beethoven piano sonatas", hay: "piano sonata no 21 waldstein ludwig van beethoven beethoven sonata 21 beethoven piano sonatas sonata 21 sonata no 21 waldstein beethoven" },
  { title: "Piano Sonata no. 17 \"Tempest\"", composer: "Ludwig van Beethoven", query: "beethoven sonata 17", group: "Beethoven piano sonatas", hay: "piano sonata no 17 tempest ludwig van beethoven beethoven sonata 17 beethoven piano sonatas sonata 17 sonata no 17 tempest beethoven" },
  { title: "Piano Sonata no. 26 \"Les Adieux\"", composer: "Ludwig van Beethoven", query: "beethoven sonata 26", group: "Beethoven piano sonatas", hay: "piano sonata no 26 les adieux ludwig van beethoven beethoven sonata 26 beethoven piano sonatas sonata 26 sonata no 26 les adieux beethoven" },
  { title: "Prelude op. 28 no. 4", composer: "Frédéric Chopin", query: "chopin prelude 4", group: "Chopin preludes", hay: "prelude op 28 no 4 frederic chopin chopin prelude 4 chopin preludes prelude 4 chopin" },
  { title: "Prelude op. 28 no. 7", composer: "Frédéric Chopin", query: "chopin prelude 7", group: "Chopin preludes", hay: "prelude op 28 no 7 frederic chopin chopin prelude 7 chopin preludes prelude 7 chopin" },
  { title: "Prelude op. 28 no. 20", composer: "Frédéric Chopin", query: "chopin prelude 20", group: "Chopin preludes", hay: "prelude op 28 no 20 frederic chopin chopin prelude 20 chopin preludes prelude 20 chopin" },
  { title: "Prelude op. 67 no. 1", composer: "Johann Nepomuk Hummel", query: "hummel prelude 1", group: "Hummel preludes", hay: "prelude op 67 no 1 johann nepomuk hummel hummel prelude 1 hummel preludes hummel prelude 1 hummel" },
  { title: "String Quartet op. 18 no. 1 — Movement 1", composer: "Ludwig van Beethoven", query: "op 18 no 1", group: "Featured", hay: "string quartet op 18 no 1 movement 1 ludwig van beethoven op 18 no 1 featured op 18 no 1 opus 18 no 1 string quartet op 18 beethoven" },
  { title: "Piano Sonata no. 16 in C major, K.545 — Movement 2", composer: "Wolfgang Amadeus Mozart", query: "k 545 mvt 2", group: "Featured", hay: "piano sonata no 16 in c major k 545 movement 2 wolfgang amadeus mozart k 545 mvt 2 featured k 545 mvt 2 sonata 16 movement 2 mozart" },
  { title: "Piano Sonata no. 16 in C major, K.545 — Movement 3", composer: "Wolfgang Amadeus Mozart", query: "k 545 mvt 3", group: "Featured", hay: "piano sonata no 16 in c major k 545 movement 3 wolfgang amadeus mozart k 545 mvt 3 featured k 545 mvt 3 sonata 16 movement 3 mozart" },
  { title: "String Quartet K.155 — Movement 1", composer: "Wolfgang Amadeus Mozart", query: "k 155", group: "Featured", hay: "string quartet k 155 movement 1 wolfgang amadeus mozart k 155 featured k 155 k155 k 155 mozart" },
  { title: "Piano Sonata no. 2", composer: "Ludwig van Beethoven", query: "beethoven sonata 2", group: "Beethoven piano sonatas", hay: "piano sonata no 2 ludwig van beethoven beethoven sonata 2 beethoven piano sonatas sonata 2 sonata no 2 beethoven" },
  { title: "Piano Sonata no. 3", composer: "Ludwig van Beethoven", query: "beethoven sonata 3", group: "Beethoven piano sonatas", hay: "piano sonata no 3 ludwig van beethoven beethoven sonata 3 beethoven piano sonatas sonata 3 sonata no 3 beethoven" },
  { title: "Piano Sonata no. 5", composer: "Ludwig van Beethoven", query: "beethoven sonata 5", group: "Beethoven piano sonatas", hay: "piano sonata no 5 ludwig van beethoven beethoven sonata 5 beethoven piano sonatas sonata 5 sonata no 5 beethoven" },
  { title: "Piano Sonata no. 29 \"Hammerklavier\"", composer: "Ludwig van Beethoven", query: "beethoven sonata 29", group: "Beethoven piano sonatas", hay: "piano sonata no 29 hammerklavier ludwig van beethoven beethoven sonata 29 beethoven piano sonatas sonata 29 sonata no 29 hammerklavier beethoven" },
  { title: "Piano Sonata no. 11", composer: "Wolfgang Amadeus Mozart", query: "mozart sonata 11", group: "Mozart piano sonatas", hay: "piano sonata no 11 wolfgang amadeus mozart mozart sonata 11 mozart piano sonatas mozart sonata 11 sonata 11 mozart" },
  { title: "Piano Sonata no. 13", composer: "Wolfgang Amadeus Mozart", query: "mozart sonata 13", group: "Mozart piano sonatas", hay: "piano sonata no 13 wolfgang amadeus mozart mozart sonata 13 mozart piano sonatas mozart sonata 13 sonata 13 mozart" },
  { title: "Mazurka op. 7 no. 1", composer: "Frédéric Chopin", query: "chopin mazurka op 7 no 1", group: "Chopin mazurkas", hay: "mazurka op 7 no 1 frederic chopin chopin mazurka op 7 no 1 chopin mazurkas mazurka op 7 no 1 mazurka 7 1 chopin" },
  { title: "Keyboard Sonata K.1 / L.366", composer: "Domenico Scarlatti", query: "scarlatti k 1", group: "Scarlatti sonatas", hay: "keyboard sonata k 1 l 366 domenico scarlatti scarlatti k 1 scarlatti sonatas k 1 l 366 scarlatti scarlatti" },
  { title: "A Breeze from Alabama", composer: "Scott Joplin", query: "a breeze from alabama", group: "Joplin rags", hay: "a breeze from alabama scott joplin a breeze from alabama joplin rags a breeze from alabama breeze joplin joplin" },
  { title: "Antoinette", composer: "Scott Joplin", query: "antoinette", group: "Joplin rags", hay: "antoinette scott joplin antoinette joplin rags antoinette antoinette joplin joplin" },
  { title: "Augustan Club Waltz", composer: "Scott Joplin", query: "augustan club waltz", group: "Joplin rags", hay: "augustan club waltz scott joplin augustan club waltz joplin rags augustan club waltz augustan joplin joplin" },
  { title: "Bethena", composer: "Scott Joplin", query: "bethena", group: "Joplin rags", hay: "bethena scott joplin bethena joplin rags bethena bethena joplin joplin" },
];

// Start on sync fallback so typeahead never blocks on fetch.
let searchIndex = SEARCH_FALLBACK;
let searchIndexReady = false; // true once static JSON upgraded the list
let searchIndexPromise = null;
let searchGen = 0;
let lastSearchQuery = "";

function activeSearchIndex() {
  return searchIndex && searchIndex.length ? searchIndex : SEARCH_FALLBACK;
}

function normSearch(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/♯|#/g, "sharp")
    .replace(/♭/g, "flat")
    .replace(/für/g, "fur")
    .replace(/[ü]/g, "u")
    .replace(/[éè]/g, "e")
    .replace(/ö/g, "o")
    .replace(/ä/g, "a")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ensureSearchIndex() {
  if (searchIndexReady) return Promise.resolve(searchIndex);
  if (!searchIndexPromise) {
    const t0 = performance.now();
    // Static JSON only — zero Python work on the request path.
    searchIndexPromise = fetch(SEARCH_INDEX_URL)
      .then((res) => {
        if (!res.ok) throw new Error("index");
        return res.json();
      })
      .then((data) => {
        const items = Array.isArray(data.items) ? data.items : [];
        if (items.length) {
          searchIndex = items;
          searchIndexReady = true;
        }
        if (typeof console !== "undefined" && console.debug) {
          console.debug(
            `[search] static index ${searchIndex.length} items in ${(performance.now() - t0).toFixed(1)}ms`
          );
        }
        // Refresh current query with the fuller index (typeahead already showed fallback).
        if (lastSearchQuery.length >= 2) paintSearch(lastSearchQuery);
        return searchIndex;
      })
      .catch(() => {
        searchIndexPromise = null;
        return searchIndex;
      });
  }
  return searchIndexPromise;
}

// Words that carry no meaning in a title search ("river flows in you" must
// not match every title containing "in").
const SEARCH_STOPWORDS = new Set([
  "a", "an", "the", "in", "of", "and", "for", "to", "by", "on", "at", "my", "you", "your",
  "de", "la", "le", "les", "du", "des", "von", "van", "der", "die", "das", "und", "piece", "music",
  "score", "sheet", "piano", "free", "musicxml",
]);

/** Rough phonetic folding so "moonlite"/"moonlight", "gymnopedy"/"gymnopedie" meet. */
function foldWord(w) {
  return w
    .replace(/ght/g, "t")
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/qu/g, "k")
    .replace(/y$/g, "ie")
    .replace(/(.)\1+/g, "$1")
    .replace(/e$/g, "");
}

function editDistanceWithin(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

const hayWordCache = new WeakMap();
function hayWords(entry) {
  let w = hayWordCache.get(entry);
  if (!w) {
    const words = [...new Set(String(entry.hay || "").split(" ").filter(Boolean))];
    w = { words, folded: words.map(foldWord) };
    hayWordCache.set(entry, w);
  }
  return w;
}

/** 3 exact word · 2.4 prefix · 1.6 typo/phonetic · 0 no match. */
function tokenMatch(token, entry) {
  const { words, folded } = hayWords(entry);
  const isNum = /^\d+$/.test(token);
  let best = 0;
  const ft = foldWord(token);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === token) return 3;
    if (isNum) continue; // numbers must match exactly (op 10 ≠ op 1)
    if (token.length >= 2 && w.startsWith(token)) best = Math.max(best, 2.4);
    else if (token.length >= 4) {
      const max = token.length >= 7 ? 2 : 1;
      if (folded[i] === ft || editDistanceWithin(ft, folded[i], max)) best = Math.max(best, 1.6);
    }
  }
  return best;
}

function scoreIndexEntry(q, entry, tokens) {
  const hay = entry.hay || "";
  let score = 0;
  for (const t of tokens) {
    const m = tokenMatch(t, entry);
    if (!m) return 0; // every meaningful word must match something
    score += m;
  }
  if (hay.includes(q)) score += 6; // whole phrase in order
  const title = normSearch(entry.title || "");
  if (title.startsWith(q)) score += 4;
  else if (title.includes(q)) score += 2;
  const group = entry.group || "";
  if (group.startsWith("Featured") || group.startsWith("Open MusicXML")) score += 1.5;
  else if (group.startsWith("Bach chorales") || group.startsWith("music21")) score -= 1;
  return score;
}

function filterSearchIndex(query, limit = SEARCH_LIMIT, index = activeSearchIndex()) {
  const q = normSearch(query);
  if (q.length < 2 || !index || !index.length) return [];
  let tokens = q.split(" ").filter((t) => t && !SEARCH_STOPWORDS.has(t));
  if (!tokens.length) tokens = q.split(" ").filter(Boolean);
  const scored = [];
  for (const entry of index) {
    const score = scoreIndexEntry(q, entry, tokens);
    if (score > 0) scored.push({ score, entry });
  }
  scored.sort((a, b) => b.score - a.score || String(a.entry.title).localeCompare(String(b.entry.title)));
  const seen = new Set();
  const results = [];
  for (const { entry } of scored) {
    // one row per piece, even if the index lists it under several names
    const key = `${normSearch(entry.title)}\0${normSearch(entry.composer)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      kind: "work",
      id: `free-${entry.query}`,
      title: entry.title,
      composer: entry.composer,
      subtitle: LUNE_ON_PAGES ? `Free score · ${entry.group || entry.composer || ""}` : `Free score · ${entry.group || ""}`,
      epoch: entry.epoch || entry.era || composerEraFallback(entry.composer) || "",
      portrait: localComposerFaceUrl(entry.composer) || "",
      openable: true,
      query: entry.query,
    });
    if (results.length >= limit) break;
  }
  return results;
}

function renderSearchResults(box, all, q) {
  if (!all.length) {
    box.textContent = "";
    const wrap = document.createElement("div");
    wrap.className = "result result-empty";
    const hint = copyrightEraHint(q);
    const msg = document.createElement("p");
    msg.className = "result-empty-msg";
    msg.textContent = hint || `No pieces found for “${q}”`;
    wrap.appendChild(msg);
    const sub = document.createElement("p");
    sub.className = "result-empty-sub";
    sub.textContent = hint
      ? "If you legally own a MusicXML, PDF, or photo of the score, upload it to practise here."
      : "Try another title, or upload a score you legally own.";
    wrap.appendChild(sub);
    const uploadBtn = document.createElement("button");
    uploadBtn.type = "button";
    uploadBtn.className = "result-empty-upload";
    uploadBtn.textContent = "Upload your score";
    uploadBtn.addEventListener("click", () => {
      closeSearchResults({ blur: true });
      $("file")?.click();
    });
    wrap.appendChild(uploadBtn);
    if (/ginastera/i.test(q || "")) {
      const info = document.createElement("a");
      info.className = "result-empty-link";
      info.href = "https://en.wikipedia.org/wiki/Suite_de_danzas_criollas";
      info.target = "_blank";
      info.rel = "noopener noreferrer";
      info.textContent = "About this work · legal editions via publishers";
      wrap.appendChild(info);
    }
    box.appendChild(wrap);
    return;
  }
  box.textContent = "";
  const frag = document.createDocumentFragment();
  for (const item of all) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "result";
    const kind =
      item.kind === "composer"
        ? "Composer"
        : item.openable
          ? "Free score"
          : item.subtitle || "Work";
    const title = document.createTextNode(item.title || "");
    const small = document.createElement("small");
    small.textContent = [item.composer, kind, item.epoch].filter(Boolean).join(" · ");
    btn.appendChild(title);
    btn.appendChild(small);
    btn.addEventListener("click", () => {
      closeSearchResults({ blur: true });
      fetchAndDiscover([item]);
    });
    frag.appendChild(btn);
  }
  box.appendChild(frag);
}

/** Sync filter+render — never touches the network. */
function paintSearch(query) {
  const box = $("results");
  if (!box) return;
  const q = (query || "").trim();
  lastSearchQuery = q;
  if (q.length < 2) {
    closeSearchResults();
    return;
  }
  const t0 = performance.now();
  const gen = ++searchGen;
  box.hidden = false;
  const all = filterSearchIndex(q);
  if (gen !== searchGen) return;
  renderSearchResults(box, all, q);
  if (typeof console !== "undefined" && console.debug) {
    console.debug(`[search] filter+render ${(performance.now() - t0).toFixed(2)}ms → ${all.length}`);
  }
}

async function search(query, { openBest = false } = {}) {
  const q = (query || "").trim();
  lastSearchQuery = q;
  if (q.length < 2) {
    closeSearchResults();
    return;
  }
  // Typing path is always local (fallback or full index).
  if (!openBest) {
    paintSearch(q);
    return;
  }

  const box = $("results");
  if (!box) return;
  const gen = ++searchGen;
  box.hidden = false;

  // Prefer full index if already ready; otherwise use fallback immediately.
  let all = filterSearchIndex(q);
  // One short wait for the prefetch if it is already in flight (submit only).
  if (!all.length && (!searchIndex || !searchIndex.length) && searchIndexPromise) {
    try {
      await Promise.race([
        searchIndexPromise,
        new Promise((r) => setTimeout(r, 120)),
      ]);
    } catch {
      /* ignore */
    }
    if (gen !== searchGen) return;
    all = filterSearchIndex(q);
  }

  const works = all.filter((r) => r.kind !== "composer");
  closeSearchResults({ blur: true });
  const openable = works.filter((r) => r.openable);
  const list = (openable.length ? openable : works).length
    ? openable.length
      ? openable
      : works
    : all
        .filter((r) => r.kind === "composer")
        .map((c) => ({
          kind: "work",
          title: c.title,
          composer: c.composer || c.title,
          epoch: c.epoch || "",
          portrait: c.portrait || "",
        }));
  await fetchAndDiscover(list.length ? list : [{ title: q, composer: "", query: q }]);
}

let staticOpensPromise = null;
const staticXmlCache = new Map();

function loadStaticOpens() {
  if (!staticOpensPromise) {
    staticOpensPromise = fetch(luneUrl("/static/opens.json"))
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => (Array.isArray(data) ? data : []))
      .catch(() => []);
  }
  return staticOpensPromise;
}

function scoreStaticOpen(body, row) {
  const query = normSearch(body.query || "");
  const title = normSearch(body.title || "");
  const rowQuery = normSearch(row.query || "");
  const rowTitle = normSearch(row.title || "");
  const hay = row.hay || "";
  let score = 0;
  if (query && rowQuery && (query === rowQuery || rowQuery.includes(query) || query.includes(rowQuery))) {
    score += 28;
  }
  if (title && rowTitle && (title === rowTitle || rowTitle.includes(title) || title.includes(rowTitle))) {
    score += 22;
  }
  if (query && hay.includes(query)) score += 10;
  if (title && hay.includes(title)) score += 8;
  return score;
}

async function loadStaticXml(file) {
  if (staticXmlCache.has(file)) return staticXmlCache.get(file);
  const res = await fetch(luneUrl(`/static/${file}`));
  if (!res.ok) throw new Error("score");
  const text = await res.text();
  staticXmlCache.set(file, text);
  return text;
}

async function tryOpenStatic(body) {
  // Prefer allowlisted remote MusicXML when the search hit is marked remote.
  if (body.remote && window.LuneFetchScore?.tryOpenRemote) {
    const remote = await window.LuneFetchScore.tryOpenRemote(body);
    if (remote && remote.opened !== false) return remote;
  }
  const rows = await loadStaticOpens();
  // 1) exact catalogue id / query (typeahead picks and shared links)
  let best = rows.find((r) => (body.query && (r.id === body.query || r.query === body.query)));
  // 2) typed text → the same strict search the typeahead uses
  if (!best) {
    const typed = body.query || body.title || "";
    const hit = filterSearchIndex(typed, 1, rows)[0];
    if (hit) best = rows.find((r) => r.query === hit.query || r.id === hit.id) || null;
  }
  if (best?.file) {
    try {
      const musicxml = await loadStaticXml(best.file);
      if (body.analyze && best.analysis) {
        const res = await fetch(luneUrl(`/static/${best.analysis}`));
        if (res.ok) {
          const full = await res.json();
          full.musicxml = musicxml;
          full.opened = true;
          full.kind = "score";
          full.needsAnalysis = false;
          full.openQuery = body.query || "";
          full.id = best.id || full.id || "";
          if (best.credit && !full.credit) full.credit = best.credit;
          if (best.fallbackNote) full.fallbackNote = best.fallbackNote;
          return full;
        }
      }
      return {
        kind: "score",
        opened: true,
        needsAnalysis: true,
        title: best.title,
        composer: best.composer,
        filename: (best.file || "").split("/").pop(),
        musicxml,
        overview: best.overview || {},
        epoch: best.epoch || "",
        era: best.epoch || "",
        debriefs: {},
        source: best.source || "library",
        downloadName: best.downloadName || "score.musicxml",
        id: best.id || "",
        credit: best.credit || null,
        openQuery: body.query || "",
        fallbackNote: best.fallbackNote || "",
      };
    } catch {
      /* fall through to remote fetch */
    }
  }
  // 3) Allowlisted free MusicXML/MXL fetch (GitHub raw only — no PDFs, no paid APIs)
  if (window.LuneFetchScore?.tryOpenRemote) {
    const remote = await window.LuneFetchScore.tryOpenRemote(body);
    if (remote) return remote;
  }
  return {
    kind: "catalogue",
    opened: false,
    title: body.title || body.query || "",
    composer: body.composer || "",
    message:
      "No free MusicXML for that title in Lune’s allowlisted sources yet. Try another spelling, pick a result from search, or upload your own MusicXML.",
  };
}

async function tryOpen(body) {
  try {
    if (LUNE_ON_PAGES) return await tryOpenStatic(body);
    const res = await fetch(luneUrl("/api/search/open"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const piece = await res.json();
    if (piece && piece.opened !== false && piece.kind !== "catalogue") return piece;
    // Server miss → try the same free remote MusicXML allowlist in-browser.
    if (window.LuneFetchScore?.tryOpenRemote) {
      const remote = await window.LuneFetchScore.tryOpenRemote(body);
      if (remote && remote.opened !== false) return remote;
    }
    return piece;
  } catch {
    if (window.LuneFetchScore?.tryOpenRemote) {
      try {
        return await window.LuneFetchScore.tryOpenRemote(body);
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function fetchAndDiscover(works) {
  closeSearchResults({ blur: true });
  const typed = ($("q").value || "").trim();
  await withLoader("Finding the score", async () => {
    let lastMiss = null;
    // Light open only (no music21) — try best hits sequentially; Discover must feel instant.
    for (const item of works.slice(0, 4)) {
      const piece = await tryOpen({
        title: item.title,
        composer: item.composer || "",
        epoch: item.epoch || "",
        query: item.query || typed,
        portrait: item.portrait || "",
        remote: !!item.remote,
        id: item.id || "",
      });
      if (!piece) continue;
      if (piece.opened === false || piece.kind === "catalogue") {
        lastMiss = { item, piece };
        continue;
      }
      $("q").value = item.composer ? `${item.composer} — ${item.title}` : item.title;
      await landOnDiscover(piece);
      return;
    }
    // Last resort: raw typed search (composer nickname etc.)
    if (typed.length >= 2) {
      const piece = await tryOpen({ title: typed, composer: "", query: typed });
      if (piece && piece.kind === "score") {
        await landOnDiscover(piece);
        return;
      }
      if (piece && (piece.opened === false || piece.kind === "catalogue")) {
        lastMiss = lastMiss || { item: { title: typed }, piece };
      }
    }
    if (lastMiss) {
      showDiscoverPage(lastMiss.piece, { canOpen: false });
      return;
    }
    toast("No free score available");
  });
}

async function landOnDiscover(piece) {
  closeSearchResults({ blur: true });
  if (piece.fallbackNote) toast(piece.fallbackNote);
  const canOpen = piece.kind === "score" && !!piece.musicxml;
  if (!canOpen && piece.kind === "catalogue") {
    // Catalogue miss still gets a studio Explain tab so the face + story show.
    openPieceSession(piece, { panel: "explain", analyze: false });
    return;
  }
  openPieceSession(piece, { panel: "explain", analyze: false });
}

/* ---------- composer faces ---------- */

function composerFaceKey(name) {
  const n = String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\d{3,4}\s*[-–—]\s*\d{3,4}/g, " ")
    .replace(/[^a-z0-9\s\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!n) return "";
  if (n.includes("rimsky") || n.includes("korsakov")) return "rimsky";
  if (n.includes("saint") && n.includes("saen")) return "saint-saens";
  const keys = Object.keys(COMPOSER_FACE_FILES).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (n.includes(key)) return key;
  }
  const last = n.trim().split(/\s+/).pop() || "";
  return COMPOSER_FACE_FILES[last] ? last : "";
}

function localComposerFaceUrl(composer) {
  const key = composerFaceKey(composer);
  if (!key) return "";
  const file = COMPOSER_FACE_FILES[key];
  return file ? luneUrl(`/static/assets/composers/${file}?v=${COMPOSER_FACE_V}`) : "";
}

function applyComposerFace(img, fallbackEl, composer, remoteUrl) {
  if (!img) return;
  const name = composer || "Composer";
  const local = localComposerFaceUrl(name);
  const remote = (remoteUrl || "").trim();
  const queue = [local, remote].filter(Boolean);
  let i = 0;

  const showSilhouette = () => {
    img.hidden = false;
    img.removeAttribute("hidden");
    img.onerror = null;
    img.src = COMPOSER_SILHOUETTE;
    img.alt = name;
    if (fallbackEl) {
      fallbackEl.hidden = true;
      fallbackEl.textContent = "";
    }
  };

  const tryNext = () => {
    if (i >= queue.length) {
      showSilhouette();
      return;
    }
    const url = queue[i++];
    img.hidden = false;
    img.removeAttribute("hidden");
    img.alt = name;
    img.onerror = () => tryNext();
    img.onload = () => {
      if (fallbackEl) fallbackEl.hidden = true;
    };
    img.src = url;
  };

  if (!queue.length) {
    showSilhouette();
    return;
  }
  tryNext();
}

/* ---------- piece sessions (browser-like tabs) ---------- */

/** Tab label: the name a pianist would say ("Moonlight · I", "Für Elise"). */
function shortPieceTitle(title) {
  const t = String(title || "Untitled").trim();
  if (t.length <= 28) return t;
  const nick = t.match(/[“"]([^”"]+)[”"]/);
  const mvt = t.match(/Movement\s+(\d+)/i);
  const roman = ["", "I", "II", "III", "IV", "V", "VI"];
  if (nick) return mvt ? `${nick[1]} · ${roman[+mvt[1]] || mvt[1]}` : nick[1];
  const dash = t.split(/\s+—\s+/);
  if (dash.length > 1 && !/^Movement/i.test(dash[1]) && dash[1].length <= 28) return dash[1];
  const lead = dash[0].replace(/,\s*(op\.|BWV|K\.|Hob\.|WoO|S\.|L\.).*$/i, "");
  let base = lead;
  if ((mvt ? base.length + 5 : base.length) > 28) base = base.replace(/\s+in\s+[A-G](-sharp|-flat)?\s+(major|minor)/i, "");
  const short = mvt ? `${base} · ${roman[+mvt[1]] || mvt[1]}` : base;
  return short.length <= 28 ? short : `${short.slice(0, 26).trim()}…`;
}

function activeSession() {
  return state.sessions.find((s) => s.id === state.activeSessionId) || null;
}

function snapshotActiveSession() {
  const s = activeSession();
  if (!s) return;
  s.piece = state.piece;
  s.rawMusicxml = state.rawMusicxml || "";
  s.panel = state.panel || "explain";
  s.scoreLetters = !!state.scoreLetters;
  s.scoreFingers = !!state.scoreFingers;
  s.showTips = !!state.showTips;
  s.showLines = !!state.showLines;
  s.playRate = state.playRate || 1;
  s.practiceBpm = state.practiceBpm || 72;
  s.markedBpm = state.markedBpm || state.practiceBpm || 72;
  s.keyboardVisible = !!state.keyboardVisible;
  s.selected = state.selected;
  s.selectedBars = [...(state.selectedBars || [])];
  s.scoreReady = !!state.scoreReady;
  try {
    if (LunePiano.hasTimeline?.()) {
      const dur = LunePiano.duration() || 0;
      s.scrubRatio = dur > 0 ? (LunePiano.progress() || 0) / dur : 0;
    } else {
      s.scrubRatio = state.scrubRatio || 0;
    }
  } catch {
    /* ignore */
  }
}

function createSession(piece, panel = "explain") {
  const o = piece?.overview || {};
  const title = o.title || piece?.title || "Untitled";
  return {
    id: `p${++state.sessionSeq}`,
    piece,
    rawMusicxml: piece?.musicxml || "",
    panel,
    scoreLetters: true,
    scoreFingers: false,
    showTips: true,
    showLines: true,
    playRate: 1,
    keyboardVisible: false,
    selected: null,
    selectedBars: [],
    scrubRatio: 0,
    scoreReady: false,
    shortTitle: shortPieceTitle(title),
  };
}

/* Open tabs survive a reload: only their ids are kept, and a tab's score is
 * fetched again when it is clicked. Uploaded scores are not kept. */
const TABS_KEY = "lune.tabs";
let tabsRestored = false;

function sessionRouteId(s) {
  return s?.lazy ? s.lazy.id : pieceRouteId(s?.piece);
}

function saveTabs() {
  if (!tabsRestored) return; // nothing is written over the saved tabs before they are read
  const tabs = state.sessions
    .filter((s) => sessionRouteId(s))
    .map((s) => ({
      id: sessionRouteId(s),
      title: s.shortTitle,
      composer: s.lazy ? s.lazy.composer : s.piece?.overview?.composer || s.piece?.composer || "",
      panel: s.panel || "explain",
    }));
  try {
    if (tabs.length) localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, active: sessionRouteId(activeSession()) || null }));
    else localStorage.removeItem(TABS_KEY);
  } catch {
    /* private mode: tabs last for this visit */
  }
}

/** Put back the tabs from the last visit, without loading any score. */
function restoreTabs() {
  if (tabsRestored) return;
  tabsRestored = true;
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(TABS_KEY) || "null");
  } catch {
    saved = null;
  }
  if (!Array.isArray(saved?.tabs)) return;
  for (const t of saved.tabs.slice(0, 12)) {
    if (!t?.id || state.sessions.some((s) => sessionRouteId(s) === t.id)) continue;
    const s = createSession(null, t.panel === "score" || t.panel === "piano" ? t.panel : "explain");
    s.lazy = { id: String(t.id), composer: String(t.composer || "") };
    s.shortTitle = String(t.title || t.id);
    state.sessions.push(s);
  }
  renderPieceTabs();
}

/** A restored tab gets its score when it is first opened. */
async function materializeSession(s) {
  if (!s?.lazy) return true;
  const id = s.lazy.id;
  const piece = await withLoader("Opening the score", () =>
    tryOpen(LUNE_ON_PAGES ? { query: id } : { query: id.replace(/-/g, " "), title: "" })
  ).catch(() => null);
  if (!piece || piece.kind !== "score") {
    state.sessions.splice(state.sessions.indexOf(s), 1);
    renderPieceTabs();
    toast("That tab’s score couldn’t be opened again, so it was closed.");
    return false;
  }
  enrichPieceMeta(piece);
  delete s.lazy;
  s.piece = piece;
  s.rawMusicxml = piece.musicxml || "";
  s.shortTitle = shortPieceTitle(piece.overview?.title || piece.title);
  return true;
}

function renderPieceTabs() {
  saveTabs();
  const host = $("piece-tabs");
  const quiet = $("studio-piece-quiet");
  if (!host) return;
  host.textContent = "";
  const n = state.sessions.length;
  if (!n) {
    host.hidden = true;
    if (quiet) {
      quiet.hidden = true;
      quiet.textContent = "";
    }
    return;
  }

  const studio = document.body.classList.contains("is-studio");
  const active = activeSession();
  const title =
    active?.shortTitle ||
    shortPieceTitle(active?.piece?.title || active?.piece?.overview?.title || "");
  if (quiet) {
    quiet.textContent = title;
    quiet.hidden = !studio || (n >= 2 && window.innerWidth > 760);
    quiet.title = active?.piece?.title || title;
  }
  const mark = $("btn-bookmark");
  if (mark) mark.hidden = false;
  // On the home page every open piece keeps its tab, so one tap returns to it.
  host.hidden = studio ? n < 2 : false;
  if (studio && n < 2) {
    host.textContent = "";
    return;
  }

  const frag = document.createDocumentFragment();
  for (const s of state.sessions) {
    const current = s.id === state.activeSessionId && !s.lazy;
    const tab = document.createElement("div");
    tab.className = "piece-tab" + (current ? " on" : "") + (s.lazy ? " piece-tab-lazy" : "");
    tab.setAttribute("role", "presentation");
    const composerName = s.lazy ? s.lazy.composer : s.piece?.overview?.composer || s.piece?.composer || "";
    const faceUrl =
      localComposerFaceUrl(composerName) ||
      (s.piece?.overview?.composerInfo?.image || "").trim() ||
      COMPOSER_SILHOUETTE;
    const face = document.createElement("img");
    face.className = "piece-tab-face";
    face.alt = "";
    face.width = 18;
    face.height = 18;
    face.decoding = "async";
    face.src = faceUrl;
    face.onerror = () => {
      face.onerror = null;
      face.src = COMPOSER_SILHOUETTE;
    };
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "piece-tab-label";
    btn.title = s.piece?.title || s.shortTitle;
    btn.textContent = s.shortTitle;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", current ? "true" : "false");
    if (current) btn.setAttribute("aria-current", "page");
    btn.addEventListener("click", () => {
      // from the home page the "active" piece still has to be brought back on stage
      if (!document.body.classList.contains("is-studio") && s.id === state.activeSessionId) showView("studio");
      else activateSession(s.id).catch((e) => toast(e.message));
    });
    tab.appendChild(face);
    tab.appendChild(btn);
    if (n >= 2 || !studio) {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "piece-tab-close";
      close.setAttribute("aria-label", `Close ${s.shortTitle}`);
      close.textContent = "×";
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        closeSession(s.id).catch((err) => toast(err.message));
      });
      tab.appendChild(close);
    }
    frag.appendChild(tab);
  }
  const add = document.createElement("button");
  add.type = "button";
  add.className = "piece-tab-new";
  add.setAttribute("aria-label", "Open another piece in a new tab");
  add.title = "Open another piece";
  add.textContent = "+";
  add.addEventListener("click", () => {
    if (document.body.classList.contains("is-studio")) openStudioSearch();
    else $("q")?.focus();
  });
  frag.appendChild(add);
  host.appendChild(frag);
  host.classList.toggle("piece-tabs-solo", n < 2);
}

function openStudioSearch() {
  document.body.classList.add("studio-search-open");
  const q = $("q");
  if (q) {
    q.focus();
    q.select?.();
  }
  toast("Search to open another piece");
}

function syncTogglesFromState() {
  const map = [
    ["tog-letters", state.scoreLetters],
    ["tog-fingers", state.scoreFingers],
  ];
  for (const [id, on] of map) {
    const el = $(id);
    if (!el) continue;
    el.checked = !!on;
    el.closest(".tog")?.classList.toggle("on", !!on);
  }
  const mode = state.scoreFingers ? "fingers" : state.scoreLetters ? "notes" : "off";
  ["notes", "fingers", "off"].forEach((v) => {
    const el = $(`anno-${v}`);
    if (!el) return;
    el.checked = mode === v;
    el.closest(".anno-opt")?.classList.toggle("on", mode === v);
  });
}

function applySessionToState(s) {
  state.piece = s.piece;
  state.rawMusicxml = s.rawMusicxml || s.piece?.musicxml || "";
  state.panel = s.panel || "explain";
  state.scoreLetters = !!s.scoreLetters;
  state.scoreFingers = !!s.scoreFingers;
  if (state.scoreLetters && state.scoreFingers) state.scoreFingers = false;
  state.showTips = s.showTips !== false;
  state.showLines = s.showLines !== false;
  state.playRate = s.playRate || 1;
  state.practiceBpm = s.practiceBpm || markedTempoBpm();
  state.markedBpm = s.markedBpm || state.practiceBpm;
  state._tempoSeedKey = s.piece?.id || s.piece?.title || "";
  state.keyboardVisible = !!s.keyboardVisible || (s.panel || "") === "piano";
  state.selected = s.selected;
  state.selectedBars = Array.isArray(s.selectedBars)
    ? s.selectedBars.map(Number).filter((n) => n > 0)
    : s.selected
      ? [Number(s.selected)]
      : [];
  state.scoreReady = !!s.scoreReady;
  state.scrubRatio = Number(s.scrubRatio) || 0;
  state.mode = "studio";
  syncTogglesFromState();
  setPlayRate(state.playRate);
  applyPieceMeter();
  syncTempoUi();
}

function fillPieceChrome(piece) {
  if (!piece) return;
  const o = piece.overview || {};
  const title = o.title || piece.title || "Untitled";
  const quiet = $("studio-piece-quiet");
  if (quiet) {
    quiet.textContent = shortPieceTitle(title);
    quiet.title = title;
  }
  if ($("btn-download")) $("btn-download").hidden = !piece.musicxml;
}

function buildExplainChapters(piece, opts) {
  // Never show the same sentence twice on one page (prose + highlight list).
  const chapters = buildExplainChaptersRaw(piece, opts);
  const seen = new Set();
  const key = (t) => String(t || "").trim().toLowerCase();
  for (const ch of chapters) {
    const body = key(ch.body);
    ch.extras = (ch.extras || []).filter((x) => {
      const k = key(x);
      if (!k || seen.has(k) || body.includes(k)) return false;
      seen.add(k);
      return true;
    });
    for (const part of body.split(/(?<=[.!?])\s+/)) if (part) seen.add(part);
  }
  return chapters;
}

function buildExplainChaptersRaw(piece, { canOpen }) {
  const o = piece.overview || {};
  const composer = o.composer || piece.composer || "";
  const era = o.era || o.epoch || composerEraFallback(composer) || "";
  const eraLabel =
    (o.eraInfo && o.eraInfo.label && o.eraInfo.label !== "Unknown era" && o.eraInfo.label) ||
    era ||
    "Style";
  const ci = o.composerInfo || {};
  return [
    {
      label: "Composer",
      title: `About ${ci.name || composer || "the composer"}`,
      body: ci.full || ci.bio || ci.hook || (composer ? `${composer}’s story isn’t in Lune’s notes yet.` : "Add a composer to this score’s details to see their story here."),
      extras: ci.highlights || [],
    },
    {
      label: "The work",
      title: "About this piece",
      body: o.history || o.summary || "Explore this work.",
      extras: o.highlights || [],
    },
    {
      label: "World",
      title: `Era · ${eraLabel}`,
      body: (o.eraInfo && o.eraInfo.story) || "",
      extras: (o.eraInfo && o.eraInfo.tips) || [],
    },
    {
      label: "Score",
      title: "In this score",
      body: canOpen
        ? "Open Score to hear it with piano sound — the playhead follows the bar, and you can show the keyboard under the page."
        : "A free MusicXML isn’t available for this title yet — upload your own score to practise here.",
      extras: (o.playingCards || []).map((c) => `${c.label}: ${c.value}`),
    },
  ];
}

function renderExplainPanel(piece) {
  const o = piece?.overview || {};
  const title = o.title || piece?.title || "Untitled";
  const composer = o.composer || piece?.composer || "";
  const era = o.era || o.epoch || composerEraFallback(composer) || "";
  const ci = o.composerInfo || {};
  const canOpen = piece?.kind === "score" && !!piece?.musicxml;

  if ($("explain-era")) $("explain-era").textContent = era || "Meet the piece";
  if ($("explain-title")) $("explain-title").textContent = title;
  if ($("explain-by")) $("explain-by").textContent = composer ? `by ${composer}` : "";
  if ($("explain-hook")) {
    $("explain-hook").textContent =
      ci.hook || o.summary || "A piece waiting to be heard carefully.";
  }

  applyComposerFace(
    $("explain-hero-img"),
    $("explain-fallback"),
    composer || title,
    ci.image || o.historyImage || ""
  );

  // Keep legacy discover nodes in sync if present (catalogue fallthrough).
  if ($("discover-era")) $("discover-era").textContent = era || "Discover";
  if ($("discover-title")) $("discover-title").textContent = title;
  if ($("discover-by")) $("discover-by").textContent = composer ? `by ${composer}` : "";
  if ($("discover-hook")) {
    $("discover-hook").textContent =
      ci.hook || o.summary || "A piece waiting to be heard carefully.";
  }
  if ($("composer-hero-img")) {
    applyComposerFace(
      $("composer-hero-img"),
      $("composer-fallback"),
      composer || title,
      ci.image || o.historyImage || ""
    );
  }

  const host = $("explain-chapters") || $("discover-chapters");
  if (host) {
    host.innerHTML = "";
    buildExplainChapters(piece, { canOpen }).forEach((ch, i) => {
      if (!ch.body && !(ch.extras || []).length) return;
      const article = document.createElement("article");
      article.className = "chapter";
      article.style.animationDelay = `${0.05 * i}s`;
      article.innerHTML = `
      <p class="chapter-label">${escapeHtml(ch.label)}</p>
      <h2 class="chapter-title">${escapeHtml(ch.title)}</h2>
      <div class="chapter-body">
        <p>${escapeHtml(ch.body)}</p>
        ${(ch.extras || []).length ? `<ul>${ch.extras.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}
      </div>`;
      host.appendChild(article);
    });
  }
  renderPieceCredit(piece);
  window.LunePractice?.decorateExplain(piece);
}

/** Fine-print source line for the open piece (overview + under the score). */
function renderPieceCredit(piece) {
  const c = piece?.credit || null;
  const o = piece?.overview || {};
  const link = (text, href) =>
    href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>` : escapeHtml(text);
  const bits = [];
  if (piece?.local) bits.push("Your own score — read in this browser only");
  else if (c?.source) {
    const prefix = piece?.remoteFetched ? "Fetched from " : "Score: ";
    const parts = [`${prefix}${link(c.source, c.sourceUrl)}`];
    if (c.license) parts.push(link(c.license, c.licenseUrl));
    if (c.sourceUrl) parts.push(link("View source", c.sourceUrl));
    bits.push(parts.join(" · "));
  }
  if (!piece?.local) {
    bits.push(
      `Notes adapted in part from ${link("Wikipedia", o.historyUrl || "https://en.wikipedia.org/")} (${link("CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/")})`
    );
  }
  bits.push(`Piano: ${link("Salamander Grand", "https://sfzinstruments.github.io/pianos/salamander")} (CC BY 3.0)`);
  const html = `${bits.join(" · ")} · <button type="button" class="link-btn" data-open-credits>All credits</button>`;
  for (const id of ["explain-credit", "score-credit"]) {
    const el = $(id);
    if (el) el.innerHTML = html;
  }
}

function openCredits(section) {
  const dlg = $("credits-dialog");
  if (!dlg) return;
  if (typeof dlg.showModal === "function") dlg.showModal();
  else dlg.setAttribute("open", "");
  if (section === "privacy") $("credits-privacy")?.scrollIntoView({ block: "start" });
  else dlg.scrollTop = 0;
}

/** ← overview (Explain) · → score. Logo is Home. */
function refreshStudioNav() {
  const back = $("btn-nav-back");
  const fwd = $("btn-nav-fwd");
  if (!back || !fwd) return;
  const panel = state.panel || "explain";
  const atOverview = panel === "explain";
  const atScore = panel === "score" || panel === "piano";
  back.disabled = atOverview;
  back.setAttribute("aria-label", "Overview");
  back.title = "Overview";
  back.classList.toggle("is-dim", atOverview);
  fwd.disabled = atScore;
  fwd.setAttribute("aria-label", "Score");
  fwd.title = "Score";
  fwd.classList.toggle("is-dim", atScore);
}

function studioNavBack() {
  const panel = state.panel || "explain";
  if (panel === "score" || panel === "piano") setStudioPanel("explain");
}

function studioNavForward() {
  if ((state.panel || "explain") === "explain") setStudioPanel("score");
}

function setStudioPanel(panel, { skipScore = false } = {}) {
  const next = ["score", "explain", "piano"].includes(panel) ? panel : "explain";
  state.panel = next;
  // Same piece, new tab → update the link in place (opening a piece pushes).
  if (state.piece && parseRoute()?.id === pieceRouteId(state.piece)) {
    setRoute(state.piece, next, { replace: true });
  }
  state.mode = next === "explain" ? "ask" : next === "score" ? "listen" : "piano";
  const s = activeSession();
  if (s) s.panel = next;
  // Explain has the piece title as its own h1; Score and Piano get one for screen readers
  const h1 = $("studio-h1");
  if (h1) {
    const t = state.piece?.overview?.title || state.piece?.title || "Score";
    h1.textContent = `${t}: ${next === "score" ? "score" : next === "piano" ? "piano" : "overview"}`;
    h1.hidden = next === "explain";
  }

  ["score", "explain", "piano"].forEach((name) => {
    const el = $(`panel-${name}`);
    if (el) {
      const wasHidden = el.hidden;
      el.hidden = name !== next;
      // Re-trigger the 200ms fade/rise each time a panel takes the stage.
      if (wasHidden && !el.hidden) {
        el.classList.remove("panel-in");
        void el.offsetWidth;
        el.classList.add("panel-in");
      }
    }
    const tab = $(`tab-${name}`);
    if (tab) {
      const on = name === next;
      tab.classList.toggle("on", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
    }
  });

  document.body.classList.toggle("is-panel-score", next === "score");
  document.body.classList.toggle("is-panel-explain", next === "explain");
  document.body.classList.toggle("is-panel-piano", next === "piano");
  refreshStudioNav();

  const dock = $("studio-dock");
  if (dock) dock.hidden = !(next === "score" || next === "piano");

  if ($("stage-label")) {
    $("stage-label").textContent =
      next === "score" ? "Score" : next === "explain" ? "Explain" : "Piano";
  }

  // Piano tab = keyboard focus mode (always show). Score = optional dock.
  if (next === "piano") {
    applyKeyboardVisibility(false);
    if (state.piece?.musicxml && !state.scoreReady) {
      ensureScoreReady()
        .then(() => {
          primeTimeline();
          mountPianoTutorial();
        })
        .catch(() => {});
    } else {
      primeTimeline();
      mountPianoTutorial();
    }
  } else if (next === "score") {
    applyKeyboardVisibility(!!state.keyboardVisible);
    window.LuneTutorial?.stop?.();
  } else {
    applyKeyboardVisibility(false);
    window.LuneTutorial?.stop?.();
  }

  if (next === "explain") {
    renderExplainPanel(state.piece);
  }

  if (next === "score") {
    requestAnimationFrame(() => {
      paintSelectionHilites();
      window.LunePractice?.afterScoreRender();
    });
  } else {
    window.LuneFollow?.stop?.({ quiet: true });
    // the bar panel belongs to the score; it must not cover the Overview or the Piano
    if (state.coachOpen) closeCoach();
    window.LuneAsk?.close?.();
  }

  syncTempoUi();

  if (next === "score" && !skipScore && state.piece?.musicxml) {
    // fire-and-forget; caller may await ensureScoreReady separately
  }
}

/**
 * Start the full analysis (letters + fingering) the moment a piece opens, so
 * the Score tab is ready by the time the pianist clicks it. One request per
 * piece; ensureScoreReady awaits the same promise.
 */
const analysisPrefetch = new Map();
function prefetchAnalysis(piece) {
  if (!piece || piece.kind !== "score" || !piece.musicxml) return null;
  if (!piece.needsAnalysis && piece.debriefs && Object.keys(piece.debriefs).length) return null;
  const key = `${piece.title || ""}|${piece.composer || ""}|${piece.filename || ""}`;
  if (analysisPrefetch.has(key)) return analysisPrefetch.get(key);
  const p = tryOpen({
    title: piece.title || "",
    composer: piece.composer || "",
    epoch: piece.epoch || piece.era || "",
    query: piece.openQuery || piece.query || ($("q").value || "").trim(),
    portrait: piece.overview?.composerInfo?.image || localComposerFaceUrl(piece.composer || "") || "",
    analyze: true,
  }).then((full) => {
    if (!full) analysisPrefetch.delete(key);
    return full;
  });
  analysisPrefetch.set(key, p);
  return p;
}

/** Arm the full-piece timeline (no audio needed) so the clock shows the real length. */
function primeTimeline() {
  try {
    if (LunePiano.isPlaying()) return;
    const notes = pieceNotes();
    if (!notes.length) return;
    seedTempoFromPiece();
    LunePiano.setRate?.(state.playRate || 1);
    state.timelineKind = "piece";
    LunePiano.arm(notes, { ...playbackHandlers(), from: 0, ...playbackTempoOpts() });
    renderScrubTicks();
    syncPlayButton();
    if (state.panel === "piano") mountPianoTutorial();
  } catch {
    /* the clock fills in on first play instead */
  }
}

function mountPianoTutorial() {
  const roll = $("piano-roll");
  if (!roll || !window.LuneTutorial) return;
  LuneTutorial.mount(roll);
  LuneTutorial.start();
  applyPieceMeter();
}

async function ensureScoreReady() {
  if (!state.piece?.musicxml) {
    $("file")?.click();
    return false;
  }
  const needs =
    state.piece.needsAnalysis ||
    !state.piece.debriefs ||
    !Object.keys(state.piece.debriefs).length;
  return withLoader(needs ? "Reading the score" : "Engraving the page", async () => {
    if (needs) {
      let full = await (prefetchAnalysis(state.piece) || tryOpen({
        title: state.piece.title || "",
        composer: state.piece.composer || "",
        epoch: state.piece.epoch || state.piece.era || "",
        query: state.piece.openQuery || state.piece.query || ($("q").value || "").trim(),
        portrait:
          state.piece.overview?.composerInfo?.image ||
          localComposerFaceUrl(state.piece.composer || "") ||
          "",
        analyze: true,
      }));
      // Pages: no Python analysis sidecar → read the MusicXML in the browser.
      const stillEmpty =
        !full ||
        full.kind !== "score" ||
        !full.debriefs ||
        !Object.keys(full.debriefs).length;
      if (stillEmpty && state.piece.musicxml && window.LuneLite?.analyze) {
        try {
          const local = LuneLite.analyze(state.piece.musicxml, {
            filename: state.piece.filename || state.piece.downloadName || "score.musicxml",
          });
          full = {
            ...state.piece,
            ...local,
            musicxml: state.piece.musicxml,
            opened: true,
            needsAnalysis: false,
            title: state.piece.title || local.title,
            composer: state.piece.composer || local.composer,
            overview: state.piece.overview?.title ? state.piece.overview : local.overview,
            id: state.piece.id || "",
            credit: state.piece.credit || null,
            openQuery: state.piece.openQuery || "",
            // Analysing in the browser must not turn a library piece into an
            // "uploaded" one: it keeps its catalogue identity, link and source.
            local: !!state.piece.local,
            source: state.piece.source || local.source,
            epoch: state.piece.epoch || local.epoch || "",
            era: state.piece.era || local.era || "",
            repKey: state.piece.repKey,
          };
        } catch (err) {
          console.warn("[lune] local analysis failed", err);
        }
      }
      if (full && full.kind === "score" && full.musicxml) {
        state.piece = full;
        state.rawMusicxml = full.musicxml || "";
        const s = activeSession();
        if (s) {
          s.piece = full;
          s.rawMusicxml = full.musicxml || "";
          s.shortTitle = shortPieceTitle(full.title || full.overview?.title);
        }
        seedTempoFromPiece({ force: true });
        renderPieceTabs();
        fillPieceChrome(full);
        renderExplainPanel(full);
      } else {
        toast("Could not prepare this score");
        return false;
      }
    }
    // Samples stream in the background; engraving never waits on them.
    // (Silent: the Play button reports sample problems if the user asks.)
    Promise.resolve()
      .then(() => LunePiano.ensure())
      .catch(() => {});
    await renderScore();
    state.scoreReady = true;
    const s = activeSession();
    if (s) s.scoreReady = true;
    updateScrub({ progress: 0, total: 0, bar: null });
    primeTimeline(); // after the reset: the clock shows the real length
    return true;
  });
}

/** Light MusicXML peek for meter/tempo — no full fingering pass. */
function peekScoreMeta(xml) {
  const src = String(xml || "");
  let timeSignature = "";
  let tempo = "";
  const beats = src.match(/<beats>\s*(\d+)\s*<\/beats>/i);
  const beatType = src.match(/<beat-type>\s*(\d+)\s*<\/beat-type>/i);
  if (beats && beatType) timeSignature = `${beats[1]}/${beatType[1]}`;
  const sound = src.match(/<sound[^>]*\btempo\s*=\s*["'](\d+(?:\.\d+)?)["']/i);
  if (sound) tempo = `${Math.round(Number(sound[1]))} bpm`;
  if (!tempo) {
    const perMin = src.match(/per-minute[^>]*>\s*(\d+(?:\.\d+)?)\s*</i);
    if (perMin) tempo = `${Math.round(Number(perMin[1]))} bpm`;
  }
  return { timeSignature, tempo };
}

/**
 * All written <sound tempo> markings with their measure numbers.
 * MusicXML tempo is always quarters-per-minute.
 */
function extractTempoMap(xml) {
  const src = String(xml || "");
  if (!src) return [];
  const map = [];
  const chunks = src.split(/(?=<measure\b)/i);
  let bar = 1;
  for (const chunk of chunks) {
    const nm = chunk.match(/<measure[^>]*\bnumber\s*=\s*["'](-?\d+)/i);
    if (nm) bar = Number(nm[1]);
    let found = false;
    for (const m of chunk.matchAll(/<sound\b[^>]*\btempo\s*=\s*["'](\d+(?:\.\d+)?)["'][^>]*>/gi)) {
      const bpm = Number(m[1]);
      if (Number.isFinite(bpm) && bpm > 0) {
        map.push({ bar, bpm });
        found = true;
      }
    }
    if (found) continue;
    // Some editions print a metronome mark without the playback tempo: read the
    // mark itself (♩ = 72, ♪ = 120, ♩. = 50) and convert it to crotchets a minute.
    const mm = chunk.match(/<metronome\b[^>]*>([\s\S]*?)<\/metronome>/i);
    if (mm) {
      const unit = (mm[1].match(/<beat-unit>\s*([a-z0-9]+)\s*<\/beat-unit>/i) || [])[1];
      const per = Number((mm[1].match(/<per-minute>\s*[^\d]*(\d+(?:\.\d+)?)/i) || [])[1]);
      const crotchets = { whole: 4, half: 2, quarter: 1, eighth: 0.5, "16th": 0.25 }[String(unit || "").toLowerCase()];
      if (crotchets && per > 0) {
        const dotted = /<beat-unit-dot\s*\/?>/i.test(mm[1]) ? 1.5 : 1;
        map.push({ bar, bpm: per * crotchets * dotted });
      }
    }
  }
  return map;
}

function pieceTempoMap() {
  try {
    return extractTempoMap(state.piece?.musicxml);
  } catch {
    return [];
  }
}

function playbackTempoOpts(extra = {}) {
  const marked = state.markedBpm || markedTempoBpm();
  const map = pieceTempoMap();
  return {
    tempoBpm: practiceTempoBpm(),
    baseBpm: marked,
    tempoMap: map.length ? map : [{ bar: pieceBarSpan()[0], bpm: marked }],
    ...extra,
  };
}

/** Pull time signature / tempo from MusicXML when the catalogue overview lacks them. */
function enrichPieceMeta(piece) {
  if (!piece?.musicxml) return piece;
  const hasTs = !!(piece.timeSignature || piece.overview?.timeSignature);
  const hasTempo = !!(piece.tempo || piece.overview?.tempo);
  if (hasTs && hasTempo) return piece;
  try {
    const local = peekScoreMeta(piece.musicxml);
    if (!hasTs && local.timeSignature) {
      piece.timeSignature = local.timeSignature;
      if (piece.overview) piece.overview.timeSignature = local.timeSignature;
    }
    if (!hasTempo && local.tempo) {
      piece.tempo = local.tempo;
      if (piece.overview) piece.overview.tempo = local.tempo;
    }
  } catch {
    /* keep catalogue meta */
  }
  return piece;
}

async function openPieceSession(piece, { panel = "explain" } = {}) {
  if (window.LuneOnboard && !LuneOnboard.requireUnlock()) return;
  if (window.LuneOnboard && !LuneOnboard.requirePieceAccess?.(piece)) return;
  // the same piece already has a tab (perhaps one restored from the last visit): use it
  const rid = pieceRouteId(piece);
  const twin = rid && state.sessions.find((x) => sessionRouteId(x) === rid);
  if (twin) {
    if (twin.lazy) {
      enrichPieceMeta(piece);
      delete twin.lazy;
      twin.piece = piece;
      twin.rawMusicxml = piece.musicxml || "";
      twin.shortTitle = shortPieceTitle(piece.overview?.title || piece.title);
      twin.panel = panel;
    }
    if (twin.id === state.activeSessionId) showView("studio");
    else await activateSession(twin.id);
    if (panel === "score") await switchToScorePanel();
    else setStudioPanel(panel);
    return;
  }
  snapshotActiveSession();
  stopAll();
  closeCoach();
  enrichPieceMeta(piece);
  const session = createSession(piece, panel);
  state.sessions.push(session);
  state.activeSessionId = session.id;
  applySessionToState(session);
  fillPieceChrome(piece);
  seedTempoFromPiece({ force: true });
  renderPieceTabs();
  // The piece has its own tab now; the search box is free for the next one.
  const q = $("q");
  if (q) q.value = "";
  closeSearchResults();
  showView("studio");
  renderPieceTabs(); // now that the studio is on screen, mark this piece's tab as current
  setStudioPanel(panel, { skipScore: true });
  renderExplainPanel(piece);
  syncOpenButtons(piece);
  setRoute(piece, panel);
  // Warm everything the Score tab needs while the pianist reads the overview.
  prefetchAnalysis(piece);
  try {
    // Audio may only start after a user gesture; searching counts as one.
    if (navigator.userActivation?.hasBeenActive !== false) LunePiano.ensure()?.catch?.(() => {});
  } catch {
    /* samples load lazily on first play */
  }
  if (panel === "score") {
    await ensureScoreReady();
  }
}

async function activateSession(id) {
  if (id === state.activeSessionId) {
    showView("studio");
    return;
  }
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return;
  if (s.lazy && !(await materializeSession(s))) return;
  snapshotActiveSession();
  stopAll();
  closeCoach();
  state.activeSessionId = id;
  applySessionToState(s);
  fillPieceChrome(s.piece);
  renderPieceTabs();
  syncOpenButtons(s.piece);
  showView("studio");
  setStudioPanel(s.panel || "explain", { skipScore: true });
  setRoute(s.piece, s.panel || "explain");
  if ((s.panel || "explain") === "score" && s.piece?.musicxml) {
    await renderScore();
    primeTimeline();
  } else if ((s.panel || "explain") === "explain") {
    renderExplainPanel(s.piece);
  } else if ((s.panel || "explain") === "piano") {
    applyKeyboardVisibility(true);
  }
}

async function closeSession(id) {
  const idx = state.sessions.findIndex((s) => s.id === id);
  if (idx < 0) return;
  const wasActive = state.activeSessionId === id;
  if (wasActive) {
    stopAll();
    closeCoach();
  }
  state.sessions.splice(idx, 1);
  if (!state.sessions.length) {
    state.activeSessionId = null;
    state.piece = null;
    state.rawMusicxml = "";
    state.osmd = null;
    state.scoreReady = false;
    renderPieceTabs();
    goHome({ keepTabs: true });
    return;
  }
  if (wasActive) {
    const next = state.sessions[Math.min(idx, state.sessions.length - 1)];
    state.activeSessionId = null;
    await activateSession(next.id);
  } else {
    renderPieceTabs();
  }
}

/* ---------- discover (legacy fallthrough) ---------- */

function showDiscoverPage(piece, { canOpen }) {
  // Nothing recognisable (no composer, no score): stay home and say so,
  // instead of a placeholder piece page whose buttons cannot work.
  if (!canOpen && !String(piece?.composer || "").trim()) {
    const typed = ($("q").value || piece?.title || "").trim();
    toast(
      `No match for “${typed}”. Try a composer or title — Chopin Mazurka, Für Elise, Clair de Lune — or upload your own score.`
    );
    // stay wherever the pianist is (home or their open piece)
    $("q")?.focus();
    $("q")?.select?.();
    return;
  }
  // Prefer studio Explain so piece tabs + faces stay consistent.
  openPieceSession(piece, { panel: "explain" });
  if (!canOpen) toast(piece?.message || "No free score for this one yet — upload your own copy to practise it.");
}

/** Primary buttons say what they will actually do for this piece. */
function syncOpenButtons(piece) {
  const label = piece?.musicxml ? "Open score" : "Upload your copy";
  for (const id of ["btn-open-piece", "btn-open-piece-bottom", "btn-explain-score"]) {
    const el = $(id);
    if (el) el.textContent = label;
  }
}

async function openPieceFromDiscover() {
  await switchToScorePanel();
}

async function switchToScorePanel() {
  if (!state.piece?.musicxml) {
    $("file")?.click();
    return;
  }
  setStudioPanel("score", { skipScore: true });
  const ok = await ensureScoreReady();
  if (!ok) setStudioPanel("explain");
}

/* ---------- listening / scrub ---------- */

function pieceBarSpan() {
  const nums = Object.keys(state.piece?.debriefs || {})
    .map(Number)
    .sort((a, b) => a - b);
  if (!nums.length) return [1, 1];
  return [nums[0], nums[nums.length - 1]];
}

function selectedBarsSorted() {
  return [...new Set((state.selectedBars || []).map(Number).filter((n) => n > 0))].sort(
    (a, b) => a - b
  );
}

function selectionSpan() {
  const bars = selectedBarsSorted();
  if (!bars.length) return null;
  return [bars[0], bars[bars.length - 1]];
}

function selectionTitle(bars = selectedBarsSorted()) {
  if (!bars.length) return "Bar";
  if (bars.length === 1) return `Bar ${bars[0]}`;
  const contiguous = bars[bars.length - 1] - bars[0] + 1 === bars.length;
  if (contiguous) return `Bars ${bars[0]}–${bars[bars.length - 1]}`;
  return `Bars ${bars.join(", ")}`;
}

/** Transport always covers the whole piece; snippets seek within it. */
function listenBarSpan() {
  return pieceBarSpan();
}

/** Quarters in a bar from the time signature (9/8 → 4.5). */
function signatureBarQuarters() {
  const ts = state.piece?.timeSignature || state.piece?.overview?.timeSignature || "4/4";
  const [b, bt] = String(ts).split("/").map(Number);
  if (b > 0 && bt > 0) return (b * 4) / bt;
  return 4;
}

/** True span of one bar in quarter notes — never "last onset + 1". */
function barLengthQuarters(barNum, pack) {
  const d = debriefFor(barNum) || state.piece?.debriefs?.[String(barNum)];
  if (Number(d?.ql) > 0) return Number(d.ql);
  const fromNotes = (pack || []).length
    ? Math.max(...pack.map((n) => (Number(n.offset) || 0) + (Number(n.duration) || 0)))
    : 0;
  const fromTs = signatureBarQuarters();
  // Pickup / incomplete bars land shorter than the signature.
  if (fromNotes > 0 && fromNotes < fromTs - 0.2) return fromNotes;
  return Math.max(fromTs, fromNotes, 1);
}

function normalizeNoteHand(h, fallback = null) {
  const s = String(h || "").toLowerCase();
  if (s === "lh" || s === "l" || s === "left") return "lh";
  if (s === "rh" || s === "r" || s === "right") return "rh";
  return fallback;
}

/**
 * Ties and hands, read from the MusicXML: which notes only continue a held
 * note (never struck), how much longer the note that starts the tie really
 * sounds, and which staff each note is written on (lower staff = left hand).
 * The analysis lists every written note, so without this a tied melody note
 * was struck again at each tie, or cut short.
 * Keys are "bar:midi:offset" with the offset in thousandths of a crotchet.
 */
const _tieCache = new WeakMap();
function tieIndex(piece) {
  const empty = { stops: new Set(), extra: new Map(), staff: new Map(), pedal: [], dyn: [] };
  if (!piece?.musicxml) return empty;
  if (_tieCache.has(piece)) return _tieCache.get(piece);
  // pedal: [{bar, q, down}] as marked; dyn: [{bar, q, v}] loudness marks (90 = forte)
  const out = { stops: new Set(), extra: new Map(), staff: new Map(), pedal: [], dyn: [] };
  _tieCache.set(piece, out);
  const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const text = (el, tag) => {
    for (const c of el.children) if (c.nodeName === tag) return c.textContent.trim();
    return "";
  };
  try {
    const doc = new DOMParser().parseFromString(piece.musicxml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) return out;
    const parts = [...doc.getElementsByTagName("part")];
    for (const part of parts) {
      // lower staff (or the second part) is the left hand
      const partStaff = parts.length > 1 ? (parts.indexOf(part) === 0 ? 1 : 2) : 0;
      let div = 1;
      const open = new Map(); // midi → key of the note that started the tie
      let index = 0;
      for (const m of part.children) {
        if (m.nodeName !== "measure") continue;
        index += 1;
        const num = parseInt(m.getAttribute("number"), 10);
        const bar = Number.isFinite(num) ? num : index;
        let pos = 0;
        let last = 0;
        for (const el of m.children) {
          const tag = el.nodeName;
          if (tag === "attributes") {
            const d = parseInt(el.getElementsByTagName("divisions")[0]?.textContent, 10);
            if (d > 0) div = d;
          } else if (tag === "backup") pos -= parseInt(text(el, "duration"), 10) || 0;
          else if (tag === "forward") pos += parseInt(text(el, "duration"), 10) || 0;
          else if (tag === "direction" || tag === "sound") {
            const q = pos / div;
            for (const pd of el.getElementsByTagName("pedal")) {
              const type = pd.getAttribute("type");
              if (type === "start" || type === "change") out.pedal.push({ bar, q, down: true });
              else if (type === "stop") out.pedal.push({ bar, q, down: false });
            }
            const snd = tag === "sound" ? el : el.getElementsByTagName("sound")[0];
            const v = Number(snd?.getAttribute("dynamics"));
            if (v > 0) out.dyn.push({ bar, q, v });
          } else if (tag === "note") {
            const chord = [...el.children].some((c) => c.nodeName === "chord");
            const grace = [...el.children].some((c) => c.nodeName === "grace");
            const dur = parseInt(text(el, "duration"), 10) || 0;
            const onset = chord ? last : pos;
            if (!chord) {
              last = pos;
              if (!grace) pos += dur;
            }
            const pitch = [...el.children].find((c) => c.nodeName === "pitch");
            if (!pitch || grace) continue;
            const midi =
              (parseInt(text(pitch, "octave"), 10) + 1) * 12 +
              (STEP[text(pitch, "step").toUpperCase()] ?? 0) +
              Math.round(Number(text(pitch, "alter")) || 0);
            const ties = [...el.children].filter((c) => c.nodeName === "tie").map((t) => t.getAttribute("type"));
            const key = `${bar}:${midi}:${Math.round((onset / div) * 1000)}`;
            if (!out.staff.has(key)) out.staff.set(key, partStaff || parseInt(text(el, "staff"), 10) || 1);
            if (ties.includes("stop") && open.has(midi)) {
              const root = open.get(midi);
              out.stops.add(key);
              out.extra.set(root, (out.extra.get(root) || 0) + dur / div);
              if (!ties.includes("start")) open.delete(midi);
            } else if (ties.includes("start")) {
              open.set(midi, key);
            }
          }
        }
      }
    }
  } catch {
    /* play the notes as written */
  }
  return out;
}

function collectNotes(fromBar, toBar) {
  const ties = tieIndex(state.piece);
  const barStart = new Map();
  const notes = [];
  const debriefs = state.piece?.debriefs || {};
  let barCursor = 0;
  for (let b = fromBar; b <= toBar; b++) {
    const d = debriefFor(b) || debriefs[String(b)];
    const pack = d?.playback?.length
      ? d.playback.map((n) => ({ ...n, hand: normalizeNoteHand(n.hand) }))
      : [
          ...(d?.rh || []).map((n) => ({ ...n, hand: normalizeNoteHand(n.hand, "rh") })),
          ...(d?.lh || []).map((n) => ({ ...n, hand: normalizeNoteHand(n.hand, "lh") })),
        ];
    const seen = new Set();
    for (const n of pack) {
      if (!n.midi) continue;
      // Same pitch at the same onset from mirrored voices → one attack.
      const key = `${Math.round((Number(n.offset) || 0) * 1000)}:${n.midi}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const tieKey = `${b}:${n.midi}:${Math.round((Number(n.offset) || 0) * 1000)}`;
      if (ties.stops.has(tieKey)) continue; // held over from the note before
      const held = ties.extra.get(tieKey) || 0;
      const staff = ties.staff.get(tieKey);
      notes.push({
        ...n,
        hand: staff ? (staff >= 2 ? "lh" : "rh") : n.hand,
        duration: (Number(n.duration) || 0) + held,
        absOffset: barCursor + (Number(n.offset) || 0),
        bar: b,
      });
    }
    barStart.set(b, barCursor);
    barCursor += barLengthQuarters(b, pack);
  }
  shapePerformance(notes, ties, barStart, barCursor);
  return notes;
}

/**
 * Turn written notes into something closer to a performance: the sustain
 * pedal (as marked, or changed with the harmony in music that expects it),
 * the score's own dynamics, and the top line sung over the accompaniment.
 * Only the sound changes; what is drawn stays the written length.
 */
function shapePerformance(notes, index, barStart, endQ) {
  if (!notes.length) return;
  const abs = (m) => (barStart.has(m.bar) ? barStart.get(m.bar) + m.q : null);

  // --- loudness: step to each marking, easing in over the bar before it
  const marks = index.dyn.map((d) => ({ q: abs(d), v: d.v })).filter((d) => d.q != null).sort((a, b) => a.q - b.q);
  const level = (q) => {
    if (!marks.length) return 1;
    let i = 0;
    while (i + 1 < marks.length && marks[i + 1].q <= q) i += 1;
    let v = marks[i].v;
    const next = marks[i + 1];
    if (next && next.q - q < 4) v += (next.v - v) * (1 - (next.q - q) / 4);
    return Math.max(0.74, Math.min(1.4, Math.pow(v / 60, 0.6)));
  };

  // --- pedal changes (crotchets from the start of this stretch)
  let changes = index.pedal.map((p) => ({ q: abs(p), down: p.down })).filter((p) => p.q != null).sort((a, b) => a.q - b.q);
  if (!changes.length) {
    const era = String(state.piece?.epoch || state.piece?.era || state.piece?.overview?.era || "").toLowerCase();
    // Romantic and later: pedal through each harmony. Classical: the same, lightly (it lifts
    // within a beat of the bass moving). Baroque keyboard music is left unpedalled.
    if (/classical|romantic|impression|modern|20th|contemporary/.test(era) && !/baroque/.test(era)) {
      // No marks in this edition: change the pedal at each bar and whenever the bass moves on.
      let lastBass = null;
      let lastQ = -9;
      const seenBar = new Set();
      for (const n of notes) {
        const q = n.absOffset;
        const barLine = !seenBar.has(n.bar);
        seenBar.add(n.bar);
        const isBass = n.hand === "lh" && (lastBass == null || n.midi <= lastBass + 2);
        if (barLine || (isBass && n.midi !== lastBass && q - lastQ >= 1)) {
          changes.push({ q: barLine ? barStart.get(n.bar) : q, down: true });
          lastQ = q;
        }
        if (isBass) lastBass = n.midi;
      }
      changes.sort((a, b) => a.q - b.q);
    }
  }

  let ci = 0;
  let k = 0;
  while (k < notes.length) {
    // notes struck together
    let j = k;
    while (j < notes.length && Math.abs(notes[j].absOffset - notes[k].absOffset) < 0.02) j += 1;
    const group = notes.slice(k, j);
    const q = notes[k].absOffset;
    while (ci + 1 < changes.length && changes[ci + 1].q <= q + 0.02) ci += 1;
    const cur = changes[ci];
    const pedalDown = cur && cur.q <= q + 0.02 && cur.down;
    const release = pedalDown ? (changes[ci + 1]?.q ?? endQ) : null;
    const top = Math.max(...group.map((n) => n.midi));
    const lvl = level(q);
    for (const n of group) {
      // held by the pedal until it changes (never more than two bars' worth)
      if (release != null) n.sustainTo = Math.min(release, q + 9);
      const melody = n.midi === top && n.hand !== "lh";
      n.dyn = lvl * (melody ? 1.12 : n.hand === "lh" ? 0.88 : 0.92);
    }
    k = j;
  }
}

function pieceNotes() {
  const [from, to] = pieceBarSpan();
  return collectNotes(from, to);
}

function playbackHandlers() {
  return {
    onTick: updateScrub,
    onKeys: onPianoKeys,
    onEnd: () => {
      syncPlayButton();
      clearKeyboard();
    },
  };
}

/** Original tempo from the score marking (unclamped parse, sensible default). */
/*
 * A tempo word with no metronome mark (Andante, Allegro, Poco moto): the usual
 * beats a minute for that word, counted in the beat the metre is felt in,
 * then turned into crotchets a minute for playback.
 */
const TEMPO_WORDS = [
  [/prestissimo/i, 200], [/presto/i, 176], [/vivacissimo/i, 168], [/vivace|vivo/i, 156],
  [/allegro (ma )?non troppo|allegro moderato/i, 118], [/allegro/i, 132], [/allegretto/i, 108],
  [/moderato/i, 104], [/con moto|poco moto|mosso/i, 128], [/andantino/i, 92], [/andante/i, 80],
  [/adagietto/i, 72], [/adagio/i, 66], [/larghetto/i, 60], [/lento/i, 56], [/largo/i, 50], [/grave/i, 42],
];
function tempoFromWords(text, timeSignature = "4/4") {
  const t = String(text || "");
  const hit = TEMPO_WORDS.find(([re]) => re.test(t));
  if (!hit) return NaN;
  const [num, den] = String(timeSignature).split("/").map(Number);
  // the felt beat: a dotted crotchet in 6/8, 9/8, 12/8; a quaver in 3/8; a minim in 2/2; else the written beat
  let crotchetsPerBeat = 4 / (den || 4);
  if (den === 8 && num % 3 === 0 && num > 3) crotchetsPerBeat = 1.5;
  if (den === 2) crotchetsPerBeat = 1.5; // cut time: the minim beat runs slower than the word's crotchet speed
  return Math.round(hit[1] * crotchetsPerBeat);
}
function firstTempoWords(xml) {
  const head = String(xml || "").split(/(?=<measure\b)/i).slice(0, 4).join("");
  return [...head.matchAll(/<words\b[^>]*>([^<]+)<\/words>/gi)].map((m) => m[1]).join(" ");
}

function markedTempoBpm() {
  const raw =
    state.piece?.tempo ||
    state.piece?.overview?.tempo ||
    state.piece?.meta?.tempo ||
    "";
  const m = String(raw).match(/(\d{2,3}(?:\.\d+)?)\s*(?:bpm)?/i);
  let marked = m ? Number(m[1]) : NaN;
  if (!Number.isFinite(marked)) {
    const map = pieceTempoMap();
    if (map.length) marked = map[0].bpm;
  }
  if (!Number.isFinite(marked)) marked = tempoFromWords(`${raw} ${firstTempoWords(state.piece?.musicxml)}`, pieceTimeSignature());
  if (!Number.isFinite(marked) || marked <= 0) marked = 72;
  return Math.max(40, Math.min(208, marked));
}

/** Practice tempo — user slider, seeded from the marking (original = 1.0×). */
function practiceTempoBpm() {
  if (Number.isFinite(state.practiceBpm) && state.practiceBpm > 0) {
    return Math.max(40, Math.min(208, state.practiceBpm));
  }
  return markedTempoBpm();
}

function pieceTimeSignature() {
  return state.piece?.timeSignature || state.piece?.overview?.timeSignature || "4/4";
}

function applyPieceMeter() {
  const ts = pieceTimeSignature();
  const [b, bt] = String(ts).split("/").map(Number);
  try {
    LunePiano.setMeter?.(b || 4, bt || 4);
  } catch {
    /* ignore */
  }
  const meterEl = $("bpm-meter");
  if (meterEl) meterEl.textContent = ts;
  const meta = $("piano-tut-meta");
  if (meta) {
    const title = state.piece?.overview?.title || state.piece?.title || "This piece";
    meta.textContent = `${title} · ${ts} · original tempo marked — drag to practice`;
  }
}

function syncTempoUi() {
  const marked = state.markedBpm || markedTempoBpm();
  const bpm = practiceTempoBpm();
  const slider = $("bpm-slider");
  const readout = $("bpm-readout");
  const mark = $("bpm-orig-mark");
  if (slider) {
    const needMax = Math.max(120, Math.ceil(marked / 10) * 10, Math.ceil(bpm / 10) * 10);
    if (Number(slider.max) < needMax) slider.max = String(Math.min(208, needMax));
    if (document.activeElement !== slider) slider.value = String(bpm);
  }
  if (readout) readout.textContent = String(Math.round(bpm));
  if (mark && slider) {
    const min = Number(slider.min) || 40;
    const max = Number(slider.max) || 120;
    const pct = ((Math.max(min, Math.min(max, marked)) - min) / (max - min)) * 100;
    mark.style.left = `${pct}%`;
    mark.title = `Original · ${Math.round(marked)} bpm`;
  }
  const meterEl = $("bpm-meter");
  if (meterEl) meterEl.textContent = pieceTimeSignature();
}

function setPracticeBpm(bpm, { rebuild = true } = {}) {
  const next = Math.max(40, Math.min(208, Number(bpm) || 72));
  state.practiceBpm = next;
  try {
    if (rebuild && LunePiano.hasTimeline?.()) {
      LunePiano.setTempoBpm(next, { rebuild: true });
    } else {
      LunePiano.setTempoBpm?.(next, { rebuild: false });
    }
  } catch {
    /* ignore */
  }
  syncTempoUi();
  if (rebuild) {
    renderScrubTicks();
    syncPlayButton();
  }
}

function seedTempoFromPiece({ force = false } = {}) {
  const pieceKey = state.piece?.id || state.piece?.title || "";
  if (!force && state._tempoSeedKey === pieceKey && pieceKey) {
    applyPieceMeter();
    syncTempoUi();
    return;
  }
  state._tempoSeedKey = pieceKey;
  const marked = markedTempoBpm();
  state.markedBpm = marked;
  // Default = written tempo (1.0×). Slider still lets you practice slower/faster.
  state.practiceBpm = marked;
  applyPieceMeter();
  try {
    LunePiano.setTempoBpm?.(state.practiceBpm, { rebuild: false });
  } catch {
    /* ignore */
  }
  syncTempoUi();
}

async function toggleMetronome() {
  const btn = $("btn-metro");
  const want = !(LunePiano.isMetronomeOn?.() || false);
  applyPieceMeter();
  try {
    await LunePiano.setMetronome?.(want);
  } catch (err) {
    toast(err.message || "Metronome needs a quick tap first");
    return;
  }
  btn?.setAttribute("aria-pressed", want ? "true" : "false");
  btn?.classList.toggle("on", want);
}

/** Ensure the full-piece timeline is armed so scrub / Play-from-here works. */
async function ensurePieceTimeline(seekRatio = null) {
  const notes = pieceNotes();
  if (!notes.length) return false;
  const ratio =
    seekRatio != null
      ? Math.max(0, Math.min(1, Number(seekRatio) || 0))
      : Math.max(0, Math.min(1, Number(state.scrubRatio) || 0));
  try {
    await ensureSamplesWithLoader();
  } catch {
    toast("Could not load piano samples — check internet once");
    return false;
  }
  try {
    LunePiano.setRate(state.playRate || 1);
  } catch {
    /* ignore */
  }
  if (!LunePiano.hasTimeline() || state.timelineKind !== "piece") {
    state.timelineKind = "piece";
    LunePiano.arm(notes, { ...playbackHandlers(), from: ratio, ...playbackTempoOpts() });
  } else if (seekRatio != null) {
    LunePiano.seek(ratio, { resumeIfWasPlaying: false });
  }
  state.scrubRatio = LunePiano.duration()
    ? (LunePiano.progress() || 0) / LunePiano.duration()
    : ratio;
  renderScrubTicks();
  syncPlayButton();
  return true;
}

function updateScrub({ progress, total, bar }) {
  // Bar/line snippets auto-pause at their end; playhead stays put.
  if (
    state.snippetEnd != null &&
    LunePiano.isPlaying() &&
    progress >= state.snippetEnd - 0.03
  ) {
    state.snippetEnd = null;
    LunePiano.pause();
    clearKeyboard();
    syncPlayButton();
    return;
  }
  const scrub = $("scrub");
  if (scrub) {
    if (!state.scrubbing && total > 0) {
      const v = String(Math.round((progress / total) * 1000));
      if (scrub.value !== v) scrub.value = v;
      state.scrubRatio = progress / total;
    } else if (total <= 0) {
      scrub.value = "0";
      state.scrubRatio = 0;
    }
  }
  const timeEl = $("scrub-time");
  const barEl = $("scrub-bar");
  const timeText = `${fmtTime(progress)} / ${fmtTime(total)}`;
  const barText = bar ? `Bar ${bar}` : "Bar —";
  // This runs every frame while playing: touch the page only when the text changes.
  if (timeEl && timeEl.textContent !== timeText) timeEl.textContent = timeText;
  if (barEl && barEl.textContent !== barText) barEl.textContent = barText;
  placePlayhead(bar, progress, total);
  syncPlayButton();
}

function syncPlayButton() {
  const label = LunePiano.isPlaying()
    ? "Pause"
    : LunePiano.hasTimeline() && LunePiano.progress() > 0.05
      ? "Resume"
      : "Play";
  const aria =
    label === "Pause" ? "Pause" : label === "Resume" ? "Resume" : "Play";
  const playBtn = $("btn-play-range");
  if (playBtn && playBtn.textContent !== label) {
    playBtn.textContent = label;
    playBtn.setAttribute("aria-label", aria);
  }
  // Stop stays visible in the dock (MuseScore-like); disabled when idle at start
  const stop = $("btn-stop");
  if (stop) {
    const canStop =
      LunePiano.isPlaying() ||
      (LunePiano.hasTimeline() && LunePiano.progress() > 0.02);
    if (stop.disabled === canStop) {
      stop.disabled = !canStop;
      stop.setAttribute("aria-disabled", canStop ? "false" : "true");
    }
  }
}

function renderScrubTicks() {
  const host = $("scrub-ticks");
  if (!host) return;
  host.innerHTML = "";
  const marks = LunePiano.barMarkers?.() || [];
  if (marks.length < 2) return;
  // Cap labels so dense pieces stay readable
  const step = marks.length > 24 ? Math.ceil(marks.length / 16) : 1;
  marks.forEach((m, i) => {
    if (i % step !== 0 && i !== marks.length - 1) return;
    const tick = document.createElement("span");
    tick.className = "scrub-tick";
    tick.style.left = `${m.ratio * 100}%`;
    tick.title = `Bar ${m.bar}`;
    tick.dataset.bar = String(m.bar);
    host.appendChild(tick);
  });
}

/** Fraction of the current bar elapsed (0–1) from the piano timeline. */
function barLocalRatio(bar, progress) {
  const marks = LunePiano.barMarkers?.() || [];
  if (!marks.length || bar == null) return 0;
  const idx = marks.findIndex((m) => Number(m.bar) === Number(bar));
  if (idx < 0) return 0;
  const start = marks[idx].t;
  const end = idx + 1 < marks.length ? marks[idx + 1].t : LunePiano.duration() || start + 1;
  const span = Math.max(0.001, end - start);
  return Math.max(0, Math.min(1, (progress - start) / span));
}

/**
 * Everything the playhead needs for one bar: where the bar sits and which x
 * belongs to which moment. Measured once per bar (and again if the score is
 * re-engraved or the tempo changes) — never on every animation frame, which
 * forced a layout 60 times a second and made playback stutter.
 */
let _phGeo = null;
function playheadGeometry(bar, host) {
  const svg = host.querySelector("svg");
  const total = LunePiano.duration() || 0;
  const g = _phGeo;
  if (g && g.bar === bar && g.osmd === state.osmd && g.svg === svg && g.w === host.clientWidth && g.total === total) {
    return g;
  }
  const bounds = LuneAnnotate.measureBoundsInHost?.(state.osmd, host, bar);
  if (!bounds) return null;
  const anchors = LuneAnnotate.playheadAnchorsInHost?.(state.osmd, host, bar) || [];
  const marks = LunePiano.barMarkers?.() || [];
  const idx = marks.findIndex((m) => Number(m.bar) === Number(bar));
  const startT = idx >= 0 ? marks[idx].t : 0;
  const endT = idx >= 0 && idx + 1 < marks.length ? marks[idx + 1].t : total || startT + 1;
  const span = Math.max(0.001, endT - startT);
  const barQl = Math.max(0.25, barLengthQuarters(bar, null) || signatureBarQuarters() || 4);
  const pad = Math.min(10, Math.max(2, bounds.width * 0.02));

  // Each engraved onset gets the time its note sounds (by offset in the bar).
  const byQ = new Map();
  try {
    for (const e of LunePiano.getEvents?.() || []) {
      if (Number(e.bar) !== Number(bar) || !Number.isFinite(e.barOff)) continue;
      const k = Math.round(e.barOff * 1000);
      if (!byQ.has(k)) byQ.set(k, e.t);
    }
  } catch {
    /* constant-tempo fallback below */
  }
  const timed = anchors
    .map((a) => ({ t: byQ.get(Math.round(a.q * 1000)) ?? startT + (a.q / barQl) * span, x: a.x }))
    .sort((a, b) => a.t - b.t);

  _phGeo = {
    bar,
    osmd: state.osmd,
    svg,
    w: host.clientWidth,
    total,
    bounds,
    timed,
    startT,
    endT,
    xMin: bounds.left + pad,
    xMax: bounds.left + bounds.width - pad,
  };
  return _phGeo;
}

/** Playhead x at this moment: glides between the bar's engraved onsets. */
function playheadX(g, progress) {
  const { timed, startT, endT, xMin, xMax } = g;
  if (!timed.length) {
    const u = Math.max(0, Math.min(1, (progress - startT) / Math.max(0.001, endT - startT)));
    return xMin + u * Math.max(0, xMax - xMin);
  }
  const first = timed[0];
  const last = timed[timed.length - 1];
  // Lead-in before the first onset (rests / pickup silence inside the bar)
  if (progress <= first.t) {
    const u = Math.max(0, Math.min(1, (progress - startT) / Math.max(0.001, first.t - startT)));
    return xMin + u * Math.max(0, first.x - xMin);
  }
  if (progress >= last.t) {
    const u = Math.max(0, Math.min(1, (progress - last.t) / Math.max(0.001, endT - last.t)));
    return last.x + u * Math.max(0, xMax - last.x);
  }
  for (let i = 0; i < timed.length - 1; i++) {
    const a = timed[i];
    const b = timed[i + 1];
    if (progress >= a.t && progress <= b.t) return a.x + ((progress - a.t) / Math.max(0.001, b.t - a.t)) * (b.x - a.x);
  }
  return first.x;
}

let _playheadScrollAt = 0;
let _playheadLastBar = null;

function placePlayhead(bar, progress = 0, total = 0) {
  const line = $("playhead-line");
  const hilite = $("measure-hilite");
  if (!line) return;

  const hide = () => {
    line.hidden = true;
    line.classList.remove("on", "playing");
    line.style.transform = "";
    line._geo = null;
    line.style.height = "";
    line.style.top = "";
    if (hilite) {
      hilite.hidden = true;
      hilite.style.cssText = "";
    }
    _playheadLastBar = null;
  };

  // Before the first play the clock is armed at 0:00 — no marker on bar 1 yet.
  if ((!bar && !(total > 0)) || (!LunePiano.isPlaying() && !(progress > 0.05) && !state.scrubbing)) {
    hide();
    return;
  }

  // Prefer OSMD measure geometry when the score is on stage
  const host = $("osmd");
  const scroll = $("score-scroll");
  const geo =
    state.osmd && host && !host.hidden && scroll && state.panel === "score" ? playheadGeometry(bar, host) : null;
  const bounds = geo?.bounds || null;

  if (bounds) {
    const x = playheadX(geo, progress);
    const playing = !!LunePiano.isPlaying?.();
    const barChangedNow = _playheadLastBar !== Number(bar) || line.hidden;
    line.hidden = false;
    line.classList.add("on");
    line.classList.toggle("playing", playing && !state.scrubbing);
    // Only the x moves within a bar; the box is set once per bar.
    if (barChangedNow || line._geo !== geo) {
      line._geo = geo;
      line.style.top = `${Math.max(0, bounds.top - 6)}px`;
      line.style.height = `${bounds.height + 12}px`;
      line.style.left = "0";
      if (hilite) {
        hilite.hidden = false;
        hilite.style.left = `${bounds.left}px`;
        hilite.style.top = `${bounds.top}px`;
        hilite.style.width = `${bounds.width}px`;
        hilite.style.height = `${bounds.height}px`;
      }
    }
    line.style.transform = `translate3d(${x}px,0,0)`;

    // Follow the sounding measure without smooth-scroll rocking.
    // During playback: instant scroll, only on bar change, and only when
    // the measure is substantially out of view. Prefer vertical; skip tiny
    // horizontal nudges so we don’t fight the reader.
    const barChanged = _playheadLastBar !== Number(bar);
    _playheadLastBar = Number(bar);
    if (barChanged || (!playing && state.scrubbing)) {
      const pad = 72;
      const viewTop = scroll.scrollTop;
      const viewBottom = viewTop + scroll.clientHeight;
      const mTop = bounds.top;
      const mBottom = bounds.top + bounds.height;
      const substantiallyOut =
        mTop < viewTop + pad * 0.35 || mBottom > viewBottom - pad * 0.35;
      let nextTop = scroll.scrollTop;
      let nextLeft = scroll.scrollLeft;
      let moved = false;
      if (substantiallyOut) {
        if (mTop < viewTop + pad) {
          nextTop = Math.max(0, mTop - pad);
          moved = true;
        } else if (mBottom > viewBottom - pad) {
          nextTop = Math.max(0, mBottom - scroll.clientHeight + pad);
          moved = true;
        }
      }
      // Horizontal: only when the playhead is well off-screen (not every tick).
      const viewLeft = scroll.scrollLeft;
      const viewRight = viewLeft + scroll.clientWidth;
      const hPad = Math.max(96, scroll.clientWidth * 0.18);
      if (x < viewLeft + 24 || x > viewRight - 24) {
        if (x < viewLeft + hPad) {
          nextLeft = Math.max(0, x - hPad);
          moved = true;
        } else if (x > viewRight - hPad) {
          nextLeft = Math.max(0, x - scroll.clientWidth + hPad);
          moved = true;
        }
      }
      if (moved) {
        _playheadScrollAt = performance.now();
        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
        scroll.scrollTo({
          top: nextTop,
          left: nextLeft,
          // Instant during playback — smooth + frequent updates rocks the page.
          behavior: playing || reduced ? "auto" : "smooth",
        });
      }
    }
    return;
  }

  // Fallback when score isn't rendered (e.g. Piano focus tab)
  if (hilite) hilite.hidden = true;
  const svg = host?.querySelector("svg");
  if (!svg || state.panel !== "score") {
    line.hidden = true;
    return;
  }
  line.hidden = false;
  line.classList.add("on");
  line.classList.toggle("playing", !!LunePiano.isPlaying?.() && !state.scrubbing);
  let ratio = total > 0 ? Math.max(0, Math.min(1, progress / total)) : 0;
  if (!(total > 0)) {
    const nums = Object.keys(state.piece?.debriefs || {})
      .map(Number)
      .sort((a, b) => a - b);
    const idx = Math.max(0, nums.indexOf(Number(bar)));
    ratio = nums.length > 1 ? idx / (nums.length - 1) : 0;
  }
  const x = 24 + ratio * Math.max(0, (svg.clientWidth || scroll?.clientWidth || 0) - 48);
  line.style.top = "0";
  line.style.height = "100%";
  line.style.left = "0";
  line.style.transform = `translate3d(${x}px,0,0)`;
}

function stopAll() {
  try {
    LunePiano.stop();
  } catch {
    /* piano not ready */
  }
  clearKeyboard();
  state.scrubRatio = 0;
  state.resumeAfterScrub = false;
  state.snippetEnd = null;
  // MuseScore-like: Stop returns to the start of the piece, playhead visible at bar 1
  const total = (() => {
    try {
      return LunePiano.duration() || 0;
    } catch {
      return 0;
    }
  })();
  const bar = (() => {
    try {
      return LunePiano.currentBar?.() || pieceBarSpan()[0];
    } catch {
      return pieceBarSpan()[0];
    }
  })();
  if (total > 0) {
    updateScrub({ progress: 0, total, bar });
    renderScrubTicks();
  } else {
    const line = $("playhead-line");
    if (line) {
      line.hidden = true;
      line.classList.remove("on", "playing");
    }
    const hilite = $("measure-hilite");
    if (hilite) hilite.hidden = true;
    updateScrub({ progress: 0, total: 0, bar: null });
  }
  syncPlayButton();
}

/** Drag the score playhead to seek; transport scrubber remains the primary control. */
function bindPlayheadScrub() {
  const scroll = $("score-scroll");
  const line = $("playhead-line");
  if (!scroll || scroll.dataset.luneScrubBound === "1") return;
  scroll.dataset.luneScrubBound = "1";

  let dragging = false;

  const seekFromPointer = (clientX, clientY) => {
    const host = $("osmd");
    if (!host || !state.osmd || !LunePiano.hasTimeline()) return false;
    const marks = LunePiano.barMarkers?.() || [];
    const total = LunePiano.duration() || 0;
    if (!marks.length || !total) return false;

    const barNum = LuneAnnotate.measureAtPoint?.(state.osmd, host, clientX, clientY);
    if (!barNum) return false;
    const bounds = LuneAnnotate.measureBoundsInHost?.(state.osmd, host, barNum);
    if (!bounds) {
      LunePiano.seekToBar?.(barNum, { resumeIfWasPlaying: false });
      return true;
    }
    const hostRect = host.getBoundingClientRect();
    const localX = clientX - hostRect.left;
    const local = Math.max(0, Math.min(1, (localX - bounds.left) / Math.max(1, bounds.width)));
    const idx = marks.findIndex((m) => Number(m.bar) === Number(barNum));
    if (idx < 0) return false;
    const start = marks[idx].t;
    const end = idx + 1 < marks.length ? marks[idx + 1].t : total;
    const at = start + local * Math.max(0.001, end - start);
    const ratio = Math.max(0, Math.min(1, at / total));
    state.scrubRatio = ratio;
    LunePiano.seek(ratio, { resumeIfWasPlaying: false });
    return true;
  };

  const onMove = (e) => {
    if (!dragging) return;
    seekFromPointer(e.clientX, e.clientY);
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    state.scrubbing = false;
    line?.classList.remove("scrubbing");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    if (state.resumeAfterScrub) {
      LunePiano.resume();
      state.resumeAfterScrub = false;
    }
    syncPlayButton();
  };

  const begin = (e) => {
    if (LunePiano.isPlaying()) {
      state.resumeAfterScrub = true;
      LunePiano.pause();
      syncPlayButton();
    } else {
      state.resumeAfterScrub = false;
    }
    dragging = true;
    state.scrubbing = true;
    line?.classList.add("scrubbing");
    seekFromPointer(e.clientX, e.clientY);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    e.preventDefault();
    e.stopPropagation();
  };

  const startDrag = (e) => {
    if (e.button != null && e.button !== 0) return;
    if (state.panel !== "score") return;

    const nearPlayhead = (() => {
      if (e.target === line || e.target?.closest?.("#playhead-line")) return true;
      if (!line || line.hidden) return false;
      const r = line.getBoundingClientRect();
      return Math.abs(e.clientX - (r.left + r.width / 2)) < 22;
    })();
    if (!nearPlayhead) return;

    if (!LunePiano.hasTimeline() && state.piece?.debriefs) {
      ensurePieceTimeline(state.scrubRatio || 0)
        .then(() => begin(e))
        .catch((err) => toast(err.message));
      e.preventDefault();
      return;
    }
    if (!LunePiano.hasTimeline()) return;
    begin(e);
  };

  if (line) {
    line.addEventListener("pointerdown", startDrag);
  }
  scroll.addEventListener("pointerdown", startDrag);
}

function ensureKeyboard() {
  if (state.keyboard) return state.keyboard;
  const host = $("lune-keyboard");
  if (!host || typeof LuneKeyboard === "undefined") return null;
  state.keyboard = LuneKeyboard.build(host);
  return state.keyboard;
}

function syncKbdToggleUi() {
  const btn = $("btn-toggle-kbd");
  if (!btn) return;
  const on = !!state.keyboardVisible && state.panel === "score";
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.textContent = on ? "Hide piano" : "Show piano";
  btn.classList.toggle("on", on);
}

function applyKeyboardVisibility(on) {
  const dock = $("piano-dock");
  if (!dock) return;
  // The Piano tab draws its own keyboard under the falling notes, lined up
  // key for key; the dock is the slim keyboard under the score.
  const show = state.panel === "score" && !!on;
  if (state.panel === "score") state.keyboardVisible = !!on;

  dock.classList.toggle("collapsed", !show);
  dock.hidden = !show;
  dock.classList.toggle("is-focus", state.panel === "piano");
  dock.classList.toggle("is-slim", state.panel === "score" && show);

  if (show) ensureKeyboard();
  else clearKeyboard();
  syncKbdToggleUi();
}

function setKeyboardVisible(on) {
  if (state.panel === "piano") {
    // Leaving focus mode returns to Score with keyboard preference
    if (!on) {
      state.keyboardVisible = false;
      setStudioPanel("score");
      return;
    }
    applyKeyboardVisibility(true);
    return;
  }
  if (state.panel !== "score") {
    // Open Score with keyboard dock — keep notation as the stage
    state.keyboardVisible = !!on;
    setStudioPanel("score", { skipScore: true });
    if (state.piece?.musicxml) {
      ensureScoreReady().catch((e) => toast(e.message || String(e)));
    }
    applyKeyboardVisibility(!!on);
    return;
  }
  applyKeyboardVisibility(!!on);
}

function clearKeyboard() {
  try {
    state.keyboard?.clear?.();
  } catch {
    /* ignore */
  }
}

function onPianoKeys(payload) {
  if (!state.keyboardVisible || state.panel !== "score") return;
  const kbd = ensureKeyboard();
  if (!kbd) return;
  if (payload?.changed !== false || payload?.active?.length) {
    kbd.setActive(payload?.active || []);
  }
}

function setPlayRate(rate) {
  const r = Number(rate) || 1;
  state.playRate = r;
  try {
    LunePiano.setRate(r);
  } catch {
    /* ignore */
  }
  document.querySelectorAll(".speed-btn").forEach((btn) => {
    btn.classList.toggle("on", Number(btn.dataset.rate) === r);
  });
  const trigger = $("btn-speed");
  if (trigger) trigger.textContent = `${r}×`.replace(/(\.0)×$/, "×");
}

function bindHomeChapters() {
  const home = $("home");
  const chapters = document.querySelectorAll(
    ".home-chapter, .home-features, .about-maker, .home-sim, .home-statement, .home-billboard, .home-feat, .home-feat-intro, .home-close, .home-screen, [data-reveal]"
  );
  if (!chapters.length || typeof IntersectionObserver === "undefined") {
    chapters.forEach((el) => el.classList.add("is-in"));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { root: home || null, threshold: 0.16, rootMargin: "0px 0px -8% 0px" }
    );
    chapters.forEach((el) => io.observe(el));
  }

  if (home && !home.dataset.scrollBound) {
    home.dataset.scrollBound = "1";
    let ticking = false;
    const hero = home.querySelector(".home-hero-inner");
    const motif = home.querySelector(".home-hero-motif");
    const finePointer = window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches;
    home.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          const y = home.scrollTop;
          home.classList.toggle("is-scrolled", y > 40);
          // Parallax only on fine pointers — phones stay momentum-friendly
          if (finePointer && hero) {
            const t = Math.min(1, y / Math.max(280, window.innerHeight * 0.55));
            hero.style.transform = `translate3d(0, ${t * 36}px, 0) scale(${1 - t * 0.03})`;
            hero.style.opacity = String(1 - t * 0.45);
          }
          if (finePointer && motif) {
            const t = Math.min(1, y / Math.max(320, window.innerHeight * 0.6));
            motif.style.transform = `translate3d(0, ${t * 56}px, 0) scale(${1 + t * 0.06})`;
            motif.style.opacity = String(0.07 * (1 - t * 0.65));
          }
          ticking = false;
        });
      },
      { passive: true }
    );
  }
}

async function togglePlayback() {
  if (LunePiano.isPlaying()) {
    state.snippetEnd = null;
    LunePiano.pause();
    syncPlayButton();
    return;
  }
  state.snippetEnd = null;
  // Resume the whole-piece timeline from wherever the playhead sits.
  if (
    state.timelineKind === "piece" &&
    LunePiano.hasTimeline() &&
    LunePiano.progress() > 0.02 &&
    LunePiano.progress() < LunePiano.duration() - 0.05
  ) {
    LunePiano.resume();
    syncPlayButton();
    return;
  }
  const from =
    state.timelineKind === "piece" && LunePiano.hasTimeline() && LunePiano.duration()
      ? (LunePiano.progress() || 0) / LunePiano.duration()
      : Math.max(0, Math.min(1, Number(state.scrubRatio) || 0));
  await startPiecePlayback(from >= 0.995 ? 0 : from);
}

async function startPiecePlayback(seekRatio = 0) {
  const notes = pieceNotes();
  if (!notes.length) {
    toast("Nothing to play");
    return;
  }

  // Keep Score as the stage — never bounce to Piano-only for Listen
  if (state.panel === "explain") {
    setStudioPanel("score", { skipScore: true });
    await ensureScoreReady();
  } else if (state.panel === "score" && !state.scoreReady) {
    await ensureScoreReady();
  }

  // Auto-show slim keyboard under the score during play (user can hide)
  if (state.panel === "score" && !state.keyboardVisible) {
    applyKeyboardVisibility(true);
  } else if (state.panel === "piano") {
    ensureKeyboard();
  }

  try {
    await ensureSamplesWithLoader();
  } catch {
    toast("Could not load piano samples — check internet once");
    return;
  }
  try {
    LunePiano.setRate(state.playRate || 1);
  } catch {
    /* ignore */
  }
  const ratio = Math.max(0, Math.min(1, Number(seekRatio) || 0));
  state.scrubRatio = ratio;
  state.timelineKind = "piece";
  await LunePiano.play(notes, {
    from: ratio,
    ...playbackTempoOpts(),
    ...playbackHandlers(),
  });
  renderScrubTicks();
  syncPlayButton();
}

/**
 * Play a span of bars on the full-piece timeline, then auto-pause at the
 * span's end. The playhead stays where the snippet finished.
 */
async function playSnippet(fromBar, toBar) {
  if (LunePiano.isPlaying()) {
    state.snippetEnd = null;
    LunePiano.pause();
    syncPlayButton();
  }
  const ok = await ensurePieceTimeline();
  if (!ok) {
    toast("Nothing to play");
    return;
  }
  const marks = LunePiano.barMarkers?.() || [];
  const total = LunePiano.duration() || 0;
  if (!marks.length || !total) {
    toast("Nothing to play");
    return;
  }
  const startMark = marks.find((m) => Number(m.bar) === Number(fromBar)) || marks[0];
  const after = marks.find((m) => Number(m.bar) > Number(toBar));
  const end = after ? after.t : total;
  if (state.panel === "score" && !state.keyboardVisible) applyKeyboardVisibility(true);
  else ensureKeyboard();
  state.snippetEnd = end;
  LunePiano.seek(startMark.t / total, { resumeIfWasPlaying: false });
  LunePiano.resume();
  syncPlayButton();
}

/** Coach action: play the currently selected bar(s). */
async function playSelectedBars() {
  if (LunePiano.isPlaying()) {
    state.snippetEnd = null;
    LunePiano.pause();
    syncPlayButton();
    refreshCoachChrome();
    return;
  }
  const bars = selectedBarsSorted();
  if (!bars.length && state.selected) bars.push(Number(state.selected));
  if (!bars.length) {
    toast("Pick a bar first");
    return;
  }
  await playSnippet(bars[0], bars[bars.length - 1]);
  refreshCoachChrome();
}

/** Bars engraved on the same line (system) as the given bar. */
function lineBarsFor(num) {
  const bar = Number(num);
  if (!Number.isFinite(bar)) return null;
  const viaOsmd = state.osmd ? LuneAnnotate.systemBarsFor?.(state.osmd, bar) : null;
  if (viaOsmd?.length) return viaOsmd;
  // Score not rendered (coach opened from Explain) — fall back to a 4-bar phrase.
  const [from, to] = pieceBarSpan();
  const start = Math.max(from, bar - ((bar - from) % 4));
  return rangeBars(start, Math.min(to, start + 3));
}

/** Coach action: play the whole line (system) the selected bar sits on. */
async function playSelectedLine() {
  const bar = Number(state.selected || selectedBarsSorted()[0]);
  if (!bar) {
    toast("Pick a bar first");
    return;
  }
  const line = lineBarsFor(bar);
  if (!line?.length) {
    toast("Could not find this line");
    return;
  }
  await playSnippet(line[0], line[line.length - 1]);
}

/* ---------- score render with annotations ---------- */

/** Analysis entry for a printed bar (numbering can differ from the page). */
function debriefFor(num) {
  const deb = state.piece?.debriefs || {};
  const key = LuneAnnotate?.debriefKeyFor?.(num) ?? String(num);
  return deb[key] || deb[String(num)] || null;
}

function scoreNeedsRoom() {
  // Always engrave with label room: Notes / Fingers / Off then only repaint
  // the overlay layer — instant, and the music never jumps under the eyes.
  return true;
}

/** Draw / clear custom SVG letter+finger layers on the current OSMD SVG. */
function overlaySpaceKey() {
  const host = $("osmd");
  const w = Math.round(host?.clientWidth || 0);
  const mode = state.scoreFingers ? "f" : state.scoreLetters ? "l" : "o";
  const piece = state.piece?.id || state.piece?.title || "";
  return `${piece}|${w}|${mode}`;
}

function applyVoiceSpacing(osmd, pass) {
  if (!osmd?.EngravingRules) return;
  const rules = osmd.EngravingRules;
  const mul = [1.05, 1.25, 1.45, 1.6][Math.max(0, Math.min(pass, 3))];
  const add = [4, 6, 8, 10][Math.max(0, Math.min(pass, 3))];
  const minD = [3, 5, 7, 9][Math.max(0, Math.min(pass, 3))];
  try {
    rules.VoiceSpacingMultiplierVexflow = mul;
    rules.VoiceSpacingMultiplierVexFlow = mul;
    rules.VoiceSpacingAddendVexflow = add;
    rules.VoiceSpacingAddendVexFlow = add;
    rules.MinNoteDistance = minD;
  } catch {
    /* older OSMD */
  }
}

const ALLOW_SPACING_RERENDER = false;

const LUNE_LYRIC_LANE = true;

/** Give engraved lane text our label styling (OSMD draws plain <text>). */
function styleLaneText(host) {
  const mode = state.renderedLaneMode || "off";
  if (mode === "off") return;
  if (mode !== "both") {
    const cls = mode === "letters" ? "lane-letter" : "lane-finger";
    for (const t of host.querySelectorAll("svg g.lyrics text")) t.classList.add(cls);
    return;
  }
  // Both labels were engraved together: read each one's tag once, then show
  // whichever the pianist asked for.
  for (const t of host.querySelectorAll("svg g.lyrics text")) {
    if (t.dataset.letter != null) continue;
    const info = LuneLane.untag(t.textContent);
    if (!info) continue;
    t.dataset.letter = info.letter;
    t.dataset.finger = info.finger;
    t.textContent = info.letter;
    t.classList.add("lane-letter");
  }
}

/** Notes / Fingers / Off without engraving again: swap the text in place. */
/** Switch Notes, Fingers or Off with a short cross-fade instead of a jump. */
let laneFadeTimer = 0;
function fadeLaneMode(host) {
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (still) return showLaneMode(host);
  clearTimeout(laneFadeTimer);
  host.classList.add("lane-fading");
  laneFadeTimer = setTimeout(() => {
    showLaneMode(host);
    requestAnimationFrame(() => host.classList.remove("lane-fading"));
  }, 110);
}

function showLaneMode(host) {
  const mode = state.scoreFingers ? "fingers" : state.scoreLetters ? "letters" : "off";
  host.classList.toggle("lane-hidden", mode === "off");
  if (mode === "off") return;
  for (const t of host.querySelectorAll("svg g.lyrics text[data-letter]")) {
    const text = mode === "fingers" ? t.dataset.finger : t.dataset.letter;
    if (t.textContent !== text) t.textContent = text;
    t.classList.toggle("lane-finger", mode === "fingers");
    t.classList.toggle("lane-letter", mode !== "fingers");
  }
}

/** Centre every label on its own spot so a short digit sits where the letter was. */
function centreLaneLabels(host) {
  for (const t of host.querySelectorAll("svg g.lyrics text[data-letter]")) {
    if (t.getAttribute("text-anchor") === "middle") continue;
    let b;
    try {
      b = t.getBBox();
    } catch {
      continue;
    }
    if (!b.width) continue;
    t.setAttribute("x", String(b.x + b.width / 2));
    t.setAttribute("text-anchor", "middle");
  }
}

function applyScoreOverlays() {
  const host = $("osmd");
  if (!host || !state.osmd) return;
  if (LUNE_LYRIC_LANE) {
    // Labels are part of the engraving; just style them and drop any overlay.
    LuneAnnotate.clearLetterOverlays(host);
    styleLaneText(host);
    state.laneStaggered = staggerLaneLabels(host);
    if (state.renderedLaneMode === "both") {
      centreLaneLabels(host);
      showLaneMode(host);
    }
    window.LunePractice?.afterScoreRender();
    return;
  }
  const wantLetters = !!state.scoreLetters;
  const wantFingers = !!state.scoreFingers;
  if (!wantLetters && !wantFingers) {
    LuneAnnotate.clearLetterOverlays(host);
    state.lastLetterCheck = null;
    window.__luneLastCheck = null;
    window.__luneLeaders = [];
    return;
  }
  const key = overlaySpaceKey();
  // Skip duplicate passes (rAF + settle timer + resize all fire after one
  // render): same SVG, same mode, labels already drawn → nothing to do.
  const svgNow = host.querySelector("svg");
  const drawnKey = `${key}|${svgNow?.getAttribute("width")}|${svgNow?.getAttribute("height")}`;
  if (
    svgNow &&
    state.overlayDrawnSvg === svgNow &&
    state.overlayDrawnKey === drawnKey &&
    svgNow.querySelector(".lune-letter-layer text, .lune-finger-layer text")
  ) {
    return;
  }
  if (state.overlaySpaceKey !== key) {
    state.overlaySpaceKey = key;
    state.overlaySpacePass = 0;
  }
  const pass = Number(state.overlaySpacePass) || 0;
  const escalate = pass >= 3;
  const debriefs = state.piece?.debriefs || {};
  window.__luneExpected = LuneAnnotate.collectLetters?.(debriefs)?.length || 0;
  const result = LuneAnnotate.placeLetterOverlays(host, state.osmd, debriefs, {
    letters: wantLetters,
    fingers: wantFingers,
    allowFontDrop: escalate,
    allowLane: escalate,
  });
  state.lastLetterCheck =
    result?.check ||
    LuneAnnotate.assertOverlaySeparation?.(host) ||
    LuneAnnotate.assertLetterSeparation?.(host);
  if (result?.leaders) state.lastOverlayLeaders = result.leaders;
  window.__luneLastCheck = state.lastLetterCheck;
  window.__luneLeaders = state.lastOverlayLeaders || [];
  window.__luneOverlayPass = state.overlaySpacePass;
  state.overlayDrawnSvg = svgNow;
  state.overlayDrawnKey = drawnKey;
  if (state.overlaySpacingLock) return;
  // Re-engraving with wider spacing reflowed the page (and cost a full
  // render). Placement now searches for clear spots itself, so stay put.
  if (ALLOW_SPACING_RERENDER && state.lastLetterCheck && !state.lastLetterCheck.ok && pass < 3) {
    state.overlaySpacePass = pass + 1;
    applyVoiceSpacing(state.osmd, state.overlaySpacePass);
    state.overlaySpacingLock = true;
    try {
      state.osmd.render();
    } catch {
      state.overlaySpacingLock = false;
    }
    window.setTimeout(() => {
      state.overlaySpacingLock = false;
      if (state.osmd) applyScoreOverlays();
    }, 140);
  }
}

/**
 * OSMD autoResize calls render() again when the container settles / window
 * resizes — that rebuilds the SVG and would wipe our overlays. Patch render
 * so every redraw re-applies Letters/Fingers. Also re-apply after a short
 * settle delay (mobile reflow can lag one frame behind render).
 */
function bindOsmdRenderOverlays(osmd) {
  if (!osmd || osmd.__luneOverlayPatched) return;
  const orig = osmd.render.bind(osmd);
  let settleTimer = 0;
  const reapply = () => {
    if (state.osmd !== osmd) return;
    untangleScoreDirections($("osmd"));
    applyScoreOverlays();
    paintSelectionHilites();
  };
  osmd.render = function luneRender(...args) {
    const result = orig(...args);
    requestAnimationFrame(reapply);
    // Second pass after layout/autoResize finishes (esp. phone width changes)
    clearTimeout(settleTimer);
    settleTimer = setTimeout(reapply, 120);
    return result;
  };
  osmd.__luneOverlayPatched = true;
  if (!state.__luneResizeBound) {
    state.__luneResizeBound = true;
    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!state.osmd) return;
        applyScoreOverlays();
      }, 180);
    });
  }
}

/**
 * OSMD often stacks metronome (♩ = 50) on top of verbal tempo ("Andante…")
 * and wedges directions into each other. Nudge colliding direction text apart
 * in the drawn SVG without re-engraving the notes.
 */
function untangleScoreDirections(host) {
  const svg = host?.querySelector?.("svg");
  if (!svg) return;
  const texts = [...svg.querySelectorAll("text")].filter((t) => {
    if (t.closest("g.lyrics")) return false;
    if (t.classList.contains("lune-letter") || t.classList.contains("lune-finger")) return false;
    if (t.classList.contains("lane-letter") || t.classList.contains("lane-finger")) return false;
    const s = (t.textContent || "").trim();
    if (!s || /^\d+$/.test(s)) return false; // measure numbers
    return true;
  });
  if (texts.length < 2) return;

  const box = (el) => {
    try {
      return el.getBBox();
    } catch {
      return null;
    }
  };
  const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  const isMetronome = (el) => /[=＝]|♩|♪|bpm/i.test(el.textContent || "") || /^\s*\d{2,3}\s*$/.test((el.textContent || "").trim());

  // Prefer lifting metronome marks; otherwise shift the lower/right label.
  for (let pass = 0; pass < 3; pass++) {
    let moved = 0;
    for (let i = 0; i < texts.length; i++) {
      const a = texts[i];
      const ba = box(a);
      if (!ba || ba.width < 1 || ba.height < 1) continue;
      for (let j = i + 1; j < texts.length; j++) {
        const b = texts[j];
        const bb = box(b);
        if (!bb || bb.width < 1 || bb.height < 1) continue;
        // Only untangle labels that share a neighbourhood (same system header).
        if (Math.abs(ba.y - bb.y) > 28 || Math.abs(ba.x - bb.x) > 160) continue;
        if (!overlap(ba, bb) && !(ba.y < bb.y + bb.height + 2 && ba.y + ba.height + 2 > bb.y && ba.x < bb.x + bb.width + 4 && ba.x + ba.width + 4 > bb.x)) {
          continue;
        }
        let lift = a;
        let stay = b;
        if (isMetronome(b) && !isMetronome(a)) {
          lift = b;
          stay = a;
        } else if (isMetronome(a) && !isMetronome(b)) {
          lift = a;
          stay = b;
        } else if (bb.y >= ba.y) {
          lift = b;
          stay = a;
        }
        const curY = Number(lift.getAttribute("y"));
        if (!Number.isFinite(curY)) continue;
        const stayBox = box(stay);
        const liftBox = box(lift);
        if (!stayBox || !liftBox) continue;
        const gap = 3;
        const need = stayBox.y - (liftBox.y + liftBox.height);
        if (need >= gap) continue;
        const dy = gap - need;
        lift.setAttribute("y", String(curY - dy));
        // If still horizontally crushed, ease metronome to the right of the word.
        const after = box(lift);
        const other = box(stay);
        if (after && other && overlap(after, other)) {
          const curX = Number(lift.getAttribute("x"));
          if (Number.isFinite(curX)) {
            lift.setAttribute("x", String(Math.max(curX, other.x + other.width + 6)));
          }
        }
        moved++;
      }
    }
    if (!moved) break;
  }
}

/** Re-engrave only when the score column really changes width (rotate, resize). */
function watchScoreWidth() {
  const host = $("osmd");
  if (!host || state.__scoreWidthObserver || typeof ResizeObserver === "undefined") return;
  let timer = 0;
  state.__scoreWidthObserver = new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const w = Math.round(host.clientWidth || 0);
      if (!state.osmd || !w || host.hidden) return;
      if (Math.abs(w - (state.osmdRenderedWidth || 0)) < 8) return;
      state.osmdRenderedWidth = w;
      try {
        state.osmd.zoom = w >= 720 ? 1.18 : 1.08;
        state.osmd.render();
        fitScoreToWidth(state.osmd);
      } catch {
        /* keep the last good engraving */
      }
    }, 160);
  });
  state.__scoreWidthObserver.observe(host);
}

/** Neighbouring lane labels (same row) whose ink touches. */
function laneTouches(svg) {
  const rows = new Map();
  for (const el of svg.querySelectorAll("g.lyrics text")) {
    if ((el.textContent || "").trim() === (window.LuneLane?.SPARE || "~")) continue;
    const b = el.getBBox();
    // group by baseline, not box top: "B♭" has a taller box than "F" on the
    // same line, and must still be checked against it
    const key = Math.round(Number(el.getAttribute("y")) || b.y);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(b);
  }
  let n = 0;
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) if (row[i].x < row[i - 1].x + row[i - 1].width + 1) n++;
  }
  return n;
}

/**
 * Space for labels comes from the layout, not from nudging: while labels in a
 * row touch, widen note spacing and re-engrave (fewer bars per line), then
 * re-fit to the page width. Spacing grows relative to the notes, so the fit
 * holds even when a dense bar has to be drawn smaller on a phone.
 */
function widenUntilLabelsFit(osmd) {
  const host = $("osmd");
  const svg0 = host?.querySelector("svg");
  if (!svg0) return;
  let touches = laneTouches(svg0);
  const R = osmd.EngravingRules;
  for (let pass = 0; pass < 3 && touches > 0; pass++) {
    const mul = (R.VoiceSpacingMultiplierVexflow || 1) * 1.3;
    R.VoiceSpacingMultiplierVexflow = mul;
    R.VoiceSpacingMultiplierVexFlow = mul;
    R.VoiceSpacingAddendVexflow = (R.VoiceSpacingAddendVexflow || 3) + 2;
    R.VoiceSpacingAddendVexFlow = R.VoiceSpacingAddendVexflow;
    R.MinNoteDistance = (R.MinNoteDistance || 2) + 1.5;
    osmd.render();
    fitScoreToWidth(osmd);
    touches = laneTouches(host.querySelector("svg"));
  }
  state.laneTouchesLeft = touches;
}

/**
 * A bar can't be split across lines, so a very dense bar on a phone can be
 * wider than the page. If anything sticks out past the right edge, scale the
 * whole engraving down just enough and re-engrave (at most twice).
 */
const fitZoomCache = new Map(); // piece|width → zoom that fits

function scoreOverflowRatio(host, svg) {
  // Compare the music's right edge with where the staff lines end (and the
  // screen edge): notes drawn past the final barline mean the bar lacks room.
  const hostBox = host.getBoundingClientRect();
  let staffRight = 0;
  for (const m of svg.querySelectorAll("g.vf-measure")) {
    for (const c of m.children) {
      if (c.tagName.toLowerCase() !== "path") continue;
      const r = c.getBoundingClientRect();
      if (r.height < 2 && r.width > 10 && r.right > staffRight) staffRight = r.right;
    }
  }
  let right = 0;
  for (const g of svg.querySelectorAll("g.vf-stavenote, g.vf-beam, g.lyrics text")) {
    const r = g.getBoundingClientRect();
    if (r.width && r.right > right) right = r.right;
  }
  const limit = Math.min(hostBox.right, staffRight || hostBox.right);
  const used = right - hostBox.left;
  const room = limit - hostBox.left;
  return used > room + 1.5 ? room / used : 1;
}

function fitScoreToWidth(osmd) {
  const host = $("osmd");
  let svg = host?.querySelector("svg");
  if (!svg || !osmd) return;
  const key = fitZoomKey();
  let ratio = scoreOverflowRatio(host, svg);
  // small overflows: scale the drawing (instant); big ones: re-engrave smaller
  for (let pass = 0; pass < 2 && ratio < 0.97; pass++) {
    // A bar that can't fit its line draws past the barline: engrave again,
    // smaller by the overflow, so every bar has room.
    osmd.zoom = Math.max(0.45, osmd.zoom * ratio * 0.96);
    osmd.render();
    svg = host.querySelector("svg");
    ratio = scoreOverflowRatio(host, svg);
  }
  fitZoomCache.set(key, osmd.zoom);
  if (ratio < 1 && svg) {
    // last few pixels: scale the finished drawing (instant, same layout)
    const w = Number(svg.getAttribute("width")) || svg.getBoundingClientRect().width;
    const h = Number(svg.getAttribute("height")) || svg.getBoundingClientRect().height;
    if (!svg.getAttribute("viewBox")) svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("width", String(w * ratio * 0.985));
    svg.setAttribute("height", String(h * ratio * 0.985));
  }
}

function fitZoomKey() {
  const host = $("osmd");
  const boost = window.LunePractice?.zoomBoost?.() || 1;
  return `${state.piece?.id || state.piece?.title || ""}|${Math.round((host?.clientWidth || 0) / 20)}|${boost}`;
}
function cachedFitZoom(defaultZoom) {
  const boost = window.LunePractice?.zoomBoost?.() || 1;
  return fitZoomCache.get(fitZoomKey()) ?? defaultZoom * boost;
}

/**
 * Last line of defence for the label lane: if two labels in the same row
 * still touch (a bar so dense the engraver ran out of room), drop every
 * other one onto a second line — the zig-zag used in beginner editions.
 * A dropped label never lands on notation; if it would, it shrinks instead.
 */
function staggerLaneLabels(host) {
  const svg = host?.querySelector("svg");
  if (!svg) return 0;
  const all = [...svg.querySelectorAll("g.lyrics text")];
  if (!all.length) return 0;
  const SPARE = window.LuneLane?.SPARE || "~";
  // spare-line placeholders: hide them, remember where the empty line is
  const spares = [];
  const labels = [];
  for (const el of all) {
    if ((el.textContent || "").trim() === SPARE) {
      el.setAttribute("visibility", "hidden");
      el.classList.add("lane-spare");
      const b = el.getBBox();
      spares.push({ x: b.x, y: b.y, h: b.height, cy: Number(el.getAttribute("y")) });
    } else labels.push(el);
  }
  // the spare line below a label: nearest placeholder underneath, same system
  const spareBelow = (b) => {
    let best = null;
    for (const sp of spares) {
      const dy = sp.y - b.y;
      if (dy <= b.height * 0.5 || dy > b.height * 6) continue;
      if (!best || dy < best.y - b.y) best = sp;
    }
    return best;
  };
  // notation that can hang into the lane (low stems, ledger notes, flags)
  const CELL = 48;
  const inkGrid = new Map();
  for (const g of svg.querySelectorAll("g.vf-notehead, g.vf-stem, g.vf-flag, g.vf-beam, g.vf-modifiers")) {
    let r;
    try {
      r = g.getBBox();
    } catch {
      continue;
    }
    if (!r.width && !r.height) continue;
    for (let gx = Math.floor(r.x / CELL); gx <= Math.floor((r.x + r.width) / CELL); gx++)
      for (let gy = Math.floor(r.y / CELL); gy <= Math.floor((r.y + r.height) / CELL); gy++) {
        const k = gx * 100003 + gy;
        if (!inkGrid.has(k)) inkGrid.set(k, []);
        inkGrid.get(k).push(r);
      }
  }
  const touchesInk = (b) => {
    const t = b.y + b.height * 0.15;
    const bot = b.y + b.height * 0.85;
    for (let gx = Math.floor(b.x / CELL); gx <= Math.floor((b.x + b.width) / CELL); gx++)
      for (let gy = Math.floor(t / CELL); gy <= Math.floor(bot / CELL); gy++)
        for (const r of inkGrid.get(gx * 100003 + gy) || [])
          if (b.x < r.x + r.width + 0.8 && b.x + b.width > r.x - 0.8 && t < r.y + r.height + 0.8 && bot > r.y - 0.8) return true;
    return false;
  };
  const rows = new Map();
  for (const el of labels) {
    const b = el.getBBox();
    // group by baseline, not box top: "B♭" has a taller box than "F" on the
    // same line, and must still be checked against it
    const key = Math.round(Number(el.getAttribute("y")) || b.y);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push({ el, b });
  }
  const dropped = new Map(); // spare-line y → right edge used so far
  let moved = 0;
  for (const row of rows.values()) {
    row.sort((p, q) => p.b.x - q.b.x);
    let lastRight = -Infinity;
    for (const { el, b } of row) {
      // labels for different notes need a visible gap, not just no overlap,
      // or "E G♯" reads as one word
      const gap = Math.max(2.5, b.height * 0.3);
      if (b.x >= lastRight + gap && !touchesInk(b)) {
        lastRight = b.x + b.width;
        continue;
      }
      const sp = spareBelow(b);
      const key = sp ? Math.round(sp.y) : null;
      const used = key != null ? dropped.get(key) ?? -Infinity : Infinity;
      if (sp && b.x >= used + gap) {
        el.setAttribute("y", String(sp.cy));
        dropped.set(key, b.x + b.width);
        moved++;
        continue;
      }
      // still no room: shrink beside its neighbour (never below 65%)
      const fs = parseFloat(getComputedStyle(el).fontSize) || 12;
      const scale = Math.max(0.65, Math.min(0.92, (b.x + b.width - lastRight - gap) / b.width));
      el.style.fontSize = `${fs * scale}px`;
      const nb = el.getBBox();
      const shift = Math.max(0, lastRight + gap - nb.x);
      if (shift) el.setAttribute("x", String(Number(el.getAttribute("x")) + shift));
      lastRight = nb.x + shift + nb.width;
      moved++;
    }
  }
  return moved;
}

/**
 * The Piano tab needs the score engraved for its timeline while the Score
 * panel is hidden. Engraving into a hidden (zero-width) panel draws bars with
 * negative widths, so the panel is laid out off screen at full width meanwhile.
 */
async function renderScore() {
  const pane = $("panel-score");
  const offstage = !!pane?.hidden;
  if (offstage) {
    pane.classList.add("score-offstage");
    pane.hidden = false;
  }
  try {
    await renderScoreNow();
  } finally {
    if (offstage && state.panel !== "score") pane.hidden = true;
    pane?.classList.remove("score-offstage");
  }
}

async function renderScoreNow() {
  const base = state.rawMusicxml || state.piece?.musicxml || "";
  if (!base) return;
  const wantLetters = !!state.scoreLetters;
  const wantFingers = !!state.scoreFingers;
  // Letters / finger numbers are engraved as a lyric lane under each staff:
  // the engraver reserves the space and spaces bars so labels never collide.
  // Letters and fingers are engraved together once; the toggle then swaps text.
  const laneMode = "both";
  state.renderedLaneMode = laneMode;
  const xml = LuneLane.build(LuneLane.printed(base), { mode: laneMode, debriefs: state.piece.debriefs || {} });
  $("osmd").hidden = false;
  $("osmd").innerHTML = "";
  const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay($("osmd"), {
    // OSMD's autoResize re-engraves right after the first render even when
    // nothing changed (+1.8s). watchScoreWidth() re-renders only on real
    // width changes instead.
    autoResize: false,
    backend: "svg",
    drawTitle: false,
    drawComposer: false,
    drawCredits: false,
    drawPartNames: false,
    drawMeasureNumbers: true,
    drawLyrics: true, // the letter / finger lane
    drawFingerings: false,
  });
  try {
    const roomy = scoreNeedsRoom();
    osmd.EngravingRules.BetweenStaffDistance = roomy ? 9.5 : 3.5;
    osmd.EngravingRules.StaffDistance = roomy ? 18 : 7.5;
    state.overlaySpacePass = 0;
    state.overlaySpaceKey = overlaySpaceKey();
    state.overlaySpacingLock = false;
    if (roomy) applyVoiceSpacing(osmd, 0);
    const R = osmd.EngravingRules;
    R.LyricsHeight = 2.15; // label size (staff-space units)
    R.LyricsYOffsetToStaffHeight = 0.9; // gap between staff and the lane
    R.VerticalBetweenLyricsDistance = 0.35; // stacked chord tones
    // Engraver defaults for label padding: extra padding pushed dense bars
    // past their barlines; crowded labels use the reserved spare line instead.
    R.LyricsUseXPaddingForLongLyrics = true;
    R.HorizontalBetweenLyricsDistance = 0.45;
    R.BetweenSyllableMinimumDistance = 0.6;
    R.RenderLyricist = false;
    // Lift metronome (♩ = 50) above verbal tempo so they don't sit on "Andante".
    R.MetronomeMarksDrawn = true;
    R.MetronomeMarkYShift = -2.8;
    R.MetronomeMarkXShift = 2;
  } catch {
    /* older OSMD */
  }
  state.osmd = osmd;
  state.scoreWasRoomy = scoreNeedsRoom();
  bindOsmdRenderOverlays(osmd);
  await osmd.load(xml);
  // load() resets zoom, so set it afterwards: 1 (the size the label lane is
  // tuned for), larger in large-print mode, or the cached fit for this width.
  osmd.zoom = cachedFitZoom(1);
  osmd.render();
  fitScoreToWidth(osmd);
  untangleScoreDirections($("osmd"));
  state.osmdRenderedWidth = Math.round($("osmd")?.clientWidth || 0);
  watchScoreWidth();
  wireScoreMeasureClicks();
  // Immediate apply (patched render also schedules one after autoResize).
  requestAnimationFrame(() => {
    if (state.osmd !== osmd) return;
    applyScoreOverlays();
    paintSelectionHilites();
  });
}

/**
 * Clicks on the engraved score.
 * Playing: a click seeks playback to that bar and keeps going.
 * Paused: a click opens the coach with that bar's guidance
 * (shift extends the range, cmd/ctrl toggles bars for coaching info).
 */
function wireScoreMeasureClicks() {
  const host = $("osmd");
  if (!host || host.dataset.luneClickBound === "1") return;
  host.dataset.luneClickBound = "1";
  host.classList.add("score-interactive");

  const nearPlayhead = (e) => {
    const line = $("playhead-line");
    if (e.target === line || e.target?.closest?.("#playhead-line")) return true;
    if (!line || line.hidden) return false;
    const r = line.getBoundingClientRect();
    return Math.abs(e.clientX - (r.left + r.width / 2)) < 16;
  };

  const barAt = (clientX, clientY) => {
    if (!state.piece?.debriefs) return null;
    const num = LuneAnnotate.measureAtPoint?.(state.osmd, host, clientX, clientY);
    if (!num || !debriefFor(num)) return null;
    return Number(num);
  };

  host.addEventListener("click", (e) => {
    if (!state.piece?.debriefs) return;
    if (state.panel !== "score") return;
    if (e.target.closest?.("button, a, input, label")) return;
    if (nearPlayhead(e)) return;
    const num = barAt(e.clientX, e.clientY);
    if (!num) {
      // Empty score click clears selection when coach is open
      if (state.coachOpen || selectedBarsSorted().length) {
        clearBarSelection({ close: true });
      }
      return;
    }
    applyBarClick(num, e);
  });

  // Desktop affordance: outline the bar under the cursor so clicks feel safe.
  if (window.matchMedia?.("(pointer: fine)")?.matches) {
    const hover = $("hover-hilite");
    let raf = 0;
    host.addEventListener("pointermove", (e) => {
      if (!hover || state.panel !== "score" || !state.osmd) return;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const num = barAt(e.clientX, e.clientY);
        const bounds = num
          ? LuneAnnotate.measureBoundsInHost?.(state.osmd, host, num)
          : null;
        if (!bounds) {
          hover.hidden = true;
          return;
        }
        hover.hidden = false;
        hover.style.left = `${bounds.left}px`;
        hover.style.top = `${bounds.top}px`;
        hover.style.width = `${bounds.width}px`;
        hover.style.height = `${bounds.height}px`;
      });
    });
    host.addEventListener("pointerleave", () => {
      if (hover) hover.hidden = true;
    });
  }
}

function rangeBars(a, b) {
  const lo = Math.min(Number(a), Number(b));
  const hi = Math.max(Number(a), Number(b));
  const out = [];
  for (let i = lo; i <= hi; i++) {
    if (debriefFor(i)) out.push(i);
  }
  return out;
}

function applyBarClick(num, e) {
  // While playing, a bar click is a seek — jump there and keep going.
  if (LunePiano.isPlaying() && state.timelineKind === "piece") {
    state.snippetEnd = null;
    LunePiano.seekToBar?.(num, { resumeIfWasPlaying: true });
    return;
  }
  const meta = !!(e.metaKey || e.ctrlKey);
  const shift = !!e.shiftKey;
  if (meta) {
    const set = new Set(selectedBarsSorted());
    if (set.has(num)) set.delete(num);
    else set.add(num);
    const next = [...set].sort((a, b) => a - b);
    if (!next.length) {
      clearBarSelection({ close: false });
      openBarCoach();
      return;
    }
    setBarSelection(next, { open: true, primary: num });
    return;
  }
  if (shift && state.selected) {
    setBarSelection(rangeBars(state.selected, num), { open: true, primary: num });
    return;
  }
  setBarSelection([num], { open: true, primary: num });
}

function setBarSelection(bars, { open = true, primary = null } = {}) {
  const next = [...new Set((bars || []).map(Number).filter((n) => n > 0))].sort((a, b) => a - b);
  state.selectedBars = next;
  state.selected = primary != null ? Number(primary) : next.length ? next[next.length - 1] : null;
  const s = activeSession();
  if (s) {
    s.selected = state.selected;
    s.selectedBars = [...next];
  }
  paintSelectionHilites();
  if (open) openBarCoach();
}

function clearBarSelection({ close = true } = {}) {
  state.selectedBars = [];
  state.selected = null;
  const s = activeSession();
  if (s) {
    s.selected = null;
    s.selectedBars = [];
  }
  paintSelectionHilites();
  if (close) closeCoach();
  else refreshCoachChrome();
}

function paintSelectionHilites() {
  window.LuneAsk?.onSelection?.();
  const layer = $("selection-hilites");
  if (!layer) return;
  layer.innerHTML = "";
  const bars = selectedBarsSorted();
  if (!bars.length || state.panel !== "score" || !state.osmd) return;
  const host = $("osmd");
  if (!host) return;
  for (const bar of bars) {
    const bounds = LuneAnnotate.measureBoundsInHost?.(state.osmd, host, bar);
    if (!bounds) continue;
    const el = document.createElement("div");
    el.className = "selection-hilite";
    el.style.left = `${bounds.left}px`;
    el.style.top = `${bounds.top}px`;
    el.style.width = `${bounds.width}px`;
    el.style.height = `${bounds.height}px`;
    layer.appendChild(el);
  }
}

async function refreshScoreAnnotations() {
  if (!state.piece?.musicxml) return;
  if (LUNE_LYRIC_LANE) {
    const want = state.scoreFingers ? "fingers" : state.scoreLetters ? "letters" : "off";
    const host = $("osmd");
    if (state.renderedLaneMode === "both" && state.osmd && host?.querySelector("svg")) {
      fadeLaneMode(host); // already engraved: the labels cross-fade, nothing is redrawn
      return;
    }
    if (want !== state.renderedLaneMode) {
      const keepScroll = $("score-scroll")?.scrollTop || 0;
      await renderScore();
      primeTimeline();
      if ($("score-scroll")) $("score-scroll").scrollTop = keepScroll;
    }
    return;
  }
  const roomy = scoreNeedsRoom();
  // Seamless: if OSMD is up and staff spacing need is unchanged, only re-paint
  // SVG overlays — no full MusicXML reload flash.
  if (state.osmd && $("osmd")?.querySelector("svg") && roomy === !!state.scoreWasRoomy) {
    applyScoreOverlays();
    paintSelectionHilites();
    return;
  }
  await renderScore();
}

/** Group simultaneous tones so chords render as a vertical stack, not one pile. */
function groupByOffset(arr) {
  const groups = [];
  for (const n of arr || []) {
    const last = groups[groups.length - 1];
    if (last && Math.abs((last[0].offset || 0) - (n.offset || 0)) < 1e-4) {
      last.push(n);
    } else {
      groups.push([n]);
    }
  }
  return groups;
}

/** "D#5" → "D♯5", "Bb3" → "B♭3" for display. */
function prettyPitch(text) {
  return String(text || "").replace(/^([A-G])(##|#|bb|b)?/, (_, l, a) => l + ({ "##": "♯♯", "#": "♯", bb: "♭♭", b: "♭" }[a || ""] || ""));
}

function lettersBlock(d) {
  const fingersFirst = !!state.scoreFingers;
  const fmt = (arr) =>
    groupByOffset(arr)
      .map((g) => {
        const sorted = [...g].sort((a, b) => (b.midi || 0) - (a.midi || 0));
        if (sorted.length === 1) {
          const n = sorted[0];
          const letter = escapeHtml(prettyPitch(n.letter || n.pitch || ""));
          const finger = n.fingering || n.finger;
          if (fingersFirst) {
            return `<span class="chip finger-only">${finger ? `<b>${finger}</b>` : ""}${letter}</span>`;
          }
          return `<span class="chip letter">${letter}${finger ? `<i class="tone-finger">${finger}</i>` : ""}</span>`;
        }
        const inner = sorted
          .map((n) => {
            const letter = escapeHtml(prettyPitch(n.letter || n.pitch || ""));
            const finger = n.fingering || n.finger;
            if (fingersFirst) {
              return `<span class="chord-tone">${finger ? `<b class="tone-finger">${finger}</b>` : ""}<i class="tone-letter">${letter}</i></span>`;
            }
            return `<span class="chord-tone"><b class="tone-letter">${letter}</b>${finger ? `<i class="tone-finger">${finger}</i>` : ""}</span>`;
          })
          .join("");
        return `<span class="chip ${fingersFirst ? "finger-only" : "letter"} chord" title="Chord">${inner}</span>`;
      })
      .join("");
  let html = `<h4 aria-level="3">Notes</h4>`;
  if (d.rh?.length) html += `<p class="hand-label">Right hand</p><div class="notes">${fmt(d.rh)}</div>`;
  if (d.lh?.length) html += `<p class="hand-label">Left hand</p><div class="notes">${fmt(d.lh)}</div>`;
  if (!d.rh?.length && !d.lh?.length) html += `<p class="dim">No pitched notes in this bar.</p>`;
  return html;
}

function deepenBarCopy(d, num) {
  const tips = [];
  // The advice engine's specific tips lead; everything else is supporting info.
  if (d?.advice?.length) tips.push(...d.advice);
  else if (d?.howToPlay?.length) tips.push(...d.howToPlay);
  if (d?.expressions?.length) {
    tips.push(`Expression marks: ${d.expressions.join(", ")}.`);
  }
  if (!tips.length) {
    const rhN = d?.rh?.length || 0;
    const lhN = d?.lh?.length || 0;
    if (rhN || lhN) {
      tips.push(
        `Bar ${num} has ${rhN} right-hand and ${lhN} left-hand tones — isolate each hand slowly, then join.`
      );
    } else {
      tips.push(`Bar ${num} is quiet — use it as a breath or check your posture.`);
    }
  }
  return tips;
}

function barSectionHtml(num, d) {
  if (!d?.found) {
    return `<section class="coach-bar-block">${lettersBlock({ rh: [], lh: [] })}</section>`;
  }
  let html = `<section class="coach-bar-block">`;
  html += lettersBlock(d);

  const practice = deepenBarCopy(d, num);
  const first = practice[0] || "";
  const extra = [];
  if (practice.length > 1) extra.push(...practice.slice(1));
  if (state.showLines !== false && d.lineAdvice) {
    for (const [key, label] of [
      ["rh", "Right-hand line"],
      ["lh", "Left-hand line"],
      ["together", "Hands together"],
    ]) {
      const tips = d.lineAdvice[key] || [];
      if (tips.length) extra.push(`${label}: ${tips.join(" ")}`);
    }
  }
  if (d.split?.needed && d.split.chunks?.length) {
    extra.push(
      ...d.split.chunks.map((chunk, i) => `${chunk.hand} · chunk ${i + 1}: ${chunk.how}`)
    );
    if (d.split.practiceNotes?.length) extra.push(...d.split.practiceNotes);
  }
  if (first) {
    const open = !!window._luneAdviceOpen;
    html += `<h4 aria-level="3">How to practise it</h4><div class="coach-advice"><p>${escapeHtml(first)}</p>`;
    if (extra.length) {
      html += `<button type="button" class="coach-more-btn" data-coach-more aria-expanded="${open ? "true" : "false"}">${open ? "Less on this bar" : "More on this bar"}</button>`;
      html += `<div class="coach-advice-more"${open ? "" : " hidden"}><ul class="focus-list">${extra
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join("")}</ul></div>`;
    }
    html += `</div>`;
  }

  html += `</section>`;
  return html;
}

function refreshCoachChrome() {
  const bars = selectedBarsSorted();
  const title = $("coach-title");
  if (title) title.textContent = selectionTitle(bars);
  const kicker = document.querySelector(".coach-kicker");
  if (kicker) kicker.textContent = bars.length > 1 ? "Bars" : "Bar";
  const diff = $("coach-diff");
  if (diff) {
    const d = bars.length === 1 ? debriefFor(bars[0]) : null;
    const tag = (d?.headline || "").trim();
    diff.hidden = !tag;
    diff.textContent = tag;
  }
  const hear = $("btn-hear");
  if (hear) {
    hear.textContent = bars.length > 1 ? "Play bars" : "Play bar";
    hear.disabled = !bars.length;
  }
  const lineBtn = $("btn-line");
  if (lineBtn) lineBtn.disabled = !bars.length;
}

/** Aggregate the engraved line's bars into one focused summary. */
function lineSummaryHtml(bar) {
  const line = lineBarsFor(bar);
  if (!line || line.length < 2) return "";
  const debriefs = state.piece?.debriefs || {};
  let hardest = null;
  const tagCounts = new Map();
  for (const n of line) {
    const d = debriefFor(n) || debriefs[String(n)];
    if (!d?.found) continue;
    const score = Number(d.difficulty?.score) || 0;
    if (!hardest || score > hardest.score) hardest = { num: n, score, d };
    for (const t of d.tags || []) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  }
  if (!hardest) return "";
  const TAG_LABELS = {
    leap: "wide leaps",
    "wide-chord": "wide chords",
    chord: "chord voicing",
    chromatic: "chromatic runs",
    "scale-run": "scale runs",
    dotted: "dotted rhythms",
    syncopation: "syncopation",
    dense: "busy writing",
    grace: "grace notes",
    "thumb-black": "thumbs on black keys",
    "black-keys": "black-key terrain",
    "hands-together": "two busy hands",
    "repeat-figure": "repeated figures",
    dynamics: "dynamic shaping",
    tempo: "tempo changes",
  };
  let common = "";
  let best = 0;
  for (const [tag, count] of tagCounts) {
    if (count >= 2 && count > best) {
      best = count;
      common = TAG_LABELS[tag] || tag;
    }
  }
  const tip = hardest.d.advice?.[0] || "";
  let html = `<section class="coach-line-block"><h4 aria-level="3">This line · bars ${line[0]}\u2013${line[line.length - 1]}</h4><ul class="line-summary">`;
  html += `<li><strong>Hardest bar:</strong> bar ${hardest.num}${
    hardest.d.headline ? ` (${escapeHtml(hardest.d.headline)})` : ""
  }.</li>`;
  if (common) {
    html += `<li><strong>Running theme:</strong> ${escapeHtml(common)} across the line.</li>`;
  }
  if (tip) {
    html += `<li><strong>One focus:</strong> ${escapeHtml(tip)}</li>`;
  }
  html += `</ul></section>`;
  return html;
}

function openBarCoach() {
  const bars = selectedBarsSorted();
  openCoach();
  refreshCoachChrome();
  const body = $("help-body");
  if (!body) return;
  if (!bars.length) {
    body.innerHTML = `<p class="dim">Click any bar on the score for its notes, fingers, and practice guidance. Shift-click extends to a range.</p>`;
    return;
  }
  let html = "";
  if (bars.length > 1) {
    html += `<p class="coach-lead">Coaching covers ${escapeHtml(
      selectionTitle(bars)
    )}. \u201cPlay bars\u201d below plays just this span.</p>`;
  }
  for (const num of bars) {
    const d = debriefFor(num);
    html += barSectionHtml(num, d);
  }
  body.innerHTML = html;
  body.querySelector("[data-coach-more]")?.addEventListener("click", (e) => {
    window._luneAdviceOpen = !window._luneAdviceOpen;
    const more = body.querySelector(".coach-advice-more");
    const btn = e.currentTarget;
    if (more) more.hidden = !window._luneAdviceOpen;
    btn.setAttribute("aria-expanded", window._luneAdviceOpen ? "true" : "false");
    btn.textContent = window._luneAdviceOpen ? "Less on this bar" : "More on this bar";
  });
  keepBarVisible(bars[0]);
  window.LunePractice?.decorateCoach(bars);
}

/** Phone: the bar sheet covers the lower half — scroll the tapped bar above it. */
function keepBarVisible(num) {
  if (!num || window.innerWidth > 760) return;
  requestAnimationFrame(() => {
    try {
      const scroller = $("score-scroll");
      const b = LuneAnnotate.measureBoundsInHost?.(state.osmd, $("osmd"), num);
      if (!scroller || !b) return;
      const sheet = $("coach")?.getBoundingClientRect();
      const visibleBottom = sheet ? sheet.top : window.innerHeight * 0.54;
      const sr = scroller.getBoundingClientRect();
      const top = b.screenTop;
      const bottom = b.screenBottom;
      if (top >= sr.top + 8 && bottom <= visibleBottom - 8) return;
      scroller.scrollBy({ top: top - sr.top - 16, behavior: "smooth" });
    } catch {
      /* keep the current scroll */
    }
  });
}

function openCoach() {
  const coach = $("coach");
  if (coach) coach.hidden = false;
  state.coachOpen = true;
  document.body.classList.add("coach-open");
}
function closeCoach() {
  const coach = $("coach");
  if (coach) coach.hidden = true;
  state.coachOpen = false;
  document.body.classList.remove("coach-open");
  if (state.selectedBars?.length) clearBarSelection({ close: false });
  requestAnimationFrame(() => paintSelectionHilites());
}

async function askPlan() {
  const bars = selectedBarsSorted();
  if (!bars.length) {
    toast("Pick a bar first");
    return;
  }
  // Built locally from the bar data already loaded (same steps the server used).
  const plan = LuneLite.practicePlan(state.piece, bars);
  openCoach();
  refreshCoachChrome();
  let html = `<h3>Practice · ${escapeHtml(selectionTitle(bars))}</h3>`;
  for (const num of bars) {
    html += lettersBlock(debriefFor(num) || { rh: [], lh: [] });
  }
  html += `<h4 aria-level="3">Session</h4><ul>${(plan.steps || [])
    .map((s) => `<li><strong>${escapeHtml(s.title)}</strong> (${s.minutes}m) — ${escapeHtml(s.detail)}</li>`)
    .join("")}</ul>`;
  $("help-body").innerHTML = html;
}

function downloadScore() {
  const xml = state.rawMusicxml || state.piece?.musicxml;
  if (!xml) return toast("Nothing to download");
  const blob = new Blob([xml], { type: "application/vnd.recordare.musicxml+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = state.piece.downloadName || "lune-score.musicxml";
  a.click();
  URL.revokeObjectURL(url);
  toast("Downloaded");
}
window.downloadScore = downloadScore;

async function openFile(file) {
  if (!file) return;
  await withLoader(`Opening ${file.name}`, async () => {
    const isNotation = /\.(musicxml|xml|mxl)$/i.test(file.name || "");
    // With a server (desktop app / local run), PDFs and photos still go to it.
    if (!LUNE_ON_PAGES && !isNotation) {
      try {
        const form = new FormData();
        form.append("file", file, file.name);
        const res = await fetch(luneUrl("/api/piece"), { method: "POST", body: form });
        if (res.ok) {
          await landOnDiscover(await res.json());
          return;
        }
      } catch {
        /* fall through to the in-browser reader and its explanation */
      }
    }
    try {
      const xml = await LuneLite.readScoreFile(file);
      const piece = LuneLite.analyze(xml, { filename: file.name });
      await window.LunePractice?.onUploadOpened(piece, xml);
      await openPieceSession(piece, { panel: "score" });
      setRoute(piece, "score");
    } catch (err) {
      const friendly =
        err instanceof LuneLite.LiteError
          ? err.message
          : "Couldn’t open this file. Export it again as MusicXML (.musicxml) and try once more.";
      toast(friendly);
    }
  });
}

/* ---------- shareable links: #/<piece-id>/<tab> ---------- */

function pieceRouteId(piece) {
  if (!piece || piece.local) return "";
  if (piece.id) return piece.id;
  const q = piece.openQuery || piece.title || "";
  return normSearch(q).replace(/\s+/g, "-").slice(0, 80);
}

let routeApplying = false;
function setRoute(piece, panel, { replace = false } = {}) {
  if (routeApplying) return;
  const id = pieceRouteId(piece);
  const hash = piece?.local ? "#/your-score" : id ? `#/${id}/${panel || "explain"}` : "";
  const title = piece ? `${piece.overview?.title || piece.title || "Score"} — Lune` : "Lune — so practice feels right again";
  document.title = title;
  if (location.hash === hash) return;
  const url = `${location.pathname}${location.search}${hash}`;
  try {
    if (replace) history.replaceState({ lune: hash }, title, url);
    else history.pushState({ lune: hash }, title, url);
  } catch {
    /* file:// or sandboxed — links just don't update */
  }
}

function parseRoute() {
  const m = (location.hash || "").match(/^#\/([^/]+)(?:\/(score|explain|piano))?/);
  if (!m) return null;
  return { id: decodeURIComponent(m[1]), panel: m[2] || "explain" };
}

async function applyRoute() {
  if (window.LunePractice?.handleRoute(location.hash)) return;
  const r = parseRoute();
  routeApplying = true;
  try {
    if (!r) {
      if (!$("home") || $("home").hidden) goHome({ keepTabs: true });
      document.title = "Lune — so practice feels right again";
      return;
    }
    if (window.LuneOnboard && !LuneOnboard.requirePieceAccess?.(r.id)) {
      goHome({ keepTabs: true });
      return;
    }
    if (r.id === "your-score") {
      const s = state.sessions.find((x) => x.piece?.local);
      if (s) await activateSession(s.id);
      else {
        goHome({ keepTabs: true });
        toast("Uploaded scores stay on the device they were opened on — upload it again here.");
      }
      return;
    }
    const open = state.sessions.find((x) => sessionRouteId(x) === r.id);
    if (open) {
      if (open.id !== state.activeSessionId) await activateSession(open.id);
      else showView("studio");
      if (r.panel === "score") await switchToScorePanel();
      else setStudioPanel(r.panel);
      return;
    }
    // static site: exact catalogue id; local server: let it resolve the words
    const piece = await withLoader("Finding the score", () =>
      tryOpen(LUNE_ON_PAGES ? { query: r.id } : { query: r.id.replace(/-/g, " "), title: "" })
    );
    if (!piece || piece.kind !== "score") {
      goHome({ keepTabs: true });
      toast("That link points to a score Lune doesn’t have any more — search for it instead.");
      return;
    }
    await openPieceSession(piece, { panel: r.panel === "score" ? "explain" : r.panel });
    if (r.panel === "score") await switchToScorePanel();
  } finally {
    routeApplying = false;
    const active = activeSession();
    if (active && r) document.title = `${active.piece?.overview?.title || active.piece?.title || "Score"} — Lune`;
  }
}

function goHome({ keepTabs = false, forceApp = false } = {}) {
  // Signed-in users always get the personal home — never bounce back into the gate.
  const signedIn = !!window.LuneOnboard?.signedIn?.();
  if (!forceApp && window.LuneOnboard && !LuneOnboard.unlocked() && !signedIn) {
    LuneOnboard.route();
    return;
  }
  stopAll();
  closeCoach();
  snapshotActiveSession();
  state.mode = "home";
  showView("home");
  window.LuneOnboard?.paintSignedHome?.();
  window.LuneOnboard?.applyGateChrome?.();
  if (!keepTabs) renderPieceTabs();
  if (!routeApplying && location.hash) {
    try {
      history.pushState({ lune: "" }, "Lune", `${location.pathname}${location.search}`);
    } catch {
      /* ignore */
    }
    document.title = "Lune — so practice feels right again";
  }
}

function bind() {
  const on = (id, event, handler) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener(event, handler);
  };

  on("top-search", "submit", (e) => {
    e.preventDefault();
    search($("q").value, { openBest: true });
  });
  document.getElementById("hero-chips")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-open-piece]");
    if (!b) return;
    if (window.LuneOnboard && !LuneOnboard.requirePieceAccess?.(b.dataset.openPiece)) return;
    try {
      history.pushState({ lune: b.dataset.openPiece }, "", `${location.pathname}${location.search}#/${b.dataset.openPiece}/explain`);
    } catch {
      location.hash = `#/${b.dataset.openPiece}/explain`;
      return;
    }
    applyRoute().catch((err) => toast(err.message));
  });
  // Member recs / chapter CTAs that open catalogue pieces by id
  document.getElementById("home")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-open-piece]");
    if (!b || b.closest("#hero-chips")) return;
    if (window.LuneOnboard && !LuneOnboard.requirePieceAccess?.(b.dataset.openPiece)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    const id = b.dataset.openPiece;
    // The landing's "Open Clair de lune" goes straight to the page of music.
    const panel = b.dataset.openPanel === "score" ? "score" : "explain";
    try {
      history.pushState({ lune: id }, "", `${location.pathname}${location.search}#/${id}/${panel}`);
    } catch {
      location.hash = `#/${id}/${panel}`;
      return;
    }
    applyRoute().catch((err) => toast(err.message));
  });
  on("q", "input", () => {
    // Sync filter+render (~1–3ms). No debounce, no rAF, no network.
    paintSearch($("q").value || "");
  });
  on("q", "focus", () => {
    ensureSearchIndex();
  });
  // Arrow keys walk the typeahead; Enter opens the highlighted hit.
  on("q", "keydown", (e) => {
    const box = $("results");
    if (!box || box.hidden) return;
    const items = [...box.querySelectorAll("button.result:not(.result-empty)")];
    if (!items.length) return;
    const activeIdx = items.findIndex((el) => el.classList.contains("is-active"));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      const next = activeIdx < 0
        ? (dir > 0 ? 0 : items.length - 1)
        : (activeIdx + dir + items.length) % items.length;
      items.forEach((el, i) => el.classList.toggle("is-active", i === next));
      items[next].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      items[activeIdx].click();
    }
  });
  // Prefetch the free-score index so the first keystroke is already local.
  ensureSearchIndex();
  on("btn-search", "click", () => {
    const next = !document.body.classList.contains("phone-search-open");
    document.body.classList.toggle("phone-search-open", next);
    $("btn-search")?.setAttribute("aria-expanded", next ? "true" : "false");
    if (next) $("q")?.focus();
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".top-search") && !e.target.closest(".results")) {
      closeSearchResults();
      if (!e.target.closest(".piece-tab-add")) {
        document.body.classList.remove("studio-search-open");
      }
      if (!e.target.closest("#btn-search")) {
        document.body.classList.remove("phone-search-open");
        $("btn-search")?.setAttribute("aria-expanded", "false");
      }
    }
  });
  /* Global keyboard shortcuts — Space play/pause, arrows seek a bar, Esc closes. */
  const SHORTCUTS_HINT = "Space play/pause · \u2190 \u2192 seek a bar · Esc closes panels";

  async function seekByBars(delta) {
    if (!state.piece?.debriefs) return;
    if (!LunePiano.hasTimeline() || state.timelineKind !== "piece") {
      const ok = await ensurePieceTimeline();
      if (!ok) return;
    }
    const marks = LunePiano.barMarkers?.() || [];
    if (!marks.length) return;
    const cur = Number(LunePiano.currentBar?.() ?? marks[0].bar);
    let idx = marks.findIndex((m) => Number(m.bar) === cur);
    if (idx < 0) idx = 0;
    const next = Math.max(0, Math.min(marks.length - 1, idx + delta));
    state.snippetEnd = null;
    LunePiano.seekToBar?.(marks[next].bar, { resumeIfWasPlaying: true });
    syncPlayButton();
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (document.querySelector(".lune-menu.is-open")) return;
      if (state.coachOpen) {
        const inPanel = $("coach")?.contains(document.activeElement) || document.activeElement === document.body;
        closeCoach();
        // keyboard users land back on the score, where the arrow keys pick the next bar
        if (inPanel || document.activeElement === $("score-scroll")) $("score-scroll")?.focus({ preventScroll: true });
        e.preventDefault();
        return;
      }
      closeSearchResults({ blur: true });
      return;
    }
    // Never steal keys from typing or focused controls.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t?.closest?.("input, textarea, select, button, a, label, [contenteditable]")) return;
    if (!document.body.classList.contains("is-studio")) return;
    if (e.code === "Space") {
      e.preventDefault();
      togglePlayback().catch((err) => toast(err.message));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      seekByBars(1).catch(() => {});
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      seekByBars(-1).catch(() => {});
    } else if (e.key === "?") {
      toast(SHORTCUTS_HINT);
    }
  });

  on("btn-home", "click", () => goHome());
  on("btn-nav-back", "click", () => studioNavBack());
  on("btn-nav-fwd", "click", () => studioNavForward());
  on("btn-open", "click", () => $("file")?.click());
  on("btn-home-upload", "click", () => $("file")?.click());
  on("btn-discover-home", "click", () => goHome());
  on("btn-open-piece", "click", () => openPieceFromDiscover().catch((e) => toast(e.message)));
  on("btn-open-piece-bottom", "click", () => openPieceFromDiscover().catch((e) => toast(e.message)));
  on("btn-explain-score", "click", () => switchToScorePanel().catch((e) => toast(e.message)));
  on("btn-explain-piano", "click", () => {
    // Open Score with keyboard dock — keep the page visible
    state.keyboardVisible = true;
    setStudioPanel("score", { skipScore: true });
    if (state.piece?.musicxml) {
      ensureScoreReady()
        .then(() => applyKeyboardVisibility(true))
        .catch((e) => toast(e.message || String(e)));
    } else {
      applyKeyboardVisibility(true);
    }
  });
  on("tab-score", "click", () => {
    // Switch chrome instantly; prepare score in the background if needed.
    setStudioPanel("score", { skipScore: true });
    if (state.piece?.musicxml) {
      ensureScoreReady().catch((e) => toast(e.message || String(e)));
    }
  });
  on("tab-explain", "click", () => {
    stopAll();
    setStudioPanel("explain");
  });
  on("tab-piano", "click", () => {
    setStudioPanel("piano");
  });

  on("btn-play-range", "click", () => {
    togglePlayback().catch((e) => toast(e.message));
  });
  on("btn-stop", "click", (e) => {
    e.preventDefault();
    stopAll();
  });
  on("btn-toggle-kbd", "click", () => {
    // go by what is on screen, not a remembered flag that may be stale
    const dock = $("piano-dock");
    setKeyboardVisible(!dock || dock.hidden);
  });
  on("btn-hide-kbd", "click", () => {
    if (state.panel === "piano") setStudioPanel("score");
    else setKeyboardVisible(false);
  });

  const scrub = $("scrub");
  if (scrub) {
    scrub.addEventListener("pointerdown", () => {
      state.scrubbing = true;
      scrub.classList.add("scrubbing");
      // Pause while dragging so the ear matches the cursor
      if (LunePiano.isPlaying()) {
        state.resumeAfterScrub = true;
        LunePiano.pause();
        syncPlayButton();
      } else {
        state.resumeAfterScrub = false;
      }
    });
    const previewScrub = (ratio) => {
      state.scrubRatio = ratio;
      const total = LunePiano.duration() || 0;
      if (total > 0 && LunePiano.hasTimeline()) {
        const at = ratio * total;
        let bar = LunePiano.currentBar();
        const marks = LunePiano.barMarkers?.() || [];
        for (const m of marks) {
          if (m.t <= at + 0.01) bar = m.bar;
        }
        onPianoKeys({ active: LunePiano.activeAt?.(at) || [], changed: true });
        updateScrub({ progress: at, total, bar });
      } else {
        // Timeline not armed yet — show scrub position; bars fill in after arm
        updateScrub({
          progress: 0,
          total: 0,
          bar: null,
        });
        if (scrub) scrub.value = String(Math.round(ratio * 1000));
      }
    };
    const endScrub = () => {
      if (!state.scrubbing) return;
      state.scrubbing = false;
      scrub.classList.remove("scrubbing");
      commitScrub(Number(scrub.value) / 1000);
    };
    const commitScrub = (ratio) => {
      state.scrubRatio = ratio;
      if (LunePiano.hasTimeline()) {
        LunePiano.seek(ratio, { resumeIfWasPlaying: false });
        if (state.resumeAfterScrub) {
          LunePiano.resume();
          state.resumeAfterScrub = false;
        }
        syncPlayButton();
        return;
      }
      if (!state.piece?.debriefs) return;
      // Arm full piece so the scrub position is ready for Play
      ensurePieceTimeline(ratio)
        .then(() => {
          if (state.resumeAfterScrub) {
            LunePiano.resume();
            state.resumeAfterScrub = false;
          }
          syncPlayButton();
        })
        .catch((e) => toast(e.message));
    };
    scrub.addEventListener("pointerup", endScrub);
    scrub.addEventListener("pointercancel", endScrub);
    scrub.addEventListener("change", () => {
      if (state.scrubbing) endScrub();
      else commitScrub(Number(scrub.value) / 1000);
    });
    scrub.addEventListener("input", () => {
      previewScrub(Number(scrub.value) / 1000);
    });
  }

  bindPlayheadScrub();

  setPlayRate(1);
  syncTempoUi();
  on("btn-metro", "click", () => {
    toggleMetronome().catch((e) => toast(e.message || String(e)));
  });
  const bpmSlider = $("bpm-slider");
  if (bpmSlider) {
    bpmSlider.addEventListener("input", () => {
      setPracticeBpm(Number(bpmSlider.value), { rebuild: true });
    });
    bpmSlider.addEventListener("change", () => {
      setPracticeBpm(Number(bpmSlider.value), { rebuild: true });
    });
  }
  window.addEventListener("resize", () => {
    if (state.panel === "piano") window.LuneTutorial?.resize?.();
  });
  syncPlayButton();
  try {
    LunePiano.setKeysHandler?.(onPianoKeys);
  } catch {
    /* ignore */
  }
  bindHomeChapters();
  renderPieceTabs();
  syncKbdToggleUi();

  on("tog-letters", "change", (e) => {
    // Letters/Fingers are mutually exclusive — only one overlay type at a time.
    if (e.target.checked) {
      state.scoreLetters = true;
      state.scoreFingers = false;
      const other = $("tog-fingers");
      if (other) {
        other.checked = false;
        other.closest(".tog")?.classList.remove("on");
      }
    } else {
      state.scoreLetters = false;
    }
    e.target.closest(".tog")?.classList.toggle("on", e.target.checked);
    syncAnnoSegUi();
    snapshotActiveSession();
    refreshScoreAnnotations();
  });
  on("tog-fingers", "change", (e) => {
    // Letters/Fingers are mutually exclusive — only one overlay type at a time.
    if (e.target.checked) {
      state.scoreFingers = true;
      state.scoreLetters = false;
      const other = $("tog-letters");
      if (other) {
        other.checked = false;
        other.closest(".tog")?.classList.remove("on");
      }
    } else {
      state.scoreFingers = false;
    }
    e.target.closest(".tog")?.classList.toggle("on", e.target.checked);
    syncAnnoSegUi();
    snapshotActiveSession();
    refreshScoreAnnotations();
  });

  function syncAnnoSegUi() {
    const mode = state.scoreFingers ? "fingers" : state.scoreLetters ? "notes" : "off";
    ["notes", "fingers", "off"].forEach((v) => {
      const el = $(`anno-${v}`);
      if (!el) return;
      el.checked = mode === v;
      el.closest(".anno-opt")?.classList.toggle("on", mode === v);
    });
    const letterEl = $("tog-letters");
    const fingerEl = $("tog-fingers");
    if (letterEl) {
      letterEl.checked = !!state.scoreLetters;
      letterEl.closest(".tog")?.classList.toggle("on", !!state.scoreLetters);
    }
    if (fingerEl) {
      fingerEl.checked = !!state.scoreFingers;
      fingerEl.closest(".tog")?.classList.toggle("on", !!state.scoreFingers);
    }
  }

  function applyAnnoMode(mode) {
    if (mode === "fingers") {
      state.scoreFingers = true;
      state.scoreLetters = false;
    } else if (mode === "notes") {
      state.scoreLetters = true;
      state.scoreFingers = false;
    } else {
      state.scoreLetters = false;
      state.scoreFingers = false;
    }
    syncAnnoSegUi();
    snapshotActiveSession();
    refreshScoreAnnotations();
  }

  ["anno-notes", "anno-fingers", "anno-off"].forEach((id) => {
    on(id, "change", (e) => {
      if (!e.target.checked) return;
      applyAnnoMode(e.target.value || "off");
    });
  });
  // Sync toggles: HTML checked attrs are the source of truth at boot.
  // Letters/Fingers stay mutually exclusive if markup ever has both checked.
  const letterEl = $("tog-letters");
  const fingerEl = $("tog-fingers");
  if (letterEl && fingerEl && letterEl.checked && fingerEl.checked) {
    fingerEl.checked = false;
  }
  if (letterEl) state.scoreLetters = !!letterEl.checked;
  if (fingerEl) state.scoreFingers = !!fingerEl.checked;
  // Prefer visible segmented control if present
  const annoNotes = $("anno-notes");
  const annoFingers = $("anno-fingers");
  const annoOff = $("anno-off");
  if (annoNotes || annoFingers || annoOff) {
    if (annoFingers?.checked) {
      state.scoreFingers = true;
      state.scoreLetters = false;
    } else if (annoOff?.checked) {
      state.scoreLetters = false;
      state.scoreFingers = false;
    } else {
      state.scoreLetters = true;
      state.scoreFingers = false;
    }
  }
  syncAnnoSegUi();
  ["tog-letters", "tog-fingers"].forEach((id) => {
    const el = $(id);
    if (el) el.closest(".tog")?.classList.toggle("on", !!el.checked);
  });

  on("btn-hear", "click", () => playSelectedBars().catch((e) => toast(e.message)));
  on("btn-line", "click", () => playSelectedLine().catch((e) => toast(e.message)));
  document.addEventListener("click", (e) => {
    if (e.target.closest?.("#btn-plan")) askPlan().catch((err) => toast(err.message));
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-open-credits]");
    if (b) openCredits(b.getAttribute("data-open-credits"));
  });
  $("credits-dialog")?.addEventListener("click", (e) => {
    if (e.target === $("credits-dialog")) $("credits-dialog").close();
  });
  on("coach-close", "click", closeCoach);
  on("coach-clear", "click", () => clearBarSelection({ close: true }));
  on("file", "change", () => {
    if (window.LuneOnboard && !LuneOnboard.requireUnlock()) {
      $("file").value = "";
      return;
    }
    const f = $("file").files?.[0];
    $("file").value = "";
    if (f) openFile(f).catch((e) => toast(e.message));
  });

  // Piano tutorial + audio/keyboard hand filter
  const setTutHand = (mode) => {
    window.LuneTutorial?.setHandFilter?.(mode);
    window.LunePiano?.setHandFilter?.(mode);
    ["both", "rh", "lh"].forEach((m) => {
      const el = $(`tut-hand-${m}`);
      if (!el) return;
      const on = m === mode;
      el.classList.toggle("on", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    });
  };
  on("tut-hand-both", "click", () => setTutHand("both"));
  on("tut-hand-rh", "click", () => setTutHand("rh"));
  on("tut-hand-lh", "click", () => setTutHand("lh"));
}

window.goHome = goHome;
window.openPieceSession = openPieceSession;
window.toast = toast;
window.showView = showView;

// Lune decides where each view starts; the browser must not drop a reload mid-page
try {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
} catch {
  /* older browsers */
}

try {
  bind();
  window.addEventListener("popstate", () => applyRoute().catch(() => {}));
  // keep each tab's last panel for the next visit
  window.addEventListener("pagehide", () => {
    snapshotActiveSession();
    saveTabs();
  });
  // Repertoire / study / onboard modules load after this file.
  const boot = async () => {
    try {
      await window.LuneStore?.init?.();
    } catch (e) {
      console.warn("[lune] store init", e);
    }
    restoreTabs();
    window.LuneOnboard?.init?.();
    window.LuneImpact?.init?.();
    const gate = window.LuneOnboard?.route?.() || "app";
    window.LunePractice?.init().catch((e) => console.warn("[lune] practice init", e));
    if (gate === "hello") {
      // Post-sign-in welcome is already showing — don't overwrite with guest home.
      return;
    }
    if (window.LuneImpact?.handleRoute?.()) return;
    if (gate === "app") {
      showView("home");
      window.LuneOnboard?.paintHomeRecs?.();
      window.LuneOnboard?.applyGateChrome?.();
      window.LuneImpact?.paintHomeImpact?.();
      if (parseRoute()) applyRoute().catch(() => {});
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
} catch (err) {
  console.error("Lune bind failed", err);
  const t = document.getElementById("toast");
  if (t) {
    t.hidden = false;
    t.textContent = "UI failed to start — hard-refresh the page.";
  }
}
