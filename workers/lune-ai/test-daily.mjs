// Tests for the morning email. Run: node workers/lune-ai/test-daily.mjs
import { localNow, todayFromPlan, renderEmail, sendMorningEmails, unsubscribe } from "./src/daily.js";
import { handle } from "./src/index.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  daily: ${name}${ok ? "" : `  (${detail})`}`); };

// time zones: 06:00 UTC on 13 Nov 2026 is 07:00 in Paris, 06:00 in London
const t = new Date("2026-11-13T06:00:00Z");
check("local hour in Paris", localNow("Europe/Paris", t).hour === 7, JSON.stringify(localNow("Europe/Paris", t)));
check("local weekday", localNow("Europe/London", t).day === "Fri");
check("bad zone falls back", localNow("Not/AZone", t).hour === 6);

const prefs = { weekPlan: { goal: "Clair de lune to bar 27", days: [{ day: "Fri", items: [{ text: "Bars 15 to 18, hands separately" }, { text: "Play bars 1 to 14 once" }] }] } };
const today = todayFromPlan(prefs, "Fri");
check("today's items from the plan", today.items.length === 2 && today.goal.includes("Clair"));
check("no plan, no items", todayFromPlan({}, "Fri").items.length === 0);

const mail = renderEmail({ name: "Ada", local: { day: "Fri", date: "2026-11-13", hour: 7 }, today, due: [], pieces: [], note: "Keep the wrist loose <today>.", unsubscribeUrl: "https://x.test/unsubscribe?t=abc" });
check("subject names the day and first task", mail.subject.startsWith("Friday: Bars 15"), mail.subject);
check("html escapes the note", mail.html.includes("&lt;today&gt;") && !mail.html.includes("<today>"));
check("html carries the unsubscribe link", mail.html.includes("https://x.test/unsubscribe?t=abc"));
check("plain text version", mail.text.includes("1. Bars 15 to 18") && mail.text.includes("Unsubscribe:"));

// inert without secrets
check("does nothing without secrets", (await sendMorningEmails({ SUPABASE_URL: "https://s.test" })).skipped === "not configured");

// a full run with fake Supabase and Resend
const sent = [], patched = [];
const token = "11111111-2222-3333-4444-555555555555";
const fakeFetch = async (url, opts = {}) => {
  const u = String(url);
  const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  if (u.includes("/rest/v1/daily_emails?enabled")) return ok([
    { user_id: "u1", send_hour: 7, tz: "Europe/Paris", token, last_sent: null },
    { user_id: "u2", send_hour: 7, tz: "Europe/London", token, last_sent: null }, // 6 am there: not yet
    { user_id: "u3", send_hour: 7, tz: "Europe/Paris", token, last_sent: "2026-11-13" }, // already sent today
  ]);
  if (u.includes("/auth/v1/admin/users/u1")) return ok({ email: "ada@example.com" });
  if (u.includes("/rest/v1/profiles")) return ok([{ display_name: "Ada Lovelace", prefs }]);
  if (u.includes("/rest/v1/repertoire")) return ok([{ title: "Clair de lune" }]);
  if (u.includes("/rest/v1/bar_cards")) return ok([{ piece_key: "clair", bar: 15 }]);
  if (u.includes("api.resend.com")) { sent.push(JSON.parse(opts.body)); return ok({ id: "e1" }); }
  if (opts.method === "PATCH") { patched.push({ u, body: JSON.parse(opts.body) }); return new Response(null, { status: 204 }); }
  return new Response("{}", { status: 404 });
};
const env = { SUPABASE_URL: "https://s.test", SUPABASE_SERVICE_ROLE_KEY: "svc", RESEND_API_KEY: "re", AI: { run: async () => ({ response: "Lovely week so far. Start slowly with bar 15 and let the thumb stay light." }) }, MODEL: "m" };
const r = await sendMorningEmails(env, fakeFetch, t);
check("sends only to the pianist whose 7 am it is", r.sent === 1 && sent.length === 1, JSON.stringify(r));
check("addressed to their email", sent[0]?.to?.[0] === "ada@example.com");
check("Gmail one-click unsubscribe headers", sent[0]?.headers?.["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click" && /unsubscribe\?t=/.test(sent[0]?.headers?.["List-Unsubscribe"] || ""));
check("greets by first name", sent[0]?.html.includes("Good morning, Ada."));
check("marks it sent for today", patched.some((p) => p.body.last_sent === "2026-11-13"));

// unsubscribe: GET asks, POST turns it off
const g = await unsubscribe(new Request(`https://w.test/unsubscribe?t=${token}`), env, fakeFetch);
check("GET shows a confirm button, changes nothing", (await g.text()).includes("<form method=\"post\"") && !patched.some((p) => p.body.enabled === false));
const before = patched.length;
const p = await unsubscribe(new Request(`https://w.test/unsubscribe?t=${token}`, { method: "POST", body: "List-Unsubscribe=One-Click" }), env, fakeFetch);
check("POST (Gmail one-click) turns it off", p.status === 200 && patched.length === before + 1 && patched.at(-1).body.enabled === false && patched.at(-1).u.includes(`token=eq.${token}`));
const bad = await unsubscribe(new Request("https://w.test/unsubscribe?t=../../etc"), env, fakeFetch);
check("rejects a malformed token", (await bad.text()).includes("expired"));
const routed = await handle(new Request(`https://w.test/unsubscribe?t=${token}`), env, fakeFetch);
check("worker routes /unsubscribe", routed.status === 200);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
