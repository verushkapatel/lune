// Does the real Lune AI model answer from the score, and only from the score?
//
// Calls the same model the Worker uses, through the evaluation Worker
// (eval-worker.js, deployed for the run by GitHub Actions), with the Worker's own SYSTEM_PROMPT and the context Ask Lune builds for
// Für Elise (fur-elise-context.json, captured from the site). Each question is
// asked three times and every answer is checked against that context.
//
// Run: EVAL_URL=… EVAL_KEY=… node workers/lune-ai/eval/eval.mjs
import { readFileSync } from "node:fs";
import { SYSTEM_PROMPT } from "../src/index.js";

const EVAL_URL = process.env.EVAL_URL;
const EVAL_KEY = process.env.EVAL_KEY;
const TOML = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const MODEL = /^MODEL = "([^"]+)"/m.exec(TOML)[1];
const FALLBACK = /^MODEL_FALLBACK = "([^"]+)"/m.exec(TOML)?.[1] || "";
const ctx = JSON.parse(readFileSync(new URL("./fur-elise-context.json", import.meta.url), "utf8"));
const REPEATS = 3;

async function ask(question, context) {
  const t0 = Date.now();
  const res = await fetch(EVAL_URL, {
    method: "POST",
    headers: { "X-Eval-Key": EVAL_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `CONTEXT:\n${JSON.stringify(context)}\n\nQUESTION: ${question}` },
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`evaluation Worker ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return { text: String(data.response || ""), model: String(data.model || ""), ms: Date.now() - t0 };
}

const letters = (list) => new Set((list || []).map((n) => String(n.note || "")[0]).filter(Boolean));
const bar5 = ctx.bar5.bar;
const bar5Notes = new Set([...letters(bar5.rightHand), ...letters(bar5.leftHand)]);
const bar5Fingers = new Set([...bar5.rightHand, ...bar5.leftHand].map((n) => n.finger).filter((f) => f != null).map(String));
const hardest = new Set(ctx.piece.piece.hardestBars.map((h) => Number(h.bar)));
const near12 = new Set([11, 12, 13]);
const bar12Notes = new Set([...ctx.bar12.bar.rightHand, ...ctx.bar12.bar.leftHand].map((n) => n.note));


// Each finger the answer pairs with a note must be the finger the score gives that note.
// Reads "E5 (finger 5)", "E5: 5", "E5 with 5", "5 for E5", "5 little finger for E5",
// "little finger (5) on E5 and D#5". Finger names must match their numbers.
const NOTE = "[A-G](?:#|♯|b|♭)?\\d";
export function fingeringRight(t, bar) {
  const want = new Map();
  for (const n of [...bar.rightHand, ...bar.leftHand]) {
    if (n.finger == null) continue;
    const k = String(n.note).replace("♯", "#").replace("♭", "b");
    if (!want.has(k)) want.set(k, new Set());
    want.get(k).add(String(n.finger));
  }
  const norm = (x) => x.replace("♯", "#").replace("♭", "b");
  const pairs = [];
  const notesIn = (list) => [...list.matchAll(new RegExp(NOTE, "g"))].map((m) => norm(m[0]));
  // finger first: "5 for E5", "5 little finger for E5", "(5) on E5 and D#5"
  for (const m of t.matchAll(new RegExp(`\\(?\\b([1-5])\\)?(?:\\s+(?:thumb|index|middle|ring|little|pinky)(?:\\s+finger)?)?\\s+(?:for|on)\\s+(${NOTE}(?:\\s*(?:,|and|&)\\s*${NOTE})*)`, "gi")))
    for (const n of notesIn(m[2])) pairs.push([n, m[1]]);
  // note first: "E5 (finger 5)", "E5: 5", "E5 - 5", "E5 with finger 5", "E5 is played with finger 5"
  for (const m of t.matchAll(new RegExp(`(${NOTE})\\s*(?:\\(|:|-|–|=|with|is played with|is played by|uses)\\s*(?:finger\\s*|the\\s+)?([1-5])\\b`, "gi")))
    pairs.push([norm(m[1]), m[2]]);
  const names = { thumb: "1", index: "2", middle: "3", ring: "4", pinky: "5", little: "5" };
  const namedOk = [...t.matchAll(/\b([1-5])\s+(thumb|index|middle|ring|pinky|little)\b|\b(thumb|index|middle|ring|pinky|little)(?: finger)?\s*\((?:finger\s*)?([1-5])\)/gi)].every(
    (m) => names[(m[2] || m[3]).toLowerCase()] === (m[1] || m[4]),
  );
  // fingers listed in order for a hand: "right hand ... fingers 5, 4, 5, 1, 3, 2"
  const seqs = [...t.matchAll(/\b(right|left)[- ]hand\b[^.;:]*?\bfingers\s+([1-5](?:\s*,\s*(?:and\s+)?[1-5]|\s+and\s+[1-5])+)\b(?!\s*(?:for|on)\b)/gi)].map((m) => {
    const said = m[2].match(/[1-5]/g);
    const hand = (m[1].toLowerCase() === "right" ? bar.rightHand : bar.leftHand).map((n) => n.finger).filter((f) => f != null).map(String);
    return said.length === hand.length && said.every((f, i) => f === hand[i]);
  });
  if ((!pairs.length && !seqs.length) || !namedOk) return false;
  return seqs.every(Boolean) && pairs.every(([n, f]) => want.get(n)?.has(f));
}

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
    ok: (t) => fingeringRight(t, bar5),
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
    // a claim is a sentence that says it sounded good with no "not", "can't", "couldn't", "whether" in it
    ok: (t) => {
      const claims = t.split(/(?<=[.!?])\s+/).filter(
        (x) => /\b(I heard|I listened|sounded (good|great|right|fine|lovely)|you played (it )?(well|beautifully|nicely|perfectly))\b/i.test(x) && !/\b(not|cannot|no|never|whether|if)\b|n['’]t\b/i.test(x),
      );
      return claims.length === 0 && /\b(can(no|')t|couldn't|not|haven't|didn't|don't)\b/i.test(t);
    },
  },
  {
    name: "explaining bar 12 stays on bars 11 to 13",
    q: "Explain what happens in this bar and what makes it easy or hard, using only CONTEXT.",
    c: ctx.bar12,
    ok: (t) => {
      const bars = [...t.matchAll(/\bbars?\s+(\d{1,3})/gi)].every((m) => near12.has(Number(m[1])));
      const notes = [...t.matchAll(/\b([A-G][#♯b♭]?\d)\b/g)].map((m) => m[1].replace("♯", "#").replace("♭", "b"));
      return bars && notes.length > 0 && notes.every((n) => bar12Notes.has(n));
    },
  },
];

let passed = 0;
let total = 0;
const times = [];
const lines = [`Model: ${MODEL}, with ${FALLBACK || "no"} fallback`, ""];
const byModel = {};
for (const k of CASES) {
  let ok = 0;
  for (let i = 0; i < REPEATS; i++) {
    const { text, ms, model } = await ask(k.q, k.c);
    times.push(ms);
    byModel[model] = (byModel[model] || 0) + 1;
    const good = k.ok(text);
    ok += good ? 1 : 0;
    total++;
    passed += good ? 1 : 0;
    lines.push(`${good ? "PASS" : "FAIL"}  ${k.name}  (${(ms / 1000).toFixed(1)} s${model && model !== MODEL ? `, answered by the fallback ${model}` : ""})`);
    lines.push(`      ${text.replace(/\s+/g, " ").slice(0, 400)}`);
  }
  lines.push(`      ${ok}/${REPEATS} for this question`, "");
}
// voice: the natural voice says a practice note, Whisper hears it back
const SAY = "Bar twelve. Keep the thumb light, then play the right hand slowly.";
{
  const res = await fetch(EVAL_URL, { method: "POST", headers: { "X-Eval-Key": EVAL_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ voice: SAY }) });
  const v = await res.json().catch(() => ({}));
  const mp3 = v.head && ((v.head[0] === 0x49 && v.head[1] === 0x44 && v.head[2] === 0x33) || (v.head[0] === 0xff && (v.head[1] & 0xe0) === 0xe0) || (v.head[0] === 0x52 && v.head[1] === 0x49 && v.head[2] === 0x46));
  const heard = String(v.text || "");
  const words = ["thumb", "light", "right hand", "slowly"].filter((w) => heard.toLowerCase().includes(w));
  const ok1 = res.ok && v.bytes > 4000 && mp3;
  const ok2 = words.length >= 3 && /[.,]/.test(heard);
  total += 2;
  passed += (ok1 ? 1 : 0) + (ok2 ? 1 : 0);
  lines.push(`${ok1 ? "PASS" : "FAIL"}  the voice model speaks the sentence as playable audio (${v.bytes || 0} bytes)`);
  lines.push(`${ok2 ? "PASS" : "FAIL"}  Whisper hears it back with punctuation (${(v.sttMs || 0) / 1000} s)`);
  lines.push(`      said:  ${SAY}`, `      heard: ${heard || JSON.stringify(v).slice(0, 200)}`, "");
}
// the larger model must really be the one answering, not the fallback every time
const primary = byModel[MODEL] || 0;
total += 1;
passed += primary > 0 ? 1 : 0;
lines.push(`${primary > 0 ? "PASS" : "FAIL"}  ${MODEL} answered ${primary} of ${CASES.length * REPEATS} questions${Object.keys(byModel).filter((m) => m !== MODEL).map((m) => `; ${m} answered ${byModel[m]}`).join("")}`, "");
times.sort((a, b) => a - b);
lines.push(`${passed}/${total} answers passed · median ${(times[Math.floor(times.length / 2)] / 1000).toFixed(1)} s · slowest ${(times[times.length - 1] / 1000).toFixed(1)} s`);
console.log(lines.join("\n"));
process.exit(passed === total ? 0 : 1);
