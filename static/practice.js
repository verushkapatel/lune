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
  // weakest to strongest; store.js schedules each one (Strong was called Easy until lune04)
  const GRADES = [
    ["again", "Again", "Still falling apart. Bring it back in 10 minutes."],
    ["hard", "Hard", "Got through it, with real effort."],
    ["okay", "Okay", "Mostly there, with a slip or two."],
    ["good", "Good", "Solid at this tempo."],
    ["strong", "Strong", "Secure. Leave it for a while."],
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
  let _voiceSecureToasted = false;
  function canListenForWords() {
    return !!Recognition && !!window.isSecureContext;
  }
  /** Open coach note field for the current/selected bar (type fallback). */
  function focusTypeNote(bar, text = "") {
    const target = bar || state.selected || selectedBarsSorted()[0] || null;
    if (target != null) {
      try {
        setBarSelection([Number(target)], { open: true });
      } catch {
        if (!state.coachOpen) openBarCoach();
      }
    } else if (!state.coachOpen) {
      openBarCoach();
    }
    setTimeout(() => {
      const ta = document.getElementById("lp-note-input");
      if (ta) {
        // words already spoken are kept, ready to save
        if (text && !ta.value) ta.value = text;
        ta.focus();
        ta.placeholder = ta.placeholder || "Type a note for this bar";
      }
    }, 40);
  }
  /** One spoken phrase → text. onPartial gets interim words while speaking. */
  function hearPhrase({ onPartial } = {}) {
    return new Promise((resolve, reject) => {
      if (!window.isSecureContext) {
        reject(new Error("Voice needs a secure connection (HTTPS) — type your note instead."));
        return;
      }
      if (!Recognition) {
        reject(new Error("Voice isn’t available in this browser — type your note instead."));
        return;
      }
      try {
        activeRec?.abort();
      } catch {
        /* ignore */
      }
      const rec = new Recognition();
      activeRec = rec;
      // English recognition even on a device set to another language
      rec.lang = /^en\b/i.test(navigator.language || "") ? navigator.language : "en-GB";
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
        // stopping it yourself is not a failure: keep whatever was heard
        if (e.error === "aborted") {
          resolve(finalText.trim());
          return;
        }
        const why =
          e.error === "not-allowed" || e.error === "service-not-allowed"
            ? "Lune needs the microphone for voice notes. Allow it in the address bar, or type the note."
            : e.error === "no-speech"
              ? "Didn’t catch that — tap the microphone and try again, or type the note."
              : e.error === "audio-capture"
                ? "No microphone found — type the note instead."
                : e.error === "network"
                  ? "Voice notes need an internet connection in this browser — type the note instead."
                  : "Voice notes aren’t available right now — type the note instead.";
        reject(new Error(why));
      };
      rec.onend = () => {
        activeRec = null;
        resolve(tidySpoken(finalText));
      };
      try {
        rec.start();
      } catch (err) {
        activeRec = null;
        reject(new Error("Voice notes aren’t available right now — type the note instead."));
      }
    });
  }
  /** Browsers return bare lower-case words: add the punctuation a person would. */
  function tidySpoken(text) {
    let t = String(text || "").replace(/\s+/g, " ").trim();
    if (!t) return "";
    t = t
      .replace(/\s*\b(comma)\b\s*/gi, ", ")
      .replace(/\s*\b(full stop|period)\b\s*/gi, ". ")
      .replace(/\s*\b(question mark)\b\s*/gi, "? ")
      .replace(/\s+([,.?!])/g, "$1")
      .trim();
    const question = /^(what|why|how|when|where|which|who|is|are|can|could|should|do|does|did|will|would)\b/i.test(t);
    if (!/[.?!]$/.test(t)) t += question ? "?" : ".";
    t = t.replace(/(^|[.?!]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\bi\b/g, "I");
    return t;
  }
  function stopHearing() {
    try {
      activeRec?.stop();
    } catch {
      /* ignore */
    }
  }

  /** "Tell Lune" button on the score: speak a note for any bar, hands free.
   * Always falls back to the type-note field when speech isn’t available. */
  async function tellLune(btn) {
    if (activeRec) {
      stopHearing();
      return;
    }
    if (!state.piece) {
      toast("Open a score first — then say a note for any bar.");
      return;
    }
    // one listener on the microphone at a time
    if (window.LuneFollow?.isOn?.()) await window.LuneFollow.stop({ quiet: true }).catch(() => {});
    const sel = state.selected || selectedBarsSorted()[0] || null;
    if (!canListenForWords()) {
      if (!window.isSecureContext && !_voiceSecureToasted) {
        _voiceSecureToasted = true;
        toast("Voice needs HTTPS — type your note instead.");
      } else {
        toast("Type your note for this bar.");
      }
      focusTypeNote(sel);
      return;
    }
    btn?.classList.add("on");
    btn?.setAttribute("aria-pressed", "true");
    toast("Listening — say “bar 12, play faster here”");
    try {
      const said = await hearPhrase({ onPartial: (t) => t && toast(`“${t}”`) });
      if (!said) {
        toast("Nothing heard — type the note instead.");
        focusTypeNote(sel);
        return;
      }
      const { bar, body } = parseSpoken(said, sel);
      if (!body) {
        toast("Heard a bar number but no note — type it instead.");
        focusTypeNote(bar || sel);
        return;
      }
      if (!bar) {
        // No bar named and none selected: keep the words and ask where they go.
        const guess = Number(LunePiano.currentBar?.()) || pieceBarSpan()[0];
        toast(`Got it. Say “bar 12 …” next time, or press Save to put this on bar ${guess}.`);
        focusTypeNote(guess, body);
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
      toast(err.message || "Type your note instead.");
      focusTypeNote(sel);
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
    const voice = bestVoice();
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else {
      u.lang = "en-GB"; // never the device's own language: the text is English
    }
    u.rate = Number(store.prefs().speechRate) || 1;
    u.pitch = 1;
    lastSpoken = text;
    u.onend = u.onerror = () => {
      // a newer utterance may already be speaking (Replay)
      if (!speechSynthesis.speaking && !speechSynthesis.pending) listenBar(false);
    };
    speechSynthesis.speak(u);
    listenBar(true);
  }
  let lastSpoken = "";
  /** Pause, Stop and Replay for whatever Lune is reading aloud. */
  function listenBar(on) {
    let bar = $("listen-bar");
    if (!on) {
      if (bar) bar.hidden = true;
      return;
    }
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "listen-bar";
      bar.className = "listen-bar";
      bar.setAttribute("role", "group");
      bar.setAttribute("aria-label", "Reading aloud");
      bar.innerHTML = `<span class="listen-bar-label">Reading aloud</span>
        <button type="button" class="quiet" data-listen="pause">Pause</button>
        <button type="button" class="quiet" data-listen="replay">Replay</button>
        <button type="button" class="quiet" data-listen="stop">Stop</button>`;
      document.body.appendChild(bar);
      bar.addEventListener("click", (e) => {
        const b = e.target.closest("[data-listen]");
        if (!b) return;
        const act = b.dataset.listen;
        if (act === "stop") {
          speechSynthesis.cancel();
          listenBar(false);
        } else if (act === "replay") {
          if (lastSpoken) speak(lastSpoken);
        } else if (speechSynthesis.paused) {
          speechSynthesis.resume();
          b.textContent = "Pause";
        } else {
          speechSynthesis.pause();
          b.textContent = "Play";
        }
      });
    }
    bar.querySelector('[data-listen="pause"]').textContent = "Pause";
    bar.hidden = false;
  }
  /**
   * The most natural English voice this device has. The default voice is
   * often the oldest, most robotic one, and a non-English default reads
   * English text as gibberish.
   */
  function bestVoice() {
    const voices = (speechSynthesis.getVoices?.() || []).filter((v) => /^en[-_]/i.test(v.lang));
    if (!voices.length) return null;
    const score = (v) => {
      const n = v.name;
      let s = 0;
      if (/natural|neural|premium|enhanced|siri/i.test(n)) s += 50;
      if (/Google UK English Female|Google US English|Samantha|Karen|Serena|Daniel|Moira|Ava|Allison|Sonia|Libby|Aria|Jenny/i.test(n)) s += 25;
      if (/compact|eloquence|albert|bad news|bahh|bells|boing|bubbles|cellos|jester|organ|trinoids|whisper|zarvox|wobble|fred|junior|ralph|kathy|good news|superstar/i.test(n)) s -= 80;
      if (/en[-_]GB/i.test(v.lang)) s += 6;
      if (v.localService) s += 2;
      return s;
    };
    return voices.slice().sort((a, b) => score(b) - score(a))[0];
  }
  // voices load late in Chrome; asking early means they are ready by the first Listen
  try {
    speechSynthesis.getVoices?.();
    speechSynthesis.addEventListener?.("voiceschanged", () => speechSynthesis.getVoices());
  } catch {
    /* no speech on this browser */
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
      <h3 class="lp-h lp-h-remarks" hidden>Remarks</h3>
      <ul class="lp-notes" aria-live="polite" hidden></ul>
      <form class="lp-note-form" autocomplete="off">
        <label class="visually-hidden" for="lp-note-input">Note for bar ${primary}</label>
        <div class="lp-note-grow">
          <textarea id="lp-note-input" rows="1" maxlength="500" placeholder="Note for bar ${primary}, or say it"></textarea>
          <button type="button" class="icon-btn lp-mic" data-lp="mic" aria-label="${canListenForWords() ? "Speak a note" : "Focus note field"}" aria-pressed="false" title="${canListenForWords() ? "Speak a note" : "Type a note for this bar"}">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            <span class="visually-hidden">${canListenForWords() ? "Speak" : "Type"}</span>
          </button>
        </div>
        <button type="submit" class="lp-save primary">Save</button>
      </form>
      <div class="lp-asked" hidden></div>
      ${
        window.LuneAsk?.modelConnected?.()
          ? `<div class="lp-ai-row" role="group" aria-label="Lune AI on bar ${primary}">${Object.entries(window.LuneAsk.MODEL_ACTIONS)
              .filter(([, a]) => a.bar)
              .map(([task, a]) => `<button type="button" class="quiet ink" data-lp-task="${task}">${esc(a.label)}</button>`)
              .join("")}</div>`
          : ""
      }
      <div class="lp-ask-row">
        <button type="button" class="quiet ink" data-lp="ask">Ask Lune about bar ${primary}</button>
        <button type="button" class="quiet ink" data-lp="plan">Add to my plan</button>
        <button type="button" class="quiet ink" data-lp="share" title="A link that opens this piece at these bars with your instructions">Share ${bars.length > 1 ? "these bars" : "this bar"}</button>
      </div>
      <h3 class="lp-h">Practice · how did it go?</h3>
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
        : "";
      // a section with nothing in it is not shown
      list.hidden = !rows.length;
      const head = wrap.querySelector(".lp-h-remarks");
      if (head) head.hidden = !rows.length;
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
    // what was asked about this bar before, so the answers are not lost
    const asked = (window.LuneAsk?.historyFor?.(primary) || []).slice(-2);
    const askedEl = wrap.querySelector(".lp-asked");
    if (asked.length && askedEl) {
      askedEl.hidden = false;
      askedEl.innerHTML = `<h3 class="lp-h">Questions</h3>${asked
        .map((h) => `<p class="lp-asked-q">${esc(h.q)}</p><p class="lp-asked-a">${esc(h.a)}</p>`)
        .join("")}`;
    }

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
      if (btn.dataset.lpTask) window.LuneAsk?.runTask?.(btn.dataset.lpTask, primary);
      else if (btn.dataset.lp === "aloud") readSelectedAloud();
      else if (btn.dataset.lp === "ask") window.LuneAsk?.open?.({ bar: primary });
      else if (btn.dataset.lp === "share") openAssignDialog(bars);
      else if (btn.dataset.lp === "plan" && window.LuneAsk) {
        // the plan is written from this bar's analysis and your remarks on it
        window.LuneAsk.open({ bar: primary });
        window.LuneAsk.ask("Make a plan");
      } else if (btn.dataset.lp === "assign" || btn.dataset.lp === "plan") {
        openTaskDialog({
          pieceKey: keyFor(state.piece),
          title: titleFor(state.piece),
          composer: composerFor(state.piece),
          bars,
        });
      }
      else if (btn.dataset.lp === "mic") {
        const ta = wrap.querySelector("textarea");
        if (!canListenForWords()) {
          toast("Type your note for this bar.");
          ta?.focus();
          return;
        }
        if (activeRec) return stopHearing();
        btn.classList.add("on");
        btn.setAttribute("aria-pressed", "true");
        const label = btn.querySelector("span");
        if (label) label.textContent = "Listening…";
        try {
          const said = await hearPhrase({ onPartial: (t) => (ta.value = t) });
          const parsed = parseSpoken(said, primary);
          if (!parsed.body) {
            toast("Nothing clear — type the note instead.");
            ta?.focus();
            return;
          }
          await saveNote(parsed.bar, parsed.body, "voice");
          ta.value = "";
          toast(parsed.bar === primary ? "Note saved" : `Saved on bar ${parsed.bar}`);
          renderNotes(true);
        } catch (err) {
          toast(err.message || "Type your note instead.");
          ta?.focus();
        } finally {
          btn.classList.remove("on");
          btn.setAttribute("aria-pressed", "false");
          if (label) label.textContent = "Speak";
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
      const label = inRep ? "This piece is in your Repertoire" : "Add this piece to my Repertoire";
      b.setAttribute("aria-label", label);
      b.title = label;
      const el = b.querySelector(".lp-add-label");
      if (el) {
        el.textContent = label;
        el.dataset.short = inRep ? "In your Repertoire" : "Add to Repertoire";
      }
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

  async function openFromRepertoire(key, { bar = null, bars = null } = {}) {
    const row = await store.getPiece(key);
    const isUpload = row?.source === "upload" || key.startsWith("upload-");
    if (isUpload) {
      const open = state.sessions.find((s) => s.piece && keyFor(s.piece) === key);
      if (open) {
        await activateSession(open.id);
        await switchToScorePanel();
      } else {
        const xml = await store.loadUploadedScore(key);
        if (!xml && row?.title) {
          // A piece added by name has no file of its own. If the library has
          // that piece, open it — keeping this Repertoire entry's notes.
          const found = await withLoader("Finding the score", () =>
            tryOpen({ query: row.title, title: row.title, composer: row.composer || "" })
          ).catch(() => null);
          if (found?.kind === "score" && found.musicxml) {
            found.repKey = key;
            await openPieceSession(found, { panel: "explain" });
            await switchToScorePanel();
            return;
          }
        }
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
    const list = (bars?.length ? bars : bar != null ? [bar] : [])
      .map(Number)
      .filter((n) => n > 0);
    if (list.length && (await waitForScore())) {
      focusBars(list);
    }
  }

  /** Select practice bars on the open score (tonight’s plan / stumble map). */
  function focusBars(bars) {
    const list = [...new Set((bars || []).map(Number).filter((n) => n > 0))].sort((a, b) => a - b);
    if (!list.length) return;
    setBarSelection(list, { open: true, primary: list[0] });
    requestAnimationFrame(() => scrollToBar(list[0]));
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
          <p class="rep-lead">Your pieces, your notes, and practice plans you set yourself — bars you chose, summarised by Lune.</p>
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
        <section class="rep-section" aria-labelledby="rep-plan-h">
          <div class="rep-today-head">
            <h2 id="rep-plan-h">Your plan</h2>
            <button type="button" class="quiet" id="rep-new-task">New task</button>
          </div>
          <div id="rep-today" class="rep-today rep-plan"></div>
        </section>
        <section class="rep-section" aria-labelledby="rep-list-h">
          <h2 id="rep-list-h">Pieces</h2>
          <div id="rep-list" class="rep-list"></div>
        </section>
        <footer class="rep-foot">
          <button type="button" class="link-btn" data-lp-access>Reading &amp; access</button>
          <span aria-hidden="true">·</span>
          <button type="button" class="link-btn" id="rep-share" title="Send the list of your pieces and where each one stands, as text">Share my repertoire</button> ·
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
    main.querySelector("#rep-share")?.addEventListener("click", async () => {
      const text = await repertoireSummary();
      if (!text) return toast("Your Repertoire is empty — add a piece first");
      shareText("My repertoire", text);
    });
    main.querySelector("#rep-new-task")?.addEventListener("click", () => {
      openTaskDialog({
        pieceKey: keyFor(state.piece),
        title: titleFor(state.piece) || "",
        composer: composerFor(state.piece) || "",
        bars: selectedBarsSorted(),
      });
    });
    main.addEventListener("click", onRepertoireClick);
    main.addEventListener("change", async (e) => {
      const sel = e.target.closest("select[data-status]");
      if (sel) {
        const label = sel.selectedOptions[0]?.textContent || sel.value;
        try {
          await store.updatePiece(sel.dataset.status, { status: sel.value });
          // the saved choice is now what the list shows; nothing to rebuild
          const list = $("rep-list");
          if (list) list.dataset.painted = "";
          toast(`Marked ${label.toLowerCase()}`);
        } catch (err) {
          toast(`Couldn’t save that — ${err.message || "check the connection"}`);
        }
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

  /** Turn spoken/typed notes + selected bars into a short practice plan. */
  function summarisePlan({ title, bars, notes }) {
    const barLabel = barsText(bars || []) || "the bars you marked";
    const body = String(notes || "").trim();
    const tags = tagsFor(body);
    const steps = [];
    steps.push({
      title: `Name the notes in ${barLabel}`,
      detail: "Say letter names out loud, one hand at a time, before you play.",
    });
    if (tags.includes("fingering") || /\bfinger/i.test(body)) {
      steps.push({ title: "Lock the fingering", detail: "Loop only the awkward finger change until it feels boring." });
    }
    if (tags.includes("tempo") || /\b(slow|fast|tempo|metronome)\b/i.test(body)) {
      steps.push({ title: "Tempo ladder", detail: "Start well under performance speed, then nudge the BPM slider up in small steps." });
    }
    if (tags.includes("left hand") || tags.includes("right hand") || /\b(hands?|separat)/i.test(body)) {
      steps.push({ title: "Hands separately", detail: "Own each hand alone, then join for two clean bars." });
    }
    if (tags.includes("dynamics") || tags.includes("touch")) {
      steps.push({ title: "Shape & touch", detail: "One slow pass only for soft/loud and how the notes connect." });
    }
    if (steps.length < 3) {
      steps.push({
        title: "Join the neighbours",
        detail: `Play the bar before + ${barLabel} + the bar after at half speed.`,
      });
    }
    steps.push({ title: "Two clean run-throughs", detail: body ? `Keep your note in mind: “${body.slice(0, 120)}${body.length > 120 ? "…" : ""}”.` : "Two calm passes without stopping to fix." });
    const summary = body
      ? `For ${title || "this piece"} · ${barLabel}. You wrote: “${body.slice(0, 160)}${body.length > 160 ? "…" : ""}”.`
      : `For ${title || "this piece"} · ${barLabel}. A quiet plan from the bars you selected.`;
    return { summary, steps: steps.slice(0, 5), tags };
  }

  function openTaskDialog({ pieceKey = "", title = "", composer = "", bars = [], notes = "" } = {}) {
    const d = dialog("task-dialog");
    const barStr = (bars || []).join(", ");
    d.innerHTML = `${closeRow}<h2>Add to your plan</h2>
      <p class="dim">${esc(title || "Current piece")}${bars.length ? ` · ${esc(barsText(bars))}` : ""}</p>
      <form class="lp-assign" id="task-form" autocomplete="off">
        <label for="task-bars">Bars to practise</label>
        <input id="task-bars" value="${esc(barStr)}" placeholder="e.g. 12, 13, 24" inputmode="numeric">
        <label for="task-notes">Your note (type or paste what you said)</label>
        <textarea id="task-notes" rows="3" maxlength="800" placeholder="e.g. Bar 12 keeps rushing — LH arpeggio messy, keep soft">${esc(notes)}</textarea>
        <button type="submit" class="primary">Summarise into a plan</button>
      </form>`;
    d.querySelector("#task-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const rawBars = ($("task-bars")?.value || "")
        .split(/[,;\s]+/)
        .map((x) => Number(x))
        .filter((n) => n > 0);
      const noteBody = ($("task-notes")?.value || "").trim();
      if (!rawBars.length && !noteBody) {
        toast("Select bars or write a note first");
        return;
      }
      const plan = { source: "self", ...summarisePlan({ title: title || titleFor(state.piece), bars: rawBars, notes: noteBody }) };
      const row = store.addTask({
        piece_key: pieceKey || keyFor(state.piece),
        title: title || titleFor(state.piece),
        composer: composer || composerFor(state.piece),
        bars: rawBars,
        notes: noteBody,
        plan,
      });
      d.close();
      toast("Plan saved to Repertoire");
      if (state.mode === "repertoire") renderRepertoire();
      else showPlanToast(row);
    });
    if (!d.open) d.showModal();
    setTimeout(() => $("task-notes")?.focus(), 30);
  }

  function showPlanToast(row) {
    const steps = row?.plan?.steps?.length || 0;
    toast(steps ? `Plan ready · ${steps} steps` : "Saved to your plan");
  }

  async function renderRepertoire() {
    if (window.LuneOnboard && !LuneOnboard.requireUnlock()) return;
    ensureRepertoireView();
    renderAccountChip();
    const listEl = $("rep-list");
    const todayEl = $("rep-today");
    let pieces = [];
    let counts = {};
    try {
      [pieces, counts] = await Promise.all([store.listPieces(), store.countNotesByPiece()]);
    } catch (err) {
      listEl.innerHTML = `<p class="rep-empty">Couldn’t load your Repertoire: ${esc(err.message)}</p>`;
      return;
    }
    repertoireKeys = new Set(pieces.map((p) => p.piece_key));
    refreshBadge();

    const tasks = store.listTasks().filter((t) => !t.done);
    todayEl.innerHTML = tasks.length
      ? tasks
          .map((t) => {
            const steps = (t.plan?.steps || []).map((s) => `<li><strong>${esc(s.title)}</strong> ${esc(s.detail || "")}</li>`).join("");
            return `<article class="rep-plan-card" data-task="${esc(t.id)}">
              <div class="rep-plan-top">
                <h3>${esc(t.title)}</h3>
                <p class="rep-card-meta"><span class="task-origin task-origin-${t.plan?.source ? "lune" : "you"}">${t.plan?.source ? "Suggested by Lune" : "Written by you"}</span> · ${t.bars?.length ? esc(barsText(t.bars)) : "Notes only"}${t.composer ? ` · ${esc(t.composer)}` : ""}</p>
              </div>
              <p class="rep-plan-summary">${esc(t.plan?.summary || t.notes || "")}</p>
              ${steps ? `<ol class="rep-plan-steps">${steps}</ol>` : ""}
              <div class="rep-plan-actions">
                <button type="button" class="primary" data-open="${esc(t.piece_key)}" ${t.bars?.[0] ? `data-bar="${t.bars[0]}"` : ""}>Open</button>
                <button type="button" class="quiet" data-task-done="${esc(t.id)}">Done</button>
                <button type="button" class="quiet" data-task-remove="${esc(t.id)}">Remove</button>
              </div>
            </article>`;
          })
          .join("")
      : `<p class="rep-empty">No tasks yet. On a score, select bars and tap <em>Add to plan</em> — or speak a note and let Lune summarise it.</p>`;

    const listHtml = pieces.length
      ? pieces
          .map((p) => {
            const n = counts[p.piece_key] || 0;
            return `<article class="rep-card" data-key="${esc(p.piece_key)}">
              <div class="rep-card-main">
                <h3>${esc(p.title)}</h3>
                <p class="rep-card-by">${esc(p.composer || (p.source === "upload" ? "Your score" : ""))}</p>
                <p class="rep-card-meta">${levelFor(p.piece_key) ? `<span title="Lune’s estimate from the score’s hardest bars. Not an exam grade.">Level: ${esc(levelFor(p.piece_key))} (Lune’s estimate)</span> · ` : ""}Last practised ${esc(ago(p.last_practised_at))}${n ? ` · ${n} note${n === 1 ? "" : "s"}` : ""}</p>
              </div>
              <div class="rep-card-actions">
                <label class="visually-hidden" for="st-${esc(p.piece_key)}">Status</label>
                <select id="st-${esc(p.piece_key)}" data-status="${esc(p.piece_key)}">
                  ${STATUS.map(([v, l]) => `<option value="${v}" ${p.status === v ? "selected" : ""}>${l}</option>`).join("")}
                </select>
                <button type="button" class="primary" data-open="${esc(p.piece_key)}">Open</button>
                <button type="button" class="quiet" data-work="${esc(p.piece_key)}" title="See what needs work in this piece and add it to your plan">Work on this piece</button>
                <button type="button" class="quiet rep-remove" hidden data-remove="${esc(p.piece_key)}" aria-label="Remove ${esc(p.title)}">Remove</button>
              </div>
            </article>`;
          })
          .join("")
      : `<p class="rep-empty">Your Repertoire is empty. Type a piece above, or press <em>Add to Repertoire</em> on any score.</p>`;
    // Rebuilding identical cards closes an open status menu and drops clicks
    // that are in progress, so the list is only replaced when it changed.
    const listChanged = listEl.dataset.painted !== listHtml;
    if (listChanged) {
      listEl.dataset.painted = listHtml;
      listEl.innerHTML = listHtml;
    }
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
    if (!listChanged) return;
    listEl.querySelectorAll("[data-work]").forEach((btn) => {
      btn.addEventListener("click", () => openWorkOn(btn.dataset.work).catch((err) => toast(err.message)));
    });
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
    if (b.dataset.taskDone) {
      store.updateTask(b.dataset.taskDone, { done: true });
      toast("Marked done");
      return renderRepertoire();
    }
    if (b.dataset.taskRemove) {
      store.removeTask(b.dataset.taskRemove);
      toast("Removed from plan");
      return renderRepertoire();
    }
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
    if (window.LuneOnboard && !LuneOnboard.requireUnlock()) return;
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
        <li>An account stores your email address, the pieces in your Repertoire, your bar notes, practice plans and listening stumbles — nothing else.</li>
        <li>When cloud sync is on, your rows are locked to your account. Nothing is sold, shared or used for ads.</li>
        <li>Microphone audio for voice notes and listening is processed in your browser. Lune never records or uploads audio.</li>
        <li>Under 13? Ask a parent or guardian before making an account. You can download or delete everything at any time.</li>
      </ul>`;
    if (!st.signedIn) {
      d.innerHTML = `${closeRow}<h2>Sign in to keep Lune</h2>
        <p>Explore first — then sign in with email (no password) so repertoire, notes and plans stay with you.</p>
        <button type="button" class="primary" data-x="create">Sign in with email</button>${privacy}`;
    } else {
      const local = store.hasLocalData() && st.mode === "cloud";
      const ownerBlock = store.isOwner?.()
        ? `<div class="account-owner-users" id="account-owner-users"><p class="dim">Loading signed-up users…</p>
            <p style="margin:10px 0 0"><button type="button" class="quiet" data-x="owner-stats">Owner stats</button></p></div>`
        : "";
      d.innerHTML = `${closeRow}<h2>Account</h2>
        <p>Signed in as <strong>${esc(st.email)}</strong>${st.mode === "local" ? " <span class=\"dim\">(this device — add Supabase keys to sync by email)</span>" : ""}.</p>
        ${ownerBlock}
        ${local ? `<p class="lp-callout">This browser also has pieces saved from before you signed in. <button type="button" class="primary" data-x="import">Move them into my account</button></p>` : ""}
        <div class="lp-row">
          <button type="button" class="quiet" data-x="export">Download my data</button>
          <button type="button" class="quiet" data-x="signout">Sign out</button>
          <button type="button" class="quiet danger" data-x="delete">Delete account…</button>
        </div>${privacy}`;
      if (store.isOwner?.()) {
        store.ownerUserCount()
          .then((res) => {
            const el = d.querySelector("#account-owner-users");
            if (!el) return;
            if (res.users != null) {
              el.innerHTML = `<span class="owner-stats-num">${esc(String(res.users))}</span>
                <span class="owner-stats-label">signed-up users</span>
                <p style="margin:10px 0 0"><button type="button" class="quiet" data-x="owner-stats">Open Owner stats</button></p>`;
            } else {
              el.innerHTML = `<p class="dim">${esc(res.note || res.error || "Couldn’t load user count.")}</p>
                <p style="margin:10px 0 0"><button type="button" class="quiet" data-x="owner-stats">Open Owner stats</button></p>`;
            }
          })
          .catch((err) => {
            const el = d.querySelector("#account-owner-users");
            if (el) el.innerHTML = `<p class="dim">${esc(err.message || String(err))}</p>`;
          });
      }
    }
    d.onclick = async (e) => {
      if (e.target === d) return d.close();
      const b = e.target.closest("[data-x]");
      if (!b || b.tagName === "FORM") return;
      try {
        if (b.dataset.x === "create") {
          d.close();
          window.LuneOnboard?.openCreateAccount?.();
          return;
        }
        if (b.dataset.x === "owner-stats") {
          d.close();
          openOwnerStats();
          return;
        }
        if (b.dataset.x === "export") await exportData();
        if (b.dataset.x === "signout") {
          await store.signOut();
          d.close();
          toast("Signed out");
          window.LuneOnboard?.route?.();
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
      ${row("readableFont", "Easy read letters", "Atkinson Hyperlegible — every letter shape distinct. Clearer under the staff for anyone who prefers it.")}
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
    toast(next ? "Easy read letters on" : "Standard letters");
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
      a.textContent = id.includes("explain") ? "Download braille music" : "Braille";
      a.setAttribute("aria-label", "Download braille music file (.brf)");
    });
    // On the Overview, say so plainly when there is no file, so the option is never a mystery.
    const none = $("braille-none-explain");
    if (none) none.hidden = !!br || !piece || !!piece.local;
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
      <button type="button" class="quiet lp-tool" id="btn-listen" title="Hear the selected bar described: its notes, fingers and a tip (R)">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 10v4h3l4 3.5v-11L8 10H5zM15.5 9a4 4 0 0 1 0 6M17.8 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span class="lp-tool-label">Listen</span></button>
      <button type="button" class="quiet lp-tool" id="btn-tell" title="Ask about a bar, leave a remark, or add to your plan — type or speak">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        <span class="lp-tool-label">Ask Lune</span></button>`;
    head.appendChild(bar);
    bar.querySelector("#btn-tell")?.addEventListener("click", () => window.LuneAsk?.open?.());
    bar.querySelector("#btn-listen")?.addEventListener("click", () => readSelectedAloud());
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
    $("btn-settings")?.addEventListener("click", () => openSettings());
    $("btn-share-piece")?.addEventListener("click", async () => {
      if (!state.piece) return;
      shareText(titleFor(state.piece), await pieceSummary());
    });
    $("btn-share")?.addEventListener("click", () => openShare());
    // The bar panel's third button says what it does instead of hiding it behind dots.
    const listen = $("btn-coach-more");
    if (listen) {
      listen.className = "quiet ink coach-listen";
      listen.textContent = "Listen";
      listen.title = "Hear this bar described: notes, fingers and a tip";
      listen.setAttribute("aria-label", "Hear this bar described");
      listen.addEventListener("click", () => readSelectedAloud());
    }
  }

  /* ---------------- repertoire: what to work on ---------------- */

  /** A summary for one Repertoire piece, from its analysis, your remarks and your reviews. */
  async function openWorkOn(key) {
    const row = await store.getPiece(key);
    if (!row) return;
    const d = dialog("work-dialog");
    d.classList.add("settings-dialog");
    d.innerHTML = `${closeRow}<p class="auth-kicker">What to work on</p><h2>${esc(row.title)}</h2><p class="dim">Reading the score…</p>`;
    if (!d.open) d.showModal();
    const [notes, cards] = await Promise.all([store.listNotes(key).catch(() => []), store.listCards(key).catch(() => [])]);
    // the score's own hard bars, when this piece is in the library
    let hard = [];
    try {
      const open = state.sessions.find((s) => s.piece && keyFor(s.piece) === key)?.piece;
      const piece =
        open?.debriefs && Object.keys(open.debriefs).length
          ? open
          : await tryOpen({ query: row.source === "upload" ? row.title : key, title: row.title, composer: row.composer || "", analyze: true });
      hard = Object.values(piece?.debriefs || {})
        .filter((x) => x?.difficulty?.score != null)
        .sort((a, b) => b.difficulty.score - a.difficulty.score)
        .slice(0, 4)
        .map((x) => ({ bar: x.measure, why: (x.difficulty.reasons || []).slice(0, 2).join(", "), tip: Array.isArray(x.advice) ? x.advice[0] : x.advice }));
    } catch {
      /* not a library piece: work from remarks and reviews */
    }
    const due = cards.filter((c) => c.due_at <= new Date().toISOString()).map((c) => c.bar);
    const remarkBars = [...new Set(notes.map((n) => n.bar))];
    const bars = [...new Set([...due, ...remarkBars, ...hard.map((h) => h.bar)])].filter((b) => b > 0).slice(0, 6).sort((a, b) => a - b);
    const mins = Number(store.prefs().practiceMins) || 20;
    const steps = [{ kind: "hear", title: "Hear it once", detail: "Listen through before you play." }];
    for (const b of bars) {
      const h = hard.find((x) => x.bar === b);
      const mine = notes.filter((n) => n.bar === b).map((n) => n.body);
      steps.push({
        kind: "hard",
        bars: [b],
        title: `Bar ${b}`,
        detail: [due.includes(b) ? "Due for review." : "", h?.tip ? String(h.tip).split(/(?<=[.!?])\s/)[0] : "", mine.length ? `Your remark: “${mine[mine.length - 1]}”.` : ""].filter(Boolean).join(" ") || "Slowly, hands separately, then together.",
      });
    }
    const label = Object.fromEntries(STATUS);
    d.innerHTML = `${closeRow}<p class="auth-kicker">What to work on</p><h2>${esc(row.title)}</h2>
      <p class="settings-note">${esc(label[row.status] || "Learning")} · last practised ${esc(ago(row.last_practised_at))} · ${notes.length} remark${notes.length === 1 ? "" : "s"}</p>
      ${
        bars.length
          ? `<ol class="work-steps">${steps.map((st) => `<li><strong>${esc(st.title)}</strong> ${esc(st.detail)}</li>`).join("")}</ol>`
          : `<p class="settings-note">Nothing to plan yet. Open the piece, tap the bars that give you trouble and leave a remark or rate them; they will show up here.</p>`
      }
      <label for="work-extra">Add something of your own <span class="dim">(optional)</span></label>
      <textarea id="work-extra" rows="2" maxlength="300" placeholder="e.g. memorise the first page"></textarea>
      <div class="onboard-nav auth-keep-nav">
        <button type="button" class="quiet rep-remove-link" data-work-remove>Remove from Repertoire</button>
        <button type="button" class="quiet" data-work-open>Open piece</button>
        <button type="button" class="primary" data-work-add>Add to my plan</button>
      </div>`;
    d.querySelector("[data-work-open]").addEventListener("click", () => {
      d.close();
      openFromRepertoire(key, { bars }).catch((err) => toast(err.message));
    });
    d.querySelector("[data-work-remove]").addEventListener("click", (e) => {
      // removing takes two presses, so it can't happen by accident
      if (!e.currentTarget.dataset.sure) {
        e.currentTarget.dataset.sure = "1";
        e.currentTarget.textContent = "Remove? Press again";
        return;
      }
      d.close();
      document.querySelector(`#rep-list [data-remove="${CSS.escape(key)}"]`)?.click();
      document.querySelector(`#rep-list [data-remove="${CSS.escape(key)}"]`)?.click();
    });
    d.querySelector("[data-work-add]").addEventListener("click", () => {
      const extra = d.querySelector("#work-extra").value.trim();
      const all = extra ? [...steps, { kind: "own", title: "Your own", detail: extra }] : steps;
      if (!bars.length && !extra) return toast("Write something to add, or mark some bars in the piece first");
      store.addTask({
        piece_key: key,
        title: row.title,
        composer: row.composer || "",
        bars,
        notes: extra || `${mins} minutes${bars.length ? ` on bars ${bars.join(", ")}` : ""}.`,
        plan: { source: "repertoire", mins, summary: `${mins} minutes${bars.length ? ` on bars ${bars.join(", ")}` : ""}.`, steps: all, created_at: new Date().toISOString() },
      });
      d.close();
      toast("Added to your plan");
      renderRepertoire();
    });
  }

  /* ---------------- settings ---------------- */

  function openSettings() {
    const d = dialog("settings-dialog");
    d.classList.add("settings-dialog");
    const signedIn = store.status().signedIn;
    const p = store.prefs();
    const days = Number(p.practiceDays) || 4;
    const mins = Number(p.practiceMins) || 30;
    const row = (act, title, text) =>
      `<button type="button" class="settings-row" data-set="${act}"><strong>${title}</strong><span>${text}</span></button>`;
    const sw = (k, label, hint) => `<label class="lp-switch"><input type="checkbox" data-pref="${k}" ${p[k] ? "checked" : ""}>
      <span><strong>${label}</strong><small>${hint}</small></span></label>`;
    const install = window.LuneInstall?.installed?.()
      ? `<p class="settings-note"><strong>Installed</strong>Lune is running as an app on this device.</p>`
      : `<button type="button" class="settings-row" data-install id="set-install"><strong>Install Lune</strong><span>${
          window.LuneInstall?.available?.()
            ? "Put Lune on this device as an app. It opens in its own window and works offline for pieces you have opened."
            : "Steps for this browser: iPhone and iPad use Share, then Add to Home Screen; Safari on a Mac uses File, then Add to Dock."
        }</span></button>`;
    const privacy = document.querySelector("#credits-privacy + ul")?.outerHTML || "";
    d.innerHTML = `${closeRow}
      <p class="auth-kicker">Settings</p>
      <h2>Settings</h2>
      <h3>Account</h3>
      ${signedIn ? row("account", "Your account", `${esc(store.status().email || "Signed in")} — export or delete your data, sign out.`) : row("signin", "Sign in or create an account", "Keeps your Repertoire, remarks and plans on every device. Free.")}
      <h3>Appearance</h3>
      <div class="settings-theme" role="group" aria-label="Appearance">
        ${[["dark", "Dark"], ["light", "Light"]]
          .map(([v, l]) => `<button type="button" data-theme-set="${v}" aria-pressed="${(document.documentElement.dataset.theme || "dark") === v}">${l}</button>`)
          .join("")}
      </div>
      <p class="settings-note">The score follows: a dark page with light notes at night, a white page in the light.</p>
      <h3>Reading and access</h3>
      ${sw("readableFont", "Easy read letters", "A typeface where every letter shape is distinct.")}
      ${sw("largePrint", "Large print", "Bigger notes, letters and buttons.")}
      ${sw("highContrast", "High contrast", "Pure black on white for the score.")}
      ${sw("autoRead", "Read bars aloud", "Each bar you select is described out loud.")}
      <p class="settings-note">Lune works with the screen reader built into your device (VoiceOver on iPhone and Mac, TalkBack on Android, Narrator on Windows). Braille music files are on each piece’s Overview when available.</p>
      <h3>Your week</h3>
      <p class="settings-note">A day counts when you rate a bar, finish a plan task or open a piece to practise. “This week” compares those days with your goal.</p>
      <div class="settings-goal">
        <label for="set-days">Days a week</label>
        <select id="set-days">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<option ${n === days ? "selected" : ""}>${n}</option>`).join("")}</select>
        <label for="set-mins">Minutes a day</label>
        <select id="set-mins">${[10, 15, 20, 30, 45, 60, 90].map((n) => `<option ${n === mins ? "selected" : ""}>${n}</option>`).join("")}</select>
      </div>
      ${signedIn ? row("week", "See this week", "Days practised against your goal, bars that improved, bars that still trip you.") : ""}
      ${row("example-week", "See an example week", "A made-up week, so you can see what This week, Share and Invite look like before you have one of your own.")}
      <h3>App</h3>
      ${install}
      ${row("upload", "Upload a score", "MusicXML, PDF or a photo. It stays on this device unless you add it to your Repertoire while signed in.")}
      ${row("feedback", "Send feedback", "Tell Verushka what changed or what is missing. It goes straight to her.")}
      <h3>Ask Lune</h3>
      <h4 class="settings-sub">Lune AI on this device</h4>
      <div class="settings-device-ai" id="set-device-ai"></div>
      <h4 class="settings-sub">Your own model with Ollama</h4>
      <p class="settings-note">If Ollama runs on your computer, Ask Lune can use a model there instead. No paid API is required, there is no key, and what you ask stays on your machine.</p>
      <p class="settings-note" id="set-ai-status" role="status"><strong>${window.LuneAIProvider?.connected?.() ? "Local model set" : "Local model not connected"}</strong>${window.LuneAIProvider?.connected?.() ? `Ask Lune sends questions to ${esc(window.LuneAsk.aiSettings().model)} at the address below. Press Test to check it is running.` : "Ask Lune is using its built-in answers, worked out from the score and your remarks. They are not from a language model."}</p>
      <ol class="settings-steps">
        <li>Install Ollama from ollama.com (free) and open it.</li>
        <li>In Terminal, fetch a model: <code>ollama pull llama3.2</code> (about 2 GB; <code>qwen2.5:7b</code> is slower and more careful).</li>
        <li>Allow this site to reach it: quit Ollama, then run <code>OLLAMA_ORIGINS=${esc(location.origin)} ollama serve</code>.</li>
        <li>Press “Use Ollama on this computer”, then Test.</li>
      </ol>
      <div class="settings-ai">
        <button type="button" class="quiet" data-ai="ollama">Use Ollama on this computer</button>
        <label for="set-ai-url">Model address</label>
        <input id="set-ai-url" type="url" inputmode="url" placeholder="http://localhost:11434/v1/chat/completions" value="${esc(window.LuneAsk?.aiSettings?.().endpoint || "")}">
        <label for="set-ai-model">Model name</label>
        <input id="set-ai-model" type="text" placeholder="llama3.2" value="${esc((() => { try { return localStorage.getItem("lune.ai.model") || ""; } catch { return ""; } })())}">
        <div class="settings-ai-actions">
          <button type="button" class="quiet" data-ai="save">Save</button>
          <button type="button" class="quiet" data-ai="test">Test</button>
          <button type="button" class="quiet" data-ai="off">Disconnect</button>
        </div>
        <p class="settings-note" id="set-ai-msg" role="status" aria-live="polite"></p>
      </div>
      <h3>Privacy</h3>
      <div class="settings-privacy">${privacy}</div>
      <h3>About Lune</h3>
      <p class="settings-note">Lune is a free piano practice studio made by Verushka Patel. No ads, no payments. It installs from the browser; it is not an App Store or Play Store app.</p>
      ${row("credits", "Credits and licences", "The scores, sounds and software Lune is built on.")}
      ${
        store.isOwner?.()
          ? `<h3>Owner</h3>${row("owner-stats", "Owner stats", "Signed-up users.")}${row("owner-impact", "Impact", "Anonymous totals and the public snapshot.")}${row("owner-feedback", "Feedback received", "What pianists and teachers have written.")}`
          : ""
      }`;
    paintDeviceAISettings(d.querySelector("#set-device-ai"));
    d.onchange = (e) => {
      const k = e.target.dataset?.pref;
      if (k) {
        store.setPref(k, e.target.checked);
        applyAccessPrefs();
        syncAccessChips();
        if (k !== "autoRead" && state.piece && state.panel === "score") {
          try {
            window.fitZoomCache?.clear?.();
          } catch {
            /* ignore */
          }
          renderScore().then(() => paintScoreMarks()).catch(() => {});
        }
        return;
      }
      if (e.target.id === "set-days" || e.target.id === "set-mins") {
        store.setPref("practiceDays", Number(d.querySelector("#set-days").value));
        store.setPref("practiceMins", Number(d.querySelector("#set-mins").value));
        store.syncPrefs?.();
        window.LuneOnboard?.paintSignedHome?.();
        toast("Goal saved");
      }
    };
    d.onclick = (e) => {
      const th = e.target.closest("[data-theme-set]");
      if (th) {
        const light = th.dataset.themeSet === "light";
        if (light) document.documentElement.dataset.theme = "light";
        else delete document.documentElement.dataset.theme;
        try {
          localStorage.setItem("lune.theme", light ? "light" : "dark");
        } catch {
          /* private mode: lasts for this visit */
        }
        document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#f5f5f5" : "#0a0a0a");
        d.querySelectorAll("[data-theme-set]").forEach((x) => x.setAttribute("aria-pressed", String(x === th)));
        return;
      }
      const dev = e.target.closest("[data-device-ai]");
      if (dev) {
        const box = d.querySelector("#set-device-ai");
        if (dev.dataset.deviceAi === "on") window.LuneAsk.turnOnDeviceAI(box, { onDone: () => setTimeout(() => paintDeviceAISettings(box), 1500) });
        else window.LuneDeviceAI.turnOff().then(() => paintDeviceAISettings(box, "Lune AI is off and its download was deleted from this browser."));
        return;
      }
      const ai = e.target.closest("[data-ai]");
      if (ai) {
        const msg = d.querySelector("#set-ai-msg");
        const url = d.querySelector("#set-ai-url").value.trim();
        const model = d.querySelector("#set-ai-model").value.trim();
        const put = (k, v) => {
          try {
            if (v) localStorage.setItem(k, v);
            else localStorage.removeItem(k);
          } catch {
            /* private mode */
          }
        };
        if (ai.dataset.ai === "ollama") {
          d.querySelector("#set-ai-url").value = "http://localhost:11434/v1/chat/completions";
          if (!d.querySelector("#set-ai-model").value.trim()) d.querySelector("#set-ai-model").value = "llama3.2";
          put("lune.ai.endpoint", d.querySelector("#set-ai-url").value);
          put("lune.ai.model", d.querySelector("#set-ai-model").value.trim());
          msg.textContent = "Set to Ollama’s address on this computer. Press Test to check it is running.";
          return;
        }
        if (ai.dataset.ai === "off") {
          put("lune.ai.endpoint", "");
          put("lune.ai.model", "");
          d.querySelector("#set-ai-url").value = "";
          d.querySelector("#set-ai-model").value = "";
          msg.textContent = "Disconnected. Ask Lune uses its built-in answers.";
          return;
        }
        if (url && !/^https?:\/\//i.test(url)) {
          msg.textContent = "The address should start with http:// or https://";
          return;
        }
        put("lune.ai.endpoint", url);
        put("lune.ai.model", model);
        if (ai.dataset.ai === "save") {
          msg.textContent = url ? "Saved. Questions in Ask Lune now go to this model." : "Nothing to connect: the address is empty.";
          return;
        }
        if (!url) {
          msg.textContent = "Enter the model address first.";
          return;
        }
        msg.textContent = "Asking the model…";
        window.LuneAsk.testModel()
          .then((t) => (msg.textContent = `Connected. The model replied: “${String(t).slice(0, 80)}”`))
          .catch((err) => (msg.textContent = `No reply from that address (${err.message || "network error"}). Check that Ollama is running and was started with OLLAMA_ORIGINS set to this site. Ask Lune keeps using its built-in answers meanwhile.`));
        return;
      }
      const b = e.target.closest("[data-set]");
      if (!b) return;
      const act = b.dataset.set;
      d.close();
      if (act === "account") openAccountDialog();
      else if (act === "signin") window.LuneOnboard?.openCreateAccount?.();
      else if (act === "week") window.LuneImpact?.openWeeklyReview?.();
      else if (act === "example-week") openExampleWeek();
      else if (act === "upload") $("file")?.click();
      else if (act === "feedback") window.LuneFeedback?.open?.();
      else if (act === "credits") document.querySelector("[data-open-credits]")?.click();
      else if (act === "owner-stats") openOwnerStats();
      else if (act === "owner-impact") window.LuneImpact?.openOwnerImpact?.();
      else if (act === "owner-feedback") window.LuneFeedback?.openOwner?.();
    };
    if (!d.open) d.showModal();
  }

  /** Lune AI in Settings: what it is, its size before anything downloads, and how to turn it off. */
  async function paintDeviceAISettings(box, message = "") {
    const D = window.LuneDeviceAI;
    if (!box || !D) return;
    const plan = await D.plan();
    if (!D.offered()) {
      // not offered until a real model has passed its test (ai-device.js)
      box.previousElementSibling?.remove();
      box.remove();
      return;
    }
    if (!plan.supported) {
      box.innerHTML = `<p class="settings-note">This browser cannot run Lune AI. Ask Lune uses its built-in answers.</p>`;
      return;
    }
    if (D.enabled() || D.status() === "ready") {
      box.innerHTML = `<p class="settings-note" role="status"><strong>Lune AI is on</strong>${esc(plan.name)} (${esc(plan.licence)}) runs in this browser on ${
        plan.device === "webgpu" ? "the graphics card (WebGPU)" : "the processor (WebAssembly)"
      }. It answers Ask Lune from the score and your remarks. Nothing you ask leaves this device.</p>
        <button type="button" class="quiet" data-device-ai="off">Turn off and delete the download</button>
        ${message ? `<p class="settings-note">${esc(message)}</p>` : ""}`;
      return;
    }
    box.innerHTML = `${window.LuneAsk.deviceOfferHtml(plan).replace("data-ai-on", 'data-device-ai="on"')}
      ${message ? `<p class="settings-note" role="status">${esc(message)}</p>` : ""}`;
  }

  /** A walk through This week → Share → Invite with invented numbers, labelled as an example throughout. */
  function openExampleWeek() {
    const d = dialog("example-week-dialog");
    d.classList.add("settings-dialog");
    const days = Number(store.prefs().practiceDays) || 4;
    const mins = Number(store.prefs().practiceMins) || 30;
    const ex = (n, title, h, body) => ({ k: `Example · ${n} of 7 · ${title}`, h, body: `${body}<p class="settings-note example-flag">Example data. Nothing here is saved or added to your account.</p>` });
    const steps = [
      ex(1, "Create your week", "Start with a goal", `<p class="settings-note">Your week is the days and minutes you intend to practise. This example uses <strong>${days} days of ${mins} minutes</strong>, the goal you have now. Change it in Settings under Your week.</p>`),
      ex(2, "Add practice goals", "Say what the week is for", `<div class="example-share"><p><strong>Goal</strong> Clair de lune, bars 1 to 14, hands together at a slow tempo.</p></div><p class="settings-note">A goal is a plan task. Write one from Repertoire with New task, or ask Lune to make a plan for a piece.</p>`),
      ex(3, "Add pieces and bars", "Point at the bars", `<div class="example-share"><p><strong>Clair de lune</strong> bars 3, 7, 12</p><p><strong>Für Elise</strong> bars 13, 32</p></div><p class="settings-note">On a score, tap a bar and choose Add to my plan, or leave a remark. Those bars become this week’s work.</p>`),
      ex(4, "See tasks", "One list, in Repertoire", `<div class="example-share"><p><span class="task-origin">Suggested by Lune</span> · bars 3, 7, 12</p><p>1. Hear it once. 2. Bar 3, slowly. 3. Bar 7, hands separately. 4. Play it through.</p><p><span class="task-origin task-origin-you">Written by you</span> · Memorise the first page</p></div>`),
      ex(5, "Mark progress", "Rate a bar after you play it", `<div class="impact-stats impact-stats-owner">
            <div><span class="impact-num">3</span><span class="dim">days practised · goal ${days}</span></div>
            <div><span class="impact-num">5</span><span class="dim">bars rated Good or Easy</span></div>
            <div><span class="impact-num">2</span><span class="dim">bars still Hard</span></div>
            <div><span class="impact-num">1</span><span class="dim">task finished</span></div>
          </div><p class="settings-note">A day counts when you rate a bar, finish a task or open a piece to practise. Again and Hard bars come back sooner.</p>`),
      ex(6, "Share the week", "What a teacher or parent sees", `<div class="example-share"><p class="auth-kicker">A Lune pianist · this week</p><p><strong>3 days practised</strong>, goal ${days}</p><p>Clair de lune · Für Elise</p><p class="dim">No email. No remark text. Hard bar numbers only if you tick the box.</p></div><p class="settings-note">Share, then This week, makes a read-only page with its own link. You pick the name and the pieces and can switch the link off whenever you like. It needs an account so you can switch it off later.</p>`),
      ex(7, "Invite another person", "Bring someone with you", `<p class="settings-note">Invite sends the same week page with one extra line: “Invited by a pianist on Lune”. If they make an account they start with their own empty studio. There are no points, no leaderboards and no friend lists.</p>`),
    ];
    let i = 0;
    const paint = () => {
      const s = steps[i];
      d.innerHTML = `${closeRow}<p class="auth-kicker">${s.k}</p><h2>${s.h}</h2>${s.body}
        <div class="onboard-nav auth-keep-nav">
          <button type="button" class="quiet" data-ex="back" ${i === 0 ? "disabled" : ""}>Back</button>
          <button type="button" class="primary" data-ex="next">${i === steps.length - 1 ? "Done" : "Next"}</button>
        </div>`;
    };
    d.onclick = (e) => {
      const b = e.target.closest("[data-ex]");
      if (!b) return;
      if (b.dataset.ex === "back") i = Math.max(0, i - 1);
      else if (i === steps.length - 1) return d.close();
      else i += 1;
      paint();
    };
    paint();
    if (!d.open) d.showModal();
  }

  /* ---------------- share ---------------- */

  /** Show exactly what will leave the device, then Share, Copy or Cancel. */
  function shareText(title, text) {
    const d = dialog("share-preview-dialog");
    d.classList.add("settings-dialog");
    d.innerHTML = `${closeRow}
      <p class="auth-kicker">What will be shared</p>
      <h2>${esc(title)}</h2>
      <p class="settings-note">Only the text below. Nothing else from your account goes with it, and you can edit it first.</p>
      <label class="visually-hidden" for="share-preview-text">Text to share</label>
      <textarea id="share-preview-text" rows="9">${esc(text)}</textarea>
      <div class="onboard-nav auth-keep-nav">
        <button type="button" class="quiet" data-sp="cancel">Cancel</button>
        <button type="button" class="quiet" data-sp="copy">Copy</button>
        ${navigator.share ? `<button type="button" class="primary" data-sp="share">Share</button>` : ""}
      </div>`;
    d.onclick = async (e) => {
      const b = e.target.closest("[data-sp]");
      if (!b) return;
      const out = d.querySelector("#share-preview-text").value;
      if (b.dataset.sp === "cancel") return d.close();
      if (b.dataset.sp === "share") {
        try {
          await navigator.share({ title, text: out });
          d.close();
        } catch (err) {
          if (err?.name !== "AbortError") toast("Sharing isn’t available here — use Copy");
        }
        return;
      }
      try {
        await navigator.clipboard.writeText(out);
        toast("Copied — paste it into a message or email");
        d.close();
      } catch {
        d.querySelector("#share-preview-text").select();
        toast("Select the text and copy it");
      }
    };
    if (!d.open) d.showModal();
  }

  async function repertoireSummary() {
    const pieces = await store.listPieces();
    if (!pieces.length) return "";
    const label = Object.fromEntries(STATUS);
    return `My repertoire on Lune (lune.page)\n\n${pieces
      .map((p) => `• ${p.title}${p.composer ? ` — ${p.composer}` : ""} · ${label[p.status] || "Learning"}${p.last_practised_at ? ` · last practised ${ago(p.last_practised_at)}` : ""}`)
      .join("\n")}`;
  }

  async function pieceSummary() {
    const piece = state.piece;
    const key = keyFor(piece);
    if (!key) return "";
    const [row, notes, cards] = await Promise.all([
      store.getPiece(key).catch(() => null),
      store.listNotes(key).catch(() => []),
      store.listCards(key).catch(() => []),
    ]);
    const label = Object.fromEntries(STATUS);
    const lines = [`${titleFor(piece)}${composerFor(piece) ? ` — ${composerFor(piece)}` : ""}`, `Where it stands: ${label[row?.status] || "Learning"}`];
    if (cards.length) lines.push(`Bars I’m reviewing: ${[...new Set(cards.map((c) => c.bar))].sort((a, b) => a - b).join(", ")}`);
    if (notes.length) {
      lines.push("", "My remarks:");
      for (const n of notes.slice(-12)) lines.push(`• Bar ${n.bar}: ${n.body}`);
    }
    lines.push("", "From Lune — lune.page");
    return lines.join("\n");
  }

  function openShare() {
    const d = dialog("share-dialog");
    d.classList.add("settings-dialog");
    const inStudio = !!state.piece && document.body.classList.contains("is-studio");
    const signedIn = store.status().signedIn;
    const bars = inStudio ? selectedBarsSorted() : [];
    const row = (act, title, text, off) =>
      `<button type="button" class="settings-row" data-share="${act}" ${off ? "disabled" : ""}><strong>${title}</strong><span>${text}</span></button>`;
    d.innerHTML = `${closeRow}
      <p class="auth-kicker">Share</p>
      <h2>What would you like to share?</h2>
      ${row("repertoire", "My repertoire", "The list of pieces you’re learning and where each one stands. Sent as text you can paste anywhere.")}
      ${row("piece", inStudio ? `Progress on ${esc(titleFor(state.piece))}` : "Progress on a piece", inStudio ? "Its status, the bars you’re reviewing and your remarks, as text." : "Open a piece first, then come back here.", !inStudio)}
      ${row("bars", "Annotated bars, as a link", inStudio ? (bars.length ? `A link that opens this piece at bar ${bars.join(", ")} with your instructions. For a teacher or a student.` : "Select the bars on the score first, then come back here.") : "Open a piece and select bars first.", !bars.length)}
      ${row("week", "This week", signedIn ? "A read-only page of your practice week for a teacher or parent. No email, no remark text. You can switch it off at any time." : "Sign in first: the week page needs an account so you can switch it off later.", !signedIn)}
      ${row("invite", "Invite someone to Lune", signedIn ? "A link to your week that also invites them to try Lune." : "Sends a link to lune.page.")}`;
    d.onclick = async (e) => {
      const b = e.target.closest("[data-share]");
      if (!b || b.disabled) return;
      const act = b.dataset.share;
      d.close();
      if (act === "repertoire") {
        const text = await repertoireSummary();
        if (!text) return toast("Your Repertoire is empty — add a piece first");
        shareText("My repertoire", text);
      } else if (act === "piece") shareText(titleFor(state.piece), await pieceSummary());
      else if (act === "bars") openAssignDialog(bars);
      else if (act === "week") window.LuneImpact?.openShareWeek?.();
      else if (act === "invite") {
        if (signedIn) window.LuneImpact?.openInvite?.();
        else shareText("Lune", "Lune — a free piano practice studio: https://lune.page");
      }
    };
    if (!d.open) d.showModal();
  }

  function headerMenuItems() {
    const studio = document.body.classList.contains("is-studio");
    const bars = selectedBarsSorted();
    const items = [
      { label: "Upload a score", action: () => $("file")?.click() },
    ];
    if (studio) {
      items.push({
        label: "Add selection to plan",
        disabled: !bars.length,
        title: bars.length ? "" : "Select bars first",
        hint: bars.length ? "" : "Select bars first",
        action: () =>
          openTaskDialog({
            pieceKey: keyFor(state.piece),
            title: titleFor(state.piece),
            composer: composerFor(state.piece),
            bars,
          }),
      });
      items.push({ label: "Download MusicXML", action: () => window.downloadScore?.() });
      const a = document.querySelector("a.lp-braille");
      if (a?.href) items.push({ label: "Download Braille (.brf)", href: a.href, download: a.getAttribute("download") || "" });
    }
    if (store.status().signedIn) {
      items.push({ label: "This week", action: () => window.LuneImpact?.openWeeklyReview?.() });
      items.push({ label: "Share this week", action: () => window.LuneImpact?.openShareWeek?.() });
      items.push({ label: "Invite", action: () => window.LuneImpact?.openInvite?.() });
      items.push({ label: "Account", action: () => openAccountDialog() });
    } else {
      items.push({ label: "Sign in", action: () => window.LuneOnboard?.openCreateAccount?.() });
    }
    if (store.isOwner?.()) {
      // Keep Owner stats as its own clear entry (user count) — not only under Impact.
      items.push({ label: "Owner stats", action: () => openOwnerStats() });
      items.push({ label: "Impact", action: () => window.LuneImpact?.openOwnerImpact?.() });
      items.push({ label: "Feedback received", action: () => window.LuneFeedback?.openOwner?.() });
    }
    items.push({ label: "Reading & access", action: () => openAccessDialog() });
    items.push({ label: "Feedback", action: () => window.LuneFeedback?.open?.() });
    if (window.LuneInstall && !window.LuneInstall.installed()) items.push({ label: "Install Lune", action: () => window.LuneInstall.install() });
    items.push({ label: "Credits & licenses", action: () => document.querySelector("[data-open-credits]")?.click() });
    if (!studio) items.push({ label: "Privacy", action: () => openCreditsPrivacy() });
    return items;
  }

  async function openOwnerStats() {
    if (!store.isOwner?.()) {
      toast("Owner sign-in required");
      return;
    }
    const d = dialog("owner-stats-dialog", "credits-dialog auth-dialog");
    d.innerHTML = `${closeRow}
      <p class="auth-kicker">Owner</p>
      <h2>Signed-up users</h2>
      <div class="owner-stats-hero" id="owner-stats-body"><p class="dim">Loading…</p></div>
      <p class="dim">Private — only visible when signed in as the owner. No public user list.</p>
      <div class="onboard-nav auth-keep-nav">
        <button type="button" class="quiet" id="owner-stats-impact">Open impact</button>
        <button type="button" class="primary" id="owner-stats-done">Done</button>
      </div>`;
    if (!d.open) d.showModal();
    d.querySelector("#owner-stats-done")?.addEventListener("click", () => d.close());
    d.querySelector("#owner-stats-impact")?.addEventListener("click", () => {
      d.close();
      window.LuneImpact?.openOwnerImpact?.();
    });
    try {
      const res = await store.ownerUserCount();
      const body = d.querySelector("#owner-stats-body");
      if (!body) return;
      if (res.users != null) {
        body.innerHTML = `<span class="owner-stats-num">${esc(String(res.users))}</span>
          <span class="owner-stats-label">signed-up users</span>`;
      } else {
        body.innerHTML = `<p class="dim">${esc(res.note || res.error || "Couldn’t load a count yet.")}</p>`;
      }
    } catch (err) {
      const body = d.querySelector("#owner-stats-body");
      if (body) body.innerHTML = `<p class="dim">${esc(err.message || String(err))}</p>`;
    }
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
      const n = store.listTasks().filter((t) => !t.done).length;
      badge.hidden = !n;
      badge.textContent = n ? String(n) : "";
      badge.setAttribute("aria-hidden", n ? "false" : "true");
      if (n) badge.setAttribute("aria-label", `${n} practice task${n === 1 ? "" : "s"}`);
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
    const base = LUNE_ON_PAGES
      ? (location.hostname.includes("lune.page") ? `${location.origin}/` : "https://verushkapatel.github.io/lune/")
      : `${location.origin}${location.pathname}`;
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
          toast("Saved — open Repertoire to turn notes into a plan");
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
  /**
   * Lune's own estimate of how demanding a piece is, from its analysed bars
   * (the average of the hardest quarter). It is not an exam-board grade and
   * the interface says so. Kept per piece once its score has been read.
   */
  const LEVELS = [
    [8, "Beginner"],
    [20, "Early intermediate"],
    [45, "Intermediate"],
    [80, "Advanced"],
    [Infinity, "Virtuoso"],
  ];
  function rememberLevel(piece) {
    const key = keyFor(piece);
    const scores = Object.values(piece?.debriefs || {})
      .map((d) => d?.difficulty?.score)
      .filter((x) => Number.isFinite(x))
      .sort((a, b) => a - b);
    if (!key || scores.length < 4) return;
    const top = scores.slice(Math.floor(scores.length * 0.75));
    const mean = top.reduce((a, b) => a + b, 0) / top.length;
    try {
      localStorage.setItem(`lune.level.${key}`, LEVELS.find(([max]) => mean < max)[1]);
    } catch {
      /* private mode */
    }
  }
  function levelFor(key) {
    try {
      return localStorage.getItem(`lune.level.${key}`) || "";
    } catch {
      return "";
    }
  }

  function afterScoreRender() {
    rememberLevel(state.piece);
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
        if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(e.key)) return;
        if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.("input, textarea, select, [contenteditable], dialog")) return;
        if (state.panel !== "score" || $("studio")?.hidden || LunePiano.isPlaying?.()) return;
        const onScore = e.target === $("score-scroll");
        const sel = selectedBarsSorted();
        if (!state.piece?.debriefs) return;
        // with nothing selected, the keys work once the score itself has focus (Tab to it)
        if (!sel.length && !onScore) return;
        if (e.key === "Enter" && !onScore) return;
        // bar 0 (a pickup) cannot be selected, so the keys skip it as the mouse does
        const bars = Object.keys(state.piece.debriefs).map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
        if (!bars.length) return;
        let next;
        if (e.key === "Home") next = bars[0];
        else if (e.key === "End") next = bars[bars.length - 1];
        else if (!sel.length) next = bars[0];
        else if (e.key === "Enter") next = sel[0];
        else {
          const i = bars.indexOf(e.key === "ArrowRight" ? sel[sel.length - 1] : sel[0]);
          next = bars[Math.max(0, Math.min(bars.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)))];
        }
        if (next == null) return;
        e.preventDefault();
        e.stopPropagation(); // the playback position stays where it is
        setBarSelection([next], { open: true });
        scrollToBar(next);
        const live = $("score-live");
        if (live) {
          const d = debriefFor(next);
          live.textContent = `Bar ${next} of ${bars[bars.length - 1]}${d?.difficulty?.isHard ? ", one of the harder bars" : ""}.`;
        }
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
    const signedIn = !!(window.LuneOnboard?.signedIn?.() || store.status?.()?.signedIn);
    const host = signedIn ? $("member-continue") || $("home-continue") : $("home-continue");
    if (!host) return;
    // Don't paint continue onto the guest marketing hero while signed in.
    if (signedIn && host.id === "home-continue") {
      host.hidden = true;
      host.innerHTML = "";
      return;
    }
    let pieces = [];
    try {
      pieces = await store.listPieces();
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
    const n = store.listTasks().filter((t) => !t.done).length;
    host.hidden = false;
    const html = `<p class="home-continue-k">Continue</p>
      <p class="home-continue-t">${esc(last.title)}</p>
      <div class="home-continue-actions">
        <button type="button" class="primary" data-open="${esc(last.piece_key)}">Open</button>
        ${n ? `<button type="button" class="quiet" data-go-rep>${n} task${n === 1 ? "" : "s"} in your plan</button>` : ""}
      </div>`;
    // Replacing the button while it is being pressed loses the click.
    if (host.dataset.painted !== html) {
      host.dataset.painted = html;
      host.innerHTML = html;
    }
    host.onclick = (e) => {
      const b = e.target.closest("button");
      if (!b || b.disabled) return;
      if (b.hasAttribute("data-go-rep")) return showRepertoire();
      if (!b.dataset.open) return;
      b.disabled = true;
      openFromRepertoire(b.dataset.open)
        .catch((err) => toast(err.message))
        .finally(() => {
          b.disabled = false;
        });
    };
  }

  return {
    init,
    stopHearing,
    hearPhrase,
    canListenForWords,
    speak,
    readSelectedAloud,
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
    focusBars,
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
