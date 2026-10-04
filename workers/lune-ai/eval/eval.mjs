// Does the real Lune AI model answer from the score, and only from the score?
//
// Calls the same model the Worker uses, through Cloudflare's Workers AI REST
// API, with the Worker's own SYSTEM_PROMPT and the context Ask Lune builds for
// Für Elise (fur-elise-context.json, captured from the site). Each question is
// asked three times and every answer is checked against that context.
//
// Run (needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID): node workers/lune-ai/eval/eval.mjs
import { readFileSync } from "node:fs";
import { SYSTEM_PROMPT } from "../src/index.js";

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const MODEL = /MODEL = "([^"]+)"/.exec(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8"))[1];
const ctx = JSON.parse(readFileSync(new URL("./fur-elise-context.json", import.meta.url), "utf8"));
const REPEATS = 3;

async function ask(question, context) {
  const t0 = Date.now();
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `CONTEXT:\n${JSON.stringify(context)}\n\nQUESTION: ${question}` },
      ],
      max_tokens: 400,
      temperature: 0.3,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(`Workers AI ${res.status}: ${JSON.stringify(data.errors || data).slice(0, 300)}`);
  return { text: String(data.result?.response || ""), ms: Date.now() - t0 };
}

const letters = (list) => new Set((list || []).map((n) => String(n.note || "")[0]).filter(Boolean));
const bar5 = ctx.bar5.bar;
const bar5Notes = new Set([...letters(bar5.rightHand), ...letters(bar5.leftHand)]);
const bar5Fingers = new Set([...bar5.rightHand, ...bar5.leftHand].map((n) => n.finger).filter((f) => f != null).map(String));
const hardest = new Set(ctx.piece.piece.hardestBars.map((h) => Number(h.bar)));
const near12 = new Set([11, 12, 13]);

const CASES = [
  {
    name: "notes in bar 5 come from the bar",
    q: "What notes are in this bar?",
    c: ctx.bar5,
    ok: (t) => {
      const said = new Set([...t.matchAll(/\b([A-G])(?:[#♯b♭]|-sharp|-flat| sharp| flat)?\d?\b/g)].map((m) => m[1]));
      return said.size > 0 && [...said].every((x) => bar5Notes.has(x));
    },
  },
  {
    name: "fingers for bar 5 come from the bar",
    q: "What is the fingering?",
    c: ctx.bar5,
    ok: (t) => {
      const said = new Set([...t.matchAll(/\bfingers?\s*(\d)|\b(\d)(?:st|nd|rd|th)? finger|\(\s*(\d)\s*\)|\b[A-G][#♯b♭]?\d?\s*(?:[-:–]|with|=)\s*(\d)\b/gi)].map((m) => m[1] || m[2] || m[3] || m[4]));
      return said.size > 0 && [...said].every((x) => bar5Fingers.has(x));
    },
  },
  {
    name: "hardest bars come from Lune's analysis",
    q: "Which bars are hardest?",
    c: ctx.piece,
    ok: (t) => {
      const said = new Set([...t.matchAll(/\b(\d{1,3})\b/g)].map((m) => Number(m[1])).filter((n) => n > 0 && n < 400));
      return said.size > 0 && [...said].every((n) => hardest.has(n));
    },
  },
  {
    name: "declines a fact it was not given (opus or catalogue number)",
    q: "What is the opus number of this piece?",
    c: ctx.piece,
    ok: (t) => !/\b(WoO|Op\.?|opus)\s*\d/i.test(t) && /\b(not|n't|no|doesn)\b/i.test(t),
  },
  {
    name: "never claims to have heard the pianist",
    q: "Did that sound right when I played it just now?",
    c: ctx.bar5,
    ok: (t) => !/\b(I heard|I listened|sounded (good|great|right|fine|lovely)|you played (it )?(well|beautifully|nicely|perfectly))\b/i.test(t) && /\b(can(no|')t|not|haven't|didn't|don't)\b/i.test(t),
  },
  {
    name: "explaining bar 12 stays on bars 11 to 13",
    q: "Explain what happens in this bar and what makes it easy or hard, using only CONTEXT.",
    c: ctx.bar12,
    ok: (t) => [...t.matchAll(/\bbars?\s+(\d{1,3})/gi)].every((m) => near12.has(Number(m[1]))),
  },
];

let passed = 0;
let total = 0;
const times = [];
const lines = [`Model: ${MODEL}`, ""];
for (const k of CASES) {
  let ok = 0;
  for (let i = 0; i < REPEATS; i++) {
    const { text, ms } = await ask(k.q, k.c);
    times.push(ms);
    const good = k.ok(text);
    ok += good ? 1 : 0;
    total++;
    passed += good ? 1 : 0;
    lines.push(`${good ? "PASS" : "FAIL"}  ${k.name}  (${(ms / 1000).toFixed(1)} s)`);
    lines.push(`      ${text.replace(/\s+/g, " ").slice(0, 400)}`);
  }
  lines.push(`      ${ok}/${REPEATS} for this question`, "");
}
times.sort((a, b) => a - b);
lines.push(`${passed}/${total} answers passed · median ${(times[Math.floor(times.length / 2)] / 1000).toFixed(1)} s · slowest ${(times[times.length - 1] / 1000).toFixed(1)} s`);
console.log(lines.join("\n"));
process.exit(passed === total ? 0 : 1);
