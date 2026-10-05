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
- Answer about the bar in CONTEXT.bar. Bring in CONTEXT.neighbouringBars only when the question asks about them or a phrase crosses into them.
- Piano finger numbers: 1 thumb, 2 index, 3 middle, 4 ring, 5 little finger. Use the numbers from CONTEXT; name a finger only with this mapping.
- When giving fingering, go note by note in the order of CONTEXT and give each note its own finger number from CONTEXT. Never group notes under one finger, and never give fingering for a hand that has no notes.
- The pianist's remarks are their own words; treat them as information from the user, not as score facts.
- You have not heard the pianist play. Never claim to have listened to a recording or a performance.
- Sound like a warm, expert piano teacher: specific, encouraging and practical, never vague. When suggesting practice, use proven methods (slow practice with a metronome, hands separately, one or two bars at a time, the leap practised silently first, rhythm variations, blocking chord shapes, starting from the end of a passage) and say which bar each step is for.
- Open with the answer itself in one clear sentence. Never open with filler such as "Great question", "Sure" or "Certainly", and never repeat the question.
- Answer a simple question in one or two sentences. For analysis, cover what each hand does, what makes it hard, and exactly how to practise it: one short sentence of what the score shows, then at most four numbered steps, each on its own line, each one concrete action.
- Keep answers under 120 words unless the pianist asks for more. Every sentence must be useful at the piano.
- If the question is not about music or the piano, say kindly in one sentence that you help with piano practice, and offer one related thing you can do.
- Speak naturally to the pianist. Never mention CONTEXT, JSON, data or "the information provided"; if the score data lacks something, simply answer from general piano knowledge and say it is general advice.
- If CONTEXT.replyStyle is "spoken", the answer will be read aloud: reply in two or three short, warm, conversational sentences, with no lists, numbers as words where natural, and no symbols.
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

  /** Lune computes fingering; it does not read the edition's. Every model is told so in its context. */
  const FINGERING_NOTE =
    "Finger numbers here are Lune's suggested fingering, worked out from the notes by Lune. They are not printed in the pianist's edition. Call them suggested fingering.";

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
      fingeringNote: FINGERING_NOTE,
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
  /** In voice chat the answer is heard, not read: ask for a short, spoken reply. */
  function spokenCtx(ctx) {
    return talking ? { ...(ctx || {}), replyStyle: "spoken" } : ctx;
  }
  const providers = {
    /** Lune AI for account holders: Lune's own server, which checks the account first. */
    account: {
      available: () => !!aiServer() && cloudAccount(),
      label: () => "Lune AI",
      async answer(question, ctx) {
        ctx = spokenCtx(ctx);
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
        ctx = spokenCtx(ctx);
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
      lines.push(fingerLine(d.rh, "Suggested fingering, right hand"), fingerLine(d.lh, "Suggested fingering, left hand"));
      if (lines.filter(Boolean).length) lines.push("Lune works this fingering out from the notes. Your edition may print different fingers.");
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
      const shown = thinkingRow();
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
      shown.closest(".ask-row")?.remove();
    }
    let note = "";
    if (!a) {
      note = fallbackNote(failure);
      a = act.fallback ? (await reply(act.fallback)).a : "Lune’s built-in answers can’t summarise practice. This week shows the days, bars and ratings instead.";
    }
    if (state.piece) window.LunePlans?.noteActivity?.("question", { key: keyFor(), title: state.piece?.overview?.title || state.piece?.title || "" });
    remember({ bar: act.bar ? bar || selectedBarsSorted()[0] || null : null, q: act.label, a, note: note || undefined, via: note ? undefined : "model", t: Date.now() });
    const said = line("lune", note ? a : "", { src: note ? "rules" : "model" });
    if (!note) {
      await revealAnswer(said, a);
      said.dataset.via = "model";
    }
    addActions(said);
    if (note) sayIfVoice(a);
    if (note) line("lune", note).classList.add("ask-note");
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
        fine.textContent = `Free with a Lune account, with nothing to download. Answers come from ${aiName()}, an open-weight model, on Lune’s server. Lune’s server passes it the score facts and your question to write the answer and stores neither. Built with Llama.`;
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

  const ICON = {
    mute: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 10v4h3l4 3.5v-11L8 10H5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M16 10l4 4M20 10l-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    menu: '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    add: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    mic: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    talk: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    speak: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 10v4h3l4 3.5v-11L8 10H5zM15.5 9a4 4 0 0 1 0 6M17.8 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 15V6a1 1 0 0 1 1-1h9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 11v5M12 8v.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };

  /** A composer like Claude's or ChatGPT's: a growing text box, then dictate, talk and send. */
  function composerHtml(prefix, placeholder) {
    // one pill, as in ChatGPT: the words, the microphone, and a round button that is
    // voice chat while the box is empty and Send once there is something to send
    return `<div class="lc-composer" id="${prefix}-composer">
        <label class="visually-hidden" for="${prefix}-input">Message Lune</label>
        <textarea id="${prefix}-input" rows="1" maxlength="600" placeholder="${esc(placeholder)}"></textarea>
        <button type="button" class="lc-tool lc-mic" id="${prefix}-mic" aria-pressed="false" aria-label="Dictate">${ICON.mic}</button>
        <button type="button" class="lc-round lc-talk" id="${prefix}-talk" aria-label="Voice chat with Lune">${ICON.talk}</button>
        <button type="submit" class="lc-round lc-send ${prefix}-send" aria-label="Send" hidden>${ICON.send}</button>
      </div>
      <div class="lc-listen" id="${prefix}-listen" hidden>
        <button type="button" class="lc-tool" data-listen="cancel" aria-label="Cancel dictation">${ICON.close}</button>
        <canvas class="lc-wave" width="600" height="60" aria-hidden="true"></canvas>
        <span class="lc-timer" aria-live="off">0:00</span>
        <button type="button" class="lc-send lc-done" data-listen="done" aria-label="Done">${ICON.check}</button>
      </div>`;
  }

  /**
   * An answer laid out as ChatGPT lays one out: paragraphs with air between
   * them, numbered steps as a real list, **bold** kept as bold. Text only, so
   * nothing the model writes can become markup.
   */
  function richText(el, text) {
    if (!el) return;
    const esc2 = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const inline = (t) => esc2(t).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|\s)\*([^*\n]+)\*(?=\s|[.,;:!?]|$)/g, "$1<em>$2</em>");
    const lines = String(text || "").replace(/\r/g, "").split("\n");
    let html = "";
    let list = null;
    let para = [];
    const flushPara = () => {
      if (para.length) html += `<p>${inline(para.join(" "))}</p>`;
      para = [];
    };
    const flushList = () => {
      if (list) html += `<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`;
      list = null;
    };
    for (const raw of lines) {
      const line = raw.trim().replace(/^#{1,6}\s+/, "");
      const num = line.match(/^(\d+)[.)]\s+(.*)$/);
      const dot = line.match(/^[-•*]\s+(.*)$/);
      if (!line) {
        flushPara();
        flushList();
      } else if (num || dot) {
        flushPara();
        const tag = num ? "ol" : "ul";
        if (!list || list.tag !== tag) {
          flushList();
          list = { tag, items: [] };
        }
        list.items.push(num ? num[2] : dot[1]);
      } else {
        flushList();
        para.push(line);
      }
    }
    flushPara();
    flushList();
    el.innerHTML = html;
    el.classList.add("rich");
  }

  /** Grow the text box with what is typed, send on Enter, and only enable Send when there is text. */
  function wireComposer(prefix, onSend) {
    const input = $(`${prefix}-input`);
    const send = document.querySelector(`#${prefix}-composer .lc-send`);
    const talk = $(`${prefix}-talk`);
    const fit = () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(140, input.scrollHeight)}px`;
      const has = !!input.value.trim();
      send.hidden = !has;
      send.disabled = !has;
      if (talk) talk.hidden = has;
    };
    input.addEventListener("input", fit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (input.value.trim()) onSend();
      }
    });
    return fit;
  }

  /*
   * Dictation, drawn as a live waveform: the bars move with your voice, the
   * timer counts, and Done keeps the words in the box to check before sending.
   */
  async function dictate(prefix) {
    const input = $(`${prefix}-input`);
    const composer = $(`${prefix}-composer`);
    const ui = $(`${prefix}-listen`);
    if (!P()?.canListenForWords?.()) {
      toast(cloudAccount() ? "Voice isn’t available in this browser. Type instead." : "This browser has no voice input of its own. Sign in (free) and Lune AI listens for you, or type.");
      input.focus();
      return;
    }
    const canvas = ui.querySelector(".lc-wave");
    const timer = ui.querySelector(".lc-timer");
    const ctx = canvas.getContext("2d");
    const bars = new Array(40).fill(0.03);
    let lastPush = 0;
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(60, canvas.clientWidth * dpr);
      canvas.height = Math.max(20, canvas.clientHeight * dpr);
    };
    let level = 0;
    let fake = true;
    let cancelled = false;
    const started = performance.now();
    let raf = 0;
    const draw = () => {
      const now = performance.now();
      // without a level from the microphone (the browser's own recognition), the wave breathes
      const v = fake ? 0.1 + 0.08 * Math.abs(Math.sin(now / 260)) : level;
      // a new bar every 60 ms scrolls in from the right, like a voice memo
      if (now - lastPush > 60) {
        lastPush = now;
        bars.push(Math.max(0.03, Math.min(1, v * 1.4)));
        bars.shift();
      }
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const step = w / bars.length;
      const bw = Math.max(2, step * 0.42);
      ctx.fillStyle = getComputedStyle(canvas).color || "#fff";
      bars.forEach((b, i) => {
        const bh = Math.max(bw, b * h * 0.92);
        ctx.globalAlpha = 0.3 + 0.7 * (i / bars.length);
        const x = i * step + (step - bw) / 2;
        const y = (h - bh) / 2;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, bw / 2);
        else ctx.rect(x, y, bw, bh);
        ctx.fill();
      });
      const sec = Math.floor((now - started) / 1000);
      timer.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
      raf = requestAnimationFrame(draw);
    };
    composer.hidden = true;
    ui.hidden = false;
    fit();
    raf = requestAnimationFrame(draw);
    const finish = (e) => {
      const act = e.target.closest?.("[data-listen]")?.dataset.listen;
      if (!act) return;
      if (act === "cancel") cancelled = true;
      P()?.stopHearing?.();
    };
    ui.addEventListener("click", finish);
    let heard = "";
    try {
      const said = await P().hearPhrase({
        onPartial: (t) => {
          if (!/^Listening|^Writing/.test(t)) input.value = t;
        },
        onLevel: (v) => {
          fake = false;
          level = v;
        },
      });
      if (!cancelled) input.value = said || input.value;
      if (!cancelled && !said) toast("Lune didn’t catch that. Try again, or type.");
      if (!cancelled && said) heard = said;
    } catch (err) {
      toast(err.message || "Type instead.");
    } finally {
      cancelAnimationFrame(raf);
      ui.removeEventListener("click", finish);
      ui.hidden = true;
      composer.hidden = false;
      input.dispatchEvent(new Event("input"));
      input.focus();
    }
    // once you stop speaking, it is sent, as in ChatGPT's voice input
    if (heard) $(`${prefix}-form`)?.requestSubmit();
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest?.(".lc-voice-toggle")) toggleVoiceReplies();
  });
  /* Voice replies: when on, Lune reads every answer aloud (a choice kept in this browser). */
  const voiceReplies = () => {
    try {
      return localStorage.getItem("lune.voiceReplies") === "1";
    } catch {
      return false;
    }
  };
  function voiceToggleHtml(id) {
    const on = voiceReplies();
    return `<button type="button" class="lc-tool lc-voice-toggle" id="${id}" aria-pressed="${on}" aria-label="Voice replies" title="Voice replies: Lune reads its answers aloud">${on ? ICON.speak : ICON.mute}</button>`;
  }
  function toggleVoiceReplies() {
    const on = !voiceReplies();
    try {
      localStorage.setItem("lune.voiceReplies", on ? "1" : "0");
    } catch {
      /* private mode */
    }
    document.querySelectorAll(".lc-voice-toggle").forEach((b) => {
      b.setAttribute("aria-pressed", String(on));
      b.innerHTML = on ? ICON.speak : ICON.mute;
    });
    toast(on ? "Voice replies on: Lune reads its answers aloud" : "Voice replies off");
    if (!on) P()?.stopSpeaking?.();
  }
  /** Show an answer: typed in, or, with voice replies on, revealed word by word as Lune says it. */
  async function revealAnswer(el, text) {
    if (voiceReplies() && !talking && P()?.speakAndWait) {
      const words = String(text).replace(/\*\*/g, "").split(/(\s+)/);
      el.textContent = "";
      el.classList.add("live");
      try {
        await P().speakAndWait(text, { onProgress: (f) => (el.textContent = words.slice(0, Math.ceil(f * words.length)).join("")) });
      } catch {
        /* the words are shown below either way */
      }
      el.classList.remove("live");
    } else if (window.LuneFX) await window.LuneFX.typeText(el, text);
    richText(el, text);
  }
  function sayIfVoice(text) {
    // voice chat speaks for itself; this is for typed questions
    if (text && voiceReplies() && !talking) P()?.speak?.(text);
  }

  /*
   * Talk with Lune: a voice conversation. Lune listens, answers out loud, then
   * listens again, with the orb showing which it is doing. The words also land
   * in the conversation, so nothing said is lost.
   */
  let talking = null;
  async function openTalk({ answer, title = "Lune AI" }) {
    if (!P()?.canListenForWords?.()) {
      toast(cloudAccount() ? "Voice isn’t available in this browser." : "This browser has no voice input of its own. Sign in (free) to talk with Lune AI.");
      return;
    }
    let d = $("lune-talk");
    if (!d) {
      d = document.createElement("dialog");
      d.id = "lune-talk";
      d.className = "lune-talk";
      d.setAttribute("aria-label", "Talk with Lune");
      // as in ChatGPT's voice mode: the orb, a line of caption, and two round buttons
      d.innerHTML = `<div class="lt-top"><span class="fx-shiny lt-title"></span></div>
        <div class="lt-orb" id="lt-orb"></div>
        <p class="lt-state" id="lt-state" aria-live="polite">Listening</p>
        <p class="lt-caption" id="lt-caption"></p>
        <div class="lt-actions">
          <button type="button" class="lt-round" data-talk="tap" aria-pressed="false" aria-label="Pause listening">${ICON.mic}</button>
          <button type="button" class="lt-round lt-end" data-talk="end" aria-label="End voice chat">${ICON.close}</button>
        </div>`;
      document.body.appendChild(d);
    }
    d.querySelector(".lt-title").textContent = title;
    if (!d.open) d.showModal();
    const orbHost = d.querySelector("#lt-orb");
    orbHost.innerHTML = "";
    const orb = window.LuneFX.orb(orbHost);
    const stateEl = d.querySelector("#lt-state");
    const cap = d.querySelector("#lt-caption");
    const tapBtn = d.querySelector('[data-talk="tap"]');
    const run = { live: true };
    talking = run;
    const setState = (m, label) => {
      orb.setMode(m);
      stateEl.textContent = label;
      // the mic button pauses listening, or starts it again
      const paused = m === "idle";
      tapBtn.setAttribute("aria-pressed", String(paused));
      tapBtn.setAttribute("aria-label", paused ? "Start listening" : "Pause listening");
      tapBtn.classList.toggle("off", paused);
    };
    const end = () => {
      run.live = false;
      P()?.stopHearing?.();
      P()?.stopSpeaking?.();
      orb.destroy();
      if (d.open) d.close();
      talking = null;
    };
    d.onclick = (e) => {
      const a = e.target.closest?.("[data-talk]")?.dataset.talk;
      if (a === "end") end();
      if (a === "tap") {
        if (orbHost.dataset.mode === "idle") {
          run.live = true;
          loop();
        } else {
          run.live = false;
          P()?.stopHearing?.();
          P()?.stopSpeaking?.();
          setState("idle", "Paused · tap the microphone to talk");
        }
      }
      // tapping the orb while Lune speaks lets you cut in
      if (e.target.closest?.("#lt-orb") && orbHost.dataset.mode === "speaking") P()?.stopSpeaking?.();
    };
    d.oncancel = (e) => {
      e.preventDefault();
      end();
    };
    let misses = 0;
    async function loop() {
      while (run.live) {
        setState("listening", "Listening");
        let said = "";
        try {
          said = await P().hearPhrase({ onLevel: (v) => orb.setLevel(v), onPartial: (t) => !/^Listening|^Writing/.test(t) && (cap.textContent = t) });
        } catch (err) {
          setState("idle", err.message || "Lune couldn’t hear that.");
          return;
        }
        orb.setLevel(0);
        if (!run.live) return;
        if (!said) {
          // honest about silence: nothing is sent, and Lune says so
          cap.textContent = "Lune didn’t catch that.";
          if (++misses >= 2) {
            run.live = false;
            return setState("idle", "Tap the microphone when you’re ready");
          }
          continue;
        }
        misses = 0;
        cap.textContent = said;
        setState("thinking", "Thinking");
        let text = "";
        try {
          text = await answer(said);
        } catch {
          text = "That didn’t work. Try again in a moment.";
        }
        if (!run.live) return;
        // the words appear as Lune says them, like live captions
        const words = String(text).replace(/\*\*/g, "").split(/(\s+)/);
        cap.textContent = "";
        cap.classList.add("live");
        setState("speaking", "Speaking · tap the orb to cut in");
        await P().speakAndWait(text, {
          onLevel: (v) => orb.setLevel(v),
          onProgress: (f) => {
            cap.textContent = words.slice(0, Math.ceil(f * words.length)).join("");
            cap.scrollTop = cap.scrollHeight; // the newest words stay in view, as live captions do
          },
        });
        cap.textContent = words.join("");
        cap.classList.remove("live");
        orb.setLevel(0);
      }
    }
    loop();
  }

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
        <button type="button" class="lc-tool" id="ask-close" aria-label="Close Ask Lune">${ICON.close}</button>
        <div class="ask-id">
          <p class="ask-title"><span class="fx-shiny">Lune AI</span></p>
          <p class="ask-where" id="ask-where"></p>
        </div>
        <span class="ask-head-end">${voiceToggleHtml("ask-voice")}<button type="button" class="lc-tool" id="ask-info" aria-expanded="false" aria-controls="ask-fine" aria-label="About these answers">${ICON.info}</button></span>
      </header>
      <p class="ask-fine" id="ask-fine" hidden></p>
      <div class="ask-log" id="ask-log" role="log" aria-live="polite"></div>
      <div class="ask-chips" id="ask-chips"></div>
      <div class="ask-ai-offer" id="ask-ai-offer" hidden></div>
      <form class="ask-form" id="ask-form" autocomplete="off">${composerHtml("ask", "Ask about this bar…")}</form>`;
    document.body.appendChild(p);
    p.querySelector("#ask-close").addEventListener("click", close);
    p.querySelector("#ask-info").addEventListener("click", (e) => {
      const f = $("ask-fine");
      f.hidden = !f.hidden;
      e.currentTarget.setAttribute("aria-expanded", f.hidden ? "false" : "true");
    });
    const send = () => {
      const input = $("ask-input");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      fitAsk();
      ask(text);
    };
    const fitAsk = wireComposer("ask", send);
    p.querySelector("#ask-form").addEventListener("submit", (e) => {
      e.preventDefault();
      send();
    });
    p.querySelector("#ask-mic").addEventListener("click", speakInto);
    p.querySelector("#ask-talk").addEventListener("click", () =>
      openTalk({ title: "Lune AI", answer: async (said) => (await ask(said)) || "" })
    );
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
    p.querySelector("#ask-log").addEventListener("click", (e) => {
      const b = e.target.closest("[data-msg-act]");
      if (!b) return;
      const text = b.closest(".ask-row")?.querySelector(".ask-msg")?.textContent || "";
      if (b.dataset.msgAct === "speak") P()?.speak?.(text);
      if (b.dataset.msgAct === "copy") {
        navigator.clipboard?.writeText(text).then(() => toast("Copied"), () => toast("Couldn’t copy"));
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !p.hidden && !$("lune-talk")?.open) close();
    });
    return p;
  }

  /** One message. Yours sit on the right; Lune's read like a page, with Listen and Copy under them. */
  function line(who, text, { src = "" } = {}) {
    const log = $("ask-log");
    $("ask-empty")?.remove();
    const chipsEl = $("ask-chips");
    if (chipsEl) chipsEl.hidden = true;
    const row = document.createElement("div");
    row.className = `ask-row ask-row-${who}`;
    const el = document.createElement("p");
    el.className = `ask-msg ask-from-${who}`;
    el.textContent = text;
    if (who === "lune") {
      const body = document.createElement("div");
      body.className = "ask-body";
      body.appendChild(el);
      // where it came from, said quietly under the answer, beside its actions
      if (src) {
        const s = document.createElement("p");
        s.className = `ask-src ask-src-${src === "model" ? "ai" : "rules"}`;
        s.textContent = src === "model" ? "Lune AI · can be wrong" : src === "rules" ? "Built-in answer, read from the score" : "Lune";
        body.appendChild(s);
      }
      row.appendChild(body);
    } else row.appendChild(el);
    log.appendChild(row);
    requestAnimationFrame(() => row.classList.add("in"));
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function addActions(el) {
    const bar = document.createElement("div");
    bar.className = "ask-actions";
    bar.innerHTML = `<button type="button" class="lc-mini" data-msg-act="speak" aria-label="Read this answer aloud">${ICON.speak}</button><button type="button" class="lc-mini" data-msg-act="copy" aria-label="Copy this answer">${ICON.copy}</button>`;
    const src = el.parentElement.querySelector(".ask-src");
    if (src) bar.appendChild(src);
    el.parentElement.appendChild(bar);
  }
  function thinkingRow() {
    const el = line("lune", "Thinking…");
    el.classList.add("ask-thinking");
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = '<span class="dots"><i></i><i></i><i></i></span><span class="visually-hidden">Thinking…</span>';
    return el;
  }

  function paintContext() {
    const fine = $("ask-fine");
    if (fine) {
      // the short version; the ⓘ button shows it
      fine.textContent = providers.endpoint.available()
        ? `Your own model (${aiSettings().model}), with this bar’s facts and your remarks.`
        : providers.account.available()
          ? `Lune AI is on: ${aiName().replace(/ Instruct$/, "")}. Lune’s server stores none of it; chats are saved only in this browser.`
          : providers.device.available()
          ? `Lune AI is on, in this browser. Nothing leaves this device.`
          : "Built-in answers from the score, not from a language model. Sign in for Lune AI.";
    }
    paintDeviceOffer();
    const sel = selectedBarsSorted();
    const where = $("ask-where");
    const title = state.piece?.overview?.title || state.piece?.title || "";
    const who = providers.endpoint.available() ? aiSettings().model : providers.account.available() ? aiName().replace(/ Instruct$/, "") : providers.device.available() ? "on this device" : "built-in answers";
    where.textContent = `${sel.length ? `Bar ${sel.join(", ")}` : title || "This piece"} · ${who}`;
    // suggestions only start a conversation, as in Claude or ChatGPT; with Lune AI on, its actions replace the built-in ones
    const fresh = !(sel.length ? historyFor(sel[0]) : history().filter((h) => !h.bar)).length;
    const builtIn = sel.length
      ? [
          ["How do I practise this bar?", "How to practise"],
          ["What is the fingering?", "Fingering"],
          ["Make a plan", "Add to my plan"],
        ]
      : [
          ["Which bars are hardest?", "Hardest bars"],
          ["Make a plan", "Make a plan"],
        ];
    const modelChips = active()
      ? Object.entries(MODEL_ACTIONS)
          .filter(([, a]) => a.bar === !!sel.length)
          .map(([task, a]) => `<button type="button" class="ask-chip-ai" data-task="${task}">${esc(a.label)}</button>`)
          .join("")
      : "";
    const chips = active() ? builtIn.filter(([q]) => q === "Make a plan") : builtIn;
    $("ask-chips").hidden = !fresh;
    $("ask-chips").innerHTML =
      modelChips +
      chips.map(([q, label]) => `<button type="button" data-q="${esc(q)}">${esc(label)}</button>`).join("");
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
      const empty = document.createElement("div");
      empty.className = "ask-empty";
      empty.id = "ask-empty";
      empty.innerHTML = `<div class="ask-empty-orb"></div><p class="ask-empty-h">${sel.length ? `What about bar ${sel[0]}?` : "Ask about this piece"}</p><p class="ask-empty-sub">${sel.length ? "Ask, leave a remark, or say how it went." : "Or tap a bar first."}</p>`;
      log.appendChild(empty);
      const orb = window.LuneFX?.orb(empty.querySelector(".ask-empty-orb"));
      orb?.setMode("idle");
      return;
    }
    for (const h of rows) {
      line("you", h.q);
      const a = line("lune", h.a, { src: h.via === "model" ? "model" : "" });
      if (h.via === "model") {
        a.dataset.via = "model";
        richText(a, h.a);
      }
      addActions(a);
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
      out = { a: err?.message || "That didn't work. Try again." };
    }
    // A question may go to the connected model; the built-in answer is the fallback.
    const model = out.question ? active() : null;
    if (model) {
      const shown = thinkingRow();
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
      shown.closest(".ask-row")?.remove();
    }
    // counted before it is saved, so the session that starts here includes it
    if (out.question) window.LunePlans?.noteActivity?.("question", { key: keyFor(), title: state.piece?.overview?.title || state.piece?.title || "" });
    // every answer says where it came from: the score through Lune's rules, or a language model
    const said = line("lune", out.via === "model" ? "" : out.a, { src: out.via === "model" ? "model" : out.question ? "rules" : "lune" });
    remember({ bar: out.bar || null, q: text, a: out.a, note: out.note, via: out.via, t: Date.now() });
    if (out.via === "model") {
      // Lune AI's words arrive as if typed; built-in answers appear at once
      await revealAnswer(said, out.a);
      said.dataset.via = "model";
    }
    addActions(said);
    if (out.via !== "model") sayIfVoice(out.a);
    if (out.note) line("lune", out.note).classList.add("ask-note");
    $("ask-log").scrollTop = $("ask-log").scrollHeight;
    if (out.saved) {
      P()?.paintScoreMarks?.();
      if (state.coachOpen) openBarCoach();
    }
    return out.a;
  }

  async function speakInto() {
    if (listening) return P()?.stopHearing?.();
    listening = true;
    try {
      await dictate("ask");
    } finally {
      listening = false;
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
  /*
   * Chat history, as in ChatGPT: many conversations, each with its own title,
   * kept only in this browser (lune.chats.v2). The old single chat (v1) becomes
   * the first conversation.
   */
  const CHATS_KEY = "lune.chats.v2";
  function chatStore() {
    let st = null;
    try {
      st = JSON.parse(localStorage.getItem(CHATS_KEY) || "null");
    } catch {
      st = null;
    }
    if (!st || !Array.isArray(st.convs)) {
      st = { cur: null, convs: [] };
      try {
        const old = JSON.parse(localStorage.getItem(CHAT_KEY) || "[]");
        if (old.length) {
          const id = `c${Date.now().toString(36)}`;
          st = { cur: id, convs: [{ id, title: chatTitle(old), t: old[old.length - 1]?.t || Date.now(), msgs: old.slice(-40) }] };
        }
      } catch {
        /* nothing to bring over */
      }
    }
    return st;
  }
  function putChats(st) {
    try {
      localStorage.setItem(CHATS_KEY, JSON.stringify({ cur: st.cur, convs: st.convs.slice(0, 50) }));
      localStorage.removeItem(CHAT_KEY);
    } catch {
      /* private mode: the chats last for this visit */
    }
  }
  function chatTitle(msgs) {
    const first = String(msgs.find((m) => m.who === "you")?.text || "New chat").replace(/\s+/g, " ").trim();
    return first.length > 42 ? `${first.slice(0, 40)}…` : first;
  }
  function chatLog() {
    const st = chatStore();
    return (st.convs.find((c) => c.id === st.cur)?.msgs || []).slice(-40);
  }
  function saveChat(log) {
    const st = chatStore();
    if (!log.length) {
      // an empty log is a new chat; the old one stays in history
      st.cur = null;
      return putChats(st);
    }
    let c = st.convs.find((x) => x.id === st.cur);
    if (!c) {
      c = { id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, title: "", t: Date.now(), msgs: [] };
      st.convs.unshift(c);
      st.cur = c.id;
    }
    c.msgs = log.slice(-40);
    c.title = chatTitle(c.msgs);
    c.t = Date.now();
    // the most recent conversation first
    st.convs.sort((x, y) => y.t - x.t);
    putChats(st);
  }
  function openConv(id) {
    const st = chatStore();
    st.cur = id;
    putChats(st);
    paintChat();
  }
  function deleteConv(id) {
    const st = chatStore();
    st.convs = st.convs.filter((c) => c.id !== id);
    if (st.cur === id) st.cur = null;
    putChats(st);
    paintChat();
  }
  function paintHistoryList() {
    const box = $("chat-hist-list");
    if (!box) return;
    const st = chatStore();
    box.innerHTML = st.convs.length
      ? st.convs
          .map(
            (c) => `<div class="ch-item${c.id === st.cur ? " on" : ""}"><button type="button" data-conv="${esc(c.id)}">${esc(c.title || "New chat")}</button><button type="button" class="ch-del" data-conv-del="${esc(c.id)}" aria-label="Delete “${esc(c.title)}”">${ICON.close}</button></div>`
          )
          .join("")
      : `<p class="ch-empty">Your chats will show here.</p>`;
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
      fingeringNote: FINGERING_NOTE,
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
      // read aloud and copy, as under a ChatGPT answer; both use the words as finally shown
      const bar = document.createElement("div");
      bar.className = "ask-actions";
      bar.innerHTML = `<button type="button" class="lc-mini chat-say" aria-label="Read this answer aloud">${ICON.speak}</button><button type="button" class="lc-mini chat-copy" aria-label="Copy this answer">${ICON.copy}</button>`;
      bar.querySelector(".chat-say").addEventListener("click", () => P()?.speak?.(bubble.textContent));
      bar.querySelector(".chat-copy").addEventListener("click", () => navigator.clipboard?.writeText(bubble.textContent).then(() => toast("Copied")).catch(() => {}));
      row.appendChild(bar);
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
      <aside class="chat-hist" id="chat-hist" aria-label="Your chats">
        <div class="ch-top"><p class="ch-h">Chats</p><button type="button" class="lc-tool ch-close" data-hist-close aria-label="Hide chats">${ICON.close}</button></div>
        <button type="button" class="ch-new" data-chat-new>${ICON.add}<span>New chat</span></button>
        <div class="ch-list" id="chat-hist-list"></div>
        <p class="ch-foot">Saved only in this browser.</p>
      </aside>
      <div class="chat-main">
      <header class="chat-head">
        <span class="chat-lead"><button type="button" class="lc-tool" id="chat-close" aria-label="Close the chat">${ICON.close}</button><button type="button" class="lc-tool" id="chat-hist-btn" aria-label="Your chats" aria-expanded="false" aria-controls="chat-hist">${ICON.menu}</button></span>
        <div class="chat-id">
          <h2 id="chat-h"><span class="fx-shiny">Lune AI</span></h2>
          <p class="chat-sub" id="chat-sub"></p>
        </div>
        <span class="ask-head-end">${voiceToggleHtml("chat-voice")}<button type="button" class="lc-tool chat-clear" id="chat-clear" aria-label="New chat"><svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M17.5 3.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button></span>
      </header>
      <div class="chat-log" id="chat-log" role="log" aria-live="polite"></div>
      <div class="chat-starters" id="chat-starters"></div>
      <div class="chat-locked" id="chat-locked" hidden>
        <p>Lune AI is free with a Lune account.</p>
        <button type="button" class="primary" data-chat-signin>Sign in to chat</button>
      </div>
      <form class="chat-form ask-form" id="chat-form" autocomplete="off">${composerHtml("chat", "Ask anything about piano…")}</form>
      <p class="chat-fine" id="chat-fine"></p>
      </div>`;
    document.body.appendChild(d);
    d.querySelector("#chat-close").addEventListener("click", () => d.close());
    // leaving the Lune AI page goes back to where the pianist was
    d.addEventListener("close", () => {
      d.classList.remove("is-page", "hist-open");
      // the page underneath never changed; only the address goes back to it
      if (location.hash === "#/ai") window.history.replaceState(null, "", `${location.pathname}${location.search}${aiReturn || ""}`);
      aiReturn = null;
    });
    const hist = (open) => {
      d.classList.toggle("hist-open", open);
      d.querySelector("#chat-hist-btn").setAttribute("aria-expanded", String(open));
      if (open) paintHistoryList();
    };
    d.querySelector("#chat-hist-btn").addEventListener("click", () => hist(!d.classList.contains("hist-open")));
    d.querySelector("#chat-clear").addEventListener("click", () => {
      saveChat([]);
      paintChat();
    });
    d.addEventListener("click", (e) => {
      if (e.target === d) d.close();
      const conv = e.target.closest?.("[data-conv]");
      if (conv) {
        openConv(conv.dataset.conv);
        if (!wide()) hist(false);
        return;
      }
      const del = e.target.closest?.("[data-conv-del]");
      if (del) {
        deleteConv(del.dataset.convDel);
        paintHistoryList();
        return;
      }
      if (e.target.closest?.("[data-chat-new]")) {
        saveChat([]);
        paintChat();
        if (!wide()) hist(false);
        setTimeout(() => $("chat-input")?.focus(), 30);
        return;
      }
      if (e.target.closest?.("[data-hist-close]")) return hist(false);
      const st = e.target.closest?.("[data-starter]");
      if (st) chatAsk(st.dataset.starter);
      if (e.target.closest?.("[data-chat-signin]")) {
        d.close();
        window.LuneOnboard?.openCreateAccount?.();
      }
    });
    const sendChat = () => {
      const input = $("chat-input");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      fitChat();
      chatAsk(text);
    };
    const fitChat = wireComposer("chat", sendChat);
    d.querySelector("#chat-form").addEventListener("submit", (e) => {
      e.preventDefault();
      sendChat();
    });
    d.querySelector("#chat-mic").addEventListener("click", () => dictate("chat"));
    d.querySelector("#chat-talk").addEventListener("click", () => openTalk({ title: "Lune AI", answer: (said) => chatAsk(said) }));
    return d;
  }

  const wide = () => window.matchMedia("(min-width: 900px)").matches;
  function paintChat() {
    const model = active();
    const log = chatLog();
    paintHistoryList();
    $("lune-chat")?.classList.toggle("is-empty", !!model && !log.length);
    $("chat-log").innerHTML = "";
    for (const m of log) {
      const el = chatLine(m.who, m.text, { via: m.via });
      if (m.who === "lune" && m.via === "model") richText(el, m.text);
    }
    $("chat-locked").hidden = !!model;
    $("chat-form").hidden = !model;
    $("chat-clear").hidden = !log.length;
    $("chat-starters").innerHTML = model && !log.length ? CHAT_STARTERS.map((q) => `<button type="button" data-starter="${esc(q)}">${esc(q)}</button>`).join("") : "";
    $("chat-sub").textContent = model ? aiName().replace(/ Instruct$/, "") : "Needs a free Lune account";
    $("chat-fine").textContent = model ? "Lune AI can be wrong. Lune’s server stores none of it; this chat stays in this browser." : "";
    if (model && !log.length) {
      const empty = document.createElement("div");
      empty.className = "ask-empty";
      empty.innerHTML = `<div class="ask-empty-orb"></div><p class="ask-empty-h">What are we practising today?</p>`;
      $("chat-log").appendChild(empty);
      window.LuneFX?.orb(empty.querySelector(".ask-empty-orb"))?.setMode("idle");
    }
  }

  async function chatAsk(text) {
    const model = active();
    if (!model) return paintChat();
    const log = chatLog();
    log.push({ who: "you", text, t: Date.now() });
    saveChat(log);
    $("chat-starters").innerHTML = "";
    $("chat-clear").hidden = false;
    $("lune-chat")?.classList.remove("is-empty");
    chatLine("you", text);
    $("chat-log").querySelector(".ask-empty")?.remove();
    const wait = chatLine("lune", "Thinking…");
    wait.classList.add("chat-wait");
    wait.innerHTML = '<span class="dots"><i></i><i></i><i></i></span><span class="visually-hidden">Thinking…</span>';
    let answer = "";
    let via = "model";
    try {
      answer = await model.answer(text, await buildChatContext(log.slice(0, -1)), { onToken: (t) => (wait.textContent = (answer += t)) });
    } catch (err) {
      via = "note";
      answer = err?.userMessage || "Lune AI didn’t answer just now. Try again in a minute.";
    }
    wait.parentElement.remove();
    // saved before it is typed out, so a follow-up sent mid-typing still carries it
    log.push({ who: "lune", text: answer, via, t: Date.now() });
    saveChat(log);
    const shown = chatLine("lune", via === "model" ? "" : answer, { via });
    if (via === "model") await revealAnswer(shown, answer);
    else shown.textContent = answer;
    return answer;
  }

  /** Ask a question on the Lune AI page, in a new chat. */
  async function askOnPage(text) {
    goAiPage();
    if (!active()) return; // no account: the page explains and offers sign-in
    await new Promise((r) => setTimeout(r, 60));
    saveChat([]);
    paintChat();
    return chatAsk(text);
  }

  /*
   * The Ask bar on Home: a question goes to the Lune AI page and is asked
   * there; the microphone and voice chat start there too.
   */
  function wireHomeAsk() {
    const form = $("home-ask");
    if (!form || form.dataset.wired) return;
    form.dataset.wired = "1";
    const input = $("home-ask-input");
    const send = form.querySelector('[data-home-ask="send"]');
    const talk = form.querySelector('[data-home-ask="talk"]');
    const fit = () => {
      const has = !!input.value.trim();
      send.hidden = !has;
      talk.hidden = has;
    };
    input.addEventListener("input", fit);
    const go = askOnPage;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      fit();
      go(text);
    });
    form.addEventListener("click", (e) => {
      const a = e.target.closest?.("[data-home-ask]")?.dataset.homeAsk;
      if (a === "talk") {
        goAiPage();
        setTimeout(() => active() && $("chat-talk")?.click(), 120);
      }
      if (a === "mic") {
        goAiPage();
        setTimeout(() => active() && $("chat-mic")?.click(), 120);
      }
    });
    $("home-ask-chips")?.addEventListener("click", (e) => {
      const q = e.target.closest?.("[data-home-q]")?.dataset.homeQ;
      if (q) go(q);
    });
    const orb = form.querySelector(".home-ask-orb");
    if (orb && window.LuneFX && !orb.firstChild) window.LuneFX.orb(orb)?.setMode("idle");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireHomeAsk, { once: true });
  else setTimeout(wireHomeAsk, 0);

  /** Go to the Lune AI page: its own address, so it can be bookmarked and Back leaves it. */
  let aiReturn = null;
  function goAiPage() {
    if (location.hash === "#/ai") openChatPage();
    else {
      aiReturn = location.hash || "";
      location.hash = "#/ai";
    }
  }
  /** The Lune AI page (#/ai): the same chat, full screen, with its history at the side. */
  function openChatPage() {
    const d = ensureChat();
    d.classList.add("is-page");
    if (wide()) d.classList.add("hist-open");
    openChat();
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
      goAiPage();
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

  return { openTalk, openChatPage, goAiPage, askOnPage, chatStore, askModel: async (q, ctx) => { const m = active(); return m ? m.answer(q, ctx) : null; }, openChat, paintAiHome, buildChatContext, open, close, ask, historyFor, onSelection, buildContext, aiSettings, SYSTEM_PROMPT, TASKS, MODEL_ACTIONS, runTask, paintNews, voice, modelConnected: () => !!active(), deviceOfferHtml, turnOnDeviceAI, testModel: () => providers.endpoint.answer("Reply with the single word: ready", { test: true }) };
})();
