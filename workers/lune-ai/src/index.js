/* Lune AI: the server side of Ask Lune for people with a Lune account.
 *
 * A Cloudflare Worker. It answers with an open-weight model on Cloudflare
 * Workers AI, inside the free daily allowance, so it costs nothing and holds
 * no API key: the model is reached through the Worker's AI binding.
 *
 * Who may ask: only someone signed in to Lune. The browser sends the
 * account's Supabase access token; the Worker asks Supabase whether it is
 * valid (with Lune's public anon key) before doing anything else.
 *
 * What the model gets: Lune's system prompt (kept here, so the service can't
 * be used as a general chatbot), the score context Ask Lune built for the bar
 * or piece, and the question. Nothing is stored.
 *
 * Routes: GET /health → {ok, model}; POST /ask {question, context} → {answer};
 * POST /transcribe (audio bytes) → {text}: speech to text with Whisper, which
 * punctuates; POST /speak {text} → audio (WAV or MP3): a natural voice for answers.
 * The audio is passed to the model and not kept.
 */

const STT_PROMPT = "Lune, ask Lune. Piano practice notes. Bar 12, right hand, left hand, fingering, thumb, crescendo, diminuendo, legato, staccato, pedal, sharp, flat, metronome, tempo. Liebestraum, Clair de lune, Für Elise, Gymnopédie, nocturne, étude, mazurka, prelude, Chopin, Debussy, Liszt, Satie, Rachmaninoff, Beethoven, Mozart, Bach, Schumann, Schubert.";
const MAX_AUDIO = 2_000_000; // bytes: about two minutes of compressed speech
const MAX_SPEAK = 900; // characters

function toBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Speech to text: Whisper, told it is hearing a pianist's practice notes. */
export async function transcribe(env, bytes) {
  const out = await env.AI.run(env.STT_MODEL || "@cf/openai/whisper-large-v3-turbo", {
    audio: toBase64(bytes),
    language: "en",
    initial_prompt: STT_PROMPT,
    // skip stretches with no voice, where Whisper otherwise makes words up
    vad_filter: true,
  });
  return cleanTranscript(out);
}

// What Whisper is known to say over silence or noise, and nothing else.
const HALLUCINATIONS = /^(thank you( so much)?( for watching)?|thanks for watching|bye|you|so|okay|ok|please subscribe.*|subtitles by.*|\.+|\s*)[.!]?$/i;
const PROMPT_WORDS = new Set(STT_PROMPT.toLowerCase().match(/[a-z0-9]+/g));

/** Keep only what was really said: drop silent segments, stock phrases and echoes of the hint prompt. */
export function cleanTranscript(out) {
  const segs = Array.isArray(out?.segments) ? out.segments : null;
  let text = segs
    ? segs
        .filter((g) => !(Number(g.no_speech_prob) > 0.6) && !(Number(g.avg_logprob) < -1.2))
        .map((g) => String(g.text || "").trim())
        .join(" ")
    : String(out?.text || "");
  text = text.replace(/\s+/g, " ").trim();
  if (HALLUCINATIONS.test(text)) return "";
  // the hint prompt read back word for word means nothing was said
  const words = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  if (words.length >= 4 && words.filter((w) => PROMPT_WORDS.has(w)).length / words.length > 0.85) return "";
  return text;
}

/** Text to speech: returns mp3 bytes, whatever shape the model answers in. */
export async function synthesize(env, text, lang = "en") {
  const model = env.TTS_MODEL || "@cf/myshell-ai/melotts";
  const input = /deepgram\/aura/.test(model) ? { text, speaker: env.TTS_VOICE || "luna", encoding: "mp3" } : { prompt: text, lang: lang === "fr" ? "fr" : "en" };
  const out = await env.AI.run(model, input);
  if (out instanceof ReadableStream) return new Uint8Array(await new Response(out).arrayBuffer());
  if (out instanceof ArrayBuffer) return new Uint8Array(out);
  if (out instanceof Uint8Array) return out;
  if (typeof out?.audio === "string") return fromBase64(out.audio);
  throw new Error("no audio");
}

/**
 * One answer from the best model available: MODEL first (Llama 3.3 70B), and
 * MODEL_FALLBACK (Llama 3.1 8B) if the larger one is busy or fails.
 */
export async function runModel(env, messages, { maxTokens = 700 } = {}) {
  let lastErr = null;
  for (const model of [env.MODEL, env.MODEL_FALLBACK].filter(Boolean)) {
    try {
      const out = await env.AI.run(model, { messages, max_tokens: maxTokens, temperature: 0.3 });
      const text = String(out?.response || "").trim();
      if (text) return { text, model };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("no answer");
}

export const SYSTEM_PROMPT = `You are Lune AI, the piano teacher inside the Lune practice app.
With each question you receive three short sections: "Score facts" (what Lune has read from the pianist's own score: key, metre, tempo, printed words, notes, suggested fingering and what makes a bar tricky), "Your practice" (the pianist's remarks, ratings, plans and the conversation so far) and "Your goal".

Facts and knowledge
- Score facts and the pianist's own data are ground truth. Use them first.
- When "about this piece" is given, it is checked history: prefer it to memory for dates, catalogue numbers and titles. Never give a catalogue or opus number you are not sure of.
- You may also use well-established public knowledge about pieces, composers, history, technique and theory (for example: Clair de lune is the third movement of Debussy's Suite bergamasque, published in 1905). Say it plainly; do not hedge common knowledge.
- Never invent bar numbers, notes, rhythms, fingerings or markings that are not in the score facts. If something about this score is not given, say so in one short clause and help with what you do know.
- Fingering in the score facts is Lune's suggested fingering, not the edition's. Finger numbers: 1 thumb, 2 index, 3 middle, 4 ring, 5 little finger. Give fingering chord by chord, one line each, low note to high with the fingers in the same order (for example "F5–B♭5–F6: 1-2-5"); for a melody, group a few notes per line ("C5 D♭5 E♭5: 1 2 3"). Cover every note in the bar or name the beats you cover; never end with "and so on".
- A bar's difficulty is exactly what "what makes it tricky" says. Never call a bar easy when it lists something, or hard when it says nothing in particular.
- You cannot hear the pianist and have not heard any recording. Never claim otherwise.
- The pianist's remarks are their own words, not score facts.

Ask before you answer
- If one missing detail would change your answer and nothing you were given settles it, ask for it instead of guessing: which piece, which bars, how long they have, what exactly goes wrong (notes, rhythm, speed, memory, hands together), or their level. Ask one short question that ends with a question mark, offer two or three likely answers on their own lines starting with "- " (a few words each), and stop. Do not answer and ask in the same reply.
- Do not ask when the score facts, their practice or the conversation already answer it, when the question is simple and factual, or when you asked something in your last reply. When they have answered, give the full answer.
- Example: "Make me a plan" with no time given: "How long do you have today?" then "- 10 minutes", "- 20 minutes", "- 45 minutes".

How to answer
- Open with the answer in one clear sentence. No filler ("Great question", "Sure"), never repeat the question.
- A simple question gets one or two sentences. Analysis: one sentence on what the score shows, then at most four numbered steps, one concrete action each, each tied to a bar.
- Specific beats generic. Not "practise slowly" but "Bar 37: left hand alone, three times at 60% tempo, then add the right hand for the first two beats only." Only say what the score facts support.
- Practice plans: when the pianist gives a time, give numbered steps, each with the bars, the hands, a tempo and a number of minutes; the minutes must add up exactly to the time given.
- The goal is exactly as stated (for example "4 days a week, 30 minutes each" is not daily).
- Reply in the language of the question. In English, use British spelling (practise as a verb, practice as a noun, colour, licence) even when the pianist writes "practice" as a verb and write notes with signs (D♭, F♯), never Db or F#.
- Write names correctly: Clair de lune, Für Elise, Gymnopédie No. 1, Liebestraum No. 3.
- Sight-reading is a different skill from learning a piece: keep going without stopping, read ahead, count, use easier material, and simulate the exam.
- Be warm and encouraging without being sugary. If a question has nothing to do with music, say kindly that you are here for their piano playing and offer two piano things you could help with.
- Never mention how you received information: no section names, field names, ids, file names, "JSON", "data provided" or the name of the model.
- If the reply will be read aloud, use two or three short spoken sentences, no lists or symbols.
- Plain text. Numbered steps on their own lines are fine; no headings.`;

/** Musical terms a pianist meets in scores, with what they mean at the piano. */
const GLOSSARY = {
  "con sordina": "literally 'with mute'. On the piano it is usually read as the soft pedal (una corda); in Debussy some editions and teachers read it as a veiled, half-pedalled sound. Editions differ.",
  "senza sordina": "'without mute': release the soft pedal (or, in Beethoven, keep the dampers raised: sustain pedal).",
  "una corda": "press the soft (left) pedal.",
  "tre corde": "release the soft pedal.",
  "tempo rubato": "flexible time: take a little time and give it back, keeping the pulse underneath.",
  "rubato": "flexible time: take a little time and give it back, keeping the pulse underneath.",
  "rall": "rallentando: gradually slower.",
  "rit": "ritardando or ritenuto: slower (ritenuto is at once).",
  "accel": "accelerando: gradually faster.",
  "a tempo": "back to the main tempo.",
  "tempo i": "back to the opening tempo.",
  "calmato": "calm, calmer.",
  "un poco mosso": "a little more movement: slightly faster.",
  "andante": "at a walking pace.",
  "espressivo": "expressively.",
  "dolce": "sweetly, softly.",
  "legato": "smoothly connected.",
  "staccato": "short and detached.",
  "tenuto": "held for its full value, slightly leaned on.",
  "sforzando": "a sudden strong accent.",
  "sf": "sforzando: a sudden strong accent.",
  "cresc": "crescendo: gradually louder.",
  "dim": "diminuendo: gradually softer.",
  "decresc": "decrescendo: gradually softer.",
  "pp": "pianissimo: very soft.",
  "p": "piano: soft.",
  "mp": "mezzo-piano: moderately soft.",
  "mf": "mezzo-forte: moderately loud.",
  "f": "forte: loud.",
  "ff": "fortissimo: very loud.",
  "ped": "press the sustain pedal; the star or bracket marks where to release it.",
  "8va": "play an octave higher than written.",
  "8vb": "play an octave lower than written.",
  "fermata": "pause: hold the note or rest longer than written.",
  "poco a poco": "little by little.",
  "morendo": "dying away: softer and slower.",
  "perdendosi": "dying away to nothing.",
  "sostenuto": "sustained.",
  "cantabile": "in a singing style: bring out the melody.",
  "leggiero": "lightly.",
  "agitato": "agitated, restless.",
  "animato": "with life, more animated.",
};
function glossaryFor(question, context) {
  const hay = `${question} ${JSON.stringify(context?.piece?.printedWords || "")} ${JSON.stringify(context?.bar?.printedHere || "")}`.toLowerCase();
  const out = [];
  for (const [term, meaning] of Object.entries(GLOSSARY)) {
    const re = new RegExp(`(^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i");
    if (term.length > 2 ? re.test(hay) : new RegExp(`"(mark|text)":"${term}"`, "i").test(hay)) out.push(`${term}: ${meaning}`);
  }
  return out.slice(0, 8);
}

/** The context as three plain sections with readable labels, never field names. */
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
export function sections(ctx = {}) {
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

// Plumbing that must never reach the pianist.
export const LEAK = /\bCONTEXT\b|\bscore facts\b|\byour practice section\b|\b[a-z]+\.(bar|piece|goal|difficulty|remarks)\b|\bupload-[a-z0-9-]{6,}|\b[a-z]+-[a-z]+-[a-z0-9-]{14,}\b|\bnull\b|\bJSON\b|\bLlama\b|\bdata provided\b/i;
/** British spelling of the verb, whatever the question said ("to practice the left hand"). */
export function british(text) {
  return String(text || "")
    .replace(/\b(to|should|can|could|will|would|then|and|or|you|I|we|please|must|might) practice\b/g, "$1 practise")
    .replace(/\b(P|p)ractic(ing|ed)\b/g, "$1ractis$2")
    .replace(/\b(P|p)ractice (it|this|that|them|the|slowly|each|hands|with|bars?|at|until|for)\b/g, "$1ractise $2")
    .replace(/\bcolor/g, "colour")
    .replace(/\bfavorite/g, "favourite");
}
export function scrubAnswer(text) {
  const t = british(String(text || "").trim());
  if (!LEAK.test(t)) return t;
  return t.split(/(?<=[.!?])\s+|\n/).filter((s) => !LEAK.test(s)).join(" ").trim();
}

const MAX_QUESTION = 1200; // characters
const MAX_CONTEXT = 24000; // characters of JSON

function cors(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0] || "",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const json = (req, env, status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(req, env) } });

/** The Lune account behind a token, or null. */
async function accountFor(token, env, fetchImpl) {
  if (!token) return null;
  const res = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY },
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user?.id ? user : null;
}

/**
 * Workers AI streams in more than one shape (its own {response} events, or
 * OpenAI-style chunks whose response field is empty). The browser gets one
 * shape: `data: {"response": "<words>"}` per piece, then `data: [DONE]`.
 */
export function plainStream(stream) {
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = "";
  const out = (controller, line) => {
    const data = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (!data || data === "[DONE]") return;
    try {
      const j = JSON.parse(data);
      const words = j?.choices?.[0]?.delta?.content || j?.response || "";
      if (words) controller.enqueue(enc.encode(`data: ${JSON.stringify({ response: words })}\n\n`));
    } catch {
      /* a partial or keep-alive line */
    }
  };
  return stream.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          out(controller, buf.slice(0, i).trim());
          buf = buf.slice(i + 1);
        }
      },
      flush(controller) {
        out(controller, buf.trim());
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
      },
    })
  );
}

export async function handle(req, env, fetchImpl = fetch) {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req, env) });
  if (req.method === "GET" && url.pathname === "/health") return json(req, env, 200, { ok: true, model: env.MODEL });
  const routes = ["/ask", "/transcribe", "/speak"];
  if (req.method !== "POST" || !routes.includes(url.pathname)) return json(req, env, 404, { error: "Not found" });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const user = await accountFor(token, env, fetchImpl);
  if (!user) return json(req, env, 401, { error: "Sign in to Lune to use Lune AI." });

  // a few questions a minute per account keeps the free allowance for everyone
  if (env.PER_ACCOUNT?.limit) {
    const { success } = await env.PER_ACCOUNT.limit({ key: user.id });
    if (!success) return json(req, env, 429, { error: "That is a lot of questions at once. Try again in a minute." });
  }

  if (url.pathname === "/transcribe") {
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length < 800) return json(req, env, 400, { error: "No speech was recorded." });
    if (bytes.length > MAX_AUDIO) return json(req, env, 413, { error: "That recording is too long. Keep it under two minutes." });
    try {
      return json(req, env, 200, { text: await transcribe(env, bytes) });
    } catch {
      return json(req, env, 503, { error: "Lune AI could not hear that just now." });
    }
  }
  if (url.pathname === "/speak") {
    const body = await req.json().catch(() => null);
    const text = String(body?.text || "").trim().slice(0, MAX_SPEAK);
    if (!text) return json(req, env, 400, { error: "Nothing to say." });
    try {
      // French names and terms in a French voice
      const audio = await synthesize(env, text, body?.lang === "fr" ? "fr" : "en");
      // MeloTTS answers in WAV; label the audio by what it really is
      const wav = audio[0] === 0x52 && audio[1] === 0x49 && audio[2] === 0x46 && audio[3] === 0x46;
      return new Response(audio, { status: 200, headers: { "Content-Type": wav ? "audio/wav" : "audio/mpeg", "Cache-Control": "private, max-age=86400", ...cors(req, env) } });
    } catch {
      return json(req, env, 503, { error: "Lune AI's voice is resting. Your device will read it instead." });
    }
  }

  const body = await req.json().catch(() => null);
  const question = String(body?.question || "").trim();
  const context = JSON.stringify(body?.context ?? {});
  if (!question) return json(req, env, 400, { error: "No question." });
  if (question.length > MAX_QUESTION || context.length > MAX_CONTEXT) return json(req, env, 413, { error: "That question is too long." });

  try {
    // a spoken reply is short, so it is written (and heard) sooner
    const spoken = body?.context?.replyStyle === "spoken";
    const terms = glossaryFor(question, body?.context);
    // earlier turns go to the model as real turns, so "20 minutes" answers the question it asked
    const convo = Array.isArray(body?.context?.conversation) ? body.context.conversation.slice(-8) : [];
    const turns = convo
      .map((m) => ({ role: m?.from === "pianist" ? "user" : "assistant", content: String(m?.text || "").slice(0, 1200) }))
      .filter((m) => m.content.trim());
    const facts = body?.context && typeof body.context === "object" ? { ...body.context, conversation: undefined } : body?.context;
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...turns,
      {
        role: "user",
        content: `${sections(facts)}${terms.length ? `\n\nTerms in this score:\n${terms.map((t) => `- ${t}`).join("\n")}` : ""}\n\nQuestion: ${question}`,
      },
    ];
    const maxTokens = spoken ? 220 : 900;
    // Stream word by word when the browser asks for it.
    if (body?.stream) {
      for (const model of [env.MODEL, env.MODEL_FALLBACK].filter(Boolean)) {
        try {
          const stream = await env.AI.run(model, { messages, max_tokens: maxTokens, temperature: 0.3, stream: true });
          return new Response(plainStream(stream), { headers: { ...cors(req, env), "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
        } catch {
          /* try the fallback model */
        }
      }
      throw new Error("no model");
    }
    let { text, model } = await runModel(env, messages, { maxTokens });
    // An answer that shows plumbing is written again once, then cleaned.
    if (LEAK.test(text)) {
      try {
        ({ text, model } = await runModel(
          env,
          [...messages, { role: "assistant", content: text }, { role: "user", content: "Write that answer again for the pianist without mentioning any section names, field names, ids or how you received information." }],
          { maxTokens },
        ));
      } catch {
        /* keep the first answer, cleaned below */
      }
    }
    return json(req, env, 200, { answer: scrubAnswer(text), model });
  } catch (err) {
    // the free daily allowance is used up, or the model is unavailable
    return json(req, env, 503, { error: "Lune AI is resting for now. Lune's built-in answers still work." });
  }
}

export default { fetch: (req, env) => handle(req, env) };
