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

  // The same instructions as Lune AI's server (workers/lune-ai), for a model on this device or computer.
  const SYSTEM_PROMPT = `You are Lune AI, the piano teacher inside the Lune practice app.
With each question you receive three short sections: "Score facts" (what Lune has read from the pianist's own score: key, metre, tempo, printed words, notes, suggested fingering and what makes a bar tricky), "Your practice" (the pianist's remarks, ratings, plans and the conversation so far) and "Your goal".

Facts and knowledge
- Score facts and the pianist's own data are ground truth. Use them first.
- You may also use well-established public knowledge about pieces, composers, history, technique and theory (for example: Clair de lune is the third movement of Debussy's Suite bergamasque, published in 1905). Say it plainly; do not hedge common knowledge.
- Never invent bar numbers, notes, rhythms, fingerings or markings that are not in the score facts. If something about this score is not given, say so in one short clause and help with what you do know.
- Fingering in the score facts is Lune's suggested fingering, not the edition's. Finger numbers: 1 thumb, 2 index, 3 middle, 4 ring, 5 little finger. Give fingering note by note, each note with its own number.
- A bar's difficulty is exactly what "what makes it tricky" says. Never call a bar easy when it lists something, or hard when it says nothing in particular.
- You cannot hear the pianist and have not heard any recording. Never claim otherwise.
- The pianist's remarks are their own words, not score facts.

How to answer
- Open with the answer in one clear sentence. No filler ("Great question", "Sure"), never repeat the question.
- A simple question gets one or two sentences. Analysis: one sentence on what the score shows, then at most four numbered steps, one concrete action each, each tied to a bar.
- Specific beats generic. Not "practise slowly" but "Bar 37: left hand alone, three times at 60% tempo, then add the right hand for the first two beats only." Only say what the score facts support.
- Practice plans: when the pianist gives a time, give numbered steps, each with the bars, the hands, a tempo and a number of minutes; the minutes must add up exactly to the time given.
- The goal is exactly as stated (for example "4 days a week, 30 minutes each" is not daily).
- Reply in the language of the question. In English, use British spelling (practise as a verb, practice as a noun, colour, licence) and write notes with signs (D♭, F♯), never Db or F#.
- Write names correctly: Clair de lune, Für Elise, Gymnopédie No. 1, Liebestraum No. 3.
- Sight-reading is a different skill from learning a piece: keep going without stopping, read ahead, count, use easier material, and simulate the exam.
- Be warm and encouraging without being sugary. If a question has nothing to do with music, say kindly that you are here for their piano playing and offer two piano things you could help with.
- Never mention how you received information: no section names, field names, ids, file names, "JSON", "data provided" or the name of the model.
- If the reply will be read aloud, use two or three short spoken sentences, no lists or symbols.
- Plain text. Numbered steps on their own lines are fine; no headings.`;
  const words = (k) => String(k).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  function plain(v, depth = 0) {
    const pad = "  ".repeat(depth);
    if (v == null || v === "") return "";
    if (Array.isArray(v)) return v.map((x) => (typeof x === "object" ? `${pad}-\n${plain(x, depth + 1)}` : `${pad}- ${x}`)).filter(Boolean).join("\n");
    if (typeof v === "object")
      return Object.entries(v)
        .filter(([, x]) => x != null && x !== "" && !(Array.isArray(x) && !x.length))
        .map(([k, x]) => (typeof x === "object" ? `${pad}${words(k)}:\n${plain(x, depth + 1)}` : `${pad}${words(k)}: ${x}`))
        .join("\n");
    return `${pad}${v}`;
  }
  function sections(ctx = {}) {
    const score = {};
    const practice = {};
    const goal = {};
    for (const [k, v] of Object.entries(ctx)) {
      if (/^(piece|bar|neighbouringBars|openPiece|lastPractisedPiece|bars|range|tempo|fingeringNote)$/.test(k)) score[k === "fingeringNote" ? "aboutFingering" : k] = v;
      else if (/^(goal|level)$/.test(k)) goal[k] = v;
      else if (k === "replyStyle") continue;
      else practice[k] = v;
    }
    return [
      `Score facts:\n${plain(score) || "none: no score is open"}`,
      `Your practice:\n${plain(practice) || "nothing recorded yet"}`,
      `Your goal:\n${plain(goal) || "not set"}`,
    ].join("\n\n");
  }



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

  /** "Gb4" → "G♭4": the score's own signs, so answers use them too. */
  function spell(name) {
    return String(name || "").replace(/^([A-Ga-g])(bb|b|##|#)?(-?\d*)$/, (m, l, acc, oct) => l.toUpperCase() + ({ b: "♭", bb: "♭♭", "#": "♯", "##": "♯♯" }[acc] || "") + oct);
  }

  /**
   * What makes a bar tricky, in the bar panel's own words (its headline and
   * reasons). Empty means Lune found nothing hard about it.
   */
  function barTricky(d) {
    if (!d) return null;
    const reasons = (d.difficulty?.reasons || []).filter((r) => r && !/straightforward/i.test(r));
    const headline = String(d.headline || "").trim();
    if (!headline && !reasons.length) return "Nothing in particular: one of the more straightforward bars.";
    return [headline, ...reasons.filter((r) => !headline.toLowerCase().includes(r.toLowerCase()))].filter(Boolean).join("; ");
  }

  /** An answer that shows Lune's plumbing: field names, ids, the word null. */
  const LEAK = /\bCONTEXT\b|\b[a-z]+[A-Z]?\w*\.(bar|piece|goal|tempo|remarks|difficulty|plans|notes)\b|\bupload-[a-z0-9-]{6,}|\b[a-z]+-[a-z]+-[a-z0-9-]{12,}\b|\bnull\b|\bJSON\b|\bwhatMakesItTricky\b|\bprintedHere\b|\bearlierQuestions\b|\bfingeringNote\b/;
  function leaks(text) {
    return LEAK.test(String(text || ""));
  }
  /** Remove any sentence that leaks; spell notes with signs; British spelling for practise (verb). */
  function scrub(text) {
    let t = String(text || "");
    if (leaks(t)) t = t.split(/(?<=[.!?])\s+/).filter((sn) => !leaks(sn)).join(" ");
    t = t.replace(/\b([A-G])(b|#)(\d)\b/g, (m, l, a, o) => l + (a === "b" ? "♭" : "♯") + o);
    t = t.replace(/\bpractice (it|this|that|them|the|slowly|each|hands|with|bar|bars|at)\b/g, "practise $1");
    t = t.replace(/\bcolor/g, "colour").replace(/\bfavorite/g, "favourite");
    return t.trim();
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
      (list || []).map((n) => ({ note: spell(n.letter || n.pitch), beat: n.offset, length: n.duration, finger: n.fingering ?? null }));
    const facts = window.LuneScoreFacts?.forPiece?.(p) || null;
    const tasks = (store().listTasks?.() || []).filter((t) => t.piece_key === key).slice(0, 6);
    const ctx = {
      piece: {
        title: p.overview?.title || p.title || null,
        composer: p.overview?.composer || p.composer || null,
        key: facts?.key?.name || p.notatedKey || p.overview?.key || null,
        keySignature: facts?.key?.signature || null,
        keyChanges: facts?.keyChanges?.length ? facts.keyChanges.map((k) => ({ bar: k.bar, key: k.name, signature: k.signature })) : undefined,
        timeSignature: facts?.time || p.timeSignature || p.overview?.timeSignature || null,
        printedTempo: facts?.tempo?.[0]?.mark || null,
        printedWords: facts?.words?.length ? facts.words.slice(0, 40) : undefined,
        // the printed marking says it best; the playback figure is only a fallback
        tempo: facts?.tempo?.length ? undefined : p.tempo || p.overview?.tempo || null,
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
      earlierQuestions: (bar ? historyFor(bar) : history())
        .filter((h) => !leaks(h.a))
        .slice(-4)
        .map((h) => ({ question: h.q, answer: h.a })),
      fingeringNote: FINGERING_NOTE,
    };
    // bars the pianist keeps finding hard (from their own ratings)
    const struggling = cards.filter((c) => (c.lapses || 0) >= 2 || /again|hard/i.test(String(c.last_grade || ""))).map((c) => c.bar);
    if (struggling.length) ctx.barsRatedHardOrAgain = [...new Set(struggling)].sort((a, b) => a - b).slice(0, 12);
    try {
      const marked = Number(String(p.tempo || p.overview?.tempo || "").match(/(\d{2,3})/)?.[1]) || null;
      const now = Math.round(LunePiano.getTempoBpm?.() || 0) || null;
      ctx.tempo = { practisingAtPercentOfMarked: marked && now ? Math.round((now / marked) * 100) : null };
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
        // The same words the bar panel shows, so Lune AI never contradicts it.
        whatMakesItTricky: barTricky(d),
        printedHere: window.LuneScoreFacts?.near?.(facts, Number(bar)) || undefined,
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
    explainBar: () => "Explain what happens in this bar and what makes it easy or hard, using what Lune has read from the score.",
    whyHard: () =>
      "Say what makes this bar tricky, using the bar's 'what makes it tricky' line (the same words the bar panel shows) and its notes. If that line says nothing in particular, say it is one of the easier bars and give one thing to listen for. Then suggest one thing to try.",
    explainPracticeProblem: (q) => `The pianist says: "${q}". Using their ratings, remarks and what makes the bar tricky, say what is most likely going wrong and one thing to try.`,
    suggestPractice: () => "Suggest how to practise this bar or passage in three short steps, each tied to something in this bar's score facts.",
    generatePracticePlan: (bars, mins) => `Write a practice plan of ${mins} minutes for bars ${bars.join(", ")}. Numbered steps with minutes for each, hands-separate or slow-tempo work only where the score facts support it, and keep the pianist's goal.`,
    summarizePractice: () => "Summarise this pianist's practice on this piece from the pianist's ratings and remarks: what has improved, what is still hard. If there is no history, say so.",
    summarizeBarNotes: () => "Summarise the pianist's remarks on this bar in one or two sentences.",
    explainFingering: () => "Explain the fingering Lune suggests for this bar, using this bar's notes and suggested fingering. If no fingering is given, say so.",
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
      async answer(question, ctx, { signal, onToken } = {}) {
        ctx = spokenCtx(ctx);
        const token = await store().accessToken();
        if (!token) throw new Error("Sign in again to use Lune AI.");
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 45000);
        signal?.addEventListener("abort", () => ctl.abort(), { once: true });
        try {
          const res = await fetch(`${aiServer()}/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ question, context: ctx, stream: true }),
            signal: ctl.signal,
          });
          // A streaming server sends server-sent events; words appear as they come.
          if (res.ok && /event-stream/.test(res.headers.get("content-type") || "") && res.body) {
            const reader = res.body.getReader();
            const dec = new TextDecoder();
            let buf = "";
            let full = "";
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              buf += dec.decode(value, { stream: true });
              let i;
              while ((i = buf.indexOf("\n\n")) >= 0) {
                const chunk = buf.slice(0, i);
                buf = buf.slice(i + 2);
                const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
                if (!data || data === "[DONE]") continue;
                let piece = "";
                try {
                  const j = JSON.parse(data);
                  piece = j.response ?? j.token ?? j.text ?? "";
                  if (j.error) throw Object.assign(new Error(j.error), { userMessage: j.error });
                } catch (e) {
                  if (e.userMessage) throw e;
                  piece = data;
                }
                if (piece) {
                  full += piece;
                  onToken?.(piece);
                }
              }
            }
            if (!full.trim()) throw new Error("Lune AI sent an empty answer");
            return full;
          }
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.answer) {
            const err = new Error(data.error || `Lune AI returned ${res.status}`);
            err.userMessage = data.error;
            throw err;
          }
          return String(data.answer);
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
            { role: "user", content: `${sections(ctx)}\n\nQuestion: ${question}` },
          ],
          { onToken },
        );
        if (!res?.text) throw new Error("model sent no answer");
        return res.text;
      },
    },
    /** A language model behind an OpenAI-compatible chat endpoint. */
    endpoint: {
      available: () => !!aiSettings().endpoint,
      async answer(question, ctx, { signal, onToken } = {}) {
        ctx = spokenCtx(ctx);
        const { endpoint, model } = aiSettings();
        const ctl = new AbortController();
        // a local model can take a while to load the first time; give up only when it goes quiet
        let timer = 0;
        const quiet = () => {
          clearTimeout(timer);
          timer = setTimeout(() => ctl.abort(), 90000);
        };
        quiet();
        signal?.addEventListener("abort", () => ctl.abort(), { once: true });
        // earlier turns go as real turns, so a follow-up ("and the left hand?") reads naturally
        const turns = (ctx?.conversation || []).slice(-8).map((m) => ({ role: m.from === "pianist" ? "user" : "assistant", content: String(m.text || "") }));
        const facts = ctx && ctx.conversation ? { ...ctx, conversation: undefined } : ctx;
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: ctl.signal,
            body: JSON.stringify({
              model,
              stream: !!onToken,
              temperature: 0.4,
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                ...turns,
                { role: "user", content: `${sections(facts)}\n\nQuestion: ${question}` },
              ],
            }),
          });
          if (!res.ok) throw new Error(`model returned ${res.status}`);
          if (onToken && res.body && /event-stream|ndjson/i.test(res.headers.get("content-type") || "")) {
            const reader = res.body.getReader();
            const dec = new TextDecoder();
            let buf = "";
            let text = "";
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              quiet();
              buf += dec.decode(value, { stream: true });
              let nl;
              while ((nl = buf.indexOf("\n")) >= 0) {
                const row = buf.slice(0, nl).trim();
                buf = buf.slice(nl + 1);
                const data = row.startsWith("data:") ? row.slice(5).trim() : row;
                if (!data || data === "[DONE]") continue;
                try {
                  const j = JSON.parse(data);
                  const t = j?.choices?.[0]?.delta?.content ?? j?.message?.content ?? "";
                  if (t) {
                    text += t;
                    onToken(t);
                  }
                } catch {
                  /* a keep-alive or partial line */
                }
              }
            }
            if (!text.trim()) throw new Error("model sent no answer");
            return text.trim().slice(0, 6000);
          }
          const data = await res.json();
          const text = data?.choices?.[0]?.message?.content ?? data?.message?.content ?? data?.answer;
          if (!text || typeof text !== "string") throw new Error("model sent no answer");
          return text.trim().slice(0, 6000);
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
    async speak(text, lang = "en") {
      if (!providers.account.available()) throw new Error("no account");
      const token = await store().accessToken();
      const res = await fetch(`${aiServer()}/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: String(text).slice(0, 900), lang }),
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
  /** The model that is really answering, named plainly for the header. */
  function whoAnswers() {
    const m = active();
    if (m === providers.endpoint) return `${aiSettings().model.replace(/:latest$/, "")} · local`;
    // the product is Lune AI; which model runs it is said in Settings, not in the header
    if (m === providers.account) return "";
    if (m === providers.device) return `${D()?.MODEL.name || "Lune AI"} · in this browser`;
    return "";
  }
  function privacyLine() {
    const m = active();
    if (m === providers.endpoint) return `Answers come from ${aiSettings().model.replace(/:latest$/, "")} on your own computer and can be wrong. Nothing leaves it.`;
    if (m === providers.device) return "Answers are written in this browser and can be wrong. Nothing leaves this device.";
    return "Lune AI can be wrong. Lune’s server stores none of it; this chat stays in this browser.";
  }

  /*
   * Ollama on this computer: ask it which models it has and use the strongest
   * one a laptop can run (the most parameters, up to 35B), skipping embedding
   * models. Returns the model chosen, or throws with a message to show.
   */
  async function findOllama() {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3000);
    let tags;
    try {
      const r = await fetch("http://localhost:11434/api/tags", { signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      tags = await r.json();
    } catch {
      throw new Error(
        `Lune couldn’t reach Ollama on this computer. Start it with: OLLAMA_ORIGINS=${location.origin} ollama serve — and if your browser asks to let this site use apps on your device, choose Allow.`
      );
    } finally {
      clearTimeout(timer);
    }
    const size = (m) => {
      const p = String(m.details?.parameter_size || m.name.match(/:(\d+(?:\.\d+)?)b/i)?.[1] || "").match(/(\d+(?:\.\d+)?)\s*([BM])?/i);
      return p ? Number(p[1]) / (/m/i.test(p[2] || "") ? 1000 : 1) : 0;
    };
    const usable = (tags.models || []).filter((m) => m?.name && !/embed|bge|minilm|nomic/i.test(m.name) && size(m) <= 35);
    if (!usable.length) throw new Error("Ollama is running but has no chat model yet. In Terminal: ollama pull qwen2.5:7b");
    usable.sort((a, b) => size(b) - size(a));
    const name = usable[0].name;
    try {
      localStorage.setItem("lune.ai.endpoint", "http://localhost:11434/v1/chat/completions");
      localStorage.setItem("lune.ai.model", name);
    } catch {
      /* private mode: lasts for this visit only through aiSettings' fallbacks */
    }
    return name;
  }

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
    // "bar 2 is hard, how should I practise it?" is a rating and a question; "is bar 2 hard?" is only a question
    const ratingStatement = !isQuestion || !/^(is|are|was|were|did|does|do|why|how|which|what|where|when|who|can|could|should|would|will|explain|tell|show)\b/.test(t.trim());
    if (grade && ratingStatement && bars.length && /\b(was|went|felt|is|that|it)\b/.test(t)) {
      const logged = await rate(bars, grade);
      // a hard bar, or a "how do I…", deserves real help, not only a receipt
      const wantsHelp = grade === "again" || grade === "hard" || /\b(how|help|practi[sc]e|fix|should|what (do|can|should) i)\b/.test(t);
      if (wantsHelp) {
        const help = await reply(`How do I practise bar ${bars[0]}?`).catch(() => null);
        return { bar: bars[0], a: help?.a || logged, saved: "review", question: true, note: logged };
      }
      return { bar: bars[0], a: logged, saved: "review" };
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
    // "which bars are hardest?" is about the piece, even with a bar selected
    if (!d || /\b(which bars|hardest bars|whole piece|the piece)\b/.test(t)) {
      if (/\b(hard(er|est)?|difficult|trick(y|ier|iest)|worst|practi[sc]e|work on|focus)\b/.test(t)) {
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
    if (!lines.filter(Boolean).length) {
      // nothing stored for this bar: steps built from its own notes
      const rh = handLine(d.rh, "Right hand").replace(/(\S)\s{2,}(?=\S)/g, "$1, ");
      const lh = handLine(d.lh, "Left hand").replace(/(\S)\s{2,}(?=\S)/g, "$1, ");
      lines.push(`Bar ${bar}, step by step:`);
      if (rh) lines.push(`1. Right hand alone, slowly (about 60 on the metronome), saying the notes as you play. ${rh}`);
      if (lh) lines.push(`${rh ? 2 : 1}. Left hand alone the same way. ${lh}`);
      lines.push(`${(rh ? 1 : 0) + (lh ? 1 : 0) + 1}. Hands together at that slow tempo. When it is clean three times in a row, raise the metronome by four.`);
    }
    return { bar, question: true, a: lines.filter(Boolean).join("\n") };
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
    const forBar = act.bar ? bar || selectedBarsSorted()[0] || null : null;
    let a = null;
    let failure = null;
    let said = null;
    if (model) {
      said = line("lune", "", { src: "model" });
      const res = await streamAnswer(said, async ({ signal, onToken }) => model.answer(TASKS[task](), await buildContext(forBar), { signal, onToken }));
      if (res.stopped) return stoppedAt(said, res.text, { q: act.label, bar: forBar });
      a = res.text || null;
      failure = res.error;
    }
    let note = "";
    if (!a) {
      note = fallbackNote(failure);
      a = act.fallback ? (await reply(act.fallback)).a : "Lune’s built-in answers can’t summarise practice. This week shows the days, bars and ratings instead.";
      if (said) {
        richText(said, a);
        setSrc(said, "rules");
      } else said = line("lune", a, { src: "rules" });
    } else said.dataset.via = "model";
    if (state.piece) window.LunePlans?.noteActivity?.("question", { key: keyFor(), title: state.piece?.overview?.title || state.piece?.title || "" });
    remember({ bar: forBar, q: act.label, a, note: note || undefined, via: note ? undefined : "model", t: Date.now() });
    addActions(said);
    if (note) {
      sayIfVoice(a);
      line("lune", note).classList.add("ask-note");
    } else voiceAfter(a);
  }
  /** Where an answer came from, said under it; changed when a model fails and the built-in answer stands in. */
  function setSrc(el, src) {
    const s = el.parentElement?.querySelector(".ask-src");
    if (!s) return;
    s.className = `ask-src ask-src-${src === "model" ? "ai" : "rules"}`;
    s.textContent = src === "model" ? "Lune AI · can be wrong" : "Built-in answer, read from the score";
  }
  /** Stop pressed: keep what was written, say it was stopped, and keep it in this bar's history. */
  function stoppedAt(el, text, { q, bar }) {
    if (!text) {
      el.closest(".ask-row")?.remove();
      line("lune", "Stopped.").classList.add("ask-note");
      return "";
    }
    el.dataset.via = "model";
    addActions(el);
    remember({ bar, q, a: text, via: "model", t: Date.now() });
    return text;
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
    stop: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/></svg>',
    retry: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
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
        <button type="button" class="lc-round lc-stop" aria-label="Stop writing">${ICON.stop}</button>
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
  function richText(el, text, { live = false } = {}) {
    if (!el) return;
    const esc2 = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    // "bar 12", "bars 26–30": a link to those bars when they are in the open score
    const barLinks = (html) =>
      state.piece
        ? html.replace(/\b(bars?)\s+(\d{1,4})(?:\s*(?:–|-|to)\s*(\d{1,4}))?\b/gi, (m, w, a, b) => {
            const from = Number(a);
            const to = b ? Number(b) : from;
            if (to < from || to - from > 64 || !debriefFor(from) || !debriefFor(to)) return m;
            return `<button type="button" class="la-bar" data-bars="${from}-${to}">${m}</button>`;
          })
        : html;
    const inline = (t) =>
      barLinks(
        esc2(t)
          .replace(/`([^`]+)`/g, "$1")
          .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
          .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:!?)]|$)/g, "$1<em>$2</em>")
      );
    // the server's range answers start lines with "@Bar 12"; shown as a bold lead-in
    const lead = (t) => t.replace(/^@((?:bars?)\s+\d+(?:\s*(?:[–,-]|and|to)\s*\d+)*)[\s:.,—–-]*/i, (m, label) => `**${label[0].toUpperCase()}${label.slice(1)}** · `);
    let html = "";
    let list = null;
    const closeList = () => {
      if (list) html += `</${list}>`;
      list = null;
    };
    for (const raw of String(text || "").replace(/\r/g, "").split("\n")) {
      const t = raw.trim();
      if (!t) {
        closeList();
        continue;
      }
      const num = t.match(/^(\d+)[.)]\s+(.*)$/);
      const dot = t.match(/^[-•*]\s+(.*)$/);
      if (num || dot) {
        const kind = num ? "ol" : "ul";
        if (list !== kind) {
          closeList();
          html += num && Number(num[1]) > 1 ? `<ol start="${Number(num[1])}">` : `<${kind}>`;
          list = kind;
        }
        html += `<li>${inline(lead(num ? num[2] : dot[1]))}</li>`;
        continue;
      }
      closeList();
      const head = t.match(/^#{1,6}\s+(.*)$/);
      const sum = t.match(/^(?:in\s+)?summary\s*[:,]\s*(.*)$/i);
      if (head) html += `<p class="la-h">${inline(head[1])}</p>`;
      else if (sum) html += `<p class="la-sum"><strong>Summary</strong> · ${inline(sum[1])}</p>`;
      else html += `<p>${inline(lead(t))}</p>`;
    }
    closeList();
    // the caret sits at the end of the last line while words are still arriving
    if (live) html = html.replace(/(<\/(?:p|li)>)((?:<\/[ou]l>)?)$/, '<span class="la-caret" aria-hidden="true"></span>$1$2') || '<span class="la-caret" aria-hidden="true"></span>';
    el.innerHTML = html;
    el.raw = String(text || "");
    el.classList.add("rich", "la2");
    el.classList.remove("la");
  }

  /* ---------- an answer being written: thinking, then words as they arrive, then Stop/Retry ---------- */

  let writing = null;
  function setWriting(on) {
    document.querySelectorAll(".lc-composer").forEach((c) => c.classList.toggle("is-writing", on));
  }
  const nearBottom = (log) => !log || log.scrollHeight - log.scrollTop - log.clientHeight < 120;
  function thinkingHtml() {
    const where = state.piece ? `<span class="la-think-where">${esc(readingLine())}</span>` : "";
    return `<span class="la-think" aria-hidden="true"><i></i><i></i><i></i></span>${where}<span class="visually-hidden">Lune is thinking</span>`;
  }
  /** A whole answer that arrived at once is shown at reading pace, already formatted. */
  async function paceIn(full, onToken, signal) {
    if (window.LuneFX?.reduced?.()) return onToken(full);
    const parts = String(full).match(/\s*\S+/g) || [String(full)];
    const per = Math.max(1, Math.ceil(parts.length / 40));
    for (let i = 0; i < parts.length && !signal.aborted; i += per) {
      onToken(parts.slice(i, i + per).join(""));
      await new Promise((r) => requestAnimationFrame(r));
    }
  }
  /**
   * Write a model's answer into `el` as it arrives. `run({signal, onToken})`
   * calls the model. Resolves to { text, stopped, error }.
   */
  // Questions asked while Lune is still answering wait their turn; none is dropped.
  let answerQueue = Promise.resolve();
  function streamAnswer(el, run) {
    const turn = answerQueue.then(() => streamOne(el, run));
    answerQueue = turn.catch(() => {});
    if (writing) {
      el.classList.add("la-thinking");
      el.innerHTML = `<p class="la-queued">Waiting for the answer above…</p>`;
    }
    return turn;
  }
  async function streamOne(el, run) {
    const ctl = new AbortController();
    writing = ctl;
    setWriting(true);
    const log = el.closest(".chat-log, .ask-log");
    el.classList.add("la-thinking");
    el.setAttribute("aria-busy", "true");
    el.innerHTML = thinkingHtml();
    let text = "";
    let raf = 0;
    let error = null;
    const paint = () => {
      raf = 0;
      if (!el.isConnected) return;
      const stick = nearBottom(log);
      el.classList.remove("la-thinking");
      richText(el, scrub(text), { live: true });
      if (stick && log) log.scrollTop = log.scrollHeight;
    };
    const onToken = (t) => {
      if (ctl.signal.aborted) return;
      text += t;
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const stopped = new Promise((_, reject) => ctl.signal.addEventListener("abort", () => reject(Object.assign(new Error("Stopped"), { name: "AbortError" })), { once: true }));
    try {
      const final = await Promise.race([run({ signal: ctl.signal, onToken }), stopped]);
      if (final && !text) await paceIn(final, onToken, ctl.signal);
      if (final && !ctl.signal.aborted) text = String(final);
    } catch (err) {
      if (!ctl.signal.aborted) error = err;
    }
    cancelAnimationFrame(raf);
    const wasStopped = ctl.signal.aborted && !error;
    if (writing === ctl) {
      writing = null;
      setWriting(false);
    }
    text = scrub(text);
    el.classList.remove("la-thinking");
    el.removeAttribute("aria-busy");
    if (text) richText(el, text);
    else el.innerHTML = "";
    return { text, stopped: wasStopped, error };
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest?.(".lc-stop")) {
      e.preventDefault();
      writing?.abort();
      return;
    }
    const b = e.target.closest?.(".la-bar");
    if (!b) return;
    const [from, to] = b.dataset.bars.split("-").map(Number);
    const bars = [];
    for (let n = from; n <= to; n++) bars.push(n);
    const chat = $("lune-chat");
    if (chat?.open) chat.close();
    try {
      setBarSelection(bars, { open: false, primary: from });
    } catch {
      /* the score isn't on screen */
    }
  });
  /** "Reading Für Elise · 3/8 · A minor", and the bars in question. */
  let readingBars = null;
  function readingLine() {
    const p = state.piece;
    if (!p) return "Lune AI";
    const title = p.overview?.title || p.title || "this piece";
    const bits = [title, p.timeSignature || p.overview?.timeSignature, p.notatedKey || p.overview?.key].filter(Boolean);
    const bars = readingBars || selectedBarsSorted?.() || [];
    if (bars.length) bits.push(bars.length > 1 ? `bars ${bars[0]}–${bars[bars.length - 1]}` : `bar ${bars[0]}`);
    return `Reading ${bits.join(" · ")}`;
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
        // while Lune is still writing, the words wait in the box
        if (input.value.trim() && !writing) onSend();
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
        fast: true,
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
  /** After an answer was streamed in: read it aloud too, when voice replies are on. */
  function voiceAfter(text) {
    if (text && voiceReplies() && !talking) P()?.speak?.(String(text).replace(/\*\*/g, ""));
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
        <span class="lw-bar lt-bar" aria-hidden="true"><i></i></span>
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
      try { P()?.stopHearing?.(); } catch { /* already stopped */ }
      try { P()?.stopSpeaking?.(); } catch { /* already quiet */ }
      try { orb.destroy(); } catch { /* gone */ }
      d.classList.remove("is-thinking");
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
          said = await P().hearPhrase({ fast: true, onLevel: (v) => orb.setLevel(v), onPartial: (t) => !/^Listening|^Writing/.test(t) && (cap.textContent = t) });
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
        d.classList.add("is-thinking");
        let text = "";
        try {
          // never wait forever on a slow model
          text = await Promise.race([answer(said), new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 25000))]);
        } catch {
          text = "That took too long. Ask me again in a moment.";
        }
        d.classList.remove("is-thinking");
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
      if (!text || writing) return;
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
      const msg = b.closest(".ask-row")?.querySelector(".ask-msg");
      const text = String(msg?.raw || msg?.textContent || "").replace(/\*\*/g, "");
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
    // Lune's answers are formatted (paragraphs, numbered steps), so they need a block, not a paragraph
    const el = document.createElement(who === "lune" ? "div" : "p");
    el.className = `ask-msg ask-from-${who}`;
    if (who === "lune" && text && !/^Thinking/.test(text)) richText(el, text);
    else el.textContent = text;
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
    const who = providers.endpoint.available() ? aiSettings().model : providers.account.available() ? "Lune AI" : providers.device.available() ? "on this device" : "built-in answers";
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

  /** Bars named in a question: "bars 1 to 4", "the first four bars", "the last 2 bars", "the first line". */
  const WORDNUM = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
  function barsInQuestion(text) {
    const t = String(text || "").toLowerCase();
    const all = Object.keys(state.piece?.debriefs || {}).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
    if (!all.length) return [];
    const span = (a, b) => all.filter((n) => n >= Math.min(a, b) && n <= Math.max(a, b)).slice(0, 12);
    let m = t.match(/\bbars?\s+(\d+)\s*(?:-|–|to|through|until)\s*(?:bar\s*)?(\d+)/);
    if (m) return span(+m[1], +m[2]);
    m = t.match(/\b(first|opening|last|final)\s+(\d+|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+bars?\b/);
    if (m) {
      const n = Math.min(12, Number(m[2]) || WORDNUM[m[2]] || 0);
      return /first|opening/.test(m[1]) ? all.slice(0, n) : all.slice(-n);
    }
    m = t.match(/\b(first|second|third|top|opening|last)\s+(line|system|row)\b/);
    if (m) {
      try {
        const rows = new Map();
        state.osmd.GraphicSheet.MeasureList.forEach((col) => {
          const gm = col.find(Boolean);
          const num = gm?.parentSourceMeasure?.MeasureNumber;
          const y = Math.round(gm?.ParentStaffLine?.PositionAndShape?.AbsolutePosition?.y ?? gm?.PositionAndShape?.AbsolutePosition?.y ?? 0);
          if (num == null || num < 1) return;
          if (!rows.has(y)) rows.set(y, []);
          rows.get(y).push(num);
        });
        const lines = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l);
        const pick = { first: 0, top: 0, opening: 0, second: 1, third: 2, last: lines.length - 1 }[m[1]];
        return (lines[pick] || []).slice(0, 12);
      } catch {
        return all.slice(0, 4);
      }
    }
    m = t.match(/\bbars\s+(\d+(?:\s*(?:,|and)\s*\d+)+)/);
    if (m) return [...new Set(m[1].split(/\s*(?:,|and)\s*/).map(Number))].filter((n) => all.includes(n)).slice(0, 12);
    return [];
  }
  /** Built from the score alone: one line a bar, then what to do first. */
  function rangeReply(bars) {
    const lines = [`One at a time, from bar ${bars[0]} to bar ${bars[bars.length - 1]}.`];
    const scored = [];
    for (const b of bars) {
      const d = debriefFor(b) || {};
      const why = (d.difficulty?.reasons || []).slice(0, 2).join(", ");
      const tip = Array.isArray(d.advice) ? d.advice[0] : d.advice;
      const what = why || d.headline || (d.rh?.length || d.lh?.length ? "steady, nothing unusual" : "rests");
      lines.push(`@Bar ${b} ${what}${tip ? ` · ${String(tip).replace(/\.$/, "")}` : ""}`);
      scored.push([b, Number(d.difficulty?.score) || 0]);
    }
    const hard = scored.filter(([, x]) => x > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([b]) => b);
    lines.push(`Summary: ${hard.length ? `Start with bar${hard.length > 1 ? "s" : ""} ${hard.join(" and ")}, hands separately and slowly, then` : "Play them"} as one phrase at 60, adding four on the metronome each time it is clean.`);
    return lines.join("\n");
  }
  async function rangeContext(bars) {
    const ctx = await buildContext(bars[0]);
    const slim = (list) => (list || []).map((n) => ({ note: n.letter || n.pitch, beat: n.offset, finger: n.fingering ?? null }));
    ctx.barsInQuestion = bars.map((b) => {
      const d = debriefFor(b) || {};
      return { number: b, rightHand: slim(d.rh).slice(0, 14), leftHand: slim(d.lh).slice(0, 14), difficulty: d.difficulty?.reasons || [], advice: [].concat(d.advice || []).slice(0, 2) };
    });
    delete ctx.neighbouringBars;
    return ctx;
  }

  async function ask(text) {
    ensurePanel();
    line("you", text);
    let out;
    const span = barsInQuestion(text);
    readingBars = span.length > 1 ? span : null;
    try {
      out = span.length > 1 ? { question: true, bar: span[0], a: rangeReply(span), range: span } : await reply(text);
    } catch (err) {
      out = { a: err?.message || "That didn't work. Try again." };
    }
    // A question may go to the connected model; the built-in answer is the fallback.
    const model = out.question ? active() : null;
    // counted before it is saved, so the session that starts here includes it
    if (out.question) window.LunePlans?.noteActivity?.("question", { key: keyFor(), title: state.piece?.overview?.title || state.piece?.title || "" });
    let said;
    if (model) {
      // the answer's own row appears at once, thinks, then fills in as the words arrive
      said = line("lune", "", { src: "model" });
      // a bar just rated hard: ask for what to do about it, not a summary of the bar
      const asked = out.range
        ? `${text}\n\nAnswer bar by bar for bars ${out.range.join(", ")}. One line per bar, each starting "@Bar N", saying what is hard in that bar and one concrete way to practise it. Then one line starting "Summary:" with two sentences: what ties these bars together and the order to practise them in. No other text.`
        : out.saved === "review" ? `${text}\n\nI find this bar hard. Give me concrete steps to practise it, tied to what is in it.` : text;
      const forBar = out.bar || selectedBarsSorted()[0] || null;
      const res = await streamAnswer(said, async ({ signal, onToken }) =>
        model.answer(asked, out.range ? await rangeContext(out.range) : await buildContext(forBar), { signal, onToken })
      );
      if (res.stopped) return stoppedAt(said, res.text, { q: text, bar: out.bar || null });
      if (res.text) {
        out.a = res.text;
        out.via = "model";
        said.dataset.via = "model";
      } else {
        out.note = [out.note, fallbackNote(res.error)].filter(Boolean).join(" ");
        richText(said, out.a);
        setSrc(said, "rules");
      }
    } else {
      // every answer says where it came from: the score through Lune's rules, or a language model
      said = line("lune", out.a, { src: out.question ? "rules" : "lune" });
    }
    remember({ bar: out.bar || null, q: text, a: out.a, note: out.note, via: out.via, t: Date.now() });
    addActions(said);
    if (out.via === "model") voiceAfter(out.a);
    else sayIfVoice(out.a);
    if (out.note) line("lune", out.note).classList.add("ask-note");
    $("ask-log").scrollTop = $("ask-log").scrollHeight;
    if (out.saved) {
      P()?.paintScoreMarks?.();
      if (state.coachOpen) openBarCoach();
    }
    return out.a;
  }

  /** A marking tapped on the score: the glossary's answer at once, then Lune AI's, in this piece's context. */
  async function explainMarking({ label, gloss, question }) {
    open({});
    line("you", `What is ${label}?`);
    const model = active();
    if (gloss) {
      const g = line("lune", gloss, { src: "rules" });
      addActions(g);
    }
    if (!model) {
      if (!gloss) line("lune", "Lune’s glossary doesn’t have that one yet. Sign in and Lune AI explains any marking.", { src: "lune" });
      return;
    }
    const said = line("lune", "", { src: "model" });
    const res = await streamAnswer(said, async ({ signal, onToken }) => model.answer(question, await buildContext(selectedBarsSorted()[0] || null), { signal, onToken }));
    if (res.stopped) return stoppedAt(said, res.text, { q: question, bar: null });
    if (res.text) {
      said.dataset.via = "model";
      addActions(said);
      remember({ bar: null, q: question, a: res.text, via: "model", t: Date.now() });
      voiceAfter(res.text);
    } else {
      said.closest(".ask-row")?.remove();
      if (!gloss) line("lune", fallbackNote(res.error) || "Lune AI didn’t answer just now.").classList.add("ask-note");
    }
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
      goal: {
        daysPerWeek: prefs.practiceDays || null,
        minutesPerSession: prefs.practiceMins || null,
        inWords: prefs.practiceDays ? `${prefs.practiceDays} days a week, ${prefs.practiceMins || 30} minutes each (not every day)` : null,
        workingToward: prefs.dreamPiece?.title || null,
        level: prefs.grade ?? null,
      },
      fingeringNote: FINGERING_NOTE,
      conversation: log.slice(-6).map((m) => ({ from: m.who === "you" ? "pianist" : "lune", text: String(m.text).slice(0, 600) })),
    };
    // the piece on stage, or the one open in a tab, or the one last practised
    const p = state.piece || state.sessions?.[state.sessions.length - 1]?.piece || null;
    if (p) {
      const facts = window.LuneScoreFacts?.forPiece?.(p) || null;
      ctx.openPiece = {
        title: p.overview?.title || p.title || null,
        composer: p.overview?.composer || p.composer || null,
        key: facts?.key?.name || null,
        timeSignature: facts?.time || null,
        hardestBars: p === state.piece ? hardest(5) : undefined,
      };
    } else if (pieces.length) {
      const last = [...pieces].sort((a, b) => String(b.last_practised_at || "").localeCompare(String(a.last_practised_at || "")))[0];
      ctx.lastPractisedPiece = { title: last.title, composer: last.composer || null };
    } else {
      ctx.openPiece = null;
      ctx.noScoreOpen = "No score is open, so there are no bar numbers to refer to. Answer as general piano teaching and do not name any bar.";
    }
    return ctx;
  }

  function chatLine(who, text, { via } = {}) {
    const log = $("chat-log");
    const row = document.createElement("div");
    row.className = `chat-row chat-from-${who}`;
    // Lune's answers are formatted (paragraphs, lists), so they need a block, not a paragraph
    const bubble = document.createElement(who === "lune" ? "div" : "p");
    bubble.className = "chat-bubble";
    bubble.textContent = text;
    row.appendChild(bubble);
    if (who === "lune" && via === "model") chatActions(bubble);
    log.appendChild(row);
    requestAnimationFrame(() => row.classList.add("in"));
    log.scrollTop = log.scrollHeight;
    return bubble;
  }
  /** Read aloud, copy and (for the newest answer) try again, as under a ChatGPT answer. */
  function chatActions(bubble, { retry, note = false } = {}) {
    const row = bubble.parentElement;
    row.querySelector(".ask-actions")?.remove();
    const bar = document.createElement("div");
    bar.className = "ask-actions";
    // a note ("Stopped.", an error) only offers to try again
    bar.innerHTML = `${
      note ? "" : `<button type="button" class="lc-mini chat-say" aria-label="Read this answer aloud">${ICON.speak}</button><button type="button" class="lc-mini chat-copy" aria-label="Copy this answer">${ICON.copy}</button>`
    }${retry ? `<button type="button" class="lc-mini chat-retry" aria-label="Try again">${ICON.retry}</button>` : ""}`;
    if (!bar.innerHTML) return;
    const words = () => String(bubble.raw || bubble.textContent).replace(/\*\*/g, "");
    bar.querySelector(".chat-say")?.addEventListener("click", () => P()?.speak?.(words()));
    bar.querySelector(".chat-copy")?.addEventListener("click", () => navigator.clipboard?.writeText(words()).then(() => toast("Copied")).catch(() => toast("Couldn’t copy")));
    bar.querySelector(".chat-retry")?.addEventListener("click", retry);
    row.appendChild(bar);
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
        <p class="chat-locked-h">Lune AI is free with a Lune account.</p>
        <p>It reads the score you have open, knows your Repertoire and your week, and answers like a patient teacher.</p>
        <div class="chat-locked-actions">
          <button type="button" class="primary" data-chat-signin>Sign in to chat</button>
          <button type="button" class="link-btn" data-chat-ollama>Use Ollama on this computer</button>
        </div>
        <p class="chat-locked-msg" id="chat-locked-msg" role="status" aria-live="polite"></p>
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
      if (e.target.closest?.("[data-chat-ollama]")) {
        const msg = $("chat-locked-msg");
        msg.textContent = "Looking for Ollama on this computer…";
        findOllama()
          .then((name) => {
            msg.textContent = "";
            toast(`Lune AI is using ${name.replace(/:latest$/, "")} on this computer`);
            paintChat();
            setTimeout(() => $("chat-input")?.focus(), 30);
          })
          .catch((err) => (msg.textContent = err.message));
      }
    });
    const sendChat = () => {
      const input = $("chat-input");
      const text = input.value.trim();
      if (!text || writing) return;
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
    $("chat-sub").textContent = model ? whoAnswers() : "Needs a free Lune account";
    $("chat-fine").textContent = model ? privacyLine() : "";
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
    if (writing) return "";
    const log = chatLog();
    log.push({ who: "you", text, t: Date.now() });
    saveChat(log);
    $("chat-starters").innerHTML = "";
    $("chat-clear").hidden = false;
    $("lune-chat")?.classList.remove("is-empty");
    $("chat-log").querySelector(".ask-empty")?.remove();
    const mine = chatLine("you", text);
    // the answer's own row appears at once, thinks, then fills in as the words arrive
    const shown = chatLine("lune", "");
    const res = await streamAnswer(shown, async ({ signal, onToken }) => model.answer(text, await buildChatContext(log.slice(0, -1)), { signal, onToken }));
    let answer = res.text;
    let via = "model";
    if (!answer && res.stopped) {
      answer = "Stopped.";
      via = "note";
    } else if (!answer) {
      via = "note";
      answer = res.error?.userMessage || "Lune AI didn’t answer just now. Try again in a moment.";
    }
    if (via === "note") {
      shown.textContent = answer;
      shown.classList.add("chat-note");
    }
    log.push({ who: "lune", text: answer, via, t: Date.now() });
    saveChat(log);
    paintHistoryList();
    // the newest answer can be asked again: both turns go, and the question is sent fresh
    chatActions(shown, {
      note: via === "note",
      retry: () => {
        if (writing) return;
        // rewritten in place: an empty log through saveChat would start a different chat
        const st = chatStore();
        const conv = st.convs.find((c) => c.id === st.cur);
        if (conv) {
          if (conv.msgs[conv.msgs.length - 1]?.who === "lune") conv.msgs.pop();
          if (conv.msgs[conv.msgs.length - 1]?.who === "you") conv.msgs.pop();
          putChats(st);
        }
        shown.parentElement.remove();
        mine.parentElement.remove();
        chatAsk(text);
      },
    });
    if (via === "model") voiceAfter(answer);
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
  // Leaving #/ai for any other place closes the Lune AI page (P0-17).
  window.addEventListener("hashchange", () => {
    if (location.hash === "#/ai") return;
    const d = document.getElementById("lune-chat");
    if (d?.open && d.classList.contains("is-page")) {
      aiReturn = null;
      d.close();
    }
  });
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

  return { explainMarking, openTalk, openChatPage, goAiPage, askOnPage, chatStore, askModel: async (q, ctx) => { const m = active(); return m ? m.answer(q, ctx) : null; }, openChat, paintAiHome, buildChatContext, open, close, ask, historyFor, onSelection, buildContext, aiSettings, SYSTEM_PROMPT, TASKS, MODEL_ACTIONS, runTask, paintNews, voice, modelConnected: () => !!active(), deviceOfferHtml, turnOnDeviceAI, testModel: () => providers.endpoint.answer("Reply with the single word: ready", { test: true }) };
})();
