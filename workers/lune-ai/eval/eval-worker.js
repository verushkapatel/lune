// A short-lived Worker for evaluating the real model: GitHub Actions deploys
// it, runs eval.mjs against it and deletes it. It reaches the model through
// the same AI binding as Lune AI and answers only requests carrying EVAL_KEY,
// a random secret made for each run.
export default {
  async fetch(req, env) {
    if (!env.EVAL_KEY || req.headers.get("X-Eval-Key") !== env.EVAL_KEY) return new Response("no", { status: 403 });
    const { messages } = await req.json();
    const out = await env.AI.run(env.MODEL, { messages, max_tokens: 400, temperature: 0.3 });
    return Response.json({ response: out?.response || "" });
  },
};
