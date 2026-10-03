/* Lune — Repertoire, bar notes (typed or spoken), review scheduling,
 * teacher assignment links, reading & access settings.
 *
 * Loaded after app.js and uses its globals (state, $, toast, escapeHtml,
 * openPieceSession, applyRoute, setBarSelection, debriefFor, …).
 * Storage goes through LuneStore (this browser, or a Supabase account).
 */
window.LunePractice = (function () {
  const store = window.LuneStore;
  const STATUS = [
    ["learning", "Learning"],
    ["polishing", "Polishing"],
    ["ready", "Ready"],
  ];
  const GRADES = [
    ["again", "Again", "Still falling apart — bring it back in 10 minutes"],
    ["hard", "Hard", "Got through it, with effort"],
    ["good", "Good", "Solid at this tempo"],
    ["easy", "Easy", "Effortless — leave it for a while"],
  ];

  let notesCache = { key: "", rows: [] };
  let assignment = null; // teacher link currently open (not yet saved)
  let pendingAttach = null; // Repertoire piece waiting for its uploaded score
  let coachToken = 0;
  let repertoireKeys = new Set();
  let brailleIndex = null;

  /* ---------------- small helpers ---------------- */

  const esc = (s) => escapeHtml(String(s ?? ""));
  function hashText(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36);
  }
  function slug(s) {
    return String(s || "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
  }
  /** Stable key for a piece: its catalogue id, or a fingerprint of an upload. */
  function keyFor(piece) {
    if (!piece) return "";
    if (piece.repKey) return piece.repKey;
    if (!piece.local) return pieceRouteId(piece);
    const xml = piece.musicxml || "";
    piece.repKey = `upload-${slug(piece.title || "score") || "score"}-${hashText(xml.slice(0, 4000) + xml.length)}`;
    return piece.repKey;
  }
  function titleFor(piece) {
    return piece?.overview?.title || piece?.title || "Untitled";
  }
  function composerFor(piece) {
    return piece?.overview?.composer || piece?.composer || "";
  }
  function ago(iso) {
    if (!iso) return "not yet";
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 90) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    const d = Math.round(s / 86400);
    return d === 1 ? "yesterday" : `${d} days ago`;
  }
  function untilText(iso) {
    const s = (new Date(iso).getTime() - Date.now()) / 1000;
    if (s <= 60) return "now";
    if (s < 3600) return `in ${Math.round(s / 60)} min`;
    if (s < 86400) return `in ${Math.round(s / 3600)} h`;
    const d = Math.round(s / 86400);
    return d === 1 ? "tomorrow" : `in ${d} days`;
  }
  function barsText(bars) {
    const b = [...new Set(bars)].sort((x, y) => x - y);
    if (!b.length) return "";
    const runs = [];
    let start = b[0];
    let prev = b[0];
    for (const n of b.slice(1).concat([null])) {
      if (n === prev + 1) {
        prev = n;
        continue;
      }
      runs.push(start === prev ? `${start}` : `${start}–${prev}`);
      start = prev = n;
    }
    return `${b.length === 1 ? "bar" : "bars"} ${runs.join(", ")}`;
  }
  async function refreshRepertoireKeys() {
    try {
      repertoireKeys = new Set((await store.listPieces()).map((p) => p.piece_key));
    } catch {
      repertoireKeys = new Set();
    }
    syncAddButtons();
  }

  /* ---------------- notes: tags and spoken commands ---------------- */

  const TAG_RULES = [
    [/\b(fast(er)?|slow(er)?|tempo|speed|rush(ing)?|steady|metronome|drag(ging)?|time)\b/i, "tempo"],
    [/\b(loud(er)?|soft(er)?|quiet(er)?|forte|piano|crescendo|cresc|diminuendo|dim|dynamics?|accent|sing|voic(e|ing))\b/i, "dynamics"],
    [/\b(finger(s|ing)?|thumb|[1-5]\s*(on|to)\s*[1-5]|cross(ing)?|stretch)\b/i, "fingering"],
    [/\b(memor(y|ise|ize)|by heart|remember|forget|forgot)\b/i, "memory"],
    [/\bpedal(ling)?\b/i, "pedal"],
    [/\b(legato|staccato|slur|phras(e|ing)|smooth|detached|touch|lift)\b/i, "touch"],
    [/\b(left hand|l\.?h\.?)\b/i, "left hand"],
    [/\b(right hand|r\.?h\.?)\b/i, "right hand"],
    [/\b(hard|tricky|difficult|messy|stumble|wrong)\b/i, "tricky"],
  ];
  function tagsFor(text) {
    return [...new Set(TAG_RULES.filter(([re]) => re.test(text)).map(([, t]) => t))];
  }
  const NUM_WORDS = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
    eighty: 80, ninety: 90, for: 4, to: 2, too: 2, won: 1, ate: 8,
  };
  function wordsToNumber(str) {
    const parts = String(str).toLowerCase().split(/[\s-]+/).filter(Boolean);
    let total = 0;
    let hundred = 0;
    let used = 0;
    for (const w of parts) {
      if (/^\d+$/.test(w)) return { n: Number(w), used: used + 1 };
      if (w === "hundred") {
        hundred = (total || 1) * 100;
        total = 0;
      } else if (w === "and" && hundred) {
        /* "one hundred and four" */
      } else if (w in NUM_WORDS) {
        const v = NUM_WORDS[w];
        if (total && v >= 10 && total % 10 === 0) break; // "twenty thirty" → stop
        total += v;
      } else break;
      used++;
    }
    const n = hundred + total;
    return used && n > 0 ? { n, used } : null;
  }
  /**
   * "Lune, bar 12: play faster here" → { bar: 12, body: "Play faster here" }.
   * Without a bar number the note goes on the bar that is selected.
   */
  function parseSpoken(raw, fallbackBar = null) {
    let text = String(raw || "").trim();
    text = text.replace(/^(hey\s+)?(lune|loon|moon|luna)[,.:!]?\s*/i, "");
    text = text.replace(/^(please\s+)?(annotate|note|mark|add a note( to)?|remember)\s*[,:]?\s*/i, "");
    let bar = null;
    const m = text.match(/\b(?:in\s+|on\s+|at\s+)?(?:bar|measure|bars|measures)\s+(?:number\s+)?([a-z0-9\s-]+)/i);
    if (m) {
      const num = wordsToNumber(m[1]);
      if (num) {
        bar = num.n;
        const words = m[1].trim().split(/[\s-]+/);
        const consumed = words.slice(0, num.used).join("[\\s-]+");
        const re = new RegExp(`\\b(?:in\\s+|on\\s+|at\\s+)?(?:bar|measure|bars|measures)\\s+(?:number\\s+)?${consumed}\\b\\s*[,.:;-]?\\s*`, "i");
        text = text.replace(re, "").trim();
      }
    }
    text = text.replace(/^[,.:;\-\s]+/, "").replace(/\s+/g, " ").trim();
    if (text) text = text[0].toUpperCase() + text.slice(1);
    return { bar: bar ?? fallbackBar, body: text, hadBar: bar != null };
  }

  async function notesFor(key, { fresh = false } = {}) {
    if (!fresh && notesCache.key === key) return notesCache.rows;
    let rows = [];
    try {
      rows = await store.listNotes(key);
    } catch (err) {
      console.warn("[lune] notes", err);
    }
    notesCache = { key, rows };
    return rows;
  }
  async function saveNote(bar, body, source = "text") {
    const piece = state.piece;
    const key = keyFor(piece);
    if (!key) throw new Error("Open a piece first.");
    if (!repertoireKeys.has(key)) await addCurrentToRepertoire({ quiet: true });
    const row = await store.addNote({ pieceKey: key, bar, body, tags: tagsFor(body), source });
    if (/\b(hard|tricky|difficult|messy|again)\b/i.test(body)) await store.queueBar(key, bar);
    await notesFor(key, { fresh: true });
    paintScoreMarks();
    return row;
  }

  /* ---------------- voice ---------------- */

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let activeRec = null;
  function canListenForWords() {
    return !!Recognition;
  }
  /** One spoken phrase → text. onPartial gets interim words while speaking. */
  function hearPhrase({ onPartial } = {}) {
    return new Promise((resolve, reject) => {
      if (!Recognition) {
        reject(new Error("Voice notes need Chrome, Edge or Safari — you can type the note instead."));
        return;
      }
      try {
        activeRec?.abort();
      } catch {
        /* ignore */
      }
      const rec = new Recognition();
      activeRec = rec;
      rec.lang = navigator.language || "en-GB";
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.continuous = false;
      let finalText = "";
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText += t;
          else interim += t;
        }
        onPartial?.((finalText + " " + interim).trim());
      };
      rec.onerror = (e) => {
        activeRec = null;
        const why =
          e.error === "not-allowed" || e.error === "service-not-allowed"
            ? "Lune needs microphone permission to hear your note."
            : e.error === "no-speech"
              ? "Didn’t catch that — try again a little closer to the mic."
              : "Voice notes aren’t available right now — type the note instead.";
        reject(new Error(why));
      };
      rec.onend = () => {
        activeRec = null;
        resolve(finalText.trim());
      };
      rec.start();
    });
  }
  function stopHearing() {
    try {
      activeRec?.stop();
    } catch {
      /* ignore */
    }
  }

  /** "Tell Lune" button on the score: speak a note for any bar, hands free. */
  async function tellLune(btn) {
    if (activeRec) {
      stopHearing();
      return;
    }
    if (!state.piece) return;
    btn?.classList.add("on");
    btn?.setAttribute("aria-pressed", "true");
    toast("Listening — say “bar 12, play faster here”");
    try {
      const said = await hearPhrase({ onPartial: (t) => t && toast(`“${t}”`) });
      if (!said) return;
      const sel = state.selected || selectedBarsSorted()[0] || null;
      const { bar, body } = parseSpoken(said, sel);
      if (!body) {
        toast("Heard a bar number but no note — try again.");
        return;
      }
      if (!bar) {
        toast("Which bar? Say “bar” and its number, or tap a bar first.");
        return;
      }
      if (!debriefFor(bar)) {
        toast(`This piece has no bar ${bar}.`);
        return;
      }
      await saveNote(bar, body, "voice");
      toast(`Noted on bar ${bar}: ${body}`);
      if (state.coachOpen && selectedBarsSorted().includes(bar)) openBarCoach();
    } catch (err) {
      toast(err.message);
    } finally {
      btn?.classList.remove("on");
      btn?.setAttribute("aria-pressed", "false");
    }
  }

  /* ---------------- spoken bar descriptions ---------------- */

  function sayPitch(letter) {
    return String(letter || "")
      .replace(/♯♯|##/g, " double sharp")
      .replace(/♭♭|bb(?=\b|\d)/g, " double flat")
      .replace(/♯|#/g, " sharp")
      .replace(/♭/g, " flat")
      .replace(/\d+$/, "");
  }
  function handWords(notes, label) {
    if (!notes?.length) return `${label}: rests.`;
    const groups = groupByOffset(notes);
    const parts = groups.map((g) =>
      g.length > 1
        ? `chord ${g.map((n) => sayPitch(n.letter || n.pitch)).join(", ")}`
        : sayPitch(g[0].letter || g[0].pitch)
    );
    const fingers = groups
      .map((g) => g.map((n) => n.fingering).filter(Boolean).join(" "))
      .filter(Boolean);
    let s = `${label}: ${parts.join(", ")}.`;
    if (fingers.length) s += ` Fingers ${fingers.join(", ")}.`;
    return s;
  }
  function describeBar(num) {
    const d = debriefFor(num);
    if (!d) return `Bar ${num} has no notes Lune can read.`;
    let s = `Bar ${num}. ${handWords(d.rh, "Right hand")} ${handWords(d.lh, "Left hand")}`;
    const tip = Array.isArray(d.advice) ? d.advice[0] : d.advice;
    if (tip) s += ` Tip: ${String(tip).replace(/[—–]/g, ",")}`;
    return s;
  }
  function speak(text) {
    if (!("speechSynthesis" in window)) {
      toast("This browser can’t read aloud.");
      return;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = Number(store.prefs().speechRate) || 0.95;
    u.lang = navigator.language || "en-GB";
    speechSynthesis.speak(u);
  }
  function readSelectedAloud() {
    const bars = selectedBarsSorted();
    if (!bars.length) {
      speak("Select a bar first. Use the arrow keys to move between bars.");
      return;
    }
    speak(bars.slice(0, 4).map(describeBar).join(" "));
  }

  /* ---------------- coach: notes, review, aloud, assign ---------------- */

  async function decorateCoach(bars) {
    const body = $("help-body");
    if (!body || !bars?.length || !state.piece) return;
    const token = ++coachToken;
    const key = keyFor(state.piece);
    const primary = bars[0];
    const wrap = document.createElement("section");
    wrap.className = "lp-coach";
    wrap.innerHTML = `
      <div class="lp-teacher" hidden></div>
      <h4 class="lp-h">Your notes</h4>
      <ul class="lp-notes" aria-live="polite"><li class="lp-empty">Nothing yet.</li></ul>
      <form class="lp-note-form" autocomplete="off">
        <label class="visually-hidden" for="lp-note-input">Note for bar ${primary}</label>
        <div class="lp-note-grow">
          <textarea id="lp-note-input" rows="1" maxlength="500" placeholder="Note for bar ${primary}, or say it"></textarea>
          <button type="button" class="icon-btn lp-mic" data-lp="mic" aria-label="Tell Lune" aria-pressed="false" ${canListenForWords() ? "" : "hidden"}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            <span class="visually-hidden">Speak</span>
          </button>
        </div>
        <button type="submit" class="lp-save primary">Save</button>
      </form>
      <h4 class="lp-h">How did it go?</h4>
      <div class="lp-grades" role="group" aria-label="Rate this practice">
        ${GRADES.map(([g, label, hint]) => `<button type="button" class="lp-grade lp-${g}" data-grade="${g}" title="${esc(hint)}">${label}</button>`).join("")}
      </div>
      <p class="lp-due dim"></p>`;
    body.appendChild(wrap);

    const list = wrap.querySelector(".lp-notes");
    const dueEl = wrap.querySelector(".lp-due");
    const renderNotes = async (fresh = false) => {
      const rows = (await notesFor(key, { fresh })).filter((n) => n.bar === primary);
      if (token !== coachToken) return;
      list.innerHTML = rows.length
        ? rows
            .map(
              (n) => `<li class="lp-note lp-src-${esc(n.source)}">
                <p>${esc(n.body)}</p>
                <span class="lp-meta">${n.source === "voice" ? "spoken · " : n.source === "teacher" ? "teacher · " : ""}${esc(ago(n.created_at))}${(n.tags || []).length ? " · " + n.tags.map(esc).join(", ") : ""}</span>
                <button type="button" class="lp-del" data-del="${esc(n.id)}" aria-label="Delete note">×</button>
              </li>`
            )
            .join("")
        : `<li class="lp-empty">Nothing yet.</li>`;
    };
    const renderDue = async () => {
      try {
        const cards = (await store.listCards(key)).filter((c) => bars.includes(c.bar));
        if (token !== coachToken) return;
        if (!cards.length) {
          dueEl.textContent = "Rate it after you practise. Lune brings it back at the right time.";
          return;
        }
        const c = cards.sort((a, b) => a.due_at.localeCompare(b.due_at))[0];
        dueEl.textContent = `Next review ${untilText(c.due_at)}${c.reps ? ` · reviewed ${c.reps}×` : ""}.`;
      } catch {
        dueEl.textContent = "";
      }
    };
    renderNotes();
    renderDue();

    // teacher assignment notes for this bar (link opened but not saved yet)
    if (assignment && assignment.key === key) {
      const t = assignment.notes.filter((n) => n.b === primary);
      const box = wrap.querySelector(".lp-teacher");
      if (t.length || assignment.bars.includes(primary)) {
        box.hidden = false;
        box.innerHTML = `<strong>${esc(assignment.by || "Your teacher")}</strong>${t.length ? t.map((n) => `<p>${esc(n.x)}</p>`).join("") : "<p>Assigned for practice.</p>"}`;
      }
    }

    wrap.addEventListener("click", async (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.dataset.lp === "aloud") readSelectedAloud();
      else if (btn.dataset.lp === "assign") openAssignDialog(bars);
      else if (btn.dataset.lp === "mic") {
        if (activeRec) return stopHearing();
        const ta = wrap.querySelector("textarea");
        btn.classList.add("on");
        btn.setAttribute("aria-pressed", "true");
        btn.querySelector("span").textContent = "Listening…";
        try {
          const said = await hearPhrase({ onPartial: (t) => (ta.value = t) });
          const parsed = parseSpoken(said, primary);
          if (!parsed.body) return;
          await saveNote(parsed.bar, parsed.body, "voice");
          ta.value = "";
          toast(parsed.bar === primary ? "Note saved" : `Saved on bar ${parsed.bar}`);
          renderNotes(true);
        } catch (err) {
          toast(err.message);
        } finally {
          btn.classList.remove("on");
          btn.setAttribute("aria-pressed", "false");
          btn.querySelector("span").textContent = "Speak";
        }
      } else if (btn.dataset.del) {
        await store.deleteNote(btn.dataset.del);
        await notesFor(key, { fresh: true });
        paintScoreMarks();
        renderNotes();
      } else if (btn.dataset.grade) {
        const g = btn.dataset.grade;
        try {
          if (!repertoireKeys.has(key)) await addCurrentToRepertoire({ quiet: true });
          let last = null;
          for (const b of bars) last = await store.reviewBar(key, b, g);
          wrap.querySelectorAll(".lp-grade").forEach((x) => x.classList.toggle("picked", x === btn));
          toast(`${barsText(bars)[0].toUpperCase() + barsText(bars).slice(1)} — next review ${untilText(last.due_at)}`);
          renderDue();
          refreshBadge();
        } catch (err) {
          toast(err.message);
        }
      }
    });
    wrap.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const ta = wrap.querySelector("textarea");
      const text = ta.value.trim();
      if (!text) return ta.focus();
      try {
        const parsed = parseSpoken(text, primary);
        // typed notes keep their wording; only an explicit "bar N" moves them
        await saveNote(parsed.hadBar ? parsed.bar : primary, parsed.hadBar ? parsed.body : text, "text");
        ta.value = "";
        renderNotes(true);
      } catch (err) {
        toast(err.message);
      }
    });
    const ta = wrap.querySelector("textarea");
    const growNote = () => {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(72, Math.max(44, ta.scrollHeight))}px`;
    };
    ta.addEventListener("input", growNote);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) wrap.querySelector("form").requestSubmit();
      e.stopPropagation();
    });
    if (store.prefs().autoRead) readSelectedAloud();
  }

  /* ---------------- markers on the score ---------------- */

  async function paintScoreMarks() {
    const scroll = $("score-scroll");
    if (!scroll || !state.piece || !state.osmd) return;
    let layer = $("lp-marks");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "lp-marks";
      layer.className = "lp-marks";
      scroll.appendChild(layer);
      layer.addEventListener("click", (e) => {
        const m = e.target.closest("[data-bar]");
        if (m) setBarSelection([Number(m.dataset.bar)], { open: true });
      });
    }
    const key = keyFor(state.piece);
    const rows = await notesFor(key);
    const heat = state.lpHeat?.key === key ? state.lpHeat.map : null;
    const host = $("osmd");
    layer.innerHTML = "";
    if (state.panel !== "score") return;
    const counts = {};
    for (const n of rows) counts[n.bar] = (counts[n.bar] || 0) + 1;
    if (assignment && assignment.key === key) for (const b of assignment.bars) counts[b] = counts[b] || 0;
    const frag = document.createDocumentFragment();
    if (heat) {
      const max = Math.max(1, ...Object.values(heat).map((v) => v.wrong + 2 * v.hesitations));
      for (const [bar, v] of Object.entries(heat)) {
        const b = LuneAnnotate.measureBoundsInHost?.(state.osmd, host, Number(bar));
        if (!b) continue;
        const sev = (v.wrong + 2 * v.hesitations) / max;
        const el = document.createElement("div");
        el.className = "lp-heat";
        el.style.cssText = `left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;opacity:${(0.18 + 0.5 * sev).toFixed(2)}`;
        el.title = `Bar ${bar}: ${v.wrong} wrong, ${v.hesitations} hesitation${v.hesitations === 1 ? "" : "s"}`;
        frag.appendChild(el);
      }
    }
    for (const [bar, n] of Object.entries(counts)) {
      const b = LuneAnnotate.measureBoundsInHost?.(state.osmd, host, Number(bar));
      if (!b) continue;
      const el = document.createElement("button");
      el.type = "button";
      el.className = "lp-mark" + (n ? "" : " lp-mark-assigned");
      el.dataset.bar = bar;
      el.style.left = `${b.left + b.width - 4}px`;
      el.style.top = `${b.top - 6}px`;
      el.setAttribute("aria-label", n ? `Bar ${bar}: ${n} note${n === 1 ? "" : "s"}` : `Bar ${bar}: assigned`);
      el.textContent = n ? String(n) : "★";
      frag.appendChild(el);
    }
    layer.appendChild(frag);
  }

  /* ---------------- Repertoire: add / open ---------------- */

  async function addCurrentToRepertoire({ quiet = false } = {}) {
    const piece = state.piece;
    if (!piece) return;
    const key = keyFor(piece);
    await store.addPiece({
      piece_key: key,
      title: titleFor(piece),
      composer: composerFor(piece),
      source: piece.local ? "upload" : "catalogue",
      musicxml: piece.local ? piece.musicxml || state.rawMusicxml : null,
    });
    repertoireKeys.add(key);
    syncAddButtons();
    if (!quiet) toast(`Added to your Repertoire`);
  }
  function syncAddButtons() {
    const key = state.piece ? keyFor(state.piece) : "";
    for (const b of document.querySelectorAll("[data-lp-add]")) {
      const inRep = key && repertoireKeys.has(key);
      b.classList.toggle("in", !!inRep);
      b.setAttribute("aria-pressed", inRep ? "true" : "false");
      const label = inRep ? "In Repertoire" : "Add to Repertoire";
      b.setAttribute("aria-label", label);
      b.title = label;
      const el = b.querySelector(".lp-add-label");
      if (el) el.textContent = label;
    }
  }

  async function waitForScore(timeout = 60000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (state.panel === "score" && state.osmd && document.querySelector("#osmd svg")) return true;
      await new Promise((r) => setTimeout(r, 120));
    }
    return false;
  }
  function scrollToBar(num) {
    const scroller = $("score-scroll");
    const b = LuneAnnotate.measureBoundsInHost?.(state.osmd, $("osmd"), num);
    if (!scroller || !b) return;
    const sr = scroller.getBoundingClientRect();
    const sheetTop = state.coachOpen && window.innerWidth <= 760 ? $("coach")?.getBoundingClientRect().top || sr.bottom : sr.bottom;
    if (b.screenTop >= sr.top + 8 && b.screenBottom <= sheetTop - 8) return;
    scroller.scrollBy({ top: b.screenTop - sr.top - Math.min(120, sr.height * 0.2), behavior: "smooth" });
  }

  async function openFromRepertoire(key, { bar = null } = {}) {
    const row = await store.getPiece(key);
    const isUpload = row?.source === "upload" || key.startsWith("upload-");
    if (isUpload) {
      const open = state.sessions.find((s) => s.piece && keyFor(s.piece) === key);
      if (open) {
        await activateSession(open.id);
        await switchToScorePanel();
      } else {
        const xml = await store.loadUploadedScore(key);
        if (!xml) {
          pendingAttach = { key, title: row?.title || "your piece" };
          toast(`Choose the score file for “${row?.title || "this piece"}” to open it.`);
          $("file")?.click();
          return;
        }
        const piece = LuneLite.analyze(xml, { filename: `${row?.title || "score"}.musicxml` });
        piece.repKey = key;
        if (row?.title) piece.title = row.title;
        await openPieceSession(piece, { panel: "score" });
      }
    } else {
      try {
        history.pushState({ lune: key }, "", `${location.pathname}${location.search}#/${key}/score`);
      } catch {
        location.hash = `#/${key}/score`;
        return;
      }
      await applyRoute();
    }
    if (bar && (await waitForScore())) {
      setBarSelection([bar], { open: true });
      requestAnimationFrame(() => scrollToBar(bar));
    }
  }

  /** Called by app.js after an uploaded score opens. */
  async function onUploadOpened(piece, xml) {
    if (!pendingAttach) return;
    const { key, title } = pendingAttach;
    pendingAttach = null;
    piece.repKey = key;
    piece.title = title;
    try {
      await store.addPiece({ piece_key: key, title, composer: piece.composer || "", source: "upload", musicxml: xml });
      repertoireKeys.add(key);
      syncAddButtons();
      toast(`Score attached to “${title}”`);
    } catch (err) {
      toast(err.message);
    }
  }

  /* ---------------- Repertoire view ---------------- */

  function ensureRepertoireView() {
    let main = $("repertoire");
    if (main) return main;
    main = document.createElement("main");
    main.id = "repertoire";
    main.className = "repertoire";
    main.hidden = true;
    main.innerHTML = `
      <div class="rep-inner">
        <header class="rep-hero">
          <p class="eyebrow">Your practice</p>
          <h1>Repertoire</h1>
          <p class="rep-lead">The pieces you’re learning — with your notes on every bar, and the bars that need you today.</p>
          <div class="rep-account" id="rep-account"></div>
        </header>
        <section class="rep-section" id="rep-add-section" aria-labelledby="rep-add-h">
          <h2 id="rep-add-h">Add a piece</h2>
          <form class="rep-add" id="rep-add" autocomplete="off">
            <input id="rep-add-q" type="search" placeholder="Type a piece — e.g. Für Elise, Gymnopédie, Chopin nocturne" aria-label="Piece you’re learning">
            <button type="submit" class="quiet">Add</button>
          </form>
          <ul class="rep-suggest" id="rep-suggest" role="listbox" aria-label="Pieces Lune has"></ul>
        </section>
        <section class="rep-section" aria-labelledby="rep-today-h">
          <div class="rep-today-head">
            <h2 id="rep-today-h">Today’s bars</h2>
            <button type="button" class="primary" id="rep-start" hidden>Start practice</button>
          </div>
          <div id="rep-today" class="rep-today"></div>
        </section>
        <section class="rep-section" aria-labelledby="rep-list-h">
          <h2 id="rep-list-h">Pieces</h2>
          <div id="rep-list" class="rep-list"></div>
        </section>
        <footer class="rep-foot">
          <button type="button" class="link-btn" data-lp-access>Reading &amp; access</button>
          <span aria-hidden="true">·</span>
          <button type="button" class="link-btn" id="rep-export">Download my data</button>
          <span aria-hidden="true">·</span>
          <a class="link-btn" href="#/study">Reading study</a>
        </footer>
      </div>`;
    $("studio")?.after(main);
    const form = main.querySelector("#rep-add");
    const q = main.querySelector("#rep-add-q");
    q.addEventListener("input", () => paintSuggestions(q.value));
    q.addEventListener("keydown", (e) => e.stopPropagation());
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const first = main.querySelector("#rep-suggest [data-add]");
      if (first) first.click();
      else if (q.value.trim()) addTyped(q.value.trim());
    });
    main.querySelector("#rep-suggest").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-add], [data-add-typed]");
      if (!b) return;
      if (b.dataset.addTyped != null) return addTyped(q.value.trim());
      await store.addPiece({ piece_key: b.dataset.add, title: b.dataset.title, composer: b.dataset.composer || "" });
      q.value = "";
      paintSuggestions("");
      toast(`Added ${b.dataset.title}`);
      await renderRepertoire();
    });
    main.querySelector("#rep-export").addEventListener("click", exportData);
    main.addEventListener("click", onRepertoireClick);
    main.addEventListener("change", async (e) => {
      const sel = e.target.closest("select[data-status]");
      if (sel) {
        await store.updatePiece(sel.dataset.status, { status: sel.value });
        toast("Status updated");
      }
    });
    return main;
  }
  async function addTyped(text) {
    if (!text) return;
    const key = `upload-${slug(text)}-${hashText(text)}`;
    await store.addPiece({ piece_key: key, title: text.slice(0, 200), source: "upload" });
    $("rep-add-q").value = "";
    paintSuggestions("");
    toast(`Added “${text}” — attach its score when you have it`);
    await renderRepertoire();
  }
  function paintSuggestions(text) {
    const ul = $("rep-suggest");
    if (!ul) return;
    const q = text.trim();
    if (!q) {
      ul.innerHTML = "";
      return;
    }
    let hits = [];
    try {
      hits = filterSearchIndex(q, 6) || [];
    } catch {
      hits = [];
    }
    const items = hits
      .filter((h) => h.openable !== false && h.kind !== "composer")
      .map((h) => {
        // the key a piece gets once opened: catalogue id (static) or its query words
        const id = LUNE_ON_PAGES ? h.query || h.id : pieceRouteId({ openQuery: h.query || h.title, title: h.title });
        return `<li><button type="button" class="rep-sug" data-add="${esc(id)}" data-title="${esc(h.title)}" data-composer="${esc(h.composer || "")}">
          <span class="rep-sug-t">${esc(h.title)}</span><span class="rep-sug-c">${esc(h.composer || "")}</span>
          <span class="rep-sug-go">${repertoireKeys.has(id) ? "Added" : "Add"}</span></button></li>`;
      })
      .join("");
    ul.innerHTML =
      items +
      `<li><button type="button" class="rep-sug rep-sug-typed" data-add-typed>
        <span class="rep-sug-t">Add “${esc(q)}”</span><span class="rep-sug-c">Not in Lune’s library — attach your own score later</span></button></li>`;
  }

  async function renderAccountChip() {
    const box = $("rep-account");
    if (!box) return;
    const st = store.status();
    if (st.signedIn) {
      box.innerHTML = `<span class="rep-acct-text"><span class="rep-acct-dot on"></span>Synced to ${esc(st.email)}</span>
        <button type="button" class="link-btn" data-lp-account>Account</button>`;
    } else if (st.cloud) {
      box.innerHTML = `<span class="rep-acct-text"><span class="rep-acct-dot"></span>Saved in this browser</span>
        <button type="button" class="quiet" data-lp-account>Sign in to sync</button>`;
    } else {
      box.innerHTML = `<span class="rep-acct-text"><span class="rep-acct-dot"></span>Saved in this browser</span>
        <button type="button" class="link-btn" data-lp-account>Account</button>`;
    }
  }

  async function renderRepertoire() {
    ensureRepertoireView();
    renderAccountChip();
    const listEl = $("rep-list");
    const todayEl = $("rep-today");
    let pieces = [];
    let due = [];
    let counts = {};
    let cards = [];
    try {
      [pieces, due, counts, cards] = await Promise.all([
        store.listPieces(),
        store.dueCards(40),
        store.countNotesByPiece(),
        store.listCards(),
      ]);
    } catch (err) {
      listEl.innerHTML = `<p class="rep-empty">Couldn’t load your Repertoire: ${esc(err.message)}</p>`;
      return;
    }
    repertoireKeys = new Set(pieces.map((p) => p.piece_key));
    refreshBadge();
    const byKey = Object.fromEntries(pieces.map((p) => [p.piece_key, p]));

    // today's bars, grouped by piece
    const groups = {};
    for (const c of due) (groups[c.piece_key] = groups[c.piece_key] || []).push(c.bar);
    const gKeys = Object.keys(groups);
    const start = $("rep-start");
    if (start) {
      start.hidden = !gKeys.length;
      if (gKeys.length) {
        const firstKey = gKeys[0];
        const firstBar = groups[firstKey].slice().sort((a, b) => a - b)[0];
        start.dataset.open = firstKey;
        start.dataset.bar = String(firstBar);
      }
    }
    todayEl.innerHTML = gKeys.length
      ? gKeys
          .map(
            (k) => `<div class="rep-today-row">
              <div class="rep-today-t">${esc(byKey[k]?.title || k)}</div>
              <div class="rep-today-bars">${groups[k]
                .sort((a, b) => a - b)
                .map((b) => `<button type="button" class="rep-bar" data-open="${esc(k)}" data-bar="${b}">Bar ${b}</button>`)
                .join("")}</div></div>`
          )
          .join("")
      : `<p class="rep-empty">${
          cards.length
            ? "Nothing due — every bar you rated is resting. Come back tomorrow."
            : "When you finish practising a bar, tap <em>Again · Hard · Good · Easy</em> in its panel. Lune brings it back here just before you’d forget it."
        }</p>`;

    const dueByPiece = {};
    for (const c of due) dueByPiece[c.piece_key] = (dueByPiece[c.piece_key] || 0) + 1;
    listEl.innerHTML = pieces.length
      ? pieces
          .map((p) => {
            const n = counts[p.piece_key] || 0;
            const d = dueByPiece[p.piece_key] || 0;
            return `<article class="rep-card" data-key="${esc(p.piece_key)}">
              <div class="rep-card-main">
                <h3>${esc(p.title)}</h3>
                <p class="rep-card-by">${esc(p.composer || (p.source === "upload" ? "Your score" : ""))}</p>
                <p class="rep-card-meta">Last practised ${esc(ago(p.last_practised_at))}${n ? ` · ${n} note${n === 1 ? "" : "s"}` : ""}${d ? ` · <strong>${d} bar${d === 1 ? "" : "s"} due</strong>` : ""}</p>
              </div>
              <div class="rep-card-actions">
                <label class="visually-hidden" for="st-${esc(p.piece_key)}">Status</label>
                <select id="st-${esc(p.piece_key)}" data-status="${esc(p.piece_key)}">
                  ${STATUS.map(([v, l]) => `<option value="${v}" ${p.status === v ? "selected" : ""}>${l}</option>`).join("")}
                </select>
                <button type="button" class="primary" data-open="${esc(p.piece_key)}">Open</button>
                <button type="button" class="icon-btn" data-card-more="${esc(p.piece_key)}" aria-label="More for ${esc(p.title)}" title="More">
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="6" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18" cy="12" r="1.4" fill="currentColor"/></svg>
                </button>
                <button type="button" class="quiet rep-remove" hidden data-remove="${esc(p.piece_key)}" aria-label="Remove ${esc(p.title)}">Remove</button>
              </div>
            </article>`;
          })
          .join("")
      : `<p class="rep-empty">Your Repertoire is empty. Type a piece above, or press <em>Add to Repertoire</em> on any score.</p>`;
    const addSec = $("rep-add-section");
    const todaySec = $("rep-today")?.closest(".rep-section");
    const listWrap = $("rep-list")?.closest(".rep-section");
    if (addSec) {
      if (!pieces.length) {
        const hero = document.querySelector(".rep-hero");
        if (hero) hero.after(addSec);
        $("rep-add-q")?.focus();
      } else if (listWrap) {
        listWrap.after(addSec);
      }
    }
    listEl.querySelectorAll("[data-card-more]").forEach((btn) => {
      const key = btn.dataset.cardMore;
      const piece = pieces.find((p) => p.piece_key === key);
      window.LuneMenu?.attach(btn, () => {
        const items = [
          {
            label: "Remove",
            action: () => {
              const hidden = listEl.querySelector(`[data-remove="${CSS.escape(key)}"]`);
              hidden?.click();
            },
          },
        ];
        if (piece?.source === "upload") {
          items.push({
            label: "Attach score",
            action: () => {
              pendingAttach = { key, title: piece.title || "your piece" };
              $("file")?.click();
            },
          });
        }
        return items;
      });
    });
  }

  async function onRepertoireClick(e) {
    const b = e.target.closest("button, a");
    if (!b) return;
    if (b.hasAttribute("data-lp-account")) return openAccountDialog();
    if (b.hasAttribute("data-lp-access")) return openAccessDialog();
    if (b.dataset.open) {
      e.preventDefault();
      await openFromRepertoire(b.dataset.open, { bar: b.dataset.bar ? Number(b.dataset.bar) : null });
    } else if (b.dataset.remove) {
      if (b.dataset.confirm !== "1") {
        b.dataset.confirm = "1";
        b.textContent = "Remove? (press again)";
        b.classList.add("danger");
        b.hidden = false;
        setTimeout(() => {
          if (b.isConnected) {
            b.dataset.confirm = "";
            b.textContent = "Remove";
            b.classList.remove("danger");
            b.hidden = true;
          }
        }, 3500);
        return;
      }
      await store.removePiece(b.dataset.remove);
      repertoireKeys.delete(b.dataset.remove);
      toast("Removed from Repertoire (your bar notes are kept)");
      renderRepertoire();
    }
  }

  function showRepertoire({ push = true } = {}) {
    ensureRepertoireView();
    stopAll();
    snapshotActiveSession();
    state.mode = "repertoire";
    showView("repertoire");
    renderPieceTabs();
    if (push && location.hash !== "#/repertoire") {
      try {
        history.pushState({ lune: "#/repertoire" }, "Repertoire — Lune", `${location.pathname}${location.search}#/repertoire`);
      } catch {
        /* ignore */
      }
    }
    document.title = "Repertoire — Lune";
    renderRepertoire();
  }

  async function exportData() {
    const data = await store.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "lune-repertoire.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------------- account dialog ---------------- */

  function dialog(id, cls = "lp-dialog") {
    let d = $(id);
    if (!d) {
      d = document.createElement("dialog");
      d.id = id;
      d.className = `credits-dialog ${cls}`;
      document.body.appendChild(d);
      d.addEventListener("click", (e) => {
        if (e.target === d) d.close();
      });
      d.addEventListener("keydown", (e) => e.stopPropagation());
    }
    return d;
  }
  const closeRow = `<form method="dialog" class="credits-close-row"><button type="submit" class="icon-btn" aria-label="Close" title="Close"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></form>`;

  function openAccountDialog() {
    const d = dialog("account-dialog");
    const st = store.status();
    const privacy = `<h3>Privacy</h3>
      <ul>
        <li>An account stores your email address, the pieces in your Repertoire, your bar notes, review dates and listening stumbles — nothing else.</li>
        <li>Your rows are locked to your account: no other user, and no one browsing the site, can read them. Nothing is sold, shared or used for ads.</li>
        <li>Microphone audio for voice notes and listening is processed in your browser (voice notes may use your browser’s own speech service). Lune never records or uploads audio.</li>
        <li>Under 13? Ask a parent or guardian before making an account. You can download or delete everything at any time.</li>
      </ul>`;
    if (!st.cloud) {
      d.innerHTML = `${closeRow}<h2>Account</h2>
        <p>Everything you add — pieces, bar notes, review dates — is saved in this browser. It stays on this device and never leaves it.</p>
        <p class="dim">No sign-up is needed. If you want the same Repertoire on a phone and a laptop, download your data here and keep the file, or ask the site owner to switch on email sign-in.</p>
        <div class="lp-row"><button type="button" class="quiet" data-x="export">Download my data</button></div>${privacy}`;
    } else if (!st.signedIn) {
      d.innerHTML = `${closeRow}<h2>Sign in to sync</h2>
        <p>Keep your Repertoire on every device. Lune emails you a sign-in link — no password to remember.</p>
        <form class="lp-signin" data-x="signin">
          <label for="lp-email">Email</label>
          <input id="lp-email" type="email" autocomplete="email" required placeholder="you@example.com">
          <button type="submit" class="primary">Email me a link</button>
        </form>
        <p class="lp-signin-msg dim" aria-live="polite"></p>${privacy}`;
    } else {
      const local = store.hasLocalData();
      d.innerHTML = `${closeRow}<h2>Account</h2>
        <p>Signed in as <strong>${esc(st.email)}</strong>.</p>
        ${local ? `<p class="lp-callout">This browser also has pieces saved from before you signed in. <button type="button" class="primary" data-x="import">Move them into my account</button></p>` : ""}
        <div class="lp-row">
          <button type="button" class="quiet" data-x="export">Download my data</button>
          <button type="button" class="quiet" data-x="signout">Sign out</button>
          <button type="button" class="quiet danger" data-x="delete">Delete account…</button>
        </div>${privacy}`;
    }
    d.onclick = async (e) => {
      if (e.target === d) return d.close();
      const b = e.target.closest("[data-x]");
      if (!b || b.tagName === "FORM") return;
      try {
        if (b.dataset.x === "export") await exportData();
        if (b.dataset.x === "signout") {
          await store.signOut();
          d.close();
          toast("Signed out");
        }
        if (b.dataset.x === "import") {
          const n = await store.importLocalIntoAccount();
          toast(`Moved ${n} item${n === 1 ? "" : "s"} into your account`);
          openAccountDialog();
        }
        if (b.dataset.x === "delete") {
          if (b.dataset.confirm !== "1") {
            b.dataset.confirm = "1";
            b.textContent = "Press again to delete everything";
            return;
          }
          await store.deleteAccount();
          d.close();
          toast("Account and all its data deleted");
        }
        if (state.mode === "repertoire") renderRepertoire();
      } catch (err) {
        toast(err.message);
      }
    };
    d.querySelector("form[data-x=signin]")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = d.querySelector(".lp-signin-msg");
      const email = d.querySelector("#lp-email").value;
      msg.textContent = "Sending…";
      try {
        await store.signIn(email);
        msg.textContent = `Check ${email} — the link signs you in on this device.`;
      } catch (err) {
        msg.textContent = err.message;
      }
    });
    if (!d.open) d.showModal();
  }

  /* ---------------- reading & access ---------------- */

  function applyAccessPrefs() {
    const p = store.prefs();
    document.body.classList.toggle("lp-large", !!p.largePrint);
    document.body.classList.toggle("lp-readable", !!p.readableFont);
    document.body.classList.toggle("lp-contrast", !!p.highContrast);
  }
  function zoomBoost() {
    return store.prefs().largePrint ? 1.4 : 1;
  }
  async function loadBrailleIndex() {
    if (brailleIndex) return brailleIndex;
    try {
      const r = await fetch(luneUrl("/static/braille/index.json"), { cache: "force-cache" });
      brailleIndex = r.ok ? await r.json() : {};
    } catch {
      brailleIndex = {};
    }
    return brailleIndex;
  }
  function openAccessDialog() {
    const d = dialog("access-dialog");
    const p = store.prefs();
    const row = (k, label, hint) => `<label class="lp-switch"><input type="checkbox" data-pref="${k}" ${p[k] ? "checked" : ""}>
      <span><strong>${label}</strong><small>${hint}</small></span></label>`;
    d.innerHTML = `${closeRow}<h2>Reading &amp; access</h2>
      ${row("largePrint", "Large print", "Bigger notes, letters and buttons — fewer bars on each line.")}
      ${row("readableFont", "Dyslexia-friendly letters", "Atkinson Hyperlegible — every letter shape distinct. Made for low vision; many dyslexic readers prefer it.")}
      ${row("highContrast", "High contrast", "Pure black on white for the score panel and letter names.")}
      ${row("autoRead", "Read bars aloud", "Every bar you select is described out loud: notes, chords, fingers and a tip.")}
      <h3>Keyboard shortcuts</h3>
      <p class="dim">Select a bar, then ← → move bar to bar · R read it aloud · N write a note on it · Space play · Esc close.</p>
      <h3>Braille</h3>
      <p class="dim">When a library piece has a braille file, use the Braille chip on Overview or Score — .brf for an embosser or refreshable display.</p>`;
    d.onchange = (e) => {
      const k = e.target.dataset.pref;
      if (!k) return;
      store.setPref(k, e.target.checked);
      applyAccessPrefs();
      syncAccessChips();
      if ((k === "largePrint" || k === "readableFont" || k === "highContrast") && state.piece && state.panel === "score") {
        try {
          window.fitZoomCache?.clear?.();
        } catch {
          /* ignore */
        }
        renderScore().then(() => paintScoreMarks()).catch(() => {});
      }
    };
    if (!d.open) d.showModal();
  }

  function syncAccessChips() {
    const on = !!store.prefs().readableFont;
    ["btn-dyslexia-score", "btn-dyslexia-explain"].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.setAttribute("aria-pressed", on ? "true" : "false");
      el.classList.toggle("on", on);
    });
  }

  function toggleDyslexia() {
    const next = !store.prefs().readableFont;
    store.setPref("readableFont", next);
    applyAccessPrefs();
    syncAccessChips();
    if (state.piece && state.panel === "score") {
      try {
        window.fitZoomCache?.clear?.();
      } catch {
        /* ignore */
      }
      renderScore().then(() => paintScoreMarks()).catch(() => {});
    }
    toast(next ? "Dyslexia-friendly letters on" : "Standard letters");
  }

  async function bindAccessChips() {
    const dysIds = ["btn-dyslexia-score", "btn-dyslexia-explain"];
    dysIds.forEach((id) => {
      const el = $(id);
      if (!el || el.dataset.bound) return;
      el.dataset.bound = "1";
      el.addEventListener("click", () => toggleDyslexia());
    });
    const more = $("btn-access-more");
    if (more && !more.dataset.bound) {
      more.dataset.bound = "1";
      more.addEventListener("click", () => openAccessDialog());
    }
    document.querySelectorAll("[data-lp-access]").forEach((el) => {
      if (el.dataset.accessBound) return;
      el.dataset.accessBound = "1";
      el.addEventListener("click", (e) => {
        e.preventDefault();
        openAccessDialog();
      });
    });
    syncAccessChips();
  }

  async function paintBrailleChips(piece) {
    const idx = await loadBrailleIndex();
    const key = keyFor(piece);
    const br = piece && !piece.local && idx[key] ? idx[key] : null;
    const href = br ? luneUrl(`/static/braille/${br.file}`) : "";
    ["btn-braille-score", "btn-braille-explain"].forEach((id) => {
      const a = $(id);
      if (!a) return;
      if (!br) {
        a.hidden = true;
        a.removeAttribute("href");
        return;
      }
      a.hidden = false;
      a.href = href;
      a.download = br.file;
      a.title = br.note || "Braille music (.brf)";
      a.textContent = id.includes("explain") ? "Braille" : "⠃";
      a.setAttribute("aria-label", "Download braille music");
    });
  }

  /* ---------------- explain page + toolbar buttons ---------------- */

  async function decorateExplain(piece) {
    const dl = $("btn-download");
    if (dl) {
      dl.hidden = !piece?.musicxml;
      const idx = await loadBrailleIndex();
      const key = keyFor(piece);
      const br = !piece.local && idx[key] ? idx[key] : null;
      dl.querySelector(".lp-braille")?.remove();
      if (br) {
        let a = document.querySelector("a.lp-braille");
        if (!a) {
          a = document.createElement("a");
          a.className = "lp-braille visually-hidden";
          dl.after(a);
        }
        a.href = luneUrl(`/static/braille/${br.file}`);
        a.download = br.file;
        a.textContent = "Braille (.brf)";
        a.title = br.note || "Braille music, generated with music21";
        window.LuneMenu?.attach(dl, () => [
          { label: "MusicXML", action: () => window.downloadScore?.() },
          { label: "Braille (.brf)", href: a.href, download: br.file, className: "lp-braille" },
        ]);
      } else {
        dl.onclick = () => window.downloadScore?.();
      }
    }
    await paintBrailleChips(piece);
    syncAccessChips();
    syncAddButtons();
  }

  function ensureToolbar() {
    const head = document.querySelector(".score-tools-head");
    if (!head || head.querySelector(".lp-tools-bar")) return;
    const bar = document.createElement("div");
    bar.className = "lp-tools-bar";
    bar.innerHTML = `
      <button type="button" class="quiet lp-tool" id="btn-follow" aria-pressed="false" title="Lune listens as you play, follows the score and marks the bars that trip you up">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 12h2l2-5 3 10 3-7 2 4h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span class="lp-tool-label">Play along</span></button>
      <button type="button" class="icon-btn lp-tool" id="btn-tell" aria-label="Tell Lune" aria-pressed="false" title="Say a note for any bar — “bar 12, play faster here”" ${canListenForWords() ? "" : "hidden"}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
      <button type="button" class="icon-btn" id="btn-score-more" aria-label="More" title="More">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="6" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18" cy="12" r="1.4" fill="currentColor"/></svg>
      </button>`;
    head.appendChild(bar);
    bar.querySelector("#btn-tell")?.addEventListener("click", (e) => tellLune(e.currentTarget));
    bar.querySelector("#btn-follow")?.addEventListener("click", () => window.LuneFollow?.toggle());
    window.LuneMenu?.attach($("btn-score-more"), () => [
      {
        id: "btn-toggle-kbd-item",
        label: "Show keyboard",
        checked: !!state.keyboardVisible && state.panel === "score",
        action: () => $("btn-toggle-kbd")?.click(),
      },
      { label: "Read selected bar aloud", hint: "R", action: () => readSelectedAloud() },
      { label: "Note on selected bar", hint: "N", action: () => {
        if (!selectedBarsSorted().length) return toast("Select a bar first");
        if (!state.coachOpen) openBarCoach();
        setTimeout(() => $("lp-note-input")?.focus(), 30);
      } },
    ]);
  }

  function ensureHeaderButton() {
    const b = $("btn-repertoire");
    if (b && !b.dataset.bound) {
      b.dataset.bound = "1";
      b.addEventListener("click", () => showRepertoire());
    }
    bindOverflowMenus();
  }

  function bindOverflowMenus() {
    if (bindOverflowMenus.done) return;
    bindOverflowMenus.done = true;
    window.LuneMenu?.attach($("btn-more"), () => headerMenuItems());
    window.LuneMenu?.attach($("btn-coach-more"), () => [
      { label: "Read aloud", hint: "R", action: () => readSelectedAloud() },
      { label: "Assign to a student", action: () => openAssignDialog(selectedBarsSorted()) },
      { id: "btn-plan", label: "Practice plan" },
    ]);
  }

  function headerMenuItems() {
    const studio = document.body.classList.contains("is-studio");
    const bars = selectedBarsSorted();
    const library = !!(state.piece && !state.piece.local);
    const items = [
      { label: "Upload a score", action: () => $("file")?.click() },
    ];
    if (studio) {
      items.push({
        label: "Assign to a student",
        disabled: !(bars.length && library),
        title: bars.length && library ? "" : "Select bars first",
        hint: bars.length && library ? "" : "Select bars first",
        action: () => openAssignDialog(bars),
      });
      items.push({ label: "Download MusicXML", action: () => window.downloadScore?.() });
      const a = document.querySelector("a.lp-braille");
      if (a?.href) items.push({ label: "Download Braille (.brf)", href: a.href, download: a.getAttribute("download") || "" });
    }
    items.push({ label: "Reading & access", action: () => openAccessDialog() });
    items.push({ label: "Credits & licenses", action: () => document.querySelector("[data-open-credits]")?.click() });
    if (!studio) items.push({ label: "Privacy", action: () => openCreditsPrivacy() });
    return items;
  }

  function openCreditsPrivacy() {
    const b = document.querySelector('[data-open-credits="privacy"]');
    if (b) b.click();
    else {
      const dlg = $("credits-dialog");
      dlg?.showModal();
      $("credits-privacy")?.scrollIntoView();
    }
  }
  async function refreshBadge() {
    const badge = $("rep-badge");
    if (!badge) return;
    try {
      const n = (await store.dueCards(99)).length;
      badge.hidden = !n;
      badge.textContent = n ? String(n) : "";
      badge.setAttribute("aria-hidden", n ? "false" : "true");
      if (n) badge.setAttribute("aria-label", `${n} bars due today`);
      else badge.removeAttribute("aria-label");
    } catch {
      badge.hidden = true;
    }
  }

  /* ---------------- teacher assignment links ---------------- */

  function b64urlEncode(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlDecode(s) {
    const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
    const bin = atob(pad);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function assignmentUrl(payload) {
    const base = LUNE_ON_PAGES ? "https://verushkapatel.github.io/lune/" : `${location.origin}${location.pathname}`;
    return `${base}#/assign/${b64urlEncode(payload)}`;
  }
  async function openAssignDialog(bars) {
    const piece = state.piece;
    if (!piece) return;
    const d = dialog("assign-dialog");
    if (piece.local) {
      d.innerHTML = `${closeRow}<h2>Assign to a student</h2>
        <p>Assignment links work for pieces in Lune’s library. This score was uploaded from your device, so send your student the file too and ask them to upload it — then share your notes in person.</p>`;
      d.showModal();
      return;
    }
    const key = keyFor(piece);
    const mine = (await notesFor(key)).filter((n) => bars.includes(n.bar));
    const savedName = store.prefs().teacherName || "";
    d.innerHTML = `${closeRow}<h2>Assign to a student</h2>
      <p>${esc(titleFor(piece))} · <strong>${esc(barsText(bars))}</strong></p>
      <form class="lp-assign" autocomplete="off">
        <label for="as-name">Your name (as the student knows you)</label>
        <input id="as-name" maxlength="40" value="${esc(savedName)}" placeholder="e.g. Ms Rao">
        <label for="as-msg">Instructions</label>
        <textarea id="as-msg" rows="3" maxlength="400" placeholder="e.g. Hands separately at 60, then together. Watch the thumb in bar 13."></textarea>
        ${mine.length ? `<label class="lp-switch"><input type="checkbox" id="as-notes" checked><span><strong>Include my ${mine.length} bar note${mine.length === 1 ? "" : "s"}</strong><small>${mine.map((n) => esc(n.body)).slice(0, 3).join(" · ")}</small></span></label>` : ""}
        <button type="submit" class="primary" id="as-create">Create link</button>
      </form>
      <div class="lp-assign-out" hidden>
        <input id="as-url" readonly aria-label="Assignment link">
        <div class="lp-row"><button type="button" class="quiet" id="as-copy">Copy link</button><button type="button" class="quiet" id="as-share" hidden>Share…</button></div>
        <p class="dim">The link holds the assignment itself — nothing is uploaded. Anyone with it sees these bars and notes.</p>
      </div>`;
    d.querySelector("form.lp-assign").addEventListener("submit", (e) => {
      e.preventDefault();
      const by = d.querySelector("#as-name").value.trim().slice(0, 40);
      const msg = d.querySelector("#as-msg").value.trim().slice(0, 400);
      store.setPref("teacherName", by);
      const notes = d.querySelector("#as-notes")?.checked ? mine.map((n) => ({ b: n.bar, x: n.body.slice(0, 300) })) : [];
      const payload = { v: 1, p: key, t: titleFor(piece).slice(0, 120), c: composerFor(piece).slice(0, 80), by, m: msg, bars, notes };
      const url = assignmentUrl(payload);
      const out = d.querySelector(".lp-assign-out");
      out.hidden = false;
      d.querySelector("#as-url").value = url;
      const create = d.querySelector("#as-create");
      if (create) create.className = "quiet";
      const copy = d.querySelector("#as-copy");
      if (copy) copy.className = "primary";
      const share = d.querySelector("#as-share");
      if (navigator.share) {
        share.hidden = false;
        share.onclick = () => navigator.share({ title: `Practice: ${payload.t}`, text: msg || `Practise ${barsText(bars)}`, url }).catch(() => {});
      }
      d.querySelector("#as-copy").onclick = async () => {
        try {
          await navigator.clipboard.writeText(url);
          toast("Link copied");
        } catch {
          d.querySelector("#as-url").select();
          toast("Select the link and copy it");
        }
      };
    });
    d.showModal();
  }

  async function openAssignment(encoded) {
    let a;
    try {
      a = b64urlDecode(encoded);
      if (!a || a.v !== 1 || !a.p || !Array.isArray(a.bars)) throw new Error("bad");
    } catch {
      toast("This assignment link is incomplete — ask your teacher to send it again.");
      goHome({ keepTabs: true });
      return;
    }
    assignment = {
      key: String(a.p).slice(0, 120),
      title: String(a.t || ""),
      composer: String(a.c || ""),
      by: String(a.by || "").slice(0, 40),
      message: String(a.m || "").slice(0, 400),
      bars: a.bars.map(Number).filter((n) => n >= 0 && n < 5000).slice(0, 64),
      notes: (a.notes || []).slice(0, 64).map((n) => ({ b: Number(n.b), x: String(n.x || "").slice(0, 300) })),
    };
    try {
      history.replaceState({ lune: assignment.key }, "", `${location.pathname}${location.search}#/${assignment.key}/score`);
    } catch {
      /* ignore */
    }
    await applyRoute();
    showAssignmentBanner();
    if (await waitForScore()) {
      paintScoreMarks();
      if (assignment.bars.length) {
        setBarSelection([assignment.bars[0]], { open: true });
        requestAnimationFrame(() => scrollToBar(assignment.bars[0]));
      }
    }
  }
  function showAssignmentBanner() {
    if (!assignment) return;
    let el = $("lp-assign-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "lp-assign-banner";
      el.className = "lp-banner";
      el.setAttribute("role", "region");
      el.setAttribute("aria-label", "Assignment from your teacher");
      $("panel-score")?.prepend(el);
    }
    el.hidden = false;
    el.innerHTML = `<div class="lp-banner-text">
        <p class="lp-banner-k">Assignment${assignment.by ? ` from ${esc(assignment.by)}` : ""}</p>
        <p>${assignment.message ? esc(assignment.message) : `Practise ${esc(barsText(assignment.bars))}.`}</p>
        ${(assignment.message || "").length > 90 ? `<button type="button" class="lp-banner-more" data-x="more">More</button>` : ""}
        <div class="lp-banner-bars">${assignment.bars.map((b) => `<button type="button" class="rep-bar" data-bar="${b}">Bar ${b}</button>`).join("")}</div>
      </div>
      <div class="lp-banner-actions">
        <button type="button" class="primary" data-x="save">Save to my Repertoire</button>
        <button type="button" class="icon-btn lp-banner-hide" data-x="dismiss" aria-label="Hide assignment" title="Hide">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
      </div>`;
    el.onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.bar) {
        setBarSelection([Number(b.dataset.bar)], { open: true });
        scrollToBar(Number(b.dataset.bar));
      } else if (b.dataset.x === "more") {
        el.classList.toggle("is-open");
        b.textContent = el.classList.contains("is-open") ? "Less" : "More";
      } else if (b.dataset.x === "dismiss") el.hidden = true;
      else if (b.dataset.x === "save") {
        b.disabled = true;
        try {
          const key = assignment.key;
          await store.addPiece({ piece_key: key, title: assignment.title || titleFor(state.piece), composer: assignment.composer || composerFor(state.piece) });
          const who = assignment.by ? `${assignment.by}: ` : "";
          if (assignment.message) await store.addNote({ pieceKey: key, bar: assignment.bars[0] || 0, body: `${who}${assignment.message}`.slice(0, 500), tags: tagsFor(assignment.message), source: "teacher" });
          for (const n of assignment.notes) await store.addNote({ pieceKey: key, bar: n.b, body: `${who}${n.x}`.slice(0, 500), tags: tagsFor(n.x), source: "teacher" });
          for (const bar of assignment.bars) await store.queueBar(key, bar);
          repertoireKeys.add(key);
          syncAddButtons();
          await notesFor(key, { fresh: true });
          assignment = null;
          paintScoreMarks();
          el.hidden = true;
          refreshBadge();
          toast("Saved — the bars are in Today’s bars in your Repertoire");
        } catch (err) {
          b.disabled = false;
          toast(err.message);
        }
      }
    };
  }

  /* ---------------- routes + hooks ---------------- */

  /** Called first by applyRoute. Returns true when it handled the hash. */
  function handleRoute(hash) {
    if (hash === "#/repertoire") {
      showRepertoire({ push: false });
      return true;
    }
    const m = (hash || "").match(/^#\/assign\/([A-Za-z0-9_-]+)$/);
    if (m) {
      openAssignment(m[1]);
      return true;
    }
    if (hash === "#/study") {
      window.LuneStudy?.show();
      return true;
    }
    return false;
  }

  /** app.js calls this whenever the score (re)renders or the view changes. */
  function afterScoreRender() {
    paintScoreMarks();
    ensureToolbar();
    syncAddButtons();
    syncAccessChips();
    paintBrailleChips(state.piece).catch(() => {});
    if (assignment && state.piece && keyFor(state.piece) === assignment.key) showAssignmentBanner();
    else {
      const el = $("lp-assign-banner");
      if (el) el.hidden = true;
    }
  }

  function bindKeys() {
    // ← → step the selected bar (and read it, if Read bars aloud is on).
    // Runs before app.js's handler, which also moves the playback position.
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.("input, textarea, select, [contenteditable], dialog")) return;
        if (state.panel !== "score" || $("studio")?.hidden || LunePiano.isPlaying?.()) return;
        const sel = selectedBarsSorted();
        if (!sel.length || !state.piece?.debriefs) return;
        const bars = Object.keys(state.piece.debriefs).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
        const i = bars.indexOf(e.key === "ArrowRight" ? sel[sel.length - 1] : sel[0]);
        const next = bars[Math.max(0, Math.min(bars.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)))];
        if (next == null) return;
        setBarSelection([next], { open: true });
        scrollToBar(next);
      },
      true
    );
    document.addEventListener("keydown", (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest?.("input, textarea, select, [contenteditable], dialog")) return;
      if (state.mode === "repertoire" || $("studio")?.hidden) return;
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        readSelectedAloud();
      } else if ((e.key === "n" || e.key === "N") && selectedBarsSorted().length) {
        e.preventDefault();
        if (!state.coachOpen) openBarCoach();
        setTimeout(() => $("lp-note-input")?.focus(), 30);
      }
    });
  }

  async function init() {
    applyAccessPrefs();
    await bindAccessChips();
    ensureHeaderButton();
    ensureRepertoireView();
    bindKeys();
    document.addEventListener("click", (e) => {
      const b = e.target.closest?.("[data-lp-add]");
      if (!b || !state.piece) return;
      if (repertoireKeys.has(keyFor(state.piece))) showRepertoire();
      else addCurrentToRepertoire().catch((err) => toast(err.message));
    });
    await store.init();
    store.onChange(async (st) => {
      notesCache = { key: "", rows: [] };
      await refreshRepertoireKeys();
      refreshBadge();
      if (state.mode === "repertoire") renderRepertoire();
      renderContinueCard();
      if (st.signedIn && store.hasLocalData()) {
        toast("Signed in. Open Account to move this browser’s pieces into it.");
      }
    });
    await refreshRepertoireKeys();
    refreshBadge();
    renderContinueCard();
    setInterval(refreshBadge, 5 * 60000);
  }

  async function renderContinueCard() {
    const host = $("home-continue");
    if (!host) return;
    let pieces = [];
    let due = [];
    try {
      [pieces, due] = await Promise.all([store.listPieces(), store.dueCards(99)]);
    } catch {
      host.hidden = true;
      return;
    }
    if (!pieces.length) {
      host.hidden = true;
      host.innerHTML = "";
      return;
    }
    const last = pieces[0];
    const n = due.length;
    host.hidden = false;
    host.innerHTML = `<p class="home-continue-k">Continue</p>
      <p class="home-continue-t">${esc(last.title)}</p>
      <div class="home-continue-actions">
        <button type="button" class="primary" data-open="${esc(last.piece_key)}">Open</button>
        ${n ? `<button type="button" class="quiet" data-go-rep>${n} bar${n === 1 ? "" : "s"} due today</button>` : ""}
      </div>`;
    host.onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.hasAttribute("data-go-rep")) showRepertoire();
      else if (b.dataset.open) openFromRepertoire(b.dataset.open).catch((err) => toast(err.message));
    };
  }

  return {
    init,
    keyFor,
    parseSpoken,
    tagsFor,
    describeBar,
    decorateCoach,
    decorateExplain,
    afterScoreRender,
    paintScoreMarks,
    handleRoute,
    onUploadOpened,
    showRepertoire,
    renderRepertoire,
    openFromRepertoire,
    zoomBoost,
    addCurrentToRepertoire,
    saveNote,
    scrollToBar,
    refreshBadge,
    b64urlEncode,
    b64urlDecode,
    __test: { wordsToNumber, barsText },
  };
})();
