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
 * Routes: GET /health → {ok, model}; POST /ask {question, context} → {answer}.
 */

export const SYSTEM_PROMPT = `You are Lune, a piano practice and score-analysis assistant inside the Lune app.
You are given CONTEXT as JSON: facts Lune has read from the score (notes, fingering, difficulty, dynamics, harmony), the pianist's own remarks, their earlier questions, their practice history and their goal.
Rules:
- Use only the score facts in CONTEXT. Never invent bars, notes, rhythms, fingerings, dynamics, tempo marks, opus numbers or movement names. If CONTEXT does not contain something, say Lune does not have it.
- Keep facts and suggestions apart: say what the score shows, then what you suggest.
- The pianist's remarks are their own words; treat them as information from the user, not as score facts.
- You have not heard the pianist play. Never claim to have listened to a recording or a performance.
- Answer a simple question in one or two sentences. Give detail only when asked for analysis.
- When asked for a practice plan, give short numbered steps tied to bar numbers from CONTEXT, sized to the minutes available, and keep the pianist's stated goal.
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
  if (req.method !== "POST" || url.pathname !== "/ask") return json(req, env, 404, { error: "Not found" });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const user = await accountFor(token, env, fetchImpl);
  if (!user) return json(req, env, 401, { error: "Sign in to Lune to use Lune AI." });

  // a few questions a minute per account keeps the free allowance for everyone
  if (env.PER_ACCOUNT?.limit) {
    const { success } = await env.PER_ACCOUNT.limit({ key: user.id });
    if (!success) return json(req, env, 429, { error: "That is a lot of questions at once. Try again in a minute." });
  }

  const body = await req.json().catch(() => null);
  const question = String(body?.question || "").trim();
  const context = JSON.stringify(body?.context ?? {});
  if (!question) return json(req, env, 400, { error: "No question." });
  if (question.length > MAX_QUESTION || context.length > MAX_CONTEXT) return json(req, env, 413, { error: "That question is too long." });

  try {
    const out = await env.AI.run(env.MODEL, {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `CONTEXT:\n${context}\n\nQUESTION: ${question}` },
      ],
      max_tokens: 400,
      temperature: 0.3,
    });
    const answer = String(out?.response || "").trim();
    if (!answer) return json(req, env, 502, { error: "The model sent no answer." });
    return json(req, env, 200, { answer: answer.slice(0, 4000), model: env.MODEL });
  } catch (err) {
    // the free daily allowance is used up, or the model is unavailable
    return json(req, env, 503, { error: "Lune AI is resting for now. Lune's built-in answers still work." });
  }
}

export default { fetch: (req, env) => handle(req, env) };
