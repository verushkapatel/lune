// Runs the real Worker code locally for browser tests, with a stand-in model
// and a stand-in Supabase that accepts one token ("test-token").
// Usage: node workers/lune-ai/local-server.mjs [port]
import http from "node:http";
import { handle } from "./src/index.js";

const port = Number(process.argv[2] || 8140);
let last = null;
const env = {
  MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_ANON_KEY: "anon",
  ALLOWED_ORIGINS: "http://127.0.0.1:8137,http://localhost:8137",
  AI: {
    run: async (model, input) => {
      if (/whisper/.test(model)) {
        const bytes = Buffer.from(input.audio, "base64");
        last = { model, format: bytes.subarray(0, 4).toString("latin1"), bytes: bytes.length, language: input.language };
        return { text: "Bar 12, keep the thumb light." };
      }
      last = input;
      const ctx = input.messages[1].content;
      const bar = ctx.match(/"bar":\{"number":(\d+)/)?.[1];
      return { response: bar ? `STANDIN account reply about bar ${bar}.` : "STANDIN account reply about the piece." };
    },
  },
};
const fakeSupabase = async (url, init) =>
  new Response(init.headers.Authorization === "Bearer test-token" ? '{"id":"u-test"}' : "{}", {
    status: init.headers.Authorization === "Bearer test-token" ? 200 : 401,
  });

http
  .createServer(async (req, res) => {
    if (req.url === "/last") {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify(last));
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await handle(
      new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers: req.headers, body: req.method === "GET" || req.method === "OPTIONS" ? undefined : body }),
      env,
      fakeSupabase,
    );
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  })
  .listen(port, "127.0.0.1", () => console.log(`Lune AI test server on ${port}`));
