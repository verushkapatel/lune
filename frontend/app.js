/* Lune — search a piece, click a bar, get help for that bar */

const $ = (id) => document.getElementById(id);
pdfjsLib.GlobalWorkerOptions.workerSrc = "/static/vendor/pdf.worker.min.js";

const state = {
  piece: null,
  selected: null,
  pendingMeta: null,
  osmd: null,
};

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 2500);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ---------- search (always in the header) ---------- */

async function search(query) {
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
    const rows = data.results || [];
    if (!rows.length) {
      box.innerHTML = `<button class="result" type="button" disabled>No pieces found for “${escapeHtml(q)}”</button>`;
      return;
    }
    box.innerHTML = "";
    for (const item of rows) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "result";
      const kind = item.kind === "composer" ? "Composer" : item.subtitle || "Work";
      btn.innerHTML = `${escapeHtml(item.title)}<small>${escapeHtml(
        [item.composer, kind, item.epoch].filter(Boolean).join(" · ")
      )}</small>`;
      btn.addEventListener("click", () => pickSearch(item));
      box.appendChild(btn);
    }
  } catch (err) {
    box.innerHTML = `<button class="result" type="button" disabled>Search failed — check your internet</button>`;
  }
}

async function pickSearch(item) {
  $("results").hidden = true;
  $("q").value = item.composer ? `${item.composer} — ${item.title}` : item.title;
  state.pendingMeta = { title: item.title, composer: item.composer || "" };

  toast("Opening score…");
  try {
    const res = await fetch("/api/search/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: item.title,
        composer: item.composer || "",
      }),
    });
    if (!res.ok) throw new Error("Could not open that piece");
    const piece = await res.json();

    if (piece.opened === false || piece.kind === "catalogue") {
      // No auto score — still show about + prompt, but try not to strand the user
      state.piece = piece;
      state.selected = null;
      enterStudio();
      renderBarStrip();
      $("btn-plan").hidden = true;
      $("osmd").hidden = false;
      $("scan").hidden = true;
      $("osmd").innerHTML = `<div style="padding:36px;color:#444;max-width:460px;font-family:var(--sans)">
        <p style="font-size:18px;margin:0 0 10px">${escapeHtml(piece.title || item.title)}</p>
        <p style="margin:0 0 14px">${escapeHtml(piece.message || "Score not available to open automatically.")}</p>
        <button type="button" id="attach-now" style="padding:10px 14px;border-radius:10px;border:none;background:#c9a45c;font-weight:600;cursor:pointer">Open a file instead</button>
      </div>`;
      showHelpAbout();
      document.getElementById("attach-now")?.addEventListener("click", () => $("file").click());
      return;
    }

    await present(piece);
    toast("Score open — click a bar");
  } catch (err) {
    toast(err.message || "Could not open score");
  }
}

/* ---------- open files / sample ---------- */

async function openSample(overview) {
  toast("Opening demo score…");
  const res = await fetch("/api/piece/sample");
  if (!res.ok) throw new Error("Sample failed");
  const piece = await res.json();
  if (overview) piece.overview = { ...piece.overview, ...overview, history: overview.history || piece.overview?.history };
  await present(piece);
}

async function openFile(file) {
  toast(`Opening ${file.name}…`);
  const form = new FormData();
  form.append("file", file, file.name);
  if (state.pendingMeta?.title) form.append("title", state.pendingMeta.title);
  if (state.pendingMeta?.composer) form.append("composer", state.pendingMeta.composer);
  const res = await fetch("/api/piece", { method: "POST", body: form });
  if (!res.ok) {
    let detail = "Could not open file";
    try {
      const data = await res.json();
      if (data.detail) detail = data.detail;
    } catch {}
    throw new Error(detail);
  }
  await present(await res.json());
}

async function present(piece) {
  state.piece = piece;
  state.selected = null;
  enterStudio();
  $("btn-plan").hidden = piece.kind !== "score";

  $("osmd").hidden = true;
  $("scan").hidden = true;
  $("osmd").innerHTML = "";
  $("scan").innerHTML = "";

  renderBarStrip();
  showHelpEmpty();

  if (piece.kind === "score" && piece.musicxml) {
    await renderOsmd(piece.musicxml);
    // Auto-select first hard spot or bar 1 so help is immediately visible
    const first =
      piece.hardSpots?.[0]?.measure ||
      Number(Object.keys(piece.debriefs || {})[0]) ||
      1;
    selectBar(first);
  } else if (piece.mediaType === "application/pdf") {
    await renderPdf(piece.dataUrl);
    showScanHelp();
  } else if (piece.kind === "scan") {
    renderImage(piece.dataUrl);
    showScanHelp();
  }
}

function enterStudio() {
  $("home").hidden = true;
  $("studio").hidden = false;
  $("piece-name").textContent = state.piece.title || state.piece.filename || "Untitled";
  const bits = [
    state.piece.composer || state.piece.overview?.composer,
    state.piece.notatedKey || state.piece.analyzedKey,
    state.piece.timeSignature,
  ].filter(Boolean);
  $("piece-meta").textContent = bits.join(" · ");
}

/* ---------- bar strip = specialised attention per bar ---------- */

function renderBarStrip() {
  const host = $("bars");
  host.innerHTML = "";
  const piece = state.piece;
  if (!piece) return;

  const debriefs = piece.debriefs || {};
  const numbers = Object.keys(debriefs)
    .map(Number)
    .sort((a, b) => a - b);

  if (!numbers.length) {
    host.innerHTML =
      '<p class="dim" style="margin:0;color:#777">No bars to click yet — open a MusicXML score for this piece.</p>';
    return;
  }

  const hot = new Set((piece.hardSpots || []).map((s) => s.measure));

  for (const num of numbers) {
    const d = debriefs[String(num)];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bar-card" + (hot.has(num) ? " hot" : "");
    btn.dataset.bar = String(num);

    const notes = [...(d.rh || []), ...(d.lh || [])].slice(0, 8);
    const preview = notes
      .map((n) => `<span>${escapeHtml(n.letter)}${n.fingering ? " " + n.fingering : ""}</span>`)
      .join("");

    btn.innerHTML = `<div class="n">Bar ${num}${hot.has(num) ? " · hard" : ""}</div><div class="preview">${preview || "—"}</div>`;
    btn.addEventListener("click", () => selectBar(num));
    host.appendChild(btn);
  }
}

function selectBar(num) {
  state.selected = num;
  document.querySelectorAll(".bar-card").forEach((el) => {
    el.classList.toggle("on", Number(el.dataset.bar) === num);
  });
  const card = document.querySelector(`.bar-card[data-bar="${num}"]`);
  card?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });

  // Try to scroll OSMD measure into view if measure hits exist
  const hit = document.querySelector(`.measure-hit[data-measure="${num}"]`);
  hit?.scrollIntoView({ behavior: "smooth", block: "center" });
  document.querySelectorAll(".measure-hit").forEach((el) => {
    el.classList.toggle("on", Number(el.getAttribute("data-measure")) === num);
  });

  showBarHelp(num);
}

function showHelpEmpty() {
  $("help-empty").hidden = false;
  $("help-body").hidden = true;
  $("help-body").innerHTML = "";
}

function showScanHelp() {
  $("help-empty").hidden = true;
  $("help-body").hidden = false;
  $("help-body").innerHTML = `
    <h3>Page open</h3>
    <p>Click a spot on the page. For letter names, fingering, and voices on each bar, also open the MusicXML export of this piece.</p>
    <p class="dim">${escapeHtml(state.piece?.hint || "")}</p>`;
}

function showBarHelp(num) {
  const d = state.piece?.debriefs?.[String(num)];
  $("help-empty").hidden = true;
  $("help-body").hidden = false;
  $("btn-plan").hidden = state.piece?.kind !== "score";

  if (!d || !d.found) {
    $("help-body").innerHTML = `<h3>Bar ${num}</h3><p>No notes parsed here.</p>`;
    return;
  }

  let html = `<h3>Bar ${num}</h3>`;

  if (d.difficulty?.reasons && d.difficulty.reasons[0] !== "straightforward") {
    html += `<h4>Why this bar</h4><p>${escapeHtml(d.difficulty.reasons.join(" · "))}</p>`;
  }

  if (d.howToPlay?.length) {
    html += `<h4>How to play it</h4><ul>${d.howToPlay
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join("")}</ul>`;
  }

  if (d.rh?.length) {
    html += `<h4>Right hand — letters & fingering</h4><div class="notes">${d.rh
      .map(
        (n) =>
          `<span class="chip">${escapeHtml(n.letter)}${
            n.fingering ? `<i>${n.fingering}</i>` : ""
          }</span>`
      )
      .join("")}</div>`;
  }

  if (d.lh?.length) {
    html += `<h4>Left hand — letters & fingering</h4><div class="notes">${d.lh
      .map(
        (n) =>
          `<span class="chip">${escapeHtml(n.letter)}${
            n.fingering ? `<i>${n.fingering}</i>` : ""
          }</span>`
      )
      .join("")}</div>`;
  }

  if (d.harmony?.length) {
    html += `<h4>Harmony</h4><p>${escapeHtml(d.harmony.join(" · "))}</p>`;
  }
  if (d.dynamics?.length) {
    html += `<h4>Dynamics</h4><p>${escapeHtml(d.dynamics.join(", "))}</p>`;
  }

  // Voice breakdown
  const byVoice = {};
  for (const n of [...(d.rh || []), ...(d.lh || [])]) {
    const v = n.voice || 1;
    (byVoice[v] = byVoice[v] || []).push(n.letter);
  }
  const voiceKeys = Object.keys(byVoice);
  if (voiceKeys.length > 1) {
    html += `<h4>Voices</h4><ul>${voiceKeys
      .map((v) => `<li>Voice ${v}: ${escapeHtml(byVoice[v].join(" "))}</li>`)
      .join("")}</ul>`;
  }

  $("help-body").innerHTML = html;
}

function showHelpAbout() {
  const o = state.piece?.overview || {};
  $("help-empty").hidden = true;
  $("help-body").hidden = false;
  let html = `<h3>${escapeHtml(o.title || state.piece?.title || "About")}</h3>`;
  if (o.composer) html += `<p>${escapeHtml(o.composer)}</p>`;
  if (o.history) {
    html += `<h4>History</h4><p>${escapeHtml(o.history)}</p>`;
  } else {
    html += `<p class="dim">No encyclopaedia entry found offline for this title.</p>`;
  }
  if (o.playing?.length) {
    html += `<h4>In this score</h4><ul>${o.playing
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join("")}</ul>`;
  }
  if (o.imslpSearch) {
    html += `<h4>Find the score</h4><p><a href="${o.imslpSearch}" target="_blank" rel="noreferrer" style="color:var(--accent)">Public-domain editions on IMSLP</a></p>`;
  }
  html += `<p style="margin-top:16px"><button type="button" class="primary" id="about-open-file">Open MusicXML / PDF / photo</button></p>`;
  $("help-body").innerHTML = html;
  document.getElementById("about-open-file")?.addEventListener("click", () => $("file").click());
}

async function askPlan() {
  if (!state.piece?.musicxml) {
    toast("Open a MusicXML score first");
    return;
  }
  toast("Building plan for this bar…");
  const bars = state.selected ? [state.selected] : [];
  const res = await fetch("/api/piece/practice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ musicxml: state.piece.musicxml, bars }),
  });
  if (!res.ok) {
    toast("Could not build plan");
    return;
  }
  const plan = await res.json();
  $("help-empty").hidden = true;
  $("help-body").hidden = false;
  $("help-body").innerHTML = `<h3>Practice plan</h3><p>${plan.totalMinutes} minutes · focused on bar ${
    state.selected || (plan.focusBars || [])[0] || "?"
  }</p><ul>${(plan.steps || [])
    .map((s) => `<li><strong>${escapeHtml(s.title)}</strong> (${s.minutes}m) — ${escapeHtml(s.detail)}</li>`)
    .join("")}</ul>`;
}

/* ---------- OSMD / PDF / image ---------- */

async function renderOsmd(musicxml) {
  $("osmd").hidden = false;
  const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay($("osmd"), {
    autoResize: true,
    backend: "svg",
    drawTitle: false,
    drawComposer: false,
    drawCredits: false,
    drawPartNames: false,
    drawMeasureNumbers: true,
  });
  state.osmd = osmd;
  await osmd.load(musicxml);
  osmd.render();
}

async function renderPdf(dataUrl) {
  $("scan").hidden = false;
  $("scan").innerHTML = "";
  const raw = atob(dataUrl.split(",")[1] || "");
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  for (let n = 1; n <= Math.min(pdf.numPages, 6); n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 1.3 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    $("scan").appendChild(canvas);
  }
}

function renderImage(dataUrl) {
  $("scan").hidden = false;
  $("scan").innerHTML = "";
  const img = document.createElement("img");
  img.src = dataUrl;
  img.alt = "Score page";
  $("scan").appendChild(img);
}

/* ---------- wire up ---------- */

function bind() {
  $("top-search").addEventListener("submit", (e) => {
    e.preventDefault();
    search($("q").value);
  });

  let timer;
  $("q").addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => search($("q").value), 250);
  });

  $("q").addEventListener("focus", () => {
    if ($("q").value.trim().length >= 2) search($("q").value);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".top-search") && !e.target.closest(".results")) {
      $("results").hidden = true;
    }
  });

  $("btn-open").addEventListener("click", () => $("file").click());
  $("btn-sample").addEventListener("click", () => openSample().catch((e) => toast(e.message)));
  $("btn-about").addEventListener("click", showHelpAbout);
  $("btn-plan").addEventListener("click", () => askPlan().catch((e) => toast(e.message)));

  $("file").addEventListener("change", () => {
    const f = $("file").files?.[0];
    $("file").value = "";
    if (f) openFile(f).catch((e) => toast(e.message));
  });
}

bind();
