/* Lune's morning email.
 *
 * Pianists who turn it on (Settings, or "Email me each morning" after Lune
 * plans their week) get one email a day at about 7 am in their own time zone:
 * today's practice from their week plan, the bars due back, and a short note
 * written by Lune AI from those facts. Every email carries List-Unsubscribe
 * and List-Unsubscribe-Post headers, so Gmail shows its own "Unsubscribe"
 * beside the sender and one tap turns it off, no sign-in needed.
 *
 * It does nothing until two secrets are set on the worker:
 *   RESEND_API_KEY            sending (Resend, with lune.page verified)
 *   SUPABASE_SERVICE_ROLE_KEY reading the accounts that turned it on
 */
import { runModel, british } from "./index.js";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const MAX_PER_RUN = 90; // Resend's free plan sends 100 a day
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function admin(env) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
}
const publicUrl = (env) => String(env.PUBLIC_URL || "https://lune-ai.verushkapatel4.workers.dev").replace(/\/$/, "");

/** The hour, the date and the weekday where the pianist lives. */
export function localNow(tz, now = new Date()) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz || "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(now);
  }
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { hour: Number(get("hour")), date: `${get("year")}-${get("month")}-${get("day")}`, day: String(get("weekday")).slice(0, 3) };
}

/** Today's items from the saved week plan, if there is one for this week. */
export function todayFromPlan(prefs, day) {
  const plan = prefs?.weekPlan;
  if (!plan || !Array.isArray(plan.days)) return { goal: "", items: [] };
  const today = plan.days.find((d) => d.day === day);
  return { goal: String(plan.goal || ""), items: (today?.items || []).map((i) => String(i.text || "").trim()).filter(Boolean).slice(0, 5) };
}

/** The facts for one pianist, read with the service key. */
async function factsFor(env, row, fetchImpl, now) {
  const base = env.SUPABASE_URL;
  const h = admin(env);
  const id = encodeURIComponent(row.user_id);
  const [user, profile, pieces, due] = await Promise.all([
    fetchImpl(`${base}/auth/v1/admin/users/${id}`, { headers: h }).then((r) => (r.ok ? r.json() : null)),
    fetchImpl(`${base}/rest/v1/profiles?id=eq.${id}&select=display_name,prefs`, { headers: h }).then((r) => (r.ok ? r.json() : [])),
    fetchImpl(`${base}/rest/v1/repertoire?user_id=eq.${id}&status=neq.ready&select=title,composer&order=last_practised_at.desc.nullslast&limit=4`, { headers: h }).then((r) => (r.ok ? r.json() : [])),
    fetchImpl(`${base}/rest/v1/bar_cards?user_id=eq.${id}&due_at=lte.${encodeURIComponent(now.toISOString())}&select=piece_key,bar&order=due_at.asc&limit=8`, { headers: h }).then((r) => (r.ok ? r.json() : [])),
  ]);
  const email = user?.email || user?.user?.email || "";
  const prof = profile?.[0] || {};
  return { email, name: String(prof.display_name || "").split(/\s+/)[0] || "", prefs: prof.prefs || {}, pieces: pieces || [], due: due || [] };
}

/** A short note from Lune AI, written only from the facts; a plain one if the model is resting. */
async function noteFor(env, facts, today, local) {
  const plain = today.items.length
    ? `Today is ${DAY_NAMES[local.day] || "a practice day"}. Start with the first task below while your hands are fresh, slowly, then come back to it at the end.`
    : facts.due.length
      ? "No plan for today, so start with the bars that are due back: slowly, hands separately, then together."
      : "A free day. Play something you love for ten minutes, then open the piece you are learning and fix the first bar that breaks.";
  try {
    const { text } = await runModel(
      env,
      [
        {
          role: "system",
          content:
            "You are Lune AI, a warm, precise piano teacher, writing a pianist's morning practice email. Use only the FACTS. Two or three short sentences, British spelling, no greeting line, no sign-off, no lists, no markdown. Encourage, then give one concrete tip for today's first task.",
        },
        { role: "user", content: `FACTS: ${JSON.stringify({ day: DAY_NAMES[local.day], goal: today.goal, today: today.items, barsDue: facts.due.map((d) => `${d.piece_key} bar ${d.bar}`), pieces: facts.pieces.map((p) => p.title) })}` },
      ],
      { maxTokens: 180 }
    );
    const t = british(text).replace(/[*#_`]/g, "").trim();
    return t.length > 20 && t.length < 800 ? t : plain;
  } catch {
    return plain;
  }
}

export function renderEmail({ name, local, today, due, pieces, note, unsubscribeUrl }) {
  const dayName = DAY_NAMES[local.day] || "Today";
  const items = today.items.length ? today.items : due.length ? [`Bars due back: ${due.map((d) => d.bar).slice(0, 6).join(", ")}`] : pieces.length ? [`Play through ${pieces[0].title} once, then fix the first bar that breaks`] : ["Open a piece you love and play it slowly, once"];
  const subject = today.items.length ? `${dayName}: ${items[0].slice(0, 60)}` : `${dayName} at the piano`;
  const serif = "'EB Garamond', Garamond, Georgia, 'Times New Roman', serif";
  const html = `<!doctype html><html lang="en-GB"><body style="margin:0;padding:0;background:#f4f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f6;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;">
<tr><td style="padding:36px 36px 8px;font-family:${serif};color:#16244a;font-size:14px;letter-spacing:4px;text-transform:uppercase;">&#9790; Lune</td></tr>
<tr><td style="padding:8px 36px 0;font-family:${serif};color:#111114;font-size:30px;line-height:1.15;">${name ? `Good morning, ${esc(name)}.` : "Good morning."}</td></tr>
<tr><td style="padding:14px 36px 0;font-family:${serif};color:#3a3a40;font-size:18px;line-height:1.55;">${esc(note)}</td></tr>
<tr><td style="padding:24px 36px 0;font-family:${serif};color:#22386e;font-size:15px;font-style:italic;">${esc(dayName)}${today.goal ? ` · towards: ${esc(today.goal)}` : ""}</td></tr>
<tr><td style="padding:8px 36px 0;">${items
    .map((t, i) => `<p style="margin:0;padding:12px 0;border-top:1px solid #ececf0;font-family:${serif};color:#111114;font-size:18px;line-height:1.45;"><span style="color:#9fb2e4;font-style:italic;">${i + 1}&nbsp;&nbsp;</span>${esc(t)}</p>`)
    .join("")}</td></tr>
<tr><td style="padding:26px 36px 36px;"><a href="https://lune.page/#/repertoire" style="display:inline-block;background:#111114;color:#ffffff;text-decoration:none;font-family:${serif};font-size:17px;padding:12px 26px;border-radius:999px;">Open today’s practice</a></td></tr>
</table>
<p style="max-width:560px;margin:18px auto 0;font-family:${serif};color:#8a8a93;font-size:13px;line-height:1.5;">You get this because you turned on Lune’s morning email. <a href="${esc(unsubscribeUrl)}" style="color:#8a8a93;">Unsubscribe</a> any time, or use Unsubscribe beside the sender in Gmail.</p>
</td></tr></table></body></html>`;
  const text = `${name ? `Good morning, ${name}.` : "Good morning."}\n\n${note}\n\n${dayName}${today.goal ? ` · towards: ${today.goal}` : ""}\n${items.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\nOpen today's practice: https://lune.page/#/repertoire\n\nUnsubscribe: ${unsubscribeUrl}`;
  return { subject, html, text };
}

/** The check-ins for a teacher's homework, newest first (service key; the table is closed to everyone else). */
async function checkinsFor(env, ids, fetchImpl) {
  const ok = ids.filter((x) => /^[A-Za-z0-9]{8,24}$/.test(String(x))).slice(0, 100);
  if (!ok.length) return [];
  const r = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/assignment_checkins?assignment_id=in.(${ok.join(",")})&select=assignment_id,who,ratings,created_at&order=created_at.desc&limit=400`, { headers: admin(env) });
  return r.ok ? r.json() : [];
}

/** The teacher's pre-lesson summary: each student's week, the bars still hard, the homework not yet touched. */
export function renderTeacherEmail({ name, local, studio, checkins, now = new Date(), unsubscribeUrl }) {
  const students = Array.isArray(studio.students) ? studio.students : [];
  const assignments = Array.isArray(studio.assignments) ? studio.assignments : [];
  if (!students.length && !assignments.length) return null;
  const weekAgo = now.getTime() - 7 * 86400000;
  const first = (n) => String(n || "").split(/[,\s]/)[0];
  const lines = [];
  for (const s of students) {
    const mine = assignments.filter((a) => a.sid === s.id);
    if (!mine.length) continue;
    const rows = checkins.filter((c) => mine.some((a) => a.id === c.assignment_id));
    const days = new Set(rows.filter((r) => Date.parse(r.created_at) > weekAgo).map((r) => String(r.created_at).slice(0, 10))).size;
    const last = {};
    for (const r of [...rows].reverse()) for (const [b, g] of Object.entries(r.ratings || {})) last[b] = String(g);
    const hard = Object.entries(last).filter(([, g]) => /again|hard/i.test(g)).map(([b]) => b);
    const good = Object.entries(last).filter(([, g]) => !/again|hard/i.test(g)).map(([b]) => b);
    const piece = mine[0].t;
    lines.push({
      who: s.name,
      line: rows.length
        ? `${days} ${days === 1 ? "day" : "days"} of practice this week on ${piece}.${hard.length ? ` Start with ${hard.length === 1 ? "bar" : "bars"} ${hard.join(", ")}: still hard.` : ""}${good.length ? ` ${good.length === 1 ? "Bar" : "Bars"} ${good.join(", ")} now feel good.` : ""}`
        : `Hasn’t opened the homework on ${piece} yet. Check the link works on their phone.`,
    });
  }
  if (!lines.length) return null;
  const serif = "'EB Garamond', Garamond, Georgia, 'Times New Roman', serif";
  const dayName = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" }[local.day] || "Today";
  const subject = `Before your lessons: ${lines.length} ${lines.length === 1 ? "student" : "students"}`;
  const html = `<!doctype html><html lang="en-GB"><body style="margin:0;padding:0;background:#f4f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f6;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;">
<tr><td style="padding:36px 36px 8px;font-family:${serif};color:#16244a;font-size:14px;letter-spacing:4px;text-transform:uppercase;">&#9790; Lune · Studio</td></tr>
<tr><td style="padding:8px 36px 0;font-family:${serif};color:#111114;font-size:30px;line-height:1.15;">${name ? `Good ${local.hour < 12 ? "morning" : local.hour < 18 ? "afternoon" : "evening"}, ${esc(name)}.` : "Before your lessons."}</td></tr>
<tr><td style="padding:10px 36px 0;font-family:${serif};color:#3a3a40;font-size:18px;line-height:1.55;">Here is where each student stands this ${esc(dayName)}.</td></tr>
<tr><td style="padding:14px 36px 0;">${lines
    .map((l) => `<p style="margin:0;padding:14px 0;border-top:1px solid #ececf0;font-family:${serif};color:#111114;font-size:18px;line-height:1.45;"><strong style="font-weight:600;">${esc(first(l.who))}</strong><br><span style="color:#3a3a40;">${esc(l.line)}</span></p>`)
    .join("")}</td></tr>
<tr><td style="padding:24px 36px 36px;"><a href="https://lune.page/" style="display:inline-block;background:#111114;color:#ffffff;text-decoration:none;font-family:${serif};font-size:17px;padding:12px 26px;border-radius:999px;">Open your Studio</a></td></tr>
</table>
<p style="max-width:560px;margin:18px auto 0;font-family:${serif};color:#8a8a93;font-size:13px;line-height:1.5;">You get this because you turned on Lune’s pre-lesson summary. <a href="${esc(unsubscribeUrl)}" style="color:#8a8a93;">Unsubscribe</a> any time.</p>
</td></tr></table></body></html>`;
  const text = `Before your lessons.\n\n${lines.map((l) => `${first(l.who)}: ${l.line}`).join("\n\n")}\n\nOpen your Studio: https://lune.page/\n\nUnsubscribe: ${unsubscribeUrl}`;
  return { subject, html, text };
}

/** Each hour: everyone whose morning it is, once a day. */
export async function sendMorningEmails(env, fetchImpl = fetch, now = new Date()) {
  if (!env.RESEND_API_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) return { sent: 0, skipped: "not configured" };
  const h = admin(env);
  let res = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/daily_emails?enabled=eq.true&select=user_id,send_hour,tz,token,last_sent,kind,days&limit=2000`, { headers: h });
  // before the kind and days columns exist
  if (!res.ok) res = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/daily_emails?enabled=eq.true&select=user_id,send_hour,tz,token,last_sent&limit=2000`, { headers: h });
  if (!res.ok) return { sent: 0, skipped: `list ${res.status}` };
  const rows = await res.json();
  let sent = 0;
  for (const row of rows) {
    if (sent >= MAX_PER_RUN) break;
    const local = localNow(row.tz, now);
    if (local.hour !== Number(row.send_hour ?? 7) || row.last_sent === local.date) continue;
    const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(local.day);
    if (Array.isArray(row.days) && row.days.length && !row.days.map(Number).includes(dayIndex)) continue;
    try {
      const facts = await factsFor(env, row, fetchImpl, now);
      if (!facts.email) continue;
      const unsubscribeUrl = `${publicUrl(env)}/unsubscribe?t=${encodeURIComponent(row.token)}`;
      let mail;
      if (row.kind === "teacher") {
        const studio = facts.prefs?.teacherStudio || {};
        const checkins = await checkinsFor(env, (studio.assignments || []).map((a) => a.id), fetchImpl);
        mail = renderTeacherEmail({ name: facts.prefs?.teacherName || facts.name, local, studio, checkins, now, unsubscribeUrl });
        if (!mail) continue; // nothing to say: no email
      } else {
        const today = todayFromPlan(facts.prefs, local.day);
        const note = await noteFor(env, facts, today, local);
        mail = renderEmail({ name: facts.name, local, today, due: facts.due, pieces: facts.pieces, note, unsubscribeUrl });
      }
      const out = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: env.DAILY_FROM || "Lune <today@lune.page>",
          to: [facts.email],
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        }),
      });
      if (!out.ok) continue;
      sent++;
      await fetchImpl(`${env.SUPABASE_URL}/rest/v1/daily_emails?user_id=eq.${encodeURIComponent(row.user_id)}`, {
        method: "PATCH",
        headers: { ...h, Prefer: "return=minimal" },
        body: JSON.stringify({ last_sent: local.date, updated_at: now.toISOString() }),
      });
    } catch {
      /* one pianist's failure never stops the rest */
    }
  }
  return { sent };
}

const page = (title, body) =>
  new Response(
    `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — Lune</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#f5f5f7;font-family:'EB Garamond',Garamond,Georgia,serif;text-align:center;padding:24px;box-sizing:border-box;">
<main style="max-width:420px;"><p style="letter-spacing:4px;font-size:13px;color:#9fb2e4;">&#9790; LUNE</p><h1 style="font-weight:400;font-size:34px;margin:10px 0 12px;">${esc(title)}</h1>${body}</main></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );

/**
 * GET shows a confirm button (mail scanners open links, and must not
 * unsubscribe anyone); POST, from that button or from Gmail's one-click
 * Unsubscribe, turns the email off.
 */
export async function unsubscribe(req, env, fetchImpl = fetch) {
  const url = new URL(req.url);
  const t = url.searchParams.get("t") || "";
  if (!/^[0-9a-f-]{36}$/i.test(t)) return page("That link has expired", `<p style="color:#a1a1aa;">Turn the morning email off in Lune’s Settings instead.</p>`);
  if (req.method === "GET") {
    return page(
      "Stop the morning email?",
      `<p style="color:#a1a1aa;font-size:18px;">You won’t get today’s practice by email any more. You can turn it back on in Lune’s Settings.</p>
<form method="post" action="/unsubscribe?t=${esc(t)}"><button style="margin-top:18px;font:inherit;font-size:17px;padding:12px 26px;border-radius:999px;border:0;background:#f5f5f7;color:#000;cursor:pointer;">Unsubscribe</button></form>`
    );
  }
  if (req.method !== "POST" || !env.SUPABASE_SERVICE_ROLE_KEY) return page("Something went wrong", `<p style="color:#a1a1aa;">Turn the morning email off in Lune’s Settings instead.</p>`);
  await fetchImpl(`${env.SUPABASE_URL}/rest/v1/daily_emails?token=eq.${encodeURIComponent(t)}`, {
    method: "PATCH",
    headers: { ...admin(env), Prefer: "return=minimal" },
    body: JSON.stringify({ enabled: false, updated_at: new Date().toISOString() }),
  });
  return page("You’re unsubscribed", `<p style="color:#a1a1aa;font-size:18px;">No more morning emails. Your practice, plans and pieces in Lune are just as they were.</p><p><a href="https://lune.page" style="color:#9fb2e4;">Back to Lune</a></p>`);
}
