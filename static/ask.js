/* Lune — Ask Lune.
 *
 * One place to type or speak: ask about a bar, leave a remark on it, say how
 * it went, or have a practice plan made. Everything it says comes from
 * Lune's analysis of the open score and from the remarks the pianist has
 * left on it. It is a rule-based assistant that runs in the browser, not a
 * language model, and it does not send what is asked anywhere.
 *
 * What was asked about a bar is kept on this device and shown again when
 * that bar is opened.
 */
window.LuneAsk = (function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const P = () => window.LunePractice;
  const store = () => window.LuneStore;

  let listening = false;

  /* ---------- memory: what was asked, per piece and bar ---------- */

  const keyFor = () => (state.piece ? P()?.keyFor(state.piece) || "" : "");
  function history(pieceKey = keyFor()) {
    try {
      return JSON.parse(localStorage.getItem(`lune.ask.${pieceKey}`) || "[]");
    } catch {
      return [];
    }
  }
  function remember(entry) {
    const k = keyFor();
    if (!k) return;
    const rows = [...history(k), entry].slice(-80);
    try {
      localStorage.setItem(`lune.ask.${k}`, JSON.stringify(rows));
    } catch {
      /* storage full or private mode: the answer is still on screen */
    }
  }
  function historyFor(bar) {
    return history().filter((h) => Number(h.bar) === Number(bar));
  }

  /* ---------- reading the analysis ---------- */

  const pretty = (name) =>
    String(name || "")
      .replace(/-?\d+$/, "")
      .replace(/^([A-Ga-g])(.*)$/, (m, a, acc) => a.toUpperCase() + acc.replace(/b/g, "♭").replace(/#/g, "♯"));

  function handLine(notes, label) {
    if (!notes?.length) return "";
    const byOffset = new Map();
    for (const n of notes) {
      const k = Math.round((Number(n.offset) || 0) * 1000);
      if (!byOffset.has(k)) byOffset.set(k, []);
      byOffset.get(k).push(n);
    }
    const groups = [...byOffset.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g.sort((a, b) => b.midi - a.midi));
    const names = groups.map((g) => g.map((n) => pretty(n.letter || n.pitch)).join("+")).slice(0, 10);
    return `${label}: ${names.join("  ")}${groups.length > 10 ? " …" : ""}`;
  }
  function fingerLine(notes, label) {
    const f = (notes || [])
      .slice()
      .sort((a, b) => a.offset - b.offset || b.midi - a.midi)
      .filter((n) => n.fingering)
      .map((n) => `${pretty(n.letter || n.pitch)} ${n.fingering}`);
    return f.length ? `${label}: ${f.slice(0, 10).join(", ")}${f.length > 10 ? " …" : ""}` : "";
  }
  const first = (v, n = 2) => (Array.isArray(v) ? v : v ? [v] : []).slice(0, n);

  function hardest(limit = 4) {
    const deb = state.piece?.debriefs || {};
    return Object.values(deb)
      .filter((d) => d?.difficulty?.score != null)
      .sort((a, b) => b.difficulty.score - a.difficulty.score)
      .slice(0, limit)
      .map((d) => ({ bar: d.measure, why: (d.difficulty.reasons || []).slice(0, 2).join(", ") }));
  }

  /* ---------- actions ---------- */

  async function makePlan(bars, words) {
    const piece = state.piece;
    const key = keyFor();
    const mins = Number(store().prefs?.()?.practiceMins) || 20;
    const goal = store().prefs?.()?.dreamPiece?.title;
    const picked = (bars.length ? bars : hardest(3).map((h) => h.bar)).slice(0, 5).sort((a, b) => a - b);
    if (!picked.length) return "Open a score with notes first, then ask me for a plan.";
    let remarks = [];
    try {
      remarks = (await store().listNotes(key)).filter((n) => picked.includes(Number(n.bar)));
    } catch {
      /* no remarks yet */
    }
    const steps = [{ kind: "hear", title: "Hear it once", detail: "Listen to these bars before you play them." }];
    for (const b of picked) {
      const d = debriefFor(b);
      const tip = first(d?.advice, 1)[0] || "Hands separately, slowly, then together.";
      const mine = remarks.filter((r) => Number(r.bar) === b).map((r) => r.body);
      steps.push({
        kind: "hard",
        bars: [b],
        title: `Bar ${b}`,
        detail: `${String(tip).split(/(?<=[.!?])\s/)[0]}${mine.length ? ` Your remark: “${mine[mine.length - 1]}”.` : ""}`,
      });
    }
    steps.push({ kind: "easy", title: "Play it through", detail: "Once at a tempo where nothing breaks, then stop." });
    const summary = `${mins} minutes on ${picked.length === 1 ? `bar ${picked[0]}` : `bars ${picked.join(", ")}`}${
      goal ? `, on the way to ${goal}` : ""
    }.`;
    await P()?.addCurrentToRepertoire?.({ quiet: true }).catch(() => {});
    store().addTask({
      piece_key: key,
      title: piece?.overview?.title || piece?.title || "Practice",
      composer: piece?.overview?.composer || piece?.composer || "",
      bars: picked,
      notes: words || summary,
      plan: { source: "ask", mins, summary, steps, created_at: new Date().toISOString() },
    });
    P()?.refreshBadge?.();
    return `Plan saved to your Repertoire. ${summary}\n${steps.map((s, i) => `${i + 1}. ${s.title} — ${s.detail}`).join("\n")}`;
  }

  async function rate(bars, grade) {
    const key = keyFor();
    await P()?.addCurrentToRepertoire?.({ quiet: true }).catch(() => {});
    for (const b of bars) await store().reviewBar(key, b, grade);
    P()?.refreshBadge?.();
    const word = { again: "to do again tomorrow", hard: "as hard", good: "as good", easy: "as easy" }[grade];
    return `Logged bar${bars.length === 1 ? "" : "s"} ${bars.join(", ")} ${word}. Lune will bring ${bars.length === 1 ? "it" : "them"} back at the right time.`;
  }

  /* ---------- understanding what was typed or said ---------- */

  async function reply(text) {
    if (!state.piece) return { a: "Open a score first — then ask me about any bar in it." };
    const sel = selectedBarsSorted();
    const parsed = P()?.parseSpoken?.(text, sel[0] || null) || { bar: sel[0] || null, body: text };
    const named = /\b(?:bar|measure)\s*\d+/i.test(text);
    const bar = parsed.bar && debriefFor(parsed.bar) ? Number(parsed.bar) : null;
    const bars = named && bar ? [bar] : sel.length ? sel : bar ? [bar] : [];
    const t = text.toLowerCase();
    const d = bar ? debriefFor(bar) : null;
    const isQuestion = /\?$|^(what|which|why|how|when|where|who|is|are|can|could|should|do|does|did|will|would|show|tell|explain|give)\b/.test(t.trim());

    // a plan
    if (/\b(plan|to-?do|todo|schedule)\b/.test(t) || /\bwhat should i (practi[sc]e|work on)\b/.test(t)) {
      return { bar: bars[0] || null, a: await makePlan(bars, ""), saved: "plan" };
    }
    // how it went
    const grade = /\b(again|couldn'?t|can'?t play|fell apart|messed)\b/.test(t)
      ? "again"
      : /\b(hard|tricky|difficult|struggl)/.test(t)
        ? "hard"
        : /\b(easy|effortless|no problem)\b/.test(t)
          ? "easy"
          : /\b(good|fine|better|okay|ok|clean|went well)\b/.test(t)
            ? "good"
            : null;
    if (grade && !isQuestion && bars.length && /\b(was|went|felt|is|that|it)\b/.test(t)) {
      return { bar: bars[0], a: await rate(bars, grade), saved: "review" };
    }
    // a remark to keep on the bar
    const remarkLead = /^(note|remark|remember|write|log|mark|flag)\b[:,]?\s*/i;
    if (remarkLead.test(text.trim()) || (!isQuestion && bar)) {
      const body = String(parsed.body || text).replace(remarkLead, "").trim();
      if (!bar) return { a: "Which bar is that for? Tap a bar, or start with “bar 12 …”." };
      if (!body) return { bar, a: `What should I note on bar ${bar}?` };
      await P().saveNote(bar, body, "text");
      return { bar, a: `Noted on bar ${bar}: “${body}”. It is flagged on the score.`, saved: "remark" };
    }

    // questions about the whole piece
    const p = state.piece;
    if (!d) {
      if (/\b(hard|difficult|tricky|worst|practi[sc]e|work on|focus)\b/.test(t)) {
        const h = hardest(4);
        return {
          a: h.length
            ? `The bars that will need the most work: ${h.map((x) => `bar ${x.bar}${x.why ? ` (${x.why})` : ""}`).join("; ")}. Tap one and ask me how to practise it, or say “make a plan”.`
            : "I can't rank the bars in this score yet.",
        };
      }
      if (/\b(key|tempo|speed|fast|time signature|metre|meter|composer|who wrote|era|period)\b/.test(t)) {
        const bits = [
          p.notatedKey || p.overview?.key ? `Key: ${p.notatedKey || p.overview.key}` : "",
          p.timeSignature || p.overview?.timeSignature ? `Time signature: ${p.timeSignature || p.overview.timeSignature}` : "",
          p.tempo || p.overview?.tempo ? `Tempo: ${p.tempo || p.overview.tempo}` : "",
          p.overview?.composer || p.composer ? `Composer: ${p.overview?.composer || p.composer}` : "",
          p.epoch || p.overview?.era ? `Era: ${p.epoch || p.overview.era}` : "",
        ].filter(Boolean);
        return { a: bits.length ? bits.join("\n") : "This score doesn't say." };
      }
      return {
        a: "Tap a bar (or say “bar 12 …”) and I can tell you its notes, fingering, harmony and how to practise it. I can also keep a remark on a bar, log how it went, or make a plan — say “make a plan”.",
      };
    }

    // questions about one bar
    const lines = [];
    if (/\bfinger/.test(t)) {
      lines.push(fingerLine(d.rh, "Right hand"), fingerLine(d.lh, "Left hand"));
      const why = [...(d.rh || []), ...(d.lh || [])].map((n) => n.fingeringNote).filter(Boolean)[0];
      if (why) lines.push(`Why: ${why}.`);
      if (!lines.filter(Boolean).length) lines.push("No fingering is suggested for this bar.");
    } else if (/\b(notes?|pitch|letters?|play(ed)? here|what is in|what's in)\b/.test(t)) {
      lines.push(handLine(d.rh, "Right hand"), handLine(d.lh, "Left hand"));
    } else if (/\b(chord|harmon|key)\b/.test(t)) {
      lines.push(first(d.harmony, 3).map((h) => (typeof h === "string" ? h : h.label || h.name || h.figure || "")).filter(Boolean).join(" · ") || "No harmony is recorded for this bar.");
    } else if (/\b(loud|soft|dynamic|pedal|express)/.test(t)) {
      lines.push([...first(d.dynamics, 3), ...first(d.expressions, 3)].map((x) => (typeof x === "string" ? x : x.label || x.text || "")).filter(Boolean).join(" · ") || "Nothing is marked in this bar; carry on from the bar before.");
    } else if (/\b(why|hard|difficult|tricky)\b/.test(t)) {
      lines.push(`${d.difficulty?.isHard ? "This is one of the harder bars" : "This bar is on the easier side"}${d.difficulty?.reasons?.length ? `: ${d.difficulty.reasons.join(", ")}` : ""}.`, ...first(d.advice, 1));
    } else {
      // how to play / practise it, or anything else: the coach's advice first
      if (d.headline) lines.push(d.headline[0].toUpperCase() + d.headline.slice(1) + ".");
      lines.push(...first(d.advice, 2));
      if (d.split?.needed && d.split.practiceNotes?.[0]) lines.push(d.split.practiceNotes[0]);
    }
    return { bar, a: lines.filter(Boolean).join("\n") || "I don't have more on this bar." };
  }

  /* ---------- the panel ---------- */

  function ensurePanel() {
    let p = $("ask-lune");
    if (p) return p;
    p = document.createElement("aside");
    p.id = "ask-lune";
    p.className = "ask-lune";
    p.hidden = true;
    p.setAttribute("aria-label", "Ask Lune");
    p.innerHTML = `
      <header class="ask-head">
        <div>
          <p class="ask-title">Ask Lune</p>
          <p class="ask-where" id="ask-where"></p>
        </div>
        <button type="button" class="icon-btn" id="ask-close" aria-label="Close Ask Lune">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
      </header>
      <div class="ask-log" id="ask-log" role="log" aria-live="polite"></div>
      <div class="ask-chips" id="ask-chips"></div>
      <form class="ask-form" id="ask-form" autocomplete="off">
        <button type="button" class="icon-btn ask-mic" id="ask-mic" aria-pressed="false" aria-label="Speak">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
        <label class="visually-hidden" for="ask-input">Ask about a bar, or leave a remark</label>
        <input id="ask-input" type="text" maxlength="400" placeholder="Ask, or say “bar 12, keep the thumb light”">
        <button type="submit" class="primary ask-send">Send</button>
      </form>
      <p class="ask-fine">Answers come from Lune’s reading of this score and your own remarks.</p>`;
    document.body.appendChild(p);
    p.querySelector("#ask-close").addEventListener("click", close);
    p.querySelector("#ask-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("ask-input");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      ask(text);
    });
    p.querySelector("#ask-mic").addEventListener("click", speakInto);
    p.querySelector("#ask-chips").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-q]");
      if (b) ask(b.dataset.q);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !p.hidden) close();
    });
    return p;
  }

  function line(who, text) {
    const log = $("ask-log");
    const el = document.createElement("p");
    el.className = `ask-msg ask-from-${who}`;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function paintContext() {
    const sel = selectedBarsSorted();
    const where = $("ask-where");
    const title = state.piece?.overview?.title || state.piece?.title || "";
    where.textContent = sel.length ? `${title} · bar ${sel.join(", ")}` : `${title} · tap a bar to ask about it`;
    const chips = sel.length
      ? [
          ["How do I practise this bar?", "How to practise"],
          ["What is the fingering?", "Fingering"],
          ["What notes are in this bar?", "Notes"],
          ["Make a plan", "Add to my plan"],
        ]
      : [
          ["Which bars are hardest?", "Hardest bars"],
          ["Make a plan", "Make a plan"],
          ["What key and tempo?", "Key and tempo"],
        ];
    $("ask-chips").innerHTML = chips.map(([q, label]) => `<button type="button" data-q="${esc(q)}">${esc(label)}</button>`).join("");
  }

  function paintHistory() {
    const log = $("ask-log");
    log.innerHTML = "";
    const sel = selectedBarsSorted();
    const rows = (sel.length ? historyFor(sel[0]) : history().filter((h) => !h.bar)).slice(-6);
    if (!rows.length) {
      line("lune", sel.length ? `Bar ${sel[0]}. Ask me anything about it, leave a remark, or tell me how it went.` : "Ask about this piece, or tap a bar first.");
      return;
    }
    for (const h of rows) {
      line("you", h.q);
      line("lune", h.a);
    }
  }

  async function ask(text) {
    ensurePanel();
    line("you", text);
    let out;
    try {
      out = await reply(text);
    } catch (err) {
      out = { a: err?.message || "That didn't work — try again." };
    }
    line("lune", out.a);
    remember({ bar: out.bar || null, q: text, a: out.a, t: Date.now() });
    if (out.saved) {
      P()?.paintScoreMarks?.();
      if (state.coachOpen) openBarCoach();
    }
  }

  async function speakInto() {
    const btn = $("ask-mic");
    const input = $("ask-input");
    if (listening) return P()?.stopHearing?.();
    if (!P()?.canListenForWords?.()) {
      toast("Voice isn’t available in this browser — type instead.");
      input.focus();
      return;
    }
    listening = true;
    btn.classList.add("on");
    btn.setAttribute("aria-pressed", "true");
    input.placeholder = "Listening…";
    try {
      const said = await P().hearPhrase({ onPartial: (t) => (input.value = t) });
      input.value = "";
      if (said) await ask(said);
      else toast("Didn’t catch that — try again, or type.");
    } catch (err) {
      toast(err.message || "Type instead.");
      input.focus();
    } finally {
      listening = false;
      btn.classList.remove("on");
      btn.setAttribute("aria-pressed", "false");
      input.placeholder = "Ask, or say “bar 12, keep the thumb light”";
    }
  }

  function open({ bar = null } = {}) {
    if (!state.piece) {
      toast("Open a score first — then ask Lune about any bar.");
      return;
    }
    const p = ensurePanel();
    if (bar && !selectedBarsSorted().includes(Number(bar))) {
      try {
        setBarSelection([Number(bar)], { open: false });
      } catch {
        /* selection is optional */
      }
    }
    paintContext();
    paintHistory();
    p.hidden = false;
    document.body.classList.add("ask-open");
    setTimeout(() => $("ask-input")?.focus(), 30);
  }

  function close() {
    const p = $("ask-lune");
    if (p) p.hidden = true;
    document.body.classList.remove("ask-open");
    P()?.stopHearing?.();
  }

  /** Keep the panel pointed at the bar that is selected while it is open. */
  function onSelection() {
    const p = $("ask-lune");
    if (!p || p.hidden) return;
    paintContext();
    paintHistory();
  }

  return { open, close, ask, historyFor, onSelection };
})();
