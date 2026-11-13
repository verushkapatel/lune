/* Homework by email, on the teacher's schedule.
 *
 * In the Studio a teacher may add a student's (or a parent's) email and say
 * when Lune should send that student their latest homework: every day, or on
 * chosen days, at an hour in the teacher's time zone. Each hour this sends the
 * ones that are due. The teacher can also send it at once ("Email it now").
 *
 * The homework itself is the teacher's newest assignment for that student,
 * read from the teacher's own saved Studio (never from the request), and the
 * link in the email is the same lune.page homework link the teacher shares.
 * Every email carries a one-tap unsubscribe that needs no sign-in.
 */
import { admin, localNow, checkinsFor, publicUrl, esc } from "./daily.js";

const MAX_PER_RUN = 40;
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const GOALS = { clean3: "Three clean in a row", full: "Perfect it at full tempo", daily: "Play it every day" };
const first = (n) => String(n || "").split(/[,\s]/)[0].trim();
const barText = (bars) => {
  const b = (Array.isArray(bars) ? bars : []).map(Number).filter(Number.isFinite);
  if (!b.length) return "";
  if (b.length === 1) return `bar ${b[0]}`;
  const run = b[b.length - 1] - b[0] === b.length - 1;
  return `bars ${run ? `${b[0]}–${b[b.length - 1]}` : b.join(", ")}`;
};
const safeLink = (u) => (/^https:\/\/lune\.page\//.test(String(u || "")) ? String(u) : "https://lune.page/");

/** The teacher's newest homework for one student, from their saved Studio. */
export function latestFor(studio, studentKey) {
  const list = (Array.isArray(studio?.assignments) ? studio.assignments : []).filter((a) => a && a.sid === studentKey);
  list.sort((x, y) => String(y.at || "").localeCompare(String(x.at || "")));
  return list[0] || null;
}

export function renderHomeworkEmail({ student, teacher, a, daily, practised = 0, unsubscribeUrl }) {
  const who = first(student);
  const by = String(teacher || "").trim() || "Your teacher";
  const bars = barText(a.bars);
  const piece = String(a.t || "Your piece");
  const link = safeLink(a.url);
  const subject = daily ? `Today’s practice: ${piece}, ${bars}` : `Homework from ${by}: ${piece}, ${bars}`;
  const lead = daily
    ? `Here is today’s practice from ${by}.`
    : `${by} has set your homework for this week.`;
  const facts = [
    a.tb ? `Target tempo: ${a.tb}` : "",
    a.goal ? `Goal: ${GOALS[a.goal] || a.goal}` : "",
    practised ? `You’ve practised it ${practised === 1 ? "once" : `${practised} times`} so far. ${by} can see how it’s going.` : "",
  ].filter(Boolean);
  const serif = "'EB Garamond', Garamond, Georgia, 'Times New Roman', serif";
  const html = `<!doctype html><html lang="en-GB"><body style="margin:0;padding:0;background:#f4f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f6;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;">
<tr><td style="padding:36px 36px 8px;font-family:${serif};color:#16244a;font-size:14px;letter-spacing:4px;text-transform:uppercase;">&#9790; Lune</td></tr>
<tr><td style="padding:8px 36px 0;font-family:${serif};color:#111114;font-size:30px;line-height:1.15;">${who ? `Hi ${esc(who)},` : "Hello,"}</td></tr>
<tr><td style="padding:12px 36px 0;font-family:${serif};color:#3a3a40;font-size:18px;line-height:1.55;">${esc(lead)}</td></tr>
<tr><td style="padding:22px 36px 0;"><div style="border-radius:14px;background:#f4f5fa;padding:18px 20px;">
<p style="margin:0;font-family:${serif};color:#111114;font-size:24px;line-height:1.2;">${esc(piece)}</p>
<p style="margin:4px 0 0;font-family:${serif};color:#22386e;font-size:17px;font-style:italic;">${esc(bars.charAt(0).toUpperCase() + bars.slice(1))}${a.c ? ` · ${esc(a.c)}` : ""}</p>
${a.m ? `<p style="margin:14px 0 0;font-family:${serif};color:#3a3a40;font-size:17px;line-height:1.5;">“${esc(a.m)}”<br><span style="color:#8a8a93;font-size:15px;">— ${esc(by)}</span></p>` : ""}
</div></td></tr>
${facts.length ? `<tr><td style="padding:14px 36px 0;">${facts.map((f) => `<p style="margin:0;padding:8px 0;border-top:1px solid #ececf0;font-family:${serif};color:#3a3a40;font-size:16px;">${esc(f)}</p>`).join("")}</td></tr>` : ""}
<tr><td style="padding:24px 36px 8px;"><a href="${esc(link)}" style="display:inline-block;background:#111114;color:#ffffff;text-decoration:none;font-family:${serif};font-size:17px;padding:12px 26px;border-radius:999px;">Open your homework</a></td></tr>
<tr><td style="padding:6px 36px 34px;font-family:${serif};color:#8a8a93;font-size:15px;line-height:1.5;">Lune shows just these bars, plays them for you, and lets ${esc(by)} know when you’ve practised. No account needed.</td></tr>
</table>
<p style="max-width:560px;margin:18px auto 0;font-family:${serif};color:#8a8a93;font-size:13px;line-height:1.5;">You get this because ${esc(by)} added this address in Lune for piano homework. <a href="${esc(unsubscribeUrl)}" style="color:#8a8a93;">Unsubscribe</a> any time.</p>
</td></tr></table></body></html>`;
  const text = `${who ? `Hi ${who},` : "Hello,"}\n\n${lead}\n\n${piece}, ${bars}${a.c ? ` (${a.c})` : ""}\n${a.m ? `\n"${a.m}" — ${by}\n` : ""}${facts.length ? `\n${facts.join("\n")}\n` : ""}\nOpen your homework: ${link}\n\nUnsubscribe: ${unsubscribeUrl}`;
  return { subject, html, text };
}

async function teacherFacts(env, teacherId, fetchImpl) {
  const r = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(teacherId)}&select=display_name,prefs`, { headers: admin(env) });
  const p = (r.ok ? await r.json() : [])[0] || {};
  const prefs = p.prefs || {};
  return { studio: prefs.teacherStudio || {}, teacher: String(prefs.teacherName || p.display_name || "").trim() };
}

async function sendOne(env, row, fetchImpl, { daily }) {
  const { studio, teacher } = await teacherFacts(env, row.teacher_id, fetchImpl);
  const a = latestFor(studio, row.student_key);
  if (!a) return { ok: false, error: "There’s no homework for this student yet. Send some from a score first." };
  const rows = await checkinsFor(env, [a.id], fetchImpl).catch(() => []);
  const unsubscribeUrl = `${publicUrl(env)}/homework/unsubscribe?t=${encodeURIComponent(row.token)}`;
  const mail = renderHomeworkEmail({ student: row.student_name, teacher, a, daily, practised: rows.length, unsubscribeUrl });
  const out = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.HOMEWORK_FROM || `${teacher ? `${teacher.replace(/[<>"]/g, "").slice(0, 40)} via Lune` : "Lune"} <homework@lune.page>`,
      to: [row.email],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    }),
  });
  return out.ok ? { ok: true } : { ok: false, error: "The email service didn’t take it. Try again in a moment." };
}

/** Each hour: every student whose homework time it is, once a day. */
export async function sendHomeworkEmails(env, fetchImpl = fetch, now = new Date()) {
  if (!env.RESEND_API_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) return { sent: 0, skipped: "not configured" };
  const h = admin(env);
  const res = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/homework_mail?enabled=eq.true&select=teacher_id,student_key,student_name,email,days,send_hour,tz,token,last_sent&limit=2000`, { headers: h });
  if (!res.ok) return { sent: 0, skipped: `list ${res.status}` };
  let sent = 0;
  for (const row of await res.json()) {
    if (sent >= MAX_PER_RUN) break;
    const local = localNow(row.tz, now);
    if (local.hour !== Number(row.send_hour ?? 17) || row.last_sent === local.date) continue;
    const days = Array.isArray(row.days) && row.days.length ? row.days.map(Number) : [1];
    if (!days.includes(DAY.indexOf(local.day))) continue;
    try {
      const r = await sendOne(env, row, fetchImpl, { daily: days.length >= 5 });
      if (!r.ok) continue;
      sent++;
      await fetchImpl(`${env.SUPABASE_URL}/rest/v1/homework_mail?teacher_id=eq.${encodeURIComponent(row.teacher_id)}&student_key=eq.${encodeURIComponent(row.student_key)}`, {
        method: "PATCH",
        headers: { ...h, Prefer: "return=minimal" },
        body: JSON.stringify({ last_sent: local.date, updated_at: now.toISOString() }),
      });
    } catch {
      /* one student's failure never stops the rest */
    }
  }
  return { sent };
}

/** "Email it now", from the Studio: the signed-in teacher, one of their own students. */
export async function sendHomeworkNow(env, user, body, fetchImpl = fetch) {
  if (!env.RESEND_API_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) return { status: 503, body: { ok: false, error: "Homework emails aren’t switched on yet." } };
  const key = String(body?.student || "");
  if (!/^[a-z0-9]{6,24}$/.test(key)) return { status: 400, body: { ok: false, error: "Choose a student first." } };
  const r = await fetchImpl(
    `${env.SUPABASE_URL}/rest/v1/homework_mail?teacher_id=eq.${encodeURIComponent(user.id)}&student_key=eq.${encodeURIComponent(key)}&select=teacher_id,student_key,student_name,email,token,enabled`,
    { headers: admin(env) }
  );
  const row = (r.ok ? await r.json() : [])[0];
  if (!row) return { status: 404, body: { ok: false, error: "Add this student’s email first." } };
  if (!row.enabled) return { status: 409, body: { ok: false, error: "This student unsubscribed from homework emails." } };
  const out = await sendOne(env, row, fetchImpl, { daily: false });
  return { status: out.ok ? 200 : 502, body: out };
}

const page = (title, body) =>
  new Response(
    `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — Lune</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#f5f5f7;font-family:'EB Garamond',Garamond,Georgia,serif;text-align:center;padding:24px;box-sizing:border-box;">
<main style="max-width:420px;"><p style="letter-spacing:4px;font-size:13px;color:#9fb2e4;">&#9790; LUNE</p><h1 style="font-weight:400;font-size:34px;margin:10px 0 12px;">${esc(title)}</h1>${body}</main></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );

/** GET asks first (mail scanners open links); POST, or Gmail's one-click, turns it off. */
export async function homeworkUnsubscribe(req, env, fetchImpl = fetch) {
  const t = new URL(req.url).searchParams.get("t") || "";
  if (!/^[0-9a-f-]{36}$/i.test(t)) return page("That link has expired", `<p style="color:#a1a1aa;">Ask your teacher to stop the homework emails.</p>`);
  if (req.method === "GET") {
    return page(
      "Stop homework emails?",
      `<p style="color:#a1a1aa;font-size:18px;">You won’t get piano homework by email any more. Your teacher can still share it with you another way.</p>
<form method="post" action="/homework/unsubscribe?t=${esc(t)}"><button style="margin-top:18px;font:inherit;font-size:17px;padding:12px 26px;border-radius:999px;border:0;background:#f5f5f7;color:#000;cursor:pointer;">Unsubscribe</button></form>`
    );
  }
  if (req.method !== "POST" || !env.SUPABASE_SERVICE_ROLE_KEY) return page("Something went wrong", `<p style="color:#a1a1aa;">Ask your teacher to stop the homework emails.</p>`);
  await fetchImpl(`${env.SUPABASE_URL}/rest/v1/homework_mail?token=eq.${encodeURIComponent(t)}`, {
    method: "PATCH",
    headers: { ...admin(env), Prefer: "return=minimal" },
    body: JSON.stringify({ enabled: false, updated_at: new Date().toISOString() }),
  });
  return page("You’re unsubscribed", `<p style="color:#a1a1aa;font-size:18px;">No more homework emails.</p><p><a href="https://lune.page" style="color:#9fb2e4;">Lune</a></p>`);
}
