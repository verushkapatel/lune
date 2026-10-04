// A short-lived Worker for evaluating the real models: GitHub Actions deploys
// it, runs eval.mjs against it and deletes it. It reaches the models through
// the same AI binding as Lune AI and answers only requests carrying EVAL_KEY,
// a random secret made for each run.
import { synthesize, transcribe } from "../src/index.js";

export default {
  async fetch(req, env) {
    if (!env.EVAL_KEY || req.headers.get("X-Eval-Key") !== env.EVAL_KEY) return new Response("no", { status: 403 });
    const body = await req.json();
    if (body.voice) {
      // the voice says it, Whisper hears it back
      const audio = await synthesize(env, body.voice);
      const t0 = Date.now();
      const text = await transcribe(env, audio);
      return Response.json({ bytes: audio.length, head: Array.from(audio.slice(0, 3)), text, sttMs: Date.now() - t0 });
    }
    const out = await env.AI.run(env.MODEL, { messages: body.messages, max_tokens: 400, temperature: 0.3 });
    return Response.json({ response: out?.response || "" });
  },
};
