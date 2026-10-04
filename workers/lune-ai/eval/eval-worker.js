// A short-lived Worker for evaluating the real models: GitHub Actions deploys
// it, runs eval.mjs against it and deletes it. It reaches the models through
// the same AI binding as Lune AI and answers only requests carrying EVAL_KEY,
// a random secret made for each run.
import { runModel, synthesize, transcribe } from "../src/index.js";

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
    // the same choice of model, and the same fallback, as Lune AI itself
    const { text, model } = await runModel(env, body.messages);
    return Response.json({ response: text, model });
  },
};
