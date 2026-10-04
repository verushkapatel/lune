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

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
