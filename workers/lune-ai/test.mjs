// Tests for the Lune AI Worker, with a fake model and a fake Supabase.
// Run: node workers/lune-ai/test.mjs
import { handle, SYSTEM_PROMPT } from "./src/index.js";

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  worker: ${name}${ok ? "" : `  (${detail})`}`);
};

const calls = [];
const env = (over = {}) => ({
  MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_ANON_KEY: "anon",
  ALLOWED_ORIGINS: "https://lune.page,http://localhost:8137",
  AI: {
    run: async (model, input) => {
      calls.push({ model, input });
      if (/whisper/.test(model)) return { text: "Bar 12, keep the thumb light." };
      if (/melotts/.test(model)) return { audio: btoa("ID3fake-mp3-bytes") };
      return { response: "Bar 5 has E and D sharp in the right hand." };
    },
  },
  PER_ACCOUNT: { limit: async () => ({ success: true }) },
  ...over,
});
// Supabase answers 200 with a user for the token "good", 401 otherwise
const fakeFetch = async (url, init) => {
  const ok = url === "https://supabase.test/auth/v1/user" && init.headers.Authorization === "Bearer good" && init.headers.apikey === "anon";
  return new Response(ok ? JSON.stringify({ id: "u1", email: "a@b.c" }) : "{}", { status: ok ? 200 : 401 });
};
const ask = (body, { token = "good", origin = "https://lune.page", e = env() } = {}) =>
  handle(
    new Request("https://lune-ai.test/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
    e,
    fakeFetch,
  );

const ctx = { bar: { number: 5, rightHand: [{ note: "E5" }, { note: "D#5" }] } };

let r = await handle(new Request("https://lune-ai.test/health"), env(), fakeFetch);
check("health says which model", r.status === 200 && (await r.json()).model === "@cf/meta/llama-3.1-8b-instruct-fast");

r = await ask({ question: "What notes?", context: ctx }, { token: "" });
check("no account, no answer", r.status === 401 && calls.length === 0, r.status);

r = await ask({ question: "What notes?", context: ctx }, { token: "forged" });
check("a token Supabase rejects gets no answer", r.status === 401 && calls.length === 0, r.status);

r = await ask({ question: "What notes?", context: ctx });
const data = await r.json();
check("a signed-in account gets the model's answer", r.status === 200 && data.answer.startsWith("Bar 5"), JSON.stringify(data));
const sent = calls[0]?.input?.messages || [];
check("the model gets Lune's system prompt from the server, not the browser", sent[0]?.role === "system" && sent[0].content === SYSTEM_PROMPT);
check("the model gets the score context and the question", sent[1]?.content.includes('"number":5') && sent[1].content.endsWith("QUESTION: What notes?"));
check("CORS allows lune.page", r.headers.get("Access-Control-Allow-Origin") === "https://lune.page");

r = await ask({ question: "x", context: ctx }, { origin: "https://evil.example" });
check("CORS does not echo other sites", r.headers.get("Access-Control-Allow-Origin") !== "https://evil.example");

r = await ask({ question: "x".repeat(5000), context: ctx });
check("over-long questions are refused", r.status === 413);

r = await ask({ question: "  ", context: ctx });
check("empty questions are refused", r.status === 400);

r = await ask({ question: "What notes?", context: ctx }, { e: env({ PER_ACCOUNT: { limit: async () => ({ success: false }) } }) });
check("too many questions a minute are refused", r.status === 429);

r = await ask({ question: "What notes?", context: ctx }, { e: env({ AI: { run: async () => { throw new Error("quota"); } } }) });
check("when the free allowance runs out, it says so", r.status === 503 && /built-in answers/.test((await r.json()).error));

// voice: speech to text and a natural voice, for accounts only
const post = (path, body, { token = "good", type = "application/json" } = {}) =>
  handle(
    new Request(`https://lune-ai.test${path}`, {
      method: "POST",
      headers: { "Content-Type": type, Origin: "https://lune.page", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body,
    }),
    env(),
    fakeFetch,
  );
const audio = new Uint8Array(4000).fill(7);
r = await post("/transcribe", audio, { token: "", type: "audio/webm" });
check("no account, no transcription", r.status === 401);
calls.length = 0;
r = await post("/transcribe", audio, { type: "audio/webm" });
const heard = await r.json();
check("a recording comes back as punctuated text", r.status === 200 && heard.text === "Bar 12, keep the thumb light.", JSON.stringify(heard));
check("Whisper is told it is hearing piano practice, in English", calls[0]?.input?.language === "en" && /fingering/.test(calls[0]?.input?.initial_prompt) && typeof calls[0]?.input?.audio === "string");
r = await post("/transcribe", new Uint8Array(10), { type: "audio/webm" });
check("an empty recording is refused", r.status === 400);
r = await post("/speak", JSON.stringify({ text: "Bar twelve. Keep the thumb light." }));
const mp3 = new Uint8Array(await r.arrayBuffer());
check("text comes back as audio, labelled by its format", r.status === 200 && r.headers.get("Content-Type") === "audio/mpeg" && new TextDecoder().decode(mp3).startsWith("ID3"));
r = await post("/speak", JSON.stringify({ text: "x" }), { token: "" });
check("no account, no voice", r.status === 401);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
