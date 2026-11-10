/* Lune AI proxy — optional, for a hosted language model.
 *
 * Lune's site is static files, so it cannot hold an API key. This small
 * function sits between Ask Lune and a model provider: the browser sends it
 * the same OpenAI-style chat request Lune sends to a local model, and the
 * function adds the key (kept in a server-side secret) and forwards it.
 *
 * Written for Cloudflare Workers (free tier), and plain enough to port.
 * Secrets / variables to set on the function, never in the repository:
 *   UPSTREAM_URL   an OpenAI-compatible chat completions URL
 *   UPSTREAM_KEY   the API key for it
 *   UPSTREAM_MODEL optional: force one model regardless of what is asked
 *   ALLOW_ORIGIN   the site allowed to call this, e.g. https://lune.page
 *
 * Then, in Lune: Settings → Ask Lune → Model address = this function's URL.
 */
export default {
  async fetch(request, env) {
    const origin = env.ALLOW_ORIGIN || "https://lune.page";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return new Response("POST only", { status: 405, headers: cors });
    if ((request.headers.get("Origin") || "") !== origin) return new Response("Forbidden", { status: 403, headers: cors });

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Bad JSON", { status: 400, headers: cors });
    }
    // Forward only what a chat needs; cap the size so the function can't be used as an open relay.
    const messages = Array.isArray(body.messages) ? body.messages.slice(0, 4) : [];
    if (!messages.length || JSON.stringify(messages).length > 60000) {
      return new Response("Bad request", { status: 400, headers: cors });
    }
    const upstream = await fetch(env.UPSTREAM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.UPSTREAM_KEY}` },
      body: JSON.stringify({ model: env.UPSTREAM_MODEL || body.model, messages, stream: false, temperature: 0.3, max_tokens: 700 }),
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  },
};
