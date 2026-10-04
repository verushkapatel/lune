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

const STT_PROMPT = "Piano practice notes. Bar 12, right hand, left hand, fingering, thumb, crescendo, diminuendo, legato, staccato, pedal, sharp, flat, metronome, tempo.";
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
  });
  return String(out?.text || "").trim();
}

/** Text to speech: returns mp3 bytes, whatever shape the model answers in. */
export async function synthesize(env, text) {
  const model = env.TTS_MODEL || "@cf/myshell-ai/melotts";
  const input = /deepgram\/aura/.test(model) ? { text, speaker: env.TTS_VOICE || "luna", encoding: "mp3" } : { prompt: text, lang: "en" };
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

export const SYSTEM_PROMPT = `You are Lune, a piano practice and score-analysis assistant inside the Lune app.
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
- Answer a simple question in one or two sentences. For analysis, cover what each hand does, what makes it hard, and exactly how to practise it, in a short paragraph or numbered steps.
- When asked for a practice plan, give short numbered steps tied to bar numbers from CONTEXT, sized to the minutes available, and keep the pianist's stated goal.
- CONTEXT.conversation, when present, holds the last turns of this chat; answer the newest question in that light.
- For a general piano question (technique, practice habits, musical terms) that does not depend on a score, answer from general piano teaching and say it is general advice. Never present general advice as a fact about the pianist's score.
- Say plainly when you are unsure.
- Plain text only. No markdown, no headings.`;

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
      const audio = await synthesize(env, text);
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
    const { text, model } = await runModel(env, [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `CONTEXT:\n${context}\n\nQUESTION: ${question}` },
    ]);
    return json(req, env, 200, { answer: text.slice(0, 4000), model });
  } catch (err) {
    // the free daily allowance is used up, or the model is unavailable
    return json(req, env, 503, { error: "Lune AI is resting for now. Lune's built-in answers still work." });
  }
}

export default { fetch: (req, env) => handle(req, env) };
