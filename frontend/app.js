/* Lune — multi-piece studio: Score · Explain · Piano */

const $ = (id) => document.getElementById(id);
pdfjsLib.GlobalWorkerOptions.workerSrc = "/static/vendor/pdf.worker.min.js";

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
};
const COMPOSER_FACE_V = "fix67";
const COMPOSER_SILHOUETTE = `/static/assets/composers/silhouette.svg?v=${COMPOSER_FACE_V}`;

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
  const home = $("home");
  const discover = $("discover");
  const studio = $("studio");
  if (home) home.hidden = name !== "home";
  if (discover) discover.hidden = name !== "discover";
  if (studio) studio.hidden = name !== "studio";
  document.body.classList.toggle("is-home", name === "home");
  document.body.classList.toggle("is-discover", name === "discover");
  document.body.classList.toggle("is-studio", name === "studio");
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
const SEARCH_INDEX_URL = "/static/search-index.json?v=fix67";
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

function scoreIndexEntry(q, entry) {
  // Scoring must stay cheap on broad queries (bach/chopin match hundreds of rows).
  // Never re-run unicode normalize here — `hay` is already normalized server-side.
  const hay = entry.hay || "";
  let score = 0;
  const queryRaw = String(entry.query || "").toLowerCase();
  const group = entry.group || "";

  if (queryRaw) {
    if (queryRaw === q) score += 22;
    else if (queryRaw.includes(q) || q.includes(queryRaw)) score += 12;
  }
  if (hay.includes(q)) {
    score = Math.max(score, 8);
    // Prefer title-ish hits: query appears early in hay (title is first).
    if (hay.startsWith(q) || hay.indexOf(q) < 48) score += 10;
  }
  for (const t of q.split(" ")) {
    if (t.length > 1 && hay.includes(t)) score += 3;
  }
  if (group.startsWith("Featured") || group.startsWith("Open MusicXML")) score += 12;
  else if (
    group.startsWith("Beethoven piano") ||
    group.startsWith("Mozart piano") ||
    group.startsWith("Chopin") ||
    group.startsWith("Haydn piano")
  ) {
    score += 8;
  } else if (group.startsWith("Bach chorales") || group.startsWith("music21")) {
    score -= 3;
  }
  return score;
}

function filterSearchIndex(query, limit = SEARCH_LIMIT, index = activeSearchIndex()) {
  const q = normSearch(query);
  if (q.length < 2 || !index || !index.length) return [];
  const tokens = q.split(" ").filter((t) => t.length > 1);
  // Keep only a small top band while scanning — avoid sorting hundreds of chorale hits.
  const band = limit * 4;
  const scored = [];
  for (const entry of index) {
    const hay = entry.hay || "";
    if (!(hay.includes(q) || tokens.some((t) => hay.includes(t)))) continue;
    const score = scoreIndexEntry(q, entry);
    if (score < 6) continue;
    scored.push({ score, entry });
    if (scored.length > band * 3) {
      // Occasional trim so broad queries (bach) don't accumulate 400+ rows.
      scored.sort((a, b) => b.score - a.score);
      scored.length = band;
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const results = [];
  for (const { entry } of scored) {
    const key = `${entry.title}\0${entry.composer}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      kind: "work",
      id: `free-${entry.query}`,
      title: entry.title,
      composer: entry.composer,
      subtitle: `Free score · ${entry.group || ""}`,
      epoch: "",
      portrait: "",
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

async function tryOpen(body) {
  try {
    const res = await fetch("/api/search/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
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
    .replace(/[\u0300-\u036f]/g, "");
  if (!n) return "";
  if (n.includes("rimsky")) return "rimsky";
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
  return file ? `/static/assets/composers/${file}?v=${COMPOSER_FACE_V}` : "";
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

function shortPieceTitle(title) {
  const t = String(title || "Untitled").trim();
  if (t.length <= 28) return t;
  return `${t.slice(0, 26).trim()}…`;
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

function renderPieceTabs() {
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

  // Single piece: quiet title, no tab chrome — keep a lone + to open another.
  const multi = n >= 2;
  if (quiet) {
    const active = activeSession();
    const title =
      active?.shortTitle ||
      shortPieceTitle(active?.piece?.title || active?.piece?.overview?.title || "");
    quiet.textContent = title;
    quiet.hidden = multi || !document.body.classList.contains("is-studio");
    quiet.title = active?.piece?.title || title;
  }
  host.hidden = false;

  const frag = document.createDocumentFragment();
  if (multi) {
    for (const s of state.sessions) {
      const tab = document.createElement("div");
      tab.className = "piece-tab" + (s.id === state.activeSessionId ? " on" : "");
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", s.id === state.activeSessionId ? "true" : "false");
      const composerName =
        s.piece?.overview?.composer || s.piece?.composer || "";
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
      btn.addEventListener("click", () => {
        activateSession(s.id).catch((e) => toast(e.message));
      });
      const close = document.createElement("button");
      close.type = "button";
      close.className = "piece-tab-close";
      close.setAttribute("aria-label", `Close ${s.shortTitle}`);
      close.textContent = "×";
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        closeSession(s.id).catch((err) => toast(err.message));
      });
      tab.appendChild(face);
      tab.appendChild(btn);
      tab.appendChild(close);
      frag.appendChild(tab);
    }
  }
  const add = document.createElement("button");
  add.type = "button";
  add.className = "piece-tab-add";
  add.title = "Open another piece";
  add.setAttribute("aria-label", "Open another piece");
  add.textContent = "+";
  add.addEventListener("click", openStudioSearch);
  frag.appendChild(add);
  host.appendChild(frag);
  if (!multi) {
    host.classList.add("piece-tabs-solo");
  } else {
    host.classList.remove("piece-tabs-solo");
  }
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

function buildExplainChapters(piece, { canOpen }) {
  const o = piece.overview || {};
  const composer = o.composer || piece.composer || "";
  const era = o.era || o.epoch || "";
  const ci = o.composerInfo || {};
  return [
    {
      label: "Composer",
      title: `About ${ci.name || composer || "the composer"}`,
      body: ci.full || ci.bio || ci.hook || "Composer story loading…",
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
      title: `Era · ${(o.eraInfo && o.eraInfo.label) || era || "Style"}`,
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
  const era = o.era || o.epoch || "";
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

}

function setStudioPanel(panel, { skipScore = false } = {}) {
  const next = ["score", "explain", "piano"].includes(panel) ? panel : "explain";
  state.panel = next;
  state.mode = next === "explain" ? "ask" : next === "score" ? "listen" : "piano";
  const s = activeSession();
  if (s) s.panel = next;

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

  const dock = $("studio-dock");
  if (dock) dock.hidden = !(next === "score" || next === "piano");

  if ($("stage-label")) {
    $("stage-label").textContent =
      next === "score" ? "Score" : next === "explain" ? "Explain" : "Piano";
  }

  // Piano tab = keyboard focus mode (always show). Score = optional dock.
  if (next === "piano") {
    state.keyboardVisible = true;
    applyKeyboardVisibility(true);
  } else if (next === "score") {
    applyKeyboardVisibility(!!state.keyboardVisible);
  } else {
    applyKeyboardVisibility(false);
  }

  if (next === "explain") {
    renderExplainPanel(state.piece);
  }

  if (next === "score") {
    requestAnimationFrame(() => {
      paintSelectionHilites();
    });
  }

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
      const full = await (prefetchAnalysis(state.piece) || tryOpen({
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
      if (full && full.kind === "score" && full.musicxml) {
        state.piece = full;
        state.rawMusicxml = full.musicxml || "";
        const s = activeSession();
        if (s) {
          s.piece = full;
          s.rawMusicxml = full.musicxml || "";
          s.shortTitle = shortPieceTitle(full.title || full.overview?.title);
        }
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
    return true;
  });
}

async function openPieceSession(piece, { panel = "explain" } = {}) {
  snapshotActiveSession();
  stopAll();
  closeCoach();
  const session = createSession(piece, panel);
  state.sessions.push(session);
  state.activeSessionId = session.id;
  applySessionToState(session);
  fillPieceChrome(piece);
  renderPieceTabs();
  showView("studio");
  setStudioPanel(panel, { skipScore: true });
  renderExplainPanel(piece);
  syncOpenButtons(piece);
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
  snapshotActiveSession();
  stopAll();
  closeCoach();
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return;
  state.activeSessionId = id;
  applySessionToState(s);
  fillPieceChrome(s.piece);
  renderPieceTabs();
  syncOpenButtons(s.piece);
  showView("studio");
  setStudioPanel(s.panel || "explain", { skipScore: true });
  if ((s.panel || "explain") === "score" && s.piece?.musicxml) {
    await renderScore();
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

function collectNotes(fromBar, toBar) {
  const notes = [];
  const debriefs = state.piece?.debriefs || {};
  let barCursor = 0;
  for (let b = fromBar; b <= toBar; b++) {
    const d = debriefFor(b) || debriefs[String(b)];
    const pack = d?.playback || [...(d?.rh || []), ...(d?.lh || [])];
    const localMax = Math.max(0, ...pack.map((n) => Number(n.offset) || 0));
    for (const n of pack) {
      if (!n.midi) continue;
      notes.push({ ...n, absOffset: barCursor + (Number(n.offset) || 0), bar: b });
    }
    barCursor += Math.max(localMax + 1, 1);
  }
  return notes;
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
    LunePiano.arm(notes, { ...playbackHandlers(), from: ratio });
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
      scrub.value = String(Math.round((progress / total) * 1000));
      state.scrubRatio = progress / total;
    } else if (total <= 0) {
      scrub.value = "0";
      state.scrubRatio = 0;
    }
  }
  const timeEl = $("scrub-time");
  const barEl = $("scrub-bar");
  if (timeEl) timeEl.textContent = `${fmtTime(progress)} / ${fmtTime(total)}`;
  if (barEl) barEl.textContent = bar ? `Bar ${bar}` : "Bar —";
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
  if (playBtn) {
    playBtn.textContent = label;
    playBtn.setAttribute("aria-label", aria);
  }
  // Stop stays visible in the dock (MuseScore-like); disabled when idle at start
  const stop = $("btn-stop");
  if (stop) {
    const canStop =
      LunePiano.isPlaying() ||
      (LunePiano.hasTimeline() && LunePiano.progress() > 0.02);
    stop.disabled = !canStop;
    stop.setAttribute("aria-disabled", canStop ? "false" : "true");
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

let _playheadScrollAt = 0;
let _playheadLastBar = null;

function placePlayhead(bar, progress = 0, total = 0) {
  const line = $("playhead-line");
  const hilite = $("measure-hilite");
  if (!line) return;

  const hide = () => {
    line.hidden = true;
    line.classList.remove("on");
    line.style.transform = "";
    line.style.height = "";
    line.style.top = "";
    if (hilite) {
      hilite.hidden = true;
      hilite.style.cssText = "";
    }
    _playheadLastBar = null;
  };

  if (!bar && !(total > 0)) {
    hide();
    return;
  }

  // Prefer OSMD measure geometry when the score is on stage
  const host = $("osmd");
  const scroll = $("score-scroll");
  const bounds =
    state.osmd && host && !host.hidden
      ? LuneAnnotate.measureBoundsInHost?.(state.osmd, host, bar)
      : null;

  if (bounds && scroll && state.panel === "score") {
    const local = barLocalRatio(bar, progress);
    const x = bounds.left + Math.max(2, Math.min(bounds.width - 2, local * bounds.width));
    line.hidden = false;
    line.classList.add("on");
    line.style.top = `${Math.max(0, bounds.top - 4)}px`;
    line.style.height = `${bounds.height + 8}px`;
    line.style.left = "0";
    line.style.transform = `translateX(${x}px)`;

    if (hilite) {
      hilite.hidden = false;
      hilite.style.left = `${bounds.left}px`;
      hilite.style.top = `${bounds.top}px`;
      hilite.style.width = `${bounds.width}px`;
      hilite.style.height = `${bounds.height}px`;
    }

    // Auto-follow when the sounding measure leaves the viewport (throttled)
    const now = performance.now();
    const barChanged = _playheadLastBar !== Number(bar);
    _playheadLastBar = Number(bar);
    if (barChanged || now - _playheadScrollAt > 280) {
      const pad = 56;
      const viewTop = scroll.scrollTop;
      const viewBottom = viewTop + scroll.clientHeight;
      const mTop = bounds.top;
      const mBottom = bounds.top + bounds.height;
      let nextTop = scroll.scrollTop;
      let nextLeft = scroll.scrollLeft;
      let moved = false;
      if (mTop < viewTop + pad) {
        nextTop = Math.max(0, mTop - pad);
        moved = true;
      } else if (mBottom > viewBottom - pad) {
        nextTop = Math.max(0, mBottom - scroll.clientHeight + pad);
        moved = true;
      }
      const viewLeft = scroll.scrollLeft;
      const viewRight = viewLeft + scroll.clientWidth;
      if (x < viewLeft + pad) {
        nextLeft = Math.max(0, x - pad);
        moved = true;
      } else if (x > viewRight - pad) {
        nextLeft = Math.max(0, x - scroll.clientWidth + pad);
        moved = true;
      }
      if (moved) {
        _playheadScrollAt = now;
        // Cinematic follow: always glide, never jump (unless the user asked for calm).
        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
        scroll.scrollTo({
          top: nextTop,
          left: nextLeft,
          behavior: reduced ? "auto" : "smooth",
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
  line.style.transform = `translateX(${x}px)`;
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
      line.classList.remove("on");
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
  btn.textContent = on ? "Hide" : "Keys";
  btn.classList.toggle("on", on);
}

function applyKeyboardVisibility(on) {
  const dock = $("piano-dock");
  if (!dock) return;
  const show =
    (state.panel === "piano" && on !== false) ||
    (state.panel === "score" && !!on);
  if (state.panel === "score") state.keyboardVisible = !!on;
  if (state.panel === "piano") state.keyboardVisible = true;

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
  if (!state.keyboardVisible && state.panel !== "piano") return;
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
}

function bindHomeChapters() {
  const chapters = document.querySelectorAll(".home-chapter");
  if (!chapters.length || typeof IntersectionObserver === "undefined") {
    chapters.forEach((el) => el.classList.add("is-in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      }
    },
    { root: $("home") || null, threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
  );
  chapters.forEach((el) => io.observe(el));
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

function applyScoreOverlays() {
  const host = $("osmd");
  if (!host || !state.osmd) return;
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
      } catch {
        /* keep the last good engraving */
      }
    }, 160);
  });
  state.__scoreWidthObserver.observe(host);
}

async function renderScore() {
  const base = state.rawMusicxml || state.piece?.musicxml || "";
  if (!base) return;
  const wantLetters = !!state.scoreLetters;
  const wantFingers = !!state.scoreFingers;
  // MusicXML fingers unused for display (drawFingerings:false); keep annotate
  // path for compatibility. Letters are always SVG overlays.
  const xml = LuneAnnotate.annotate(base, state.piece.debriefs || {}, {
    fingers: wantFingers,
    letters: false,
  });
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
    drawLyrics: false,
    drawFingerings: false, // custom SVG fingers — OSMD piles chord digits
  });
  try {
    const roomy = scoreNeedsRoom();
    osmd.EngravingRules.BetweenStaffDistance = roomy ? 9.5 : 3.5;
    osmd.EngravingRules.StaffDistance = roomy ? 18 : 7.5;
    const wide = ($("osmd")?.clientWidth || 900) >= 720;
    osmd.zoom = wide ? 1.18 : 1.08;
    state.overlaySpacePass = 0;
    state.overlaySpaceKey = overlaySpaceKey();
    state.overlaySpacingLock = false;
    if (roomy) applyVoiceSpacing(osmd, 0);
    if (wantFingers) {
      osmd.EngravingRules.FingeringPaddingY = 0.85;
      osmd.EngravingRules.FingeringOffsetY = 0.35;
      osmd.EngravingRules.FingeringTextSize = 1.55;
    }
  } catch {
    /* older OSMD */
  }
  state.osmd = osmd;
  state.scoreWasRoomy = scoreNeedsRoom();
  bindOsmdRenderOverlays(osmd);
  await osmd.load(xml);
  osmd.render();
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

function lettersBlock(d) {
  const fmt = (arr) =>
    groupByOffset(arr)
      .map((g) => {
        const sorted = [...g].sort((a, b) => (b.midi || 0) - (a.midi || 0));
        if (sorted.length === 1) {
          const n = sorted[0];
          const finger = n.fingering ? `<i>${n.fingering}</i>` : "";
          return `<span class="chip letter">${escapeHtml(n.letter)}${finger}</span>`;
        }
        const inner = sorted
          .map((n) => {
            const finger = n.fingering ? `<i>${n.fingering}</i>` : "";
            return `<span class="chord-tone"><b class="tone-letter">${escapeHtml(
              n.letter
            )}</b>${finger ? `<i class="tone-finger">${n.fingering}</i>` : ""}</span>`;
          })
          .join("");
        return `<span class="chip letter chord" title="Chord">${inner}</span>`;
      })
      .join("");
  let html = `<h4>Letter names</h4>`;
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
    return `<section class="coach-bar-block"><h3>Bar ${num}</h3><p class="dim">No notes here.</p></section>`;
  }
  const headline = (d.headline || "").trim();
  let html = `<section class="coach-bar-block"><h3>Bar ${num}${
    headline ? `<span class="bar-headline">${escapeHtml(headline)}</span>` : ""
  }</h3>`;
  html += lettersBlock(d);

  // Always surface finger numbers in the coach (score overlay remains Letters XOR Fingers)
  if (d.fingerings && (d.fingerings.rh?.length || d.fingerings.lh?.length || d.rh?.some((n) => n.fingering) || d.lh?.some((n) => n.fingering))) {
    html += `<h4>Fingers</h4>`;
    for (const [label, pack] of [
      ["Right hand", d.rh?.filter((n) => n.fingering != null) || []],
      ["Left hand", d.lh?.filter((n) => n.fingering != null) || []],
    ]) {
      const rows = pack.length
        ? pack
        : label.startsWith("Right")
          ? d.fingerings.rh
          : d.fingerings.lh;
      if (!rows?.length) continue;
      const chips = groupByOffset(rows)
        .map((g) => {
          const sorted = [...g].sort((a, b) => (b.midi || 0) - (a.midi || 0));
          if (sorted.length === 1) {
            const n = sorted[0];
            const finger = n.finger ?? n.fingering;
            return `<span class="chip finger-only"><b>${finger}</b>${escapeHtml(n.letter || "")}</span>`;
          }
          const inner = sorted
            .map((n) => {
              const finger = n.finger ?? n.fingering;
              return `<span class="chord-tone"><b class="tone-finger">${finger}</b><i class="tone-letter">${escapeHtml(
                n.letter || ""
              )}</i></span>`;
            })
            .join("");
          return `<span class="chip finger-only chord" title="Chord">${inner}</span>`;
        })
        .join("");
      html += `<p class="hand-label">${label}</p><div class="notes">${chips}</div>`;
    }
  }

  if (d.harmony?.length) {
    html += `<h4>Harmony</h4><p>${escapeHtml(d.harmony.join(" · "))}</p>`;
  }

  const practice = deepenBarCopy(d, num);
  if (state.showTips !== false && practice.length) {
    html += `<h4>Practice</h4><ul class="focus-list">${practice
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join("")}</ul>`;
  }

  if (state.showLines !== false && d.lineAdvice) {
    let any = false;
    let block = `<h4>Line advice</h4>`;
    for (const [key, label] of [
      ["rh", "Right-hand line"],
      ["lh", "Left-hand line"],
      ["together", "Hands together"],
    ]) {
      const tips = d.lineAdvice[key] || [];
      if (!tips.length) continue;
      any = true;
      block += `<p class="hand-label">${label}</p><ul>${tips
        .map((t) => `<li>${escapeHtml(t)}</li>`)
        .join("")}</ul>`;
    }
    if (any) html += block;
  }

  if (d.split?.needed && d.split.chunks?.length) {
    html += `<h4>Break it apart</h4>`;
    for (const [i, chunk] of d.split.chunks.entries()) {
      html += `<div class="chunk"><div class="label">${escapeHtml(chunk.hand)} · chunk ${i + 1}</div><p>${escapeHtml(chunk.how)}</p></div>`;
    }
    if (d.split.practiceNotes?.length) {
      html += `<h4>How to practise</h4><ul>${d.split.practiceNotes
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join("")}</ul>`;
    }
  }

  html += `</section>`;
  return html;
}

function refreshCoachChrome() {
  const bars = selectedBarsSorted();
  const title = $("coach-title");
  if (title) title.textContent = selectionTitle(bars);
  const clear = $("coach-clear");
  if (clear) clear.hidden = bars.length < 1;
  const hear = $("btn-hear");
  if (hear) {
    hear.textContent =
      bars.length > 1
        ? `Play bars ${bars[0]}\u2013${bars[bars.length - 1]}`
        : "Play this bar";
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
  let html = `<section class="coach-line-block"><h4>This line · bars ${line[0]}\u2013${line[line.length - 1]}</h4><ul class="line-summary">`;
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
  if (bars.length === 1) {
    html += lineSummaryHtml(bars[0]);
  }
  body.innerHTML = html;
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
  // Keep selection + listen region; only hide the panel
  requestAnimationFrame(() => paintSelectionHilites());
}

async function askPlan() {
  const bars = selectedBarsSorted();
  if (!bars.length) {
    toast("Pick a bar first");
    return;
  }
  const res = await fetch("/api/piece/practice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ musicxml: state.piece.musicxml, bars }),
  });
  if (!res.ok) return toast("Could not build practice notes");
  const plan = await res.json();
  openCoach();
  refreshCoachChrome();
  let html = `<h3>Practice · ${escapeHtml(selectionTitle(bars))}</h3>`;
  for (const num of bars) {
    html += lettersBlock(debriefFor(num) || { rh: [], lh: [] });
  }
  html += `<h4>Session</h4><ul>${(plan.steps || [])
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

async function openFile(file) {
  await withLoader(`Opening ${file.name}`, async () => {
    const form = new FormData();
    form.append("file", file, file.name);
    const res = await fetch("/api/piece", { method: "POST", body: form });
    if (!res.ok) throw new Error("Could not open file");
    await landOnDiscover(await res.json());
  });
}

function goHome({ keepTabs = false } = {}) {
  stopAll();
  closeCoach();
  snapshotActiveSession();
  state.mode = "home";
  showView("home");
  if (!keepTabs) renderPieceTabs();
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
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".top-search") && !e.target.closest(".results")) {
      closeSearchResults();
      if (!e.target.closest(".piece-tab-add")) {
        document.body.classList.remove("studio-search-open");
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
      if (state.coachOpen) {
        closeCoach();
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
    setKeyboardVisible(!state.keyboardVisible);
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

  document.querySelectorAll(".speed-btn").forEach((btn) => {
    btn.addEventListener("click", () => setPlayRate(btn.dataset.rate));
  });
  setPlayRate(1);
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
  on("btn-plan", "click", () => askPlan().catch((e) => toast(e.message)));
  on("btn-download", "click", downloadScore);
  on("coach-close", "click", closeCoach);
  on("coach-clear", "click", () => clearBarSelection({ close: true }));
  on("file", "change", () => {
    const f = $("file").files?.[0];
    $("file").value = "";
    if (f) openFile(f).catch((e) => toast(e.message));
  });
}

try {
  bind();
  showView("home");
} catch (err) {
  console.error("Lune bind failed", err);
  const t = document.getElementById("toast");
  if (t) {
    t.hidden = false;
    t.textContent = "UI failed to start — hard-refresh the page.";
  }
}
