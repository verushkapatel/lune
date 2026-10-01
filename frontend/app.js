/* Lune — meet → listen (piano + scrub) → ask (letters/fingers on score) */

const $ = (id) => document.getElementById(id);
pdfjsLib.GlobalWorkerOptions.workerSrc = "/static/vendor/pdf.worker.min.js";

const state = {
  piece: null,
  selected: null,
  pendingMeta: null,
  osmd: null,
  rawMusicxml: "",
  showFingers: false,
  lettersOnly: false,
  scoreLetters: false,
  scoreFingers: false,
  showTips: true,
  showLines: true,
  mode: "home",
  listenRange: "opening",
  scrubbing: false,
};

function toast(msg) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 2800);
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
  if (name !== "studio") closeCoach();
}

/* ---------- search ---------- */

async function search(query, { openBest = false } = {}) {
  const box = $("results");
  const q = (query || "").trim();
  if (q.length < 2) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.hidden = false;
  box.innerHTML = `<button class="result" type="button" disabled>Searching…</button>`;
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    const all = data.results || [];
    const works = all.filter((r) => r.kind !== "composer");
    if (!all.length) {
      box.innerHTML = `<button class="result" type="button" disabled>No pieces found for “${escapeHtml(q)}”</button>`;
      return;
    }
    if (openBest) {
      box.hidden = true;
      // Prefer free/openable hits so Enter always lands on a real score when possible.
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
      await fetchAndDiscover(list);
      return;
    }
    box.innerHTML = "";
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
      btn.innerHTML = `${escapeHtml(item.title)}<small>${escapeHtml(
        [item.composer, kind, item.epoch].filter(Boolean).join(" · ")
      )}</small>`;
      btn.addEventListener("click", () => fetchAndDiscover([item]));
      box.appendChild(btn);
    }
  } catch {
    box.innerHTML = `<button class="result" type="button" disabled>Search failed</button>`;
  }
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
  toast("Loading the piece…");
  const typed = ($("q").value || "").trim();
  let lastMiss = null;
  for (const item of works.slice(0, 12)) {
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
    state.piece = lastMiss.piece;
    showDiscoverPage(lastMiss.piece, { canOpen: false });
    toast(lastMiss.piece.message || "Try another free title or upload a file");
    return;
  }
  toast("No free score available");
}

async function landOnDiscover(piece) {
  state.piece = piece;
  state.rawMusicxml = piece.musicxml || "";
  state.selected = null;
  state.mode = "discover";
  if (piece.fallbackNote) toast(piece.fallbackNote);
  showDiscoverPage(piece, { canOpen: piece.kind === "score" && !!piece.musicxml });
}

/* ---------- discover ---------- */

function showDiscoverPage(piece, { canOpen }) {
  const o = piece.overview || {};
  const title = o.title || piece.title || "Untitled";
  const composer = o.composer || piece.composer || "";
  const era = o.era || o.epoch || "";
  const ci = o.composerInfo || {};

  $("discover-era").textContent = era || "Discover";
  $("discover-title").textContent = title;
  $("discover-by").textContent = composer ? `by ${composer}` : "";
  $("discover-hook").textContent = ci.hook || o.summary || "A piece waiting to be heard carefully.";

  const img = $("composer-hero-img");
  const fallback = $("composer-fallback");
  const photo = ci.image || o.historyImage || "";
  if (photo) {
    img.hidden = false;
    img.src = photo;
    img.alt = composer || title;
    fallback.hidden = true;
  } else {
    img.hidden = true;
    fallback.hidden = false;
    fallback.textContent = (composer || title).slice(0, 1).toUpperCase();
  }

  const host = $("discover-chapters");
  host.innerHTML = "";
  const chapters = [
    {
      title: `About ${ci.name || composer || "the composer"}`,
      body: ci.full || ci.bio || ci.hook || "Composer story loading…",
      extras: ci.highlights || [],
    },
    {
      title: "The piece",
      body: o.history || o.summary || "Explore this work.",
      extras: o.highlights || [],
    },
    {
      title: `Era · ${(o.eraInfo && o.eraInfo.label) || era || "Style"}`,
      body: (o.eraInfo && o.eraInfo.story) || "",
      extras: (o.eraInfo && o.eraInfo.tips) || [],
    },
    {
      title: "In this score",
      body: "Facts from the MusicXML once opened.",
      extras: (o.playingCards || []).map((c) => `${c.label}: ${c.value}`),
    },
  ];
  chapters.forEach((ch, i) => {
    const details = document.createElement("details");
    details.className = "chapter";
    if (i === 0) details.open = true;
    details.innerHTML = `<summary>${escapeHtml(ch.title)}</summary>
      <div class="chapter-body"><p>${escapeHtml(ch.body)}</p>
      ${(ch.extras || []).length ? `<ul>${ch.extras.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}
      </div>`;
    host.appendChild(details);
  });

  $("btn-open-piece").hidden = !canOpen;
  $("btn-open-piece-bottom").hidden = !canOpen;
  document.querySelectorAll(".journey-steps span").forEach((el, i) => el.classList.toggle("on", i === 0));
  showView("discover");
}

async function openPieceFromDiscover() {
  if (!state.piece?.musicxml) {
    $("file").click();
    return;
  }
  toast("Preparing piano sound…");
  try {
    await LunePiano.ensure();
  } catch {
    toast("Piano samples need internet the first time");
  }
  await enterListenMode();
}

async function enterListenMode() {
  state.mode = "listen";
  showView("studio");
  $("stage-label").textContent = "2 · Listen";
  $("piece-name").textContent = state.piece.title || "Untitled";
  $("piece-meta").textContent = [
    state.piece.composer || state.piece.overview?.composer,
    state.piece.overview?.era,
    state.piece.notatedKey || state.piece.analyzedKey,
    state.piece.timeSignature,
  ]
    .filter(Boolean)
    .join(" · ");

  $("listen-dock").hidden = false;
  $("ask-banner").hidden = true;
  $("bars").hidden = true;
  $("score-toggles").hidden = false;
  $("btn-to-ask").hidden = true;
  $("btn-ready-ask").hidden = false;
  $("btn-download").hidden = !state.piece.musicxml;
  $("tab-listen")?.classList.add("on");
  $("tab-ask")?.classList.remove("on");
  closeCoach();
  setListenRange(state.listenRange || "opening");
  await renderScore();
  updateScrub({ progress: 0, total: 0, bar: null });
}

function enterAskMode() {
  state.mode = "ask";
  stopAll();
  $("stage-label").textContent = "3 · Ask";
  $("listen-dock").hidden = true;
  $("ask-banner").hidden = false;
  $("bars").hidden = false;
  $("score-toggles").hidden = false;
  $("btn-to-ask").hidden = true;
  $("btn-ready-ask").hidden = true;
  $("tab-listen")?.classList.remove("on");
  $("tab-ask")?.classList.add("on");
  renderBarStrip();
  toast("Tap a bar — your companion opens with help");
}

/* ---------- listening / scrub ---------- */

function setListenRange(range) {
  state.listenRange = range;
  document.querySelectorAll(".range").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.range === range);
  });
}

function rangeBars() {
  const nums = Object.keys(state.piece?.debriefs || {})
    .map(Number)
    .sort((a, b) => a - b);
  if (!nums.length) return [1, 1];
  const first = nums[0];
  const last = nums[nums.length - 1];
  switch (state.listenRange) {
    case "phrase":
      return [first, Math.min(first + 7, last)];
    case "page":
      return [first, Math.min(first + 15, last)];
    case "whole":
      return [first, last];
    default:
      return [first, Math.min(first + 3, last)];
  }
}

function collectNotes(fromBar, toBar) {
  const notes = [];
  const debriefs = state.piece?.debriefs || {};
  let barCursor = 0;
  for (let b = fromBar; b <= toBar; b++) {
    const d = debriefs[String(b)];
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

function updateScrub({ progress, total, bar }) {
  const scrub = $("scrub");
  if (scrub) {
    if (!state.scrubbing && total > 0) {
      scrub.value = String(Math.round((progress / total) * 1000));
    } else if (total <= 0) {
      scrub.value = "0";
    }
  }
  const timeEl = $("scrub-time");
  const barEl = $("scrub-bar");
  if (timeEl) timeEl.textContent = `${fmtTime(progress)} / ${fmtTime(total)}`;
  if (barEl) barEl.textContent = bar ? `Bar ${bar}` : "Bar —";
  highlightPlayingBar(bar);
  placePlayhead(bar);
}

function highlightPlayingBar(bar) {
  document.querySelectorAll(".bar-card").forEach((el) => {
    el.classList.toggle("playing", bar && Number(el.dataset.bar) === Number(bar));
  });
}

function placePlayhead(bar) {
  const line = $("playhead-line");
  if (!line) return;
  if (!bar) {
    line.hidden = true;
    return;
  }
  const card = document.querySelector(`.bar-card[data-bar="${bar}"]`);
  card?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  const svg = $("osmd")?.querySelector("svg");
  if (!svg) {
    line.hidden = true;
    return;
  }
  line.hidden = false;
  const nums = Object.keys(state.piece?.debriefs || {})
    .map(Number)
    .sort((a, b) => a - b);
  const idx = Math.max(0, nums.indexOf(Number(bar)));
  const ratio = nums.length > 1 ? idx / (nums.length - 1) : 0;
  const scroll = $("score-scroll");
  const x = 24 + ratio * Math.max(0, (svg.clientWidth || scroll?.clientWidth || 0) - 48);
  line.style.left = `${x}px`;
}

function stopAll() {
  try {
    LunePiano.stop();
  } catch {
    /* piano not ready */
  }
  const playBtn = $("btn-play-range");
  if (playBtn) playBtn.textContent = "Play";
  const stop = $("btn-stop");
  if (stop) stop.hidden = true;
  const stopBar = $("btn-stop-bar");
  if (stopBar) stopBar.hidden = true;
  const hear = $("btn-hear");
  if (hear) hear.textContent = "Hear this bar";
  const line = $("playhead-line");
  if (line) line.hidden = true;
}

async function startRangePlayback(seekRatio = 0) {
  const [from, to] = rangeBars();
  const notes = collectNotes(from, to);
  if (!notes.length) {
    toast("Nothing to play");
    return;
  }
  toast(state.listenRange === "whole" ? "Playing whole piece…" : `Playing bars ${from}–${to}…`);
  $("btn-play-range").textContent = "Playing…";
  $("btn-stop").hidden = false;
  try {
    await LunePiano.ensure();
  } catch {
    toast("Could not load piano samples — check internet once");
  }
  await LunePiano.play(notes, {
    from: 0,
    onTick: updateScrub,
    onEnd: () => {
      $("btn-play-range").textContent = "Play";
      $("btn-stop").hidden = true;
    },
  });
  if (seekRatio > 0) LunePiano.seek(seekRatio);
}

async function hearBar() {
  if (LunePiano.isPlaying()) {
    stopAll();
    return;
  }
  const d = state.piece?.debriefs?.[String(state.selected)];
  const notes = (d?.playback || [...(d?.rh || []), ...(d?.lh || [])]).map((n) => ({
    ...n,
    absOffset: n.offset,
    bar: state.selected,
  }));
  $("btn-hear").textContent = "Stop";
  $("btn-stop-bar").hidden = false;
  await LunePiano.play(notes, {
    onTick: updateScrub,
    onEnd: () => {
      $("btn-hear").textContent = "Hear this bar";
      $("btn-stop-bar").hidden = true;
    },
  });
}

/* ---------- score render with annotations ---------- */

async function renderScore() {
  const base = state.rawMusicxml || state.piece?.musicxml || "";
  if (!base) return;
  const xml = LuneAnnotate.annotate(base, state.piece.debriefs || {}, {
    fingers: state.scoreFingers,
  });
  $("osmd").hidden = false;
  $("osmd").innerHTML = "";
  const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay($("osmd"), {
    autoResize: true,
    backend: "svg",
    drawTitle: false,
    drawComposer: false,
    drawCredits: false,
    drawPartNames: false,
    drawMeasureNumbers: true,
    drawLyrics: true,
  });
  // Extra room so fingerings / overlays don’t crush the staff
  try {
    osmd.EngravingRules.BetweenStaffDistance = state.scoreFingers || state.scoreLetters ? 5.2 : 3.5;
    osmd.EngravingRules.StaffDistance = state.scoreFingers || state.scoreLetters ? 10.5 : 7.5;
  } catch {
    /* older OSMD */
  }
  state.osmd = osmd;
  await osmd.load(xml);
  osmd.render();
  if (state.scoreLetters) {
    requestAnimationFrame(() => {
      LuneAnnotate.placeLetterOverlays($("osmd"), osmd, state.piece.debriefs || {});
    });
  } else {
    LuneAnnotate.clearLetterOverlays($("osmd"));
  }
}

async function refreshScoreAnnotations() {
  if (!state.piece?.musicxml) return;
  await renderScore();
}

function renderBarStrip() {
  const host = $("bars");
  host.innerHTML = "";
  const debriefs = state.piece?.debriefs || {};
  const numbers = Object.keys(debriefs).map(Number).sort((a, b) => a - b);
  const hot = new Set((state.piece.hardSpots || []).map((s) => s.measure));
  for (const num of numbers) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bar-card" + (hot.has(num) ? " hot" : "");
    btn.dataset.bar = String(num);
    btn.innerHTML = `<div class="n">${num}${hot.has(num) ? " ·" : ""}</div>`;
    btn.title = hot.has(num) ? `Bar ${num} · harder spot` : `Bar ${num}`;
    btn.addEventListener("click", () => selectBar(num));
    host.appendChild(btn);
  }
}

function selectBar(num) {
  if (state.mode !== "ask") enterAskMode();
  state.selected = num;
  document.querySelectorAll(".bar-card").forEach((el) => {
    el.classList.toggle("on", Number(el.dataset.bar) === num);
  });
  showBarHelp(num);
}

function lettersBlock(d) {
  const fmt = (arr) => {
    // Group simultaneous pitches so every chord tone is visible as a stack
    const groups = [];
    for (const n of arr || []) {
      const last = groups[groups.length - 1];
      if (last && Math.abs((last[0].offset || 0) - (n.offset || 0)) < 1e-4) {
        last.push(n);
      } else {
        groups.push([n]);
      }
    }
    return groups
      .map((g) => {
        // High → low for reading (already usually sorted that way)
        const sorted = [...g].sort((a, b) => (b.midi || 0) - (a.midi || 0));
        if (sorted.length === 1) {
          const n = sorted[0];
          const finger = state.showFingers && n.fingering ? `<i>${n.fingering}</i>` : "";
          return `<span class="chip letter">${escapeHtml(n.letter)}${finger}</span>`;
        }
        const inner = sorted
          .map((n) => {
            const finger = state.showFingers && n.fingering ? `<i>${n.fingering}</i>` : "";
            return `<span class="chord-tone">${escapeHtml(n.letter)}${finger}</span>`;
          })
          .join("");
        return `<span class="chip letter chord" title="Chord">${inner}</span>`;
      })
      .join("");
  };
  let html = `<h4>Letter names</h4>`;
  if (d.rh?.length) html += `<p class="hand-label">Right hand</p><div class="notes">${fmt(d.rh)}</div>`;
  if (d.lh?.length) html += `<p class="hand-label">Left hand</p><div class="notes">${fmt(d.lh)}</div>`;
  if (!d.rh?.length && !d.lh?.length) html += `<p class="dim">No pitched notes in this bar.</p>`;
  return html;
}

function showBarHelp(num) {
  const d = state.piece?.debriefs?.[String(num)];
  openCoach();
  if (!d?.found) {
    $("help-body").innerHTML = `<h3>Bar ${num}</h3><p>No notes here.</p>`;
    return;
  }
  if (state.lettersOnly) {
    $("help-body").innerHTML = `<h3>Bar ${num} · letters</h3>${lettersBlock(d)}`;
    return;
  }
  const hard = d.difficulty?.isHard || d.split?.needed;
  let html = `<h3>Bar ${num}${hard ? " · hard" : ""}</h3>`;
  html += lettersBlock(d);

  if (state.showTips && d.focus?.length) {
    html += `<h4>Focus</h4><ul class="focus-list">${d.focus
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join("")}</ul>`;
  }

  if (state.showLines && d.lineAdvice) {
    html += `<h4>Line advice</h4>`;
    for (const [key, label] of [
      ["rh", "Right-hand line"],
      ["lh", "Left-hand line"],
      ["together", "Hands together"],
    ]) {
      const tips = d.lineAdvice[key] || [];
      if (!tips.length) continue;
      html += `<p class="hand-label">${label}</p><ul>${tips
        .map((t) => `<li>${escapeHtml(t)}</li>`)
        .join("")}</ul>`;
    }
  }

  if (d.split?.needed && d.split.chunks?.length) {
    html += `<h4>Break it apart</h4>`;
    for (const [i, chunk] of d.split.chunks.entries()) {
      html += `<div class="chunk"><div class="label">${escapeHtml(chunk.hand)} · chunk ${i + 1}</div><p>${escapeHtml(chunk.how)}</p></div>`;
    }
    if (state.showTips && d.split.practiceNotes?.length) {
      html += `<h4>How to practise</h4><ul>${d.split.practiceNotes
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join("")}</ul>`;
    }
  }

  if (state.showFingers && d.fingerings) {
    html += `<h4>Finger numbers</h4>`;
    for (const [label, rows] of [
      ["Right hand", d.fingerings.rh],
      ["Left hand", d.fingerings.lh],
    ]) {
      if (!rows?.length) continue;
      html += `<p class="hand-label">${label}</p><div class="notes">${rows
        .map((n) => `<span class="chip finger-only"><b>${n.finger}</b>${escapeHtml(n.letter)}</span>`)
        .join("")}</div>`;
    }
  }

  $("help-body").innerHTML = html;
}

function openCoach() {
  const coach = $("coach");
  if (coach) coach.hidden = false;
}
function closeCoach() {
  const coach = $("coach");
  if (coach) coach.hidden = true;
}

async function askPlan() {
  if (!state.selected) {
    toast("Pick a bar first");
    return;
  }
  const res = await fetch("/api/piece/practice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ musicxml: state.piece.musicxml, bars: [state.selected] }),
  });
  if (!res.ok) return toast("Could not build practice notes");
  const plan = await res.json();
  const d = state.piece.debriefs?.[String(state.selected)];
  openCoach();
  let html = `<h3>Practice · bar ${state.selected}</h3>${lettersBlock(d || { rh: [], lh: [] })}`;
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
  toast(`Opening ${file.name}…`);
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch("/api/piece", { method: "POST", body: form });
  if (!res.ok) throw new Error("Could not open file");
  await landOnDiscover(await res.json());
}

function goHome() {
  stopAll();
  closeCoach();
  state.mode = "home";
  showView("home");
}

async function loadLibrary(filter = "") {
  const host = $("library-groups");
  const countEl = $("library-count");
  if (!host) return;
  try {
    const url = filter
      ? `/api/library?q=${encodeURIComponent(filter)}`
      : "/api/library";
    const res = await fetch(url);
    const data = await res.json();
    const groups = data.groups || {};
    const total = data.count || (data.items || []).length;
    host.innerHTML = "";
    const order = [
      "Featured",
      "Open MusicXML · Liszt",
      "Open MusicXML · Debussy",
      "Open MusicXML · Chopin",
      "Open MusicXML · Satie",
      "Open MusicXML · Bach",
      "Open MusicXML · Beethoven",
      "Open MusicXML · Mozart",
      "Open MusicXML · Schubert",
      "Open MusicXML · Brahms",
      "Open MusicXML · Pachelbel",
      "Open MusicXML · Tchaikovsky",
      "Open MusicXML · Rimsky-Korsakov",
      "Liszt · KernScores",
      "OpenScore Lieder",
      "Scriabin piano",
      "Beethoven piano sonatas",
      "Mozart piano sonatas",
      "Haydn piano sonatas",
      "Chopin preludes",
      "Chopin mazurkas",
      "Joplin rags",
      "Scarlatti sonatas",
      "Hummel preludes",
      "Bach · Art of Fugue",
      "Beethoven string quartets",
      "Bach chorales",
    ];
    const keys = [
      ...order.filter((k) => groups[k]),
      ...Object.keys(groups)
        .filter((k) => !order.includes(k))
        .sort(),
    ];
    if (!keys.length) {
      host.innerHTML = `<p class="dim">No scores match that filter.</p>`;
      return;
    }

    // Without a filter, curated piano groups only — full corpus via filter.
    const curated = new Set(order);
    const visibleKeys = filter
      ? keys
      : keys.filter(
          (k) =>
            curated.has(k) ||
            k.startsWith("Open MusicXML") ||
            k.startsWith("Liszt") ||
            k.startsWith("Scriabin") ||
            k.startsWith("OpenScore")
        );

    const totalAll = data.totalAvailable || total;
    if (countEl) {
      countEl.textContent = filter
        ? `${total} match${total === 1 ? "" : "es"} · ${totalAll} openable in all`
        : `${total} ready to open · ${totalAll} in the full catalogue`;
    }

    if (!filter) {
      const tip = document.createElement("p");
      tip.className = "dim library-tip";
      tip.textContent =
        "Type a composer (Liszt, Chopin, Scriabin…) or title to search every openable encoding.";
      host.appendChild(tip);
    }

    const perGroup = filter ? 48 : 12;
    for (const name of visibleKeys) {
      const items = groups[name] || [];
      const section = document.createElement("div");
      section.className = "library-group";
      section.innerHTML = `<h3>${escapeHtml(name)} <span class="lib-n">${items.length}</span></h3>`;
      const row = document.createElement("div");
      row.className = "library-row";
      const shown = items.slice(0, perGroup);
      for (const item of shown) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "lib-card";
        btn.innerHTML = `<strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(
          item.composer
        )}</span>`;
        btn.addEventListener("click", () => {
          $("q").value = item.query || item.title;
          fetchAndDiscover([
            {
              kind: "work",
              title: item.title,
              composer: item.composer,
              query: item.query,
              epoch: "",
            },
          ]);
        });
        row.appendChild(btn);
      }
      section.appendChild(row);
      if (items.length > shown.length) {
        const more = document.createElement("p");
        more.className = "dim library-more";
        more.textContent = filter
          ? `Showing ${shown.length} of ${items.length} — refine the filter.`
          : `Showing ${shown.length} of ${items.length} — filter by name for the rest.`;
        section.appendChild(more);
      }
      host.appendChild(section);
    }
  } catch {
    host.innerHTML = `<p class="dim">Library unavailable — use search.</p>`;
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
  let timer;
  on("q", "input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => search($("q").value), 250);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".top-search") && !e.target.closest(".results")) {
      const box = $("results");
      if (box) box.hidden = true;
    }
  });

  on("btn-home", "click", goHome);
  on("btn-open", "click", () => $("file")?.click());
  const libFilter = $("library-filter");
  if (libFilter) {
    let libTimer;
    libFilter.addEventListener("input", () => {
      clearTimeout(libTimer);
      libTimer = setTimeout(() => loadLibrary(libFilter.value.trim()), 200);
    });
  }
  on("btn-discover-home", "click", goHome);
  on("btn-open-piece", "click", () => openPieceFromDiscover().catch((e) => toast(e.message)));
  on("btn-open-piece-bottom", "click", () => openPieceFromDiscover().catch((e) => toast(e.message)));
  on("btn-back-discover", "click", () => {
    stopAll();
    if (state.piece) showDiscoverPage(state.piece, { canOpen: !!state.piece.musicxml });
  });
  on("btn-to-ask", "click", enterAskMode);
  on("tab-listen", "click", () => {
    if (state.piece) enterListenMode().catch((e) => toast(e.message));
  });
  on("tab-ask", "click", enterAskMode);

  document.querySelectorAll(".range").forEach((btn) => {
    btn.addEventListener("click", () => setListenRange(btn.dataset.range));
  });
  on("btn-play-range", "click", () => {
    if (LunePiano.isPlaying()) stopAll();
    else startRangePlayback(0).catch((e) => toast(e.message));
  });
  on("btn-stop", "click", stopAll);
  on("btn-stop-bar", "click", stopAll);
  on("btn-ready-ask", "click", enterAskMode);

  const scrub = $("scrub");
  if (scrub) {
    scrub.addEventListener("pointerdown", () => {
      state.scrubbing = true;
    });
    scrub.addEventListener("pointerup", () => {
      state.scrubbing = false;
      const ratio = Number(scrub.value) / 1000;
      if (LunePiano.duration() > 0) LunePiano.seek(ratio);
      else startRangePlayback(ratio).catch((e) => toast(e.message));
    });
    scrub.addEventListener("input", () => {
      const ratio = Number(scrub.value) / 1000;
      const total = LunePiano.duration() || 1;
      updateScrub({ progress: ratio * total, total, bar: LunePiano.currentBar() });
    });
  }

  on("tog-letters", "change", (e) => {
    state.scoreLetters = e.target.checked;
    refreshScoreAnnotations();
  });
  on("tog-fingers", "change", (e) => {
    state.scoreFingers = e.target.checked;
    refreshScoreAnnotations();
  });
  on("tog-tips", "change", (e) => {
    state.showTips = e.target.checked;
    if (state.selected) showBarHelp(state.selected);
  });
  on("tog-lines", "change", (e) => {
    state.showLines = e.target.checked;
    if (state.selected) showBarHelp(state.selected);
  });

  on("btn-hear", "click", () => hearBar().catch((e) => toast(e.message)));
  on("btn-letters", "click", () => {
    state.lettersOnly = !state.lettersOnly;
    $("btn-letters").textContent = state.lettersOnly ? "Full help" : "Letters panel";
    if (state.selected) showBarHelp(state.selected);
  });
  on("btn-fingers", "click", () => {
    state.showFingers = !state.showFingers;
    $("btn-fingers").textContent = state.showFingers ? "Hide fingers" : "Fingers panel";
    if (state.selected) showBarHelp(state.selected);
  });
  on("btn-plan", "click", () => askPlan().catch((e) => toast(e.message)));
  on("btn-download", "click", downloadScore);
  on("coach-close", "click", closeCoach);
  on("file", "change", () => {
    const f = $("file").files?.[0];
    $("file").value = "";
    if (f) openFile(f).catch((e) => toast(e.message));
  });

  loadLibrary().catch(() => {});
}

try {
  bind();
} catch (err) {
  console.error("Lune bind failed", err);
  const t = document.getElementById("toast");
  if (t) {
    t.hidden = false;
    t.textContent = "UI failed to start — hard-refresh the page.";
  }
}
