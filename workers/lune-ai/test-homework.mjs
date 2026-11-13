// Tests for homework by email. Run: node workers/lune-ai/test-homework.mjs
import { renderHomeworkEmail, latestFor, sendHomeworkEmails, homeworkUnsubscribe } from "./src/homework.js";
import { handle } from "./src/index.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  homework: ${name}${ok ? "" : `  (${detail})`}`); };

const studio = {
  students: [{ id: "meera12345", name: "Meera, Grade 5" }],
  assignments: [
    { id: "OLDaaaaaaa1", sid: "meera12345", t: "Für Elise", bars: [1, 2], at: "2026-11-01T10:00:00Z", url: "https://lune.page/#/a/old" },
    { id: "NEWbbbbbbb2", sid: "meera12345", t: "Clair de lune", c: "Claude Debussy", bars: [3, 4], m: "Loose wrist <please>", tb: "♩. = 40", goal: "clean3", at: "2026-11-10T10:00:00Z", url: "https://lune.page/#/a/new" },
    { id: "OTHERccccc3", sid: "someoneelse", t: "Gymnopédie", bars: [9], at: "2026-11-12T10:00:00Z", url: "https://lune.page/#/a/x" },
  ],
};
check("newest homework for that student", latestFor(studio, "meera12345")?.id === "NEWbbbbbbb2");
check("no homework, null", latestFor(studio, "nobody0000") === null);

const unsub = "https://x.test/homework/unsubscribe?t=abc";
const weekly = renderHomeworkEmail({ student: "Meera, Grade 5", teacher: "Ms Rao", a: studio.assignments[1], daily: false, practised: 2, unsubscribeUrl: unsub });
check("weekly subject names teacher, piece, bars", weekly.subject === "Homework from Ms Rao: Clair de lune, bars 3–4", weekly.subject);
check("greets by first name", weekly.html.includes("Hi Meera,"));
check("teacher's note escaped", weekly.html.includes("Loose wrist &lt;please&gt;") && !weekly.html.includes("<please>"));
check("target and goal shown", weekly.text.includes("Target tempo: ♩. = 40") && weekly.text.includes("Three clean in a row"));
check("progress line", weekly.text.includes("practised it 2 times"));
check("links to the homework", weekly.html.includes("https://lune.page/#/a/new"));
check("carries unsubscribe", weekly.html.includes(unsub) && weekly.text.includes(unsub));
const daily = renderHomeworkEmail({ student: "Aarav", teacher: "", a: { ...studio.assignments[1], url: "https://evil.test/x" }, daily: true, unsubscribeUrl: unsub });
check("daily subject", daily.subject.startsWith("Today’s practice: Clair de lune"), daily.subject);
check("only lune.page links", !daily.html.includes("evil.test") && daily.html.includes("https://lune.page/"));

check("inert without secrets", (await sendHomeworkEmails({ SUPABASE_URL: "https://s.test" })).skipped === "not configured");

// a run: Monday 17:00 in London is due; a Tuesday row and an already-sent row are not
const tok = "11111111-2222-3333-4444-555555555555";
const rows = [
  { teacher_id: "t1", student_key: "meera12345", student_name: "Meera", email: "meera@example.com", days: [1], send_hour: 17, tz: "Europe/London", token: tok, last_sent: null },
  { teacher_id: "t1", student_key: "meera12345", student_name: "Meera", email: "tue@example.com", days: [2], send_hour: 17, tz: "Europe/London", token: tok, last_sent: null },
  { teacher_id: "t1", student_key: "meera12345", student_name: "Meera", email: "done@example.com", days: [1], send_hour: 17, tz: "Europe/London", token: tok, last_sent: "2026-11-16" },
  { teacher_id: "t1", student_key: "nobody0000", student_name: "Nobody", email: "none@example.com", days: [1], send_hour: 17, tz: "Europe/London", token: tok, last_sent: null },
];
const sent = [], patched = [];
const fake = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("/rest/v1/homework_mail?enabled=eq.true")) return new Response(JSON.stringify(rows));
  if (u.includes("/rest/v1/homework_mail?teacher_id=eq.t1&student_key=eq.meera12345&select")) return new Response(JSON.stringify([{ ...rows[0], enabled: true }]));
  if (u.includes("/rest/v1/homework_mail?teacher_id=eq.t1&student_key=eq.other00000&select")) return new Response(JSON.stringify([]));
  if (u.includes("/rest/v1/homework_mail") && init.method === "PATCH") return patched.push({ u, body: JSON.parse(init.body) }), new Response(null, { status: 204 });
  if (u.includes("/rest/v1/profiles")) return new Response(JSON.stringify([{ display_name: "Anika Rao", prefs: { teacherName: "Ms Rao", teacherStudio: studio } }]));
  if (u.includes("/rest/v1/assignment_checkins")) return new Response(JSON.stringify([{ assignment_id: "NEWbbbbbbb2", ratings: {}, created_at: "2026-11-15T10:00:00Z" }]));
  if (u.includes("api.resend.com")) return sent.push(JSON.parse(init.body)), new Response(JSON.stringify({ id: "x" }));
  if (u.includes("/auth/v1/user")) return init.headers?.Authorization === "Bearer good" ? new Response(JSON.stringify({ id: "t1" })) : new Response("{}", { status: 401 });
  return new Response("[]");
};
const env = { SUPABASE_URL: "https://s.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "svc", RESEND_API_KEY: "re", ALLOWED_ORIGINS: "https://lune.page" };
const out = await sendHomeworkEmails(env, fake, new Date("2026-11-16T17:10:00Z"));
check("sends only the due one", out.sent === 1 && sent.length === 1 && sent[0].to[0] === "meera@example.com", JSON.stringify(out) + JSON.stringify(sent.map((s) => s.to)));
check("from the teacher via Lune", sent[0]?.from === "Ms Rao via Lune <homework@lune.page>", sent[0]?.from);
check("one-click unsubscribe header", /homework\/unsubscribe\?t=/.test(sent[0]?.headers?.["List-Unsubscribe"] || ""));
check("marks it sent today", patched[0]?.body?.last_sent === "2026-11-16");
check("wrong hour sends nothing", (await sendHomeworkEmails(env, fake, new Date("2026-11-16T09:10:00Z"))).sent === 0);

// Email it now: signed in, own student only
sent.length = 0;
const call = (auth, body) => handle(new Request("https://w.test/homework/send", { method: "POST", headers: { Origin: "https://lune.page", Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(body) }), env, fake);
check("needs sign-in", (await call("Bearer bad", { student: "meera12345" })).status === 401);
const ok = await call("Bearer good", { student: "meera12345" });
check("sends now", ok.status === 200 && sent.length === 1, String(ok.status));
check("unknown student refused", (await call("Bearer good", { student: "other00000" })).status === 404);
check("bad key refused", (await call("Bearer good", { student: "../x" })).status === 400);

// unsubscribe: GET asks, POST turns it off
const g = await homeworkUnsubscribe(new Request(`https://w.test/homework/unsubscribe?t=${tok}`), env, fake);
check("GET asks first", (await g.text()).includes("Stop homework emails?"));
patched.length = 0;
await homeworkUnsubscribe(new Request(`https://w.test/homework/unsubscribe?t=${tok}`, { method: "POST" }), env, fake);
check("POST turns it off", patched[0]?.body?.enabled === false);
check("bad token", (await (await homeworkUnsubscribe(new Request("https://w.test/homework/unsubscribe?t=nope"), env, fake)).text()).includes("expired"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
