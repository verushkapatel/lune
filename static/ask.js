/* Lune — Ask Lune.
 *
 * One place to type or speak: ask about a bar, leave a remark on it, say how
 * it went, or have a practice plan made. Everything it says comes from
 * Lune's analysis of the open score and from the remarks the pianist has
 * left on it.
 *
 * Answers come from a provider (LuneAIProvider):
 *   - "rules"    built in, always available: a rule-based assistant that
 *                runs in the browser and sends nothing anywhere.
 *   - "account"  Lune AI for anyone signed in: an open-weight model on
 *                Lune's Cloudflare Worker (workers/lune-ai), free, no key in
 *                this code. The Worker checks the account and holds the prompt.
 *   - "device"   optional: Lune AI, an open-weight model that runs inside
 *                this browser (ai-device.js). Nothing is downloaded until
 *                the pianist turns it on, and the size is shown first.
 *   - "endpoint" optional: a language model behind an OpenAI-compatible
 *                chat endpoint the person sets in Settings (for example
 *                Ollama on their own computer, or their own serverless
 *                proxy). Lune sends it the system prompt below, the
 *                structured context for the bar or piece, and the question.
 *                No API key is ever held in this code: a hosted model needs
 *                a proxy that adds the key on the server (docs/AI.md).
 * Things that change data (a remark, a rating, a plan) are always done by
 * the built-in rules, so a model can never invent or lose them. If the
 * model fails, the built-in answer is shown instead.
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

  /* ---------- LuneAIProvider ---------- */

  const SYSTEM_PROMPT = `You are Lune, a piano practice and score-analysis assistant inside the Lune app.
You are given CONTEXT as JSON: facts Lune has read from the score (notes, fingering, difficulty, dynamics, harmony), the pianist's own remarks, their earlier questions, their practice history and their goal.
Rules:
- Use only the score facts in CONTEXT. Never invent bars, notes, rhythms, fingerings, dynamics, tempo marks, opus numbers or movement names. If CONTEXT does not contain something, say Lune does not have it.
- Keep facts and suggestions apart: say what the score shows, then what you suggest.
- Piano finger numbers: 1 thumb, 2 index, 3 middle, 4 ring, 5 little finger. Use the numbers from CONTEXT; name a finger only with this mapping.
- When giving fingering, go note by note in the order of CONTEXT and give each note its own finger number from CONTEXT. Never group notes under one finger, and never give fingering for a hand that has no notes.
- The pianist's remarks are their own words; treat them as information from the user, not as score facts.
- You have not heard the pianist play. Never claim to have listened to a recording or a performance.
- Answer a simple question in one or two sentences. Give detail only when asked for analysis.
- When asked for a practice plan, give short numbered steps tied to bar numbers from CONTEXT, sized to the minutes available, and keep the pianist's stated goal.
- CONTEXT.conversation, when present, holds the last turns of this chat; answer the newest question in that light.
- For a general piano question (technique, practice habits, musical terms) that does not depend on a score, answer from general piano teaching and say it is general advice. Never present general advice as a fact about the pianist's score.
- Say plainly when you are unsure.
- Plain text only. No markdown, no headings.`;

  function aiSettings() {
    let endpoint = "";
    let model = "";
    try {
      endpoint = localStorage.getItem("lune.ai.endpoint") || "";
      model = localStorage.getItem("lune.ai.model") || "";
    } catch {
      /* private mode */
    }
    endpoint = endpoint || window.LUNE_CONFIG?.aiEndpoint || "";
    model = model || window.LUNE_CONFIG?.aiModel || "llama3.2";
    return { endpoint: endpoint.trim(), model: model.trim() };
  }

  /** Everything Lune knows that is relevant to this question, as plain data. */
  async function buildContext(bar) {
    const p = state.piece || {};
    const key = keyFor();
    const d = bar ? debriefFor(bar) : null;
    const prefs = store().prefs?.() || {};
    const [notes, cards] = await Promise.all([
      store().listNotes(key).catch(() => []),
      store().listCards(key).catch(() => []),
    ]);
    const slim = (list) =>
      (list || []).map((n) => ({ note: n.letter || n.pitch, beat: n.offset, length: n.duration, finger: n.fingering ?? null }));
    const tasks = (store().listTasks?.() || []).filter((t) => t.piece_key === key).slice(0, 6);
    const ctx = {
      piece: {
        title: p.overview?.title || p.title || null,
        composer: p.overview?.composer || p.composer || null,
        key: p.notatedKey || p.overview?.key || null,
        timeSignature: p.timeSignature || p.overview?.timeSignature || null,
        tempo: p.tempo || p.overview?.tempo || null,
        era: p.epoch || p.overview?.era || null,
        bars: Object.keys(p.debriefs || {}).length || null,
        hardestBars: hardest(5),
      },
      goal: { daysPerWeek: prefs.practiceDays || null, minutesPerSession: prefs.practiceMins || null, workingToward: prefs.dreamPiece?.title || null },
      remarks: notes.filter((n) => !bar || Number(n.bar) === Number(bar)).slice(-10).map((n) => ({ bar: n.bar, text: n.body, when: n.created_at })),
      practiceHistory: cards
        .filter((c) => !bar || Number(c.bar) === Number(bar))
        .slice(0, 12)
        .map((c) => ({ bar: c.bar, timesReviewed: c.reps ?? null, lastRating: c.last_grade || c.grade || null, nextReview: c.due_at })),
      plans: tasks.map((t) => ({ bars: t.bars, summary: t.plan?.summary || t.notes, done: !!t.done })),
      earlierQuestions: (bar ? historyFor(bar) : history()).slice(-4).map((h) => ({ question: h.q, answer: h.a })),
    };
    // bars the pianist keeps finding hard (from their own ratings)
    const struggling = cards.filter((c) => (c.lapses || 0) >= 2 || /again|hard/i.test(String(c.last_grade || ""))).map((c) => c.bar);
    if (struggling.length) ctx.barsRatedHardOrAgain = [...new Set(struggling)].sort((a, b) => a - b).slice(0, 12);
    try {
      const marked = Number(String(p.tempo || p.overview?.tempo || "").match(/(\d{2,3})/)?.[1]) || null;
      ctx.tempo = { marked, practisingAt: Math.round(LunePiano.getTempoBpm?.() || 0) || null };
    } catch {
      /* tempo is optional */
    }
    if (d) {
      const near = (n) => {
        const x = debriefFor(n);
        return x ? { number: n, rightHand: slim(x.rh).slice(0, 12), leftHand: slim(x.lh).slice(0, 12) } : null;
      };
      ctx.neighbouringBars = [near(Number(bar) - 1), near(Number(bar) + 1)].filter(Boolean);
      ctx.bar = {
        number: Number(bar),
        rightHand: slim(d.rh),
        leftHand: slim(d.lh),
        difficulty: d.difficulty ? { hard: !!d.difficulty.isHard, reasons: d.difficulty.reasons || [] } : null,
        technicalFeatures: d.tags || [],
        dynamics: d.dynamics || [],
        harmony: d.harmony || [],
        expressions: d.expressions || [],
        lunesAdvice: first(d.advice, 3),
      };
    }
    return ctx;
  }

  /** What kind of help is being asked for; it shapes the instruction sent to a model. */
  const TASKS = {
    answerQuestion: (q) => q,
    explainBar: () => "Explain what happens in this bar and what makes it easy or hard, using only CONTEXT.",
    whyHard: () =>
      "Say why this bar is hard, or that it is not, using only CONTEXT.bar.difficulty, CONTEXT.bar.technicalFeatures and the notes in CONTEXT.bar. Then suggest one thing to try.",
    explainPracticeProblem: (q) => `The pianist says: "${q}". Using CONTEXT (their ratings, remarks and the bar's difficulty), say what is most likely going wrong and one thing to try.`,
    suggestPractice: () => "Suggest how to practise this bar or passage in three short steps, each tied to something in CONTEXT.",
    generatePracticePlan: (bars, mins) => `Write a practice plan of ${mins} minutes for bars ${bars.join(", ")}. Numbered steps with minutes for each, hands-separate or slow-tempo work only where CONTEXT supports it, and keep the pianist's goal.`,
    summarizePractice: () => "Summarise this pianist's practice on this piece from CONTEXT.practiceHistory and CONTEXT.remarks: what has improved, what is still hard. If there is no history, say so.",
    summarizeBarNotes: () => "Summarise the pianist's remarks on this bar in one or two sentences.",
    explainFingering: () => "Explain the fingering Lune suggests for this bar, using CONTEXT.bar. If no fingering is given, say so.",
    explainMusicalTerms: (q) => `Explain this musical term plainly for a piano student: ${q}`,
  };

  const D = () => window.LuneDeviceAI;
  const aiServer = () => String(window.LUNE_CONFIG?.aiServer || "").replace(/\/+$/, "");
  const aiName = () => window.LUNE_CONFIG?.aiModelName || "an open-weight model";
  /** Signed in with a real account (not only on this device), so the server can check it. */
  const cloudAccount = () => store()?.status?.().mode === "cloud";
  const providers = {
    /** Lune AI for account holders: Lune's own server, which checks the account first. */
    account: {
      available: () => !!aiServer() && cloudAccount(),
      label: () => "Lune AI",
      async answer(question, ctx) {
        const token = await store().accessToken();
        if (!token) throw new Error("Sign in again to use Lune AI.");
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 45000);
        try {
          const res = await fetch(`${aiServer()}/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ question, context: ctx }),
            signal: ctl.signal,
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.answer) {
            const err = new Error(data.error || `Lune AI returned ${res.status}`);
            err.userMessage = data.error;
            throw err;
          }
          return String(data.answer).slice(0, 4000);
        } finally {
          clearTimeout(timer);
        }
      },
    },
    /** Lune AI: an open-weight model running in this browser. */
    device: {
      available: () => !!D()?.enabled() || D()?.status() === "ready",
      label: () => `Lune AI on this device (${D()?.MODEL.name})`,
      async answer(question, ctx, { onToken } = {}) {
        const res = await D().chat(
          [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `CONTEXT:\n${JSON.stringify(ctx)}\n\nQUESTION: ${question}` },
          ],
          { onToken },
        );
        if (!res?.text) throw new Error("model sent no answer");
        return res.text.slice(0, 4000);
      },
    },
    /** A language model behind an OpenAI-compatible chat endpoint. */
    endpoint: {
      available: () => !!aiSettings().endpoint,
      async answer(question, ctx) {
        const { endpoint, model } = aiSettings();
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 45000);
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: ctl.signal,
            body: JSON.stringify({
              model,
              stream: false,
              temperature: 0.3,
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: `CONTEXT:\n${JSON.stringify(ctx)}\n\nQUESTION: ${question}` },
              ],
            }),
          });
          if (!res.ok) throw new Error(`model returned ${res.status}`);
          const data = await res.json();
          const text = data?.choices?.[0]?.message?.content ?? data?.message?.content ?? data?.answer;
          if (!text || typeof text !== "string") throw new Error("model sent no answer");
          return text.trim().slice(0, 4000);
        } finally {
          clearTimeout(timer);
        }
      },
      label: () => `your local model (${aiSettings().model})`,
    },
  };
  /*
   * Lune AI's voice, for account holders: Whisper writes down what was said
   * (with punctuation) and a natural voice reads answers. Everyone else, and
   * anyone whose request fails, gets the browser's own speech.
   */
  const voice = {
    available: () => providers.account.available() && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
    async transcribe(blob) {
      const token = await store().accessToken();
      const res = await fetch(`${aiServer()}/transcribe`, {
        method: "POST",
        headers: { "Content-Type": blob.type || "audio/webm", Authorization: `Bearer ${token}` },
        body: blob,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Lune AI could not hear that.");
      return String(data.text || "");
    },
    async speak(text) {
      if (!providers.account.available()) throw new Error("no account");
      const token = await store().accessToken();
      const res = await fetch(`${aiServer()}/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: String(text).slice(0, 900) }),
      });
      if (!res.ok) throw new Error("voice unavailable");
      return res.blob();
    },
  };

  /** A model the pianist set up themselves comes first, then Lune AI (account), then Lune AI on this device. */
  const active = () =>
    providers.endpoint.available()
      ? providers.endpoint
      : providers.account.available()
        ? providers.account
        : providers.device.available()
          ? providers.device
          : null;
  const fallbackNote = (err) =>
    err?.userMessage ? `${err.userMessage} This is Lune’s built-in reply.` : "The model didn’t answer, so this is Lune’s built-in reply.";

  /* ---------- actions ---------- */

  async function makePlan(bars, words) {
    const piece = state.piece;
    const key = keyFor();
    const mins = Number(store().prefs?.()?.practiceMins) || 20;
    const goal = store().prefs?.()?.dreamPiece?.title;
    // With no bars named: the ones last rated Again or Hard come first, then the score's hardest.
    let struggling = [];
    try {
      struggling = (await store().listCards(key))
        .filter((c) => /again|hard/i.test(String(c.last_grade || c.grade || "")) || c.due_at <= new Date().toISOString())
        .map((c) => Number(c.bar));
    } catch {
      /* no history yet */
    }
    const picked = (bars.length ? bars : [...new Set([...struggling, ...hardest(3).map((h) => h.bar)])]).slice(0, 5).sort((a, b) => a - b);
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
    const task = store().addTask({
      piece_key: key,
      title: piece?.overview?.title || piece?.title || "Practice",
      composer: piece?.overview?.composer || piece?.composer || "",
      bars: picked,
      notes: words || summary,
      plan: { source: "ask", mins, summary, steps, created_at: new Date().toISOString() },
    });
    P()?.refreshBadge?.();
    let out = `Plan saved to your Repertoire. ${summary}\n${steps.map((s, i) => `${i + 1}. ${s.title} — ${s.detail}`).join("\n")}`;
    // With a model connected, Lune AI writes the plan from the pianist's goal and their
    // remarks on these bars, and that plan is saved in Repertoire with a one-line summary.
    if (LuneAIProvider.connected()) {
      try {
        const note = await LuneAIProvider.generatePracticePlan(picked[0], picked, mins);
        if (note) {
          out = `Plan saved to your Repertoire, written by ${LuneAIProvider.label()} from your goal and your remarks.\n${note}`;
          const first = String(note).split("\n").map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim()).find(Boolean) || summary;
          store().updateTask(task.id, {
            plan: { ...task.plan, ai: String(note).slice(0, 2000), aiBy: LuneAIProvider.label(), summary: `${summary} ${first}`.slice(0, 300) },
          });
        }
      } catch {
        out += "\n\nLune AI didn’t answer, so this plan is Lune’s built-in one.";
      }
    }
    return out;
  }

  async function rate(bars, grade) {
    const key = keyFor();
    await P()?.addCurrentToRepertoire?.({ quiet: true }).catch(() => {});
    for (const b of bars) await store().reviewBar(key, b, grade);
    P()?.refreshBadge?.();
    const word = { again: "to do again soon", hard: "as hard", okay: "as okay", good: "as good", strong: "as strong" }[grade];
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
        : /\b(strong|easy|effortless|secure|no problem)\b/.test(t)
          ? "strong"
          : /\b(okay|ok|so-so|mostly|alright)\b/.test(t)
            ? "okay"
            : /\b(good|fine|better|clean|went well|solid)\b/.test(t)
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
          question: true,
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
        return { question: true, a: bits.length ? bits.join("\n") : "This score doesn't say." };
      }
      return {
        question: true,
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
    return { bar, question: true, a: lines.filter(Boolean).join("\n") || "I don't have more on this bar." };
  }

  /*
   * The model-only actions. Each has a fixed place: these chips in Ask Lune
   * and the Lune AI row in the bar panel (practice.js). They are shown only
   * while a model is connected; the built-in rules have their own chips.
   */
  const MODEL_ACTIONS = {
    explainBar: { label: "Explain this bar", bar: true, fallback: "How do I practise this bar?" },
    whyHard: { label: "Why is this hard?", bar: true, fallback: "Why is this bar hard?" },
    suggestPractice: { label: "Suggest practice", bar: true, fallback: "How do I practise this bar?" },
    explainFingering: { label: "Explain the fingering", bar: true, fallback: "What is the fingering?" },
    summarizePractice: { label: "Summarise my practice", bar: false, fallback: null },
  };

  /** Run one model action on a bar (or the piece) and show it in the panel. */
  async function runTask(task, bar = null) {
    const act = MODEL_ACTIONS[task];
    if (!act) return;
    open({ bar });
    line("you", act.label);
    const model = active();
    let a = null;
    let failure = null;
    if (model) {
      const shown = line("lune", model === providers.device && D().status() !== "ready" ? "Loading Lune AI…" : "Thinking…");
      shown.setAttribute("aria-hidden", "true");
      let streamed = "";
      try {
        a = await model.answer(TASKS[task](), await buildContext(act.bar ? bar || selectedBarsSorted()[0] || null : null), {
          onToken: (t) => {
            streamed += t;
            shown.textContent = streamed;
          },
        });
      } catch (err) {
        a = null;
        failure = err;
      }
      shown.remove();
    }
    let note = "";
    if (!a) {
      note = fallbackNote(failure);
      a = act.fallback ? (await reply(act.fallback)).a : "Lune’s built-in answers can’t summarise practice. This week shows the days, bars and ratings instead.";
    }
    const said = line("lune", a);
    if (!note) said.dataset.via = "model";
    else line("lune", note).classList.add("ask-note");
    remember({ bar: act.bar ? bar || selectedBarsSorted()[0] || null : null, q: act.label, a, note: note || undefined, via: note ? undefined : "model", t: Date.now() });
  }

  /* ---------- "Now superpowered with Lune AI" (landing page and signed-in home) ---------- */

  /**
   * Shown once Lune AI's server is set (LUNE_CONFIG.aiServer). It says, on the
   * same card, where answers come from and that an account is all it needs.
   */
  function paintNews() {
    const boxes = document.querySelectorAll("[data-ai-news]");
    const on = !!aiServer();
    document.querySelectorAll("[data-ai-credit], [data-ai-news-badge]").forEach((el) => (el.hidden = !on));
    const st = store()?.status?.() || {};
    for (const box of boxes) {
      box.hidden = !on;
      if (!on) continue;
      const fine = box.querySelector("[data-ai-news-fine]");
      if (fine) {
        fine.textContent = `Free with a Lune account, with nothing to download. Answers come from ${aiName()}, an open-weight model, on Lune’s server. Lune sends it the score facts and your question and keeps nothing. Built with Llama.`;
      }
      const btn = box.querySelector("[data-ai-news-open]");
      if (btn) btn.textContent = st.mode === "cloud" ? "Try it on Clair de lune" : st.signedIn ? "Confirm your account" : "Create a free account";
    }
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest?.("[data-ai-news-badge]")) {
      const card = document.querySelector("#home-guest [data-ai-news]") || document.querySelector("[data-ai-news]");
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      card?.querySelector("[data-ai-news-open]")?.focus({ preventScroll: true });
      return;
    }
    if (!e.target.closest?.("[data-ai-news-open]")) return;
    if (store()?.status?.().mode === "cloud") {
      // the piece opens on its score; Ask Lune is the button beside the score
      location.hash = "#/debussy-clair-de-lune/score";
    } else window.LuneOnboard?.openCreateAccount?.();
  });
  const paintNewsSoon = () => setTimeout(paintNews, 0);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paintNewsSoon, { once: true });
  else paintNewsSoon();
  setTimeout(() => store()?.onChange?.(paintNews), 0);

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
      <div class="ask-ai-offer" id="ask-ai-offer" hidden></div>
      <p class="ask-fine" id="ask-fine"></p>`;
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
    p.querySelector("#ask-ai-offer").addEventListener("click", (e) => {
      if (e.target.closest("[data-ai-on]")) turnOnDeviceAI(p.querySelector("#ask-ai-offer"));
      if (e.target.closest("[data-ai-account]")) {
        close();
        window.LuneOnboard?.openCreateAccount?.();
      }
    });
    p.querySelector("#ask-chips").addEventListener("click", (e) => {
      const t = e.target.closest("button[data-task]");
      if (t) return runTask(t.dataset.task, selectedBarsSorted()[0] || null);
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
    const fine = $("ask-fine");
    if (fine) {
      fine.textContent = providers.endpoint.available()
        ? `Local model connected (${aiSettings().model}). Questions go to it with this bar’s score facts and your remarks.`
        : providers.account.available()
          ? `Lune AI is on: ${aiName()}, an open-weight model on Lune’s server. Questions go there with this bar’s score facts and your remarks. Lune does not keep them.`
          : providers.device.available()
          ? `Lune AI is on. ${D().MODEL.name} runs in this browser and answers from this bar’s score facts and your remarks. Nothing you ask leaves this device.`
          : "These are Lune’s built-in answers, worked out from the score and your remarks. They are not from a language model. Nothing is sent anywhere.";
    }
    paintDeviceOffer();
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
    const modelChips = active()
      ? Object.entries(MODEL_ACTIONS)
          .filter(([, a]) => a.bar === !!sel.length)
          .map(([task, a]) => `<button type="button" class="ask-chip-ai" data-task="${task}">${esc(a.label)}</button>`)
          .join("")
      : "";
    $("ask-chips").innerHTML =
      modelChips +
      chips.map(([q, label]) => `<button type="button" data-q="${esc(q)}">${esc(label)}</button>`).join("") +
      // the coach's full step-by-step notes for the selected bars, written into the bar panel
      (sel.length ? `<button type="button" id="btn-plan">Step-by-step notes</button>` : "");
  }

  /* ---------- turning Lune AI on (ask first, show the size, then download) ---------- */

  /** Offer Lune AI in the panel when no model is connected. Nothing downloads until the button is pressed. */
  async function paintDeviceOffer() {
    const box = $("ask-ai-offer");
    if (!box || box.dataset.busy) return;
    if (active()) {
      box.hidden = true;
      return;
    }
    // Lune AI comes with an account: guests are invited to make one, no download
    if (aiServer()) {
      const st = store()?.status?.() || {};
      box.innerHTML = st.signedIn
        ? `<p><strong>Lune AI</strong> needs your account to be confirmed. Sign in with the code Lune emails you, and it turns on.</p>
           <button type="button" class="quiet" data-ai-account="signin">Sign in</button>`
        : `<p><strong>Lune AI</strong> answers with a language model when you have a Lune account. The account is free, and nothing is downloaded.</p>
           <button type="button" class="quiet" data-ai-account="create">Create a free account</button>`;
      box.hidden = false;
      return;
    }
    if (!D()) {
      box.hidden = true;
      return;
    }
    const plan = await D().plan();
    if (!plan.supported) {
      box.hidden = true;
      return;
    }
    box.innerHTML = deviceOfferHtml(plan);
    box.hidden = false;
  }

  function deviceOfferHtml(plan) {
    const size = esc(D().sizeText(plan.bytes));
    const slow =
      plan.device === "wasm" ? " This browser has no WebGPU, so it runs on the processor and each answer takes noticeably longer." : "";
    return `<p><strong>Lune AI</strong> answers with a language model that runs in this browser. It downloads ${size} once.</p>
      <details class="ask-ai-more"><summary>What this means</summary>
        <p>The model is ${esc(plan.name)} (${esc(plan.licence)} licence), fetched from Hugging Face and kept in this browser.
        After that it works offline and nothing you ask leaves this device. It answers from Lune’s reading of the score and your remarks.${slow}
        It is a general model, not one trained for Lune, and it can be wrong.</p></details>
      <button type="button" class="quiet" data-ai-on>Download ${size} and turn on</button>`;
  }

  /** Download the model with a progress bar; used by Ask Lune and Settings. */
  async function turnOnDeviceAI(box, { onDone } = {}) {
    if (!D()) return;
    box.dataset.busy = "1";
    box.innerHTML = `<p class="ask-ai-progress-label" role="status">Downloading Lune AI…</p>
      <progress max="1" value="0" aria-label="Lune AI download"></progress>`;
    const bar = box.querySelector("progress");
    const label = box.querySelector(".ask-ai-progress-label");
    let lastPct = -1;
    const stop = D().on((ev) => {
      if (ev.type !== "progress" || !ev.total) return;
      bar.value = ev.loaded / ev.total;
      const pct = Math.floor((100 * ev.loaded) / ev.total);
      // update the spoken status in tens so a screen reader is not flooded
      if (Math.floor(pct / 10) !== Math.floor(lastPct / 10)) label.textContent = `Downloading Lune AI: ${pct}% of ${D().sizeText(ev.total)}`;
      lastPct = pct;
    });
    try {
      await D().load();
      label.textContent = "Lune AI is on. Ask anything about the piece or a bar.";
      bar.remove();
      paintContext();
      onDone?.(true);
    } catch (err) {
      label.textContent = `Lune AI could not start here (${err.message || "unknown error"}). Ask Lune keeps using its built-in answers.`;
      bar.remove();
      onDone?.(false);
    } finally {
      stop();
      delete box.dataset.busy;
    }
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
      const a = line("lune", h.a);
      if (h.via === "model") a.dataset.via = "model";
      if (h.note) line("lune", h.note).classList.add("ask-note");
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
    // A question may go to the connected model; the built-in answer is the fallback.
    const model = out.question ? active() : null;
    let shown = null;
    if (model) {
      shown = line("lune", model === providers.device && D().status() !== "ready" ? "Loading Lune AI…" : "Thinking…");
      // the words appear as they are written; screen readers get the finished answer once
      shown.setAttribute("aria-hidden", "true");
      let streamed = "";
      try {
        out.a = await model.answer(text, await buildContext(out.bar || selectedBarsSorted()[0] || null), {
          onToken: (t) => {
            streamed += t;
            shown.textContent = streamed;
          },
        });
        out.via = "model";
      } catch (err) {
        out.note = fallbackNote(err);
      }
      shown.remove();
    }
    const said = line("lune", out.a);
    if (out.via === "model") said.dataset.via = "model";
    if (out.note) line("lune", out.note).classList.add("ask-note");
    remember({ bar: out.bar || null, q: text, a: out.a, note: out.note, via: out.via, t: Date.now() });
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
      // The words stay in the box to be corrected before they are sent.
      input.value = said || "";
      if (said) {
        input.focus();
        toast("Check the words, then press Send");
      } else toast("Didn’t catch that — try again, or type.");
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

  let opener = null;
  function open({ bar = null } = {}) {
    const from = document.activeElement;
    if (from && from !== document.body && !$("ask-lune")?.contains(from)) opener = from;
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
    const had = p && !p.hidden && p.contains(document.activeElement);
    if (p) p.hidden = true;
    document.body.classList.remove("ask-open");
    P()?.stopHearing?.();
    // focus goes back to what opened the panel
    if (had && opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  }

  /** Keep the panel pointed at the bar that is selected while it is open. */
  function onSelection() {
    const p = $("ask-lune");
    if (!p || p.hidden) return;
    paintContext();
    paintHistory();
  }


  /* ---------- Chat with Lune: practice in general, not one bar ---------- */

  const CHAT_KEY = "lune.chat.v1";
  const CHAT_STARTERS = [
    "What should I practise today?",
    "Summarise my week",
    "Make me a 20 minute plan",
    "How do I stop rushing fast notes?",
    "How do I practise a trill?",
  ];
  function chatLog() {
    try {
      return JSON.parse(localStorage.getItem(CHAT_KEY) || "[]").slice(-40);
    } catch {
      return [];
    }
  }
  function saveChat(log) {
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(log.slice(-40)));
    } catch {
      /* private mode: the chat lasts for this visit */
    }
  }

  /** What Chat with Lune knows: the pianist's Repertoire, plans, week and goal, and the open piece. */
  async function buildChatContext(log) {
    const prefs = store().prefs?.() || {};
    const pieces = await store().listPieces?.().catch(() => []) || [];
    const tasks = (store().listTasks?.() || []).slice(0, 12);
    const week = store().weekSnapshot?.() || null;
    const cards = await store().listCards?.().catch(() => []) || [];
    const hardNow = cards
      .filter((c) => /again|hard/i.test(String(c.last_grade || c.grade || "")))
      .slice(0, 12)
      .map((c) => ({ piece: c.piece_key, bar: c.bar, lastRating: c.last_grade || c.grade, nextReview: c.due_at }));
    const ctx = {
      repertoire: pieces.slice(0, 30).map((x) => ({ title: x.title, composer: x.composer || null, status: x.status || null, level: x.level || x.grade || null })),
      plans: tasks.map((t) => ({ piece: t.piece_title || t.piece_key, bars: t.bars, summary: t.plan?.summary || t.notes || null, done: !!t.done })),
      thisWeek: week ? { daysPractised: week.days, goalDays: week.goalDays, minutes: week.mins, barsRatedGoodOrStrong: week.good, barsRatedHardOrAgain: week.hard, barsWorked: week.barsWorked } : null,
      barsStillHard: hardNow,
      goal: { daysPerWeek: prefs.practiceDays || null, minutesPerSession: prefs.practiceMins || null, workingToward: prefs.dreamPiece?.title || null, level: prefs.grade ?? null },
      conversation: log.slice(-6).map((m) => ({ from: m.who === "you" ? "pianist" : "lune", text: String(m.text).slice(0, 600) })),
    };
    if (state.piece) {
      const p = state.piece;
      ctx.openPiece = { title: p.overview?.title || p.title || null, composer: p.overview?.composer || p.composer || null, hardestBars: hardest(5) };
    }
    return ctx;
  }

  function chatLine(who, text, { via } = {}) {
    const log = $("chat-log");
    const row = document.createElement("div");
    row.className = `chat-row chat-from-${who}`;
    const bubble = document.createElement("p");
    bubble.className = "chat-bubble";
    bubble.textContent = text;
    row.appendChild(bubble);
    if (who === "lune" && via === "model") {
      const say = document.createElement("button");
      say.type = "button";
      say.className = "chat-say";
      say.setAttribute("aria-label", "Read this answer aloud");
      say.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 10v4h3l4 3.5v-11L8 10H5zM15.5 9a4 4 0 0 1 0 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      say.addEventListener("click", () => P()?.speak?.(text));
      row.appendChild(say);
    }
    log.appendChild(row);
    requestAnimationFrame(() => row.classList.add("in"));
    log.scrollTop = log.scrollHeight;
    return bubble;
  }

  function ensureChat() {
    let d = $("lune-chat");
    if (d) return d;
    d = document.createElement("dialog");
    d.id = "lune-chat";
    d.className = "lune-chat";
    d.setAttribute("aria-labelledby", "chat-h");
    d.innerHTML = `
      <header class="chat-head">
        <div>
          <h2 id="chat-h">Chat with Lune</h2>
          <p class="chat-sub" id="chat-sub"></p>
        </div>
        <button type="button" class="quiet chat-clear" id="chat-clear">Clear</button>
        <button type="button" class="icon-btn" id="chat-close" aria-label="Close the chat">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
      </header>
      <div class="chat-log" id="chat-log" role="log" aria-live="polite"></div>
      <div class="chat-starters" id="chat-starters"></div>
      <div class="chat-locked" id="chat-locked" hidden>
        <p>Chat with Lune uses Lune AI, which comes free with a Lune account. Sign in and ask about your practice, your week, or any piano question.</p>
        <button type="button" class="primary" data-chat-signin>Sign in or create an account</button>
        <p class="chat-fine">Without an account, Ask Lune on any score still answers from the music with Lune’s built-in rules.</p>
      </div>
      <form class="chat-form" id="chat-form" autocomplete="off">
        <button type="button" class="icon-btn chat-mic" id="chat-mic" aria-pressed="false" aria-label="Speak your question">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
        <label class="visually-hidden" for="chat-input">Your question</label>
        <input id="chat-input" type="text" maxlength="600" placeholder="Ask about your practice">
        <button type="submit" class="primary chat-send">Send</button>
      </form>
      <p class="chat-fine" id="chat-fine"></p>`;
    document.body.appendChild(d);
    d.querySelector("#chat-close").addEventListener("click", () => d.close());
    d.querySelector("#chat-clear").addEventListener("click", () => {
      saveChat([]);
      paintChat();
    });
    d.addEventListener("click", (e) => {
      if (e.target === d) d.close();
      const st = e.target.closest?.("[data-starter]");
      if (st) chatAsk(st.dataset.starter);
      if (e.target.closest?.("[data-chat-signin]")) {
        d.close();
        window.LuneOnboard?.openCreateAccount?.();
      }
    });
    d.querySelector("#chat-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("chat-input");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      chatAsk(text);
    });
    d.querySelector("#chat-mic").addEventListener("click", async () => {
      const btn = $("chat-mic");
      const input = $("chat-input");
      if (btn.classList.contains("on")) return P()?.stopHearing?.();
      if (!P()?.canListenForWords?.()) {
        toast("Voice isn’t available in this browser. Type instead.");
        return input.focus();
      }
      btn.classList.add("on");
      btn.setAttribute("aria-pressed", "true");
      input.placeholder = "Listening…";
      try {
        const said = await P().hearPhrase({ onPartial: (t) => (input.value = t) });
        input.value = said || "";
        input.focus();
      } catch (err) {
        toast(err.message || "Type instead.");
      } finally {
        btn.classList.remove("on");
        btn.setAttribute("aria-pressed", "false");
        input.placeholder = "Ask about your practice";
      }
    });
    return d;
  }

  function paintChat() {
    const model = active();
    const log = chatLog();
    $("chat-log").innerHTML = "";
    for (const m of log) chatLine(m.who, m.text, { via: m.via });
    $("chat-locked").hidden = !!model;
    $("chat-form").hidden = !model;
    $("chat-clear").hidden = !log.length;
    $("chat-starters").innerHTML = model && !log.length ? CHAT_STARTERS.map((q) => `<button type="button" data-starter="${esc(q)}">${esc(q)}</button>`).join("") : "";
    $("chat-sub").textContent = model ? "Your Repertoire, plans and week, with Lune AI" : "Needs a free Lune account";
    $("chat-fine").textContent = model
      ? `Answers come from ${model.label()}. Lune sends it your question, this chat’s last few turns, and a summary of your Repertoire, plans and week, and keeps nothing on the server. Answers can be wrong.`
      : "";
  }

  async function chatAsk(text) {
    const model = active();
    if (!model) return paintChat();
    const log = chatLog();
    log.push({ who: "you", text, t: Date.now() });
    saveChat(log);
    $("chat-starters").innerHTML = "";
    $("chat-clear").hidden = false;
    chatLine("you", text);
    const wait = chatLine("lune", "Thinking…");
    wait.classList.add("chat-wait");
    let answer = "";
    let via = "model";
    try {
      answer = await model.answer(text, await buildChatContext(log.slice(0, -1)), { onToken: (t) => (wait.textContent = (answer += t)) });
    } catch (err) {
      via = "note";
      answer = err?.userMessage || "Lune AI didn’t answer just now. Try again in a minute.";
    }
    wait.parentElement.remove();
    chatLine("lune", answer, { via });
    log.push({ who: "lune", text: answer, via, t: Date.now() });
    saveChat(log);
  }

  function openChat() {
    const d = ensureChat();
    paintChat();
    if (!d.open) d.showModal();
    setTimeout(() => (active() ? $("chat-input") : d.querySelector("[data-chat-signin]"))?.focus(), 40);
  }

  /** The Lune AI section on Home: what it does, plainly, and the way in. */
  function paintAiHome() {
    const on = !!aiServer() || !!active();
    const ready = !!active();
    for (const box of document.querySelectorAll("[data-ai-home]")) {
      box.hidden = !on;
      if (!on) continue;
      box.innerHTML = `
        <p class="about-kicker">Lune AI</p>
        <h2>What Lune AI does for you</h2>
        <ul class="ai-home-list">
          <li><strong>Explains any bar.</strong> <span>Tap a bar, then Ask Lune: “What’s hard in bar 12?”</span></li>
          <li><strong>Plans your practice.</strong> <span>“I have 20 minutes.” You get steps tied to bar numbers, saved to Repertoire.</span></li>
          <li><strong>Helps when a bar falls apart.</strong> <span>Rate a bar Hard and get one thing to try.</span></li>
          <li><strong>Writes down what you say.</strong> <span>Speak a remark mid-practice and it is flagged on the bar.</span></li>
          <li><strong>Chats about practice.</strong> <span>Your week, your goal, or any piano question.</span></li>
        </ul>
        <div class="ai-home-actions">
          ${ready ? `<button type="button" class="primary" data-open-chat>Chat with Lune</button>` : `<button type="button" class="primary" data-lp-signin-only>Sign in to use Lune AI</button>`}
          <button type="button" class="link-btn" data-show-ai>See examples</button>
        </div>
        <p class="ai-home-fine">${ready ? `Answers come from ${esc(aiName())}, an open-weight model, using what Lune reads in your score. They can be wrong.` : "Free with a Lune account. Ask Lune’s built-in answers work without one."}</p>`;
    }
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest?.("[data-open-chat]")) {
      e.preventDefault();
      openChat();
    }
  });
  const paintAiHomeSoon = () => setTimeout(paintAiHome, 0);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paintAiHomeSoon, { once: true });
  else paintAiHomeSoon();
  setTimeout(() => store()?.onChange?.(paintAiHome), 0);

  /**
   * LuneAIProvider: the one interface the rest of Lune uses. `connected()` is
   * true only when a local model address is set; every method returns null
   * when it is not, so callers fall back to the built-in rules and never
   * present a rule-based answer as a model's.
   */
  const LuneAIProvider = {
    connected: () => !!active(),
    model: () => (providers.endpoint.available() ? aiSettings().model : D()?.MODEL.name || ""),
    label: () => active()?.label() || "",
    async run(task, bar, ...args) {
      const m = active();
      if (!m || !TASKS[task]) return null;
      return m.answer(TASKS[task](...args), await buildContext(bar));
    },
  };
  for (const task of Object.keys(TASKS)) LuneAIProvider[task] = (bar, ...args) => LuneAIProvider.run(task, bar, ...args);
  window.LuneAIProvider = LuneAIProvider;

  return { openChat, paintAiHome, buildChatContext, open, close, ask, historyFor, onSelection, buildContext, aiSettings, SYSTEM_PROMPT, TASKS, MODEL_ACTIONS, runTask, paintNews, voice, modelConnected: () => !!active(), deviceOfferHtml, turnOnDeviceAI, testModel: () => providers.endpoint.answer("Reply with the single word: ready", { test: true }) };
})();
