/* Lune — Studio: the teacher's home, and the student or teacher choice.
 *
 * A signed-in pianist is a student or a teacher (chosen at sign-in, changed in
 * Settings). Students keep the practice home. Teachers get the Studio:
 *   - their students (a name and a level; students never need accounts),
 *   - every piece of homework sent, with live status from the zero-login
 *     check-ins (who practised, when, which bars felt hard or good),
 *   - "Prepare next lesson": a three-point plan from Lune AI (or Lune's own
 *     reading when Lune AI is not on),
 *   - the pre-lesson email: which days, what time.
 * The roster and the homework list live in the teacher's own profile, which
 * only they can read; the check-ins come through the two locked functions.
 */
window.LuneStudio = (function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const store = () => window.LuneStore;
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  /* ---------------- role ---------------- */

  let previewRole = null; // review tabs on this computer only; never saved
  function role() {
    if (previewRole) return previewRole;
    return store()?.prefs?.()?.role === "teacher" ? "teacher" : "student";
  }
  function setRole(r) {
    if (previewRole) previewRole = r === "teacher" ? "teacher" : "student";
    store()?.setPref?.("role", r === "teacher" ? "teacher" : "student");
    store()?.syncPrefs?.()?.catch?.(() => {});
    document.body.classList.toggle("is-teacher", r === "teacher");
    window.LuneOnboard?.paintSignedHome?.();
  }

  /* ---------------- the teacher's data ---------------- */

  function data() {
    const d = store()?.prefs?.()?.teacherStudio || {};
    return { students: Array.isArray(d.students) ? d.students : [], assignments: Array.isArray(d.assignments) ? d.assignments : [], email: d.email || { on: false, days: [0], hour: 18 } };
  }
  function save(d) {
    store()?.setPref?.("teacherStudio", { students: d.students.slice(0, 200), assignments: d.assignments.slice(0, 300), email: d.email });
    store()?.syncPrefs?.()?.catch?.(() => {});
  }
  const newId = () => {
    const a = new Uint8Array(9);
    crypto.getRandomValues(a);
    return Array.from(a, (x) => "abcdefghijklmnopqrstuvwxyz0123456789"[x % 36]).join("");
  };
  function addStudent(name) {
    const clean = String(name || "").trim().replace(/\s+/g, " ").slice(0, 60);
    if (!clean) return null;
    const d = data();
    const s = { id: newId(), name: clean, at: new Date().toISOString() };
    d.students.push(s);
    save(d);
    return s;
  }
  function removeStudent(id) {
    const d = data();
    d.students = d.students.filter((s) => s.id !== id);
    save(d);
    if (mailRows.has(id)) {
      mailRows.delete(id);
      Promise.resolve(store()?.removeHomeworkMail?.(id)).catch(() => {});
    }
  }
  function updateStudent(id, name) {
    const clean = String(name || "").trim().replace(/\s+/g, " ").slice(0, 60);
    const d = data();
    const s = d.students.find((x) => x.id === id);
    if (!s || !clean) return null;
    s.name = clean;
    save(d);
    return s;
  }

  /* ---------------- homework by email: each student's address and schedule ---------------- */

  const mailRows = new Map(); // student id → { email, days, send_hour, enabled }
  let mailLoad = null;
  function loadMail(force = false) {
    if (mailLoad && !force) return mailLoad;
    mailLoad = Promise.race([Promise.resolve(store()?.homeworkMail?.()), new Promise((r) => setTimeout(() => r(null), 6000))])
      .then((rows) => {
        if (Array.isArray(rows)) {
          mailRows.clear();
          for (const r of rows) mailRows.set(r.student_key, r);
        }
        return mailRows;
      })
      .catch(() => mailRows);
    return mailLoad;
  }
  const hourText = (h) => (h === 0 ? "midnight" : h === 12 ? "noon" : h < 12 ? `${h} am` : `${h - 12} pm`);
  function scheduleLine(r) {
    if (!r) return "";
    const days = (r.days || [1]).map(Number).sort();
    const at = hourText(Number(r.send_hour ?? 17));
    if (days.length === 7) return `every day at ${at}`;
    if (days.length === 5 && !days.includes(0) && !days.includes(6)) return `on weekdays at ${at}`;
    return `${days.map((d) => `${DAY_NAMES[d]}s`).join(" and ")} at ${at}`.replace(/^/, "on ");
  }
  /** For the homework dialog: may Lune email this student now? */
  function mailFor(sid) {
    const r = mailRows.get(sid);
    if (!r) return null;
    return { email: r.email, enabled: r.enabled !== false, line: r.enabled !== false ? `Lune also emails it ${scheduleLine(r)}` : "" };
  }
  async function setStudentMail(sid, { email, freq, day = 1, hour = 17 }) {
    const st = data().students.find((x) => x.id === sid);
    if (!st) return "That student isn’t in your Studio.";
    const was = mailRows.get(sid);
    if (!email || freq === "off") {
      if (was) {
        try {
          await store()?.removeHomeworkMail?.(sid);
        } catch {
          /* already gone */
        }
        mailRows.delete(sid);
      }
      return null;
    }
    if (was && was.enabled === false && was.email === email) return `${split(st.name).first} unsubscribed from homework emails, so Lune won’t send them any more.`;
    const days = freq === "daily" ? [0, 1, 2, 3, 4, 5, 6] : [Number(day)];
    try {
      await store()?.setHomeworkMail?.(sid, { name: split(st.name).first, email, days, hour, on: true });
    } catch (err) {
      return err?.message || "Couldn’t save that just now.";
    }
    mailRows.set(sid, { student_key: sid, email, days, send_hour: hour, enabled: true });
    return null;
  }
  /** "Email it now": the newest homework for one student, sent by Lune's server. */
  async function emailNow(sid) {
    try {
      await store()?.syncPrefs?.(); // the server reads the homework from the saved Studio
    } catch {
      /* it may already be saved */
    }
    return store()?.sendHomeworkNow?.(sid);
  }

  /** Called by the homework builder when a teacher creates a link. */
  function recordAssignment(a) {
    const d = data();
    d.assignments = [a, ...d.assignments.filter((x) => x.id !== a.id)];
    save(d);
  }

  /* ---------------- progress, from the check-ins ---------------- */

  const progressCache = new Map();
  async function progressFor(aid) {
    if (progressCache.has(aid)) return progressCache.get(aid);
    const p = Promise.race([Promise.resolve(store()?.assignmentProgress?.(aid)).catch(() => null), new Promise((r) => setTimeout(() => r(null), 8000))]);
    progressCache.set(aid, p);
    return p;
  }
  /** One student's week: last practised, days this week, and how each assigned bar last went. */
  async function snapshot(student) {
    const mine = data().assignments.filter((a) => a.sid === student.id);
    const rows = (await Promise.all(mine.map(async (a) => ((await progressFor(a.id)) || []).map((r) => ({ ...r, a }))))).flat();
    rows.sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
    const weekAgo = Date.now() - 7 * 86400000;
    const days = new Set(rows.filter((r) => Date.parse(r.created_at) > weekAgo).map((r) => String(r.created_at).slice(0, 10)));
    const bars = {};
    for (const r of [...rows].reverse()) for (const [b, g] of Object.entries(r.ratings || {})) bars[`${r.a.key}|${b}`] = { bar: Number(b), piece: r.a.t, grade: String(g) };
    return { last: rows[0]?.created_at || null, days: days.size, dates: [...days], checkins: rows.length, bars: Object.values(bars), assignments: mine };
  }
  const hardish = (g) => /again|hard/i.test(g);
  const when = (iso) => {
    try {
      const d = new Date(iso);
      const days = Math.floor((Date.now() - d.getTime()) / 86400000);
      if (days < 1) return `today, ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
      if (days < 2) return "yesterday";
      if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
      return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    } catch {
      return "";
    }
  };

  /* ---------------- Prepare next lesson ---------------- */

  function lessonByRules(student, snap) {
    const hard = snap.bars.filter((b) => hardish(b.grade));
    const good = snap.bars.filter((b) => !hardish(b.grade));
    const out = [];
    if (hard.length) out.push(`Start with ${hard.length === 1 ? "bar" : "bars"} ${hard.map((b) => b.bar).join(", ")} of ${hard[0].piece}: rated hard this week. Slow, hands separately, then together.`);
    else if (snap.assignments[0]) out.push(`Hear ${snap.assignments[0].t}, ${snap.assignments[0].bars.length === 1 ? "bar" : "bars"} ${snap.assignments[0].bars.join(", ")}, played through once before you say anything.`);
    if (good.length) out.push(`Check ${good.length === 1 ? "bar" : "bars"} ${good.map((b) => b.bar).slice(0, 4).join(", ")} at full tempo: rated good, so they are ready to move on.`);
    out.push(
      snap.days >= 4
        ? `${student.name.split(/[,\s]/)[0]} practised on ${snap.days} days this week. Say so, then set the next passage.`
        : snap.days
          ? `Only ${snap.days} ${snap.days === 1 ? "day" : "days"} of practice this week: agree a shorter, daily routine.`
          : `No practice logged yet: make sure the homework link opens on their phone before they leave.`
    );
    return out.slice(0, 3);
  }
  async function prepareLesson(student) {
    const snap = await snapshot(student);
    if (window.LuneAsk?.modelConnected?.()) {
      try {
        const text = await window.LuneAsk.askModel(
          `Write a lesson plan for my piano student ${student.name} as exactly three numbered points, each one sentence, most important first, naming pieces and bar numbers. Use only the facts given. No other text.`,
          {
            student: { name: student.name, level: student.level || null },
            practiceThisWeek: { daysPractised: snap.days, lastPractised: snap.last, checkIns: snap.checkins },
            barsRated: snap.bars.map((b) => ({ piece: b.piece, bar: b.bar, howItWent: b.grade })),
            homework: snap.assignments.slice(0, 4).map((a) => ({ piece: a.t, bars: a.bars, note: a.m || null, targetTempo: a.tb || null, goal: a.goal || null })),
          }
        );
        const pts = String(text || "")
          .split(/\n+/)
          .map((l) => l.replace(/^\s*(\d+[.)]|[-•*])\s*/, "").trim())
          .filter((l) => l.length > 8)
          .slice(0, 3);
        if (pts.length >= 2) return { points: pts, via: "Lune AI" };
      } catch {
        /* Lune's own reading below */
      }
    }
    return { points: lessonByRules(student, snap), via: "Lune" };
  }

  /* ---------------- the email ---------------- */

  async function setEmail(email) {
    const d = data();
    d.email = { on: !!email.on, days: (email.days || [0]).filter((x) => x >= 0 && x < 7), hour: Math.max(0, Math.min(23, Number(email.hour) || 18)) };
    save(d);
    try {
      await store()?.setDailyEmail?.(d.email.on, { hour: d.email.hour, kind: "teacher", days: d.email.days });
    } catch (err) {
      return err?.message || "Couldn’t save the email just now.";
    }
    return null;
  }
  function emailLine(e) {
    if (!e.on) return "Off";
    const days = e.days.length === 7 ? "Every day" : e.days.length === 5 && !e.days.includes(0) && !e.days.includes(6) ? "Weekdays" : e.days.map((d) => DAY_NAMES[d]).join(", ");
    const h = e.hour;
    return `${days} at ${h === 0 ? "midnight" : h === 12 ? "noon" : h < 12 ? `${h} am` : `${h - 12} pm`}`;
  }
  /**
   * "email me a summary every Sunday at 6pm" (from Lune AI): the schedule, or null if it isn't one.
   * Teachers get the pre-lesson summary; students their morning practice email.
   */
  function parseEmailRequest(text) {
    const t = String(text || "").toLowerCase();
    if (!/\b(e-?mail|mail)(s|ing|ed)?\b/.test(t) || !/\b(me|my)\b/.test(t)) return null;
    if (/\b(stop|don'?t|no more|turn off|unsubscribe|cancel)\b/.test(t)) return { on: false };
    let days = [];
    if (/every ?day|daily|each day|every morning|every evening/.test(t)) days = [0, 1, 2, 3, 4, 5, 6];
    else if (/week ?days?\b/.test(t)) days = [1, 2, 3, 4, 5];
    else if (/week ?ends?\b/.test(t)) days = [0, 6];
    else DAYS.forEach((d, i) => new RegExp(`\\b${d.toLowerCase()}`).test(t) && days.push(i));
    if (!days.length) days = role() === "teacher" ? [0] : [0, 1, 2, 3, 4, 5, 6];
    let hour = role() === "teacher" ? 18 : 7;
    const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/);
    if (m && Number(m[1]) <= 23) {
      hour = Number(m[1]);
      if (/p/.test(m[3] || "") && hour < 12) hour += 12;
      if (/a/.test(m[3] || "") && hour === 12) hour = 0;
    } else if (/morning/.test(t)) hour = 7;
    else if (/evening|night/.test(t)) hour = 19;
    else if (/afternoon/.test(t)) hour = 15;
    return { on: true, days, hour };
  }
  async function applyEmailRequest(req) {
    if (role() === "teacher") {
      const err = await setEmail(req);
      if (err) return err;
      paint();
      return req.on ? `Done. I’ll email you a pre-lesson summary: ${emailLine({ ...data().email })}. Change it any time in your Studio, or ask me.` : "Done. No more summary emails. Ask me any time to start them again.";
    }
    try {
      await store()?.setDailyEmail?.(req.on, { hour: req.hour, kind: "student", days: req.days });
    } catch (err) {
      return err?.message || "Couldn’t set that up just now.";
    }
    return req.on ? `Done. I’ll email you today’s practice ${emailLine(req).toLowerCase()}. Unsubscribe any time from the email.` : "Done. No more practice emails.";
  }

  /*
   * From Lune AI: "send Meera her homework every Monday at 5pm",
   * "email Aarav's homework daily at 7 to aarav@example.com", "email Meera her homework now",
   * "stop emailing Aarav homework". Teachers only; null when it isn't one of these.
   */
  function parseHomeworkRequest(text) {
    if (role() !== "teacher") return null;
    const t = String(text || "");
    const low = t.toLowerCase();
    if (!/\bhomework\b/.test(low) || !/\b(send|sends|sending|e-?mail|e-?mails|e-?mailing|mail)\b/.test(low)) return null;
    const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const student = data().students.find((x) => {
      const f = split(x.name).first.toLowerCase();
      return f && new RegExp(`\\b${reEsc(f)}('s)?\\b`).test(low);
    });
    const email = (t.match(/[^@\s<>,;:]+@[^@\s<>,;:]+\.[a-z]{2,}/i) || [])[0] || "";
    if (/\b(stop|don'?t|no more|turn off|cancel|no longer)\b/.test(low)) return { student, freq: "off" };
    const repeat = /every|daily|each|weekly|week ?days?|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays/.test(low);
    if (!repeat && /\b(now|right away|straight away|today)\b/.test(low)) return { student, now: true, email };
    let freq = "weekly";
    let day = 1;
    if (/every ?day|daily|each day|every (morning|evening|night)/.test(low)) freq = "daily";
    else {
      const i = DAYS.findIndex((d) => new RegExp(`\\b${d.toLowerCase()}`).test(low));
      if (i >= 0) day = i;
    }
    let hour = 17;
    const m = low.replace(email.toLowerCase(), " ").match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/);
    if (m && Number(m[1]) <= 23) {
      hour = Number(m[1]);
      if (/p/.test(m[3] || "") && hour < 12) hour += 12;
      if (/a/.test(m[3] || "") && hour === 12) hour = 0;
      if (!m[3] && hour >= 1 && hour <= 7) hour += 12; // "at 5" after school, not before dawn
    } else if (/morning/.test(low)) hour = 7;
    else if (/evening|night/.test(low)) hour = 18;
    else if (/afternoon|after school/.test(low)) hour = 16;
    return { student, freq, day, hour, email };
  }
  async function applyHomeworkRequest(req) {
    if (!req.student) {
      const names = data().students.map((x) => split(x.name).first);
      return names.length ? `Which student? I have ${names.join(", ")} in your Studio. Ask again with their name.` : "Add the student in your Studio first, then ask me again with their name.";
    }
    const id = req.student.id;
    const first = split(req.student.name).first;
    await loadMail();
    const have = mailRows.get(id);
    if (req.freq === "off") {
      await setStudentMail(id, { email: "", freq: "off" });
      paint();
      return `Done. Lune won’t email ${first} homework any more. You can still share it by link.`;
    }
    const email = req.email || have?.email || "";
    if (!email) return `I need ${first}’s email (or a parent’s) first. Say, for example: “send ${first} their homework every Monday at 5 pm to name@example.com”, or add it on ${first}’s card in your Studio.`;
    if (req.now) {
      if (!have || req.email) {
        const problem = await setStudentMail(id, { email, freq: "weekly", day: new Date().getDay(), hour: 17 });
        if (problem) return problem;
      }
      if (!data().assignments.some((a) => a.sid === id)) return `${first} has no homework yet. Send some from a score first, then I’ll email it.`;
      try {
        await emailNow(id);
      } catch (err) {
        return err?.message || "Couldn’t send it just now.";
      }
      paint();
      return `Sent. ${first} has the newest homework in their inbox now.`;
    }
    const problem = await setStudentMail(id, { email, freq: req.freq, day: req.day, hour: req.hour });
    if (problem) return problem;
    paint();
    return `Done. Lune will email ${first} the newest homework ${scheduleLine(mailRows.get(id))}${req.email ? `, to ${email}` : ""}. Change it any time on ${first}’s card in your Studio, or ask me.`;
  }

  /* ---------------- the Studio page ---------------- */

  function host() {
    let el = $("home-studio");
    if (el) return el;
    el = document.createElement("div");
    el.id = "home-studio";
    el.className = "studio-home";
    el.hidden = true;
    const member = $("home-member");
    member?.parentNode?.insertBefore(el, member);
    el.addEventListener("click", onClick);
    el.addEventListener("submit", onSubmit);
    el.addEventListener("change", onChange);
    return el;
  }

  /** On the student's home: the newest homework from a teacher, first. */
  function paintHomeworkCard() {
    const member = $("home-member");
    if (!member) return;
    let card = $("member-homework");
    let got = [];
    try {
      got = JSON.parse(localStorage.getItem("lune.homework.received") || "[]");
    } catch {
      got = [];
    }
    const hw = got[0];
    if (!hw) {
      if (card) card.hidden = true;
      return;
    }
    if (!card) {
      card = document.createElement("section");
      card.id = "member-homework";
      card.className = "member-homework";
      card.setAttribute("aria-label", "Homework");
      const next = $("member-next");
      next?.parentNode?.insertBefore(card, next);
    }
    const bars = hw.bars.length === 1 ? `bar ${hw.bars[0]}` : `bars ${hw.bars[0]}–${hw.bars[hw.bars.length - 1]}`;
    card.hidden = false;
    card.innerHTML = `<p class="mh-k">Homework${hw.by ? ` from ${esc(hw.by)}` : ""}</p>
      <h2>${esc(hw.t)} <span>· ${esc(bars)}</span></h2>
      ${hw.m ? `<p class="mh-note">${esc(hw.m)}</p>` : ""}
      <div class="mh-act"><a class="primary" href="${esc(hw.hash)}">Open homework</a></div>`;
  }

  /** Called by the signed-in home: true when the Studio takes the page. */
  function takeOver() {
    const teacher = role() === "teacher";
    document.body.classList.toggle("is-teacher", teacher);
    const el = host();
    el.hidden = !teacher;
    if (!teacher) {
      paintHomeworkCard();
      return false;
    }
    const member = $("home-member");
    if (member) member.hidden = true;
    paint();
    return true;
  }

  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }

  /** "Meera, Grade 5" → { first: "Meera", level: "Grade 5" } */
  const split = (n) => {
    const [name, ...rest] = String(n || "").split(",");
    return { name: name.trim(), first: name.trim().split(/\s+/)[0], level: rest.join(",").trim() };
  };
  const barList = (bars) => (bars.length > 1 && bars[bars.length - 1] - bars[0] === bars.length - 1 ? `${bars[0]}–${bars[bars.length - 1]}` : bars.join(", "));

  let selected = null; // the student open on the right
  const snapCache = new Map();
  async function paint() {
    const el = host();
    const d = data();
    // "Ms Rao" stays whole; "Anika Shah" is greeted as Anika
    const full = String(store()?.prefs?.()?.teacherName || store()?.prefs?.()?.displayName || "").trim();
    const name = /^(ms|mr|mrs|miss|mx|dr|prof)\.?\s/i.test(full) ? full.split(/\s+/).slice(0, 2).join(" ") : full.split(/\s+/)[0];
    if (!d.students.some((x) => x.id === selected)) selected = d.students[0]?.id || null;
    el.innerHTML = `
      <div class="s3">
        <header class="s3-top sd2-hero">
          <div class="s3-hello">
            <p class="s3-k">Studio</p>
            <h1>${greeting()}${name ? `, ${esc(name)}` : ""}</h1>
            <p class="s3-lede" id="sd2-lede">${d.students.length ? "Reading your students’ week…" : "Add your students, send homework from any score, and see how the week went before each lesson."}</p>
          </div>
          <div class="s3-cta">
            <button type="button" class="sd2-primary" data-sd="send" id="sd2-send">Send homework</button>
            <button type="button" class="sd2-quiet" data-sd="ask">Ask Lune</button>
          </div>
        </header>
        <div class="s3-stats sd2-stats" aria-live="polite">
          <div><b id="sd2-n-students">${d.students.length}</b><span>${d.students.length === 1 ? "student" : "students"}</span></div>
          <div><b id="sd2-n-week">${d.students.length ? '<i class="sk sk-num"></i>' : "0"}</b><span>practised this week</span></div>
          <div><b id="sd2-n-hard">${d.students.length ? '<i class="sk sk-num"></i>' : "0"}</b><span>bars still hard</span></div>
        </div>
        <div class="s3-main${selected ? "" : " is-empty"}" id="s3-main">
          <aside class="s3-list" id="sd2-students" aria-label="Students">
            <div class="s3-list-h"><h2>Students</h2><button type="button" class="s3-add" id="sd2-add" data-sd="student" aria-label="Add a student"><span aria-hidden="true">+</span> Add</button></div>
            ${
              d.students.length
                ? `<ul class="s3-rows">${d.students.map((s) => studentRow(s)).join("")}</ul>`
                : `<div class="s3-none"><p>No students yet.</p><button type="button" class="sd2-primary" data-sd="student">Add your first student</button><p class="s3-none-note">A name and a level is enough. Students never need an account.</p></div>`
            }
          </aside>
          <section class="s3-detail" id="s3-detail" aria-live="polite">${selected ? detailSkeleton() : `<div class="s3-none s3-none-detail"><p>Your students appear here with their week: who practised, which bars are still hard, and a plan for the next lesson.</p></div>`}</section>
        </div>
        <section class="s3-sec" aria-labelledby="sd2-mail-h" id="sd2-mail-sec">
          <div class="s3-sec-h"><h2 id="sd2-mail-h">Before your lessons</h2></div>
          <div class="sd2-mail">
            <label class="sd2-switch"><span><strong>Email me a summary</strong><small>Who practised, which bars are still hard, and where to start.</small></span><input type="checkbox" id="sd-mail-on" role="switch"${d.email.on ? " checked" : ""}><span class="sd2-sw" aria-hidden="true"></span></label>
            <div class="sd2-when"${d.email.on ? "" : " hidden"}>
              <div class="sd2-days" role="group" aria-label="Days">${DAYS.map((x, i) => `<button type="button" data-day="${i}" aria-pressed="${d.email.days.includes(i)}" aria-label="${DAY_NAMES[i]}">${x.slice(0, 2)}</button>`).join("")}</div>
              <label class="sd2-hour">at <select id="sd-mail-hour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === d.email.hour ? " selected" : ""}>${String(h).padStart(2, "0")}:00</option>`).join("")}</select></label>
            </div>
            <p class="sd2-note" id="sd-mail-note">${d.email.on ? `${esc(emailLine(d.email))}.` : "Off."} Or just tell Lune AI: “email me a summary every Sunday at 6 pm”.</p>
          </div>
        </section>
        <p class="sd2-foot"><button type="button" class="sd2-link" data-sd="tour">Take the Studio tour</button></p>
      </div>`;

    // the homework emails, then each student's week as the check-ins arrive
    loadMail().then(() => {
      if (!el.isConnected) return;
      if (selected) paintDetail();
    });
    const snaps = await Promise.all(d.students.map((s) => snapshot(s).then((snap) => (snapCache.set(s.id, snap), { s, snap }))));
    if (!el.isConnected) return;
    let week = 0;
    let hardAll = 0;
    const said = [];
    for (const { s, snap } of snaps) {
      const hard = snap.bars.filter((b) => hardish(b.grade));
      if (snap.days) week += 1;
      hardAll += hard.length;
      const first = split(s.name).first;
      if (snap.last) said.push(`${first} practised ${when(snap.last)}.`);
      else if (snap.assignments.length) said.push(`${first} hasn’t started ${first.endsWith("s") ? "their" : "the"} homework yet.`);
      const row = el.querySelector(`.s3-row[data-student="${s.id}"]`);
      if (row) {
        row.querySelector(".s3-row-s").textContent = snap.last ? `Practised ${when(snap.last)}` : snap.assignments.length ? "Not started yet" : "No homework yet";
        const dot = row.querySelector(".s3-dot");
        dot.className = `s3-dot ${snap.days ? "is-on" : snap.assignments.length ? "is-wait" : ""}`;
        row.querySelector(".s3-row-n").textContent = hard.length ? `${hard.length} hard` : "";
      }
    }
    const set = (id, v) => {
      const x = $(id);
      if (x) x.textContent = v;
    };
    set("sd2-n-week", String(week));
    set("sd2-n-hard", String(hardAll));
    if (d.students.length) set("sd2-lede", said.length ? said.slice(0, 2).join(" ") : "Send your first homework and each student’s week shows here.");
    if (selected) paintDetail();
    maybeTour();
  }

  function studentRow(s) {
    const p = split(s.name);
    return `<li><button type="button" class="s3-row${s.id === selected ? " on" : ""}" data-sd="pick" data-student="${s.id}" data-id="${s.id}" aria-current="${s.id === selected}">
      <span class="sd2-av" aria-hidden="true">${esc(p.first.charAt(0).toUpperCase())}</span>
      <span class="s3-row-t"><b>${esc(p.name)}</b><span class="s3-row-s"><i class="sk sk-line"></i></span></span>
      <span class="s3-row-n"></span><span class="s3-dot" aria-hidden="true"></span>
    </button></li>`;
  }
  function detailSkeleton() {
    return `<div class="s3-d-skel" aria-label="Loading"><i class="sk sk-av"></i><i class="sk sk-h"></i><i class="sk sk-line"></i><i class="sk sk-block"></i><i class="sk sk-block"></i></div>`;
  }
  const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  async function paintDetail() {
    const box = $("s3-detail");
    const s = data().students.find((x) => x.id === selected);
    if (!box || !s) return;
    const snap = snapCache.get(s.id);
    if (!snap) {
      box.innerHTML = detailSkeleton();
      return;
    }
    const p = split(s.name);
    const hard = snap.bars.filter((b) => hardish(b.grade));
    const good = snap.bars.filter((b) => !hardish(b.grade));
    // this week, Monday first, with the days practised lit
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const dates = new Set(snap.dates || []);
    const dots = WEEK.map((w, i) => {
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      const key = day.toISOString().slice(0, 10);
      const future = day > now;
      return `<span class="s3-wd${dates.has(key) ? " is-on" : ""}${future ? " is-future" : ""}${day.toDateString() === now.toDateString() ? " is-today" : ""}"><i></i>${w.charAt(0)}</span>`;
    }).join("");
    const hw = snap.assignments;
    const d = data();
    box.innerHTML = `
      <button type="button" class="s3-back" data-sd="back"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>Students</button>
      <div class="s3-d-head">
        <span class="sd2-av s3-av-lg" aria-hidden="true">${esc(p.first.charAt(0).toUpperCase())}</span>
        <div class="s3-d-who"><h2>${esc(p.name)}</h2><p>${esc(p.level || "Student")}</p></div>
        <div class="s3-d-act">
          <button type="button" class="sd2-primary" data-sd="send" data-id="${s.id}">Send homework</button>
          <button type="button" class="sd2-quiet" data-sd="student" data-id="${s.id}">Edit</button>
          <button type="button" class="sd2-x" data-sd="remove" data-id="${s.id}" aria-label="Remove ${esc(p.name)}" title="Remove"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
        </div>
      </div>
      <div class="s3-card">
        <div class="s3-card-h"><h3>This week</h3><span>${snap.days} ${snap.days === 1 ? "day" : "days"} practised</span></div>
        <div class="s3-weekrow" role="img" aria-label="Practised on ${snap.days} days this week">${dots}</div>
        <p class="s3-note">${snap.last ? `Last practised ${esc(when(snap.last))}.` : hw.length ? "Homework sent, not started yet." : "No homework sent yet."}</p>
      </div>
      <div class="s3-card">
        <div class="s3-card-h"><h3>Bars</h3><span>${hard.length ? `${hard.length} still hard` : snap.bars.length ? "All feeling good" : ""}</span></div>
        <div class="sd2-chips">${[...hard.map((b) => `<span class="is-hard" title="Still hard">${b.bar}</span>`), ...good.map((b) => `<span class="is-good" title="Feels good">${b.bar}</span>`)].join("") || `<span class="is-none">${hw.length ? "Waiting for the first practice" : "Send homework to see how each bar goes"}</span>`}</div>
      </div>
      <div class="s3-card">
        <div class="s3-card-h"><h3>Next lesson</h3><button type="button" class="sd2-link" data-sd="replan" data-id="${s.id}">Refresh</button></div>
        <div class="sd2-prep" id="s3-prep"><i class="sk sk-line"></i><i class="sk sk-line"></i><i class="sk sk-line sk-short"></i></div>
      </div>
      <div class="s3-card">
        <div class="s3-card-h"><h3>Homework</h3><span>${hw.length || ""}</span></div>
        <div class="sd2-hw">${hw.length ? hw.slice(0, 6).map((a) => homeworkRow(a, d)).join("") : `<p class="s3-note">Nothing sent to ${esc(p.first)} yet.</p>`}</div>
      </div>
      <div class="s3-card">
        <div class="s3-card-h"><h3>Homework email</h3></div>
        <p class="sd2-mailline">${mailLineHtml(s)}</p>
      </div>`;
    for (const a of hw.slice(0, 6)) {
      progressFor(a.id).then((rows) => {
        const st = box.querySelector(`[data-hw="${a.id}"] .sd2-pill`);
        if (!st) return;
        st.textContent = rows?.length ? `Practised ${rows.length}×` : "Not started";
        st.classList.toggle("is-done", !!rows?.length);
      });
    }
    paintPlan(s);
  }
  const planCache = new Map();
  async function paintPlan(s, fresh = false) {
    if (fresh) planCache.delete(s.id);
    if (!planCache.has(s.id)) planCache.set(s.id, prepareLesson(s));
    const out = await planCache.get(s.id);
    const box = $("s3-prep");
    if (!box || selected !== s.id) return;
    box.innerHTML = `<ol>${out.points.map((x) => `<li>${esc(x)}</li>`).join("")}</ol><p class="sd2-via">From ${esc(out.via)}, using ${esc(split(s.name).first)}’s check-ins.</p>`;
  }

  function studentCard(s) {
    const p = split(s.name);
    return `<article class="sd2-card" data-student="${s.id}">
        <header>
          <span class="sd2-av" aria-hidden="true">${esc(p.first.charAt(0).toUpperCase())}</span>
          <div class="sd2-who"><h3>${esc(p.name)}</h3>${p.level ? `<p>${esc(p.level)}</p>` : ""}</div>
          <button type="button" class="sd2-x sd2-edit" data-sd="student" data-id="${s.id}" aria-label="Edit ${esc(p.name)}" title="Edit">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
          </button>
          <button type="button" class="sd2-x" data-sd="remove" data-id="${s.id}" aria-label="Remove ${esc(p.name)}" title="Remove">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </header>
        <p class="sd2-status">…</p>
        <p class="sd2-mailline">${mailLineHtml(s)}</p>
        <div class="sd2-chips" aria-label="Bars: still hard, and feeling good"></div>
        <footer>
          <button type="button" class="sd2-quiet" data-sd="prep" data-id="${s.id}">Lesson plan</button>
          <button type="button" class="sd2-quiet" data-sd="send" data-id="${s.id}">Send homework</button>
        </footer>
        <div class="sd2-prep" hidden aria-live="polite"></div>
      </article>`;
  }

  function mailLineHtml(s) {
    const r = mailRows.get(s.id);
    const first = esc(split(s.name).first);
    const icon = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 6.5h16v11H4zM4.5 7l7.5 6 7.5-6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    if (!r) return `${icon}<button type="button" class="sd2-link" data-sd="student" data-id="${s.id}">Add an email for automatic homework</button>`;
    if (r.enabled === false) return `${icon}<span>${first} unsubscribed from homework emails</span>`;
    const hasHw = data().assignments.some((a) => a.sid === s.id);
    return `${icon}<span>Homework emailed ${esc(scheduleLine(r))}</span>${hasHw ? `<button type="button" class="sd2-link" data-sd="mail-now" data-id="${s.id}">Email now</button>` : ""}`;
  }

  /* ---------------- a student: name, level, and their homework email ---------------- */

  async function openStudentSheet(sid = "") {
    await loadMail();
    const st = data().students.find((x) => x.id === sid) || null;
    const p = st ? split(st.name) : { name: "", level: "" };
    const r = st ? mailRows.get(st.id) : null;
    const freq = !r ? "weekly" : (r.days || []).length >= 7 ? "daily" : "weekly";
    const day = r && (r.days || []).length < 7 ? Number(r.days[0]) : 1;
    const hour = r ? Number(r.send_hour) : 17;
    let d = $("sd2-student");
    if (!d) {
      d = document.createElement("dialog");
      d.id = "sd2-student";
      d.className = "sd2-sheet";
      d.setAttribute("aria-labelledby", "sd2-student-h");
      document.body.appendChild(d);
      d.addEventListener("click", (e) => {
        if (e.target === d || e.target.closest("[data-close]")) d.close();
      });
      d.addEventListener("input", () => syncStudentSheet(d));
      d.addEventListener("change", () => syncStudentSheet(d));
      d.addEventListener("submit", onStudentSubmit);
    }
    d.dataset.sid = st?.id || "";
    d.innerHTML = `
      <form class="sd2-sheet-in sd2-stu" method="dialog" autocomplete="off" novalidate>
        <header><h2 id="sd2-student-h">${st ? esc(p.name) : "Add a student"}</h2><button type="button" class="sd2-x" data-close aria-label="Close"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></header>
        <div class="sd2-pair">
          <label class="sd2-field"><span>Name</span><input name="name" maxlength="40" required value="${esc(p.name)}" placeholder="Meera" autocomplete="off"></label>
          <label class="sd2-field"><span>Level</span><input name="level" maxlength="20" value="${esc(p.level)}" placeholder="Grade 5" autocomplete="off"></label>
        </div>
        <label class="sd2-field"><span>Email for homework <i>the student’s or a parent’s · optional</i></span><input name="email" type="email" maxlength="254" value="${esc(r?.email || "")}" placeholder="name@example.com" autocomplete="off" inputmode="email"></label>
        <div class="sd2-sched" ${r?.enabled === false ? "data-off" : ""}>
          <p class="sd2-sched-k">Send their homework</p>
          <div class="sd2-seg" role="radiogroup" aria-label="How often">
            ${[["weekly", "Once a week"], ["daily", "Every day"], ["off", "Don’t email"]].map(([v, l]) => `<label><input type="radio" name="freq" value="${v}"${(r ? (r.enabled === false ? "off" : freq) : "weekly") === v ? " checked" : ""}><span>${l}</span></label>`).join("")}
          </div>
          <div class="sd2-sched-when">
            <label class="sd2-field sd2-day"><span>On</span><select name="day">${DAY_NAMES.map((n, i) => ({ n, i })).slice(1).concat([{ n: "Sunday", i: 0 }]).map(({ n, i }) => `<option value="${i}"${i === day ? " selected" : ""}>${n}</option>`).join("")}</select></label>
            <label class="sd2-field"><span>At</span><select name="hour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === hour ? " selected" : ""}>${String(h).padStart(2, "0")}:00</option>`).join("")}</select></label>
          </div>
          <p class="sd2-sched-note" id="sd2-sched-note"></p>
        </div>
        <p class="sd2-err" id="sd2-stu-err" role="alert"></p>
        <footer class="sd2-stu-act"><button type="button" class="sd2-quiet" data-close>Cancel</button><button type="submit" class="sd2-primary" id="sd2-stu-save">${st ? "Save" : "Add student"}</button></footer>
      </form>`;
    syncStudentSheet(d);
    d.showModal();
    setTimeout(() => d.querySelector(st ? 'input[name="email"]' : 'input[name="name"]')?.focus(), 40);
  }
  function syncStudentSheet(d) {
    const f = d.querySelector("form");
    if (!f) return;
    const email = f.email.value.trim();
    const freq = f.freq.value;
    const sched = f.querySelector(".sd2-sched");
    const unsub = sched.hasAttribute("data-off");
    sched.classList.toggle("is-dim", !email || unsub);
    f.querySelectorAll('input[name="freq"], select').forEach((x) => (x.disabled = !email || unsub));
    f.querySelector(".sd2-sched-when").hidden = freq === "off";
    f.querySelector(".sd2-day").hidden = freq !== "weekly";
    const first = f.name.value.trim().split(/\s+/)[0] || "they";
    const at = hourText(Number(f.hour.value));
    $("sd2-sched-note").textContent = unsub
      ? `${first} unsubscribed from homework emails, so Lune won’t send them any more.`
      : !email
        ? "Add an email and Lune sends their newest homework for you, with a link that opens just those bars."
        : freq === "off"
          ? "No emails. You can still share homework by link or WhatsApp."
          : freq === "daily"
            ? `Every day at ${at}, Lune emails ${first} their newest homework.`
            : `Every ${DAY_NAMES[Number(f.day.value)]} at ${at}, Lune emails ${first} the week’s homework.`;
  }
  async function onStudentSubmit(e) {
    e.preventDefault();
    const d = e.target.closest("dialog");
    const f = e.target;
    const err = $("sd2-stu-err");
    const name = f.name.value.trim().replace(/[,]/g, " ").replace(/\s+/g, " ");
    const level = f.level.value.trim().replace(/[,]/g, " ");
    const email = f.email.value.trim();
    if (!name) {
      err.textContent = "Add their name.";
      return f.name.focus();
    }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      err.textContent = "That email address doesn’t look right.";
      return f.email.focus();
    }
    const btn = $("sd2-stu-save");
    btn.disabled = true;
    const full = level ? `${name}, ${level}` : name;
    const st = d.dataset.sid ? updateStudent(d.dataset.sid, full) : addStudent(full);
    if (!st) {
      btn.disabled = false;
      err.textContent = "Couldn’t save that.";
      return;
    }
    const problem = await setStudentMail(st.id, { email, freq: email ? f.freq.value : "off", day: Number(f.day.value), hour: Number(f.hour.value) });
    btn.disabled = false;
    if (problem) {
      d.dataset.sid = st.id;
      err.textContent = problem;
      paint();
      return;
    }
    d.close();
    paint();
    window.toast?.(d.dataset.sid ? "Saved" : `${name} added`);
  }

  function homeworkRow(a, d) {
    const who = d.students.find((s) => s.id === a.sid);
    return `<article class="sd2-hw-row" data-hw="${a.id}">
        <div class="sd2-hw-text">
          <h3>${esc(a.t)} <span>· ${a.bars.length === 1 ? "bar" : "bars"} ${esc(barList(a.bars))}</span></h3>
          <p>${esc(who ? split(who.name).first : "Anyone with the link")} · sent ${esc(when(a.at))}${a.tb ? ` · ${esc(a.tb)}` : ""}</p>
        </div>
        <span class="sd2-pill">…</span>
        ${a.url ? `<button type="button" class="sd2-icon" data-sd="open-hw" data-url="${esc(a.url)}" aria-label="Open this homework" title="Open"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : ""}
      </article>`;
  }

  /* ---------------- sending homework: who, which piece, then the bars ---------------- */

  async function openSendSheet(sid = "") {
    let d = $("sd2-sheet");
    if (!d) {
      d = document.createElement("dialog");
      d.id = "sd2-sheet";
      d.className = "sd2-sheet";
      d.setAttribute("aria-labelledby", "sd2-sheet-h");
      document.body.appendChild(d);
      d.addEventListener("click", (e) => {
        if (e.target === d) return d.close();
        const b = e.target.closest("button");
        if (!b) return;
        if (b.dataset.close != null) return d.close();
        if (b.dataset.piece) {
          const sidNow = d.querySelector("#sd2-for")?.value || "";
          d.close();
          startAssigning(b.dataset.piece, sidNow);
        }
        if (b.dataset.find != null) {
          const sidNow = d.querySelector("#sd2-for")?.value || "";
          d.close();
          try {
            sessionStorage.setItem("lune.assign.for", sidNow);
          } catch {
            /* fine */
          }
          document.getElementById("search-input")?.focus();
          window.toast?.("Find the piece, then select the bars and tap Assign.");
        }
      });
    }
    const st = data().students;
    let pieces = [];
    try {
      pieces = ((await store()?.listPieces?.()) || []).map((p) => ({ key: p.piece_key, t: p.title, c: p.composer }));
    } catch {
      pieces = [];
    }
    const seen = new Set(pieces.map((p) => p.key));
    for (const a of data().assignments) if (!seen.has(a.key)) (seen.add(a.key), pieces.push({ key: a.key, t: a.t, c: a.c }));
    if (!seen.has("debussy-clair-de-lune")) pieces.push({ key: "debussy-clair-de-lune", t: "Clair de lune", c: "Claude Debussy" });
    // one row per piece, however many keys it has been saved under
    const titles = new Set();
    pieces = pieces.filter((p) => {
      const k = String(p.t).toLowerCase().trim();
      if (titles.has(k)) return false;
      titles.add(k);
      return true;
    });
    d.innerHTML = `
      <div class="sd2-sheet-in">
        <header><h2 id="sd2-sheet-h">Send homework</h2><button type="button" class="sd2-x" data-close aria-label="Close"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></header>
        <label class="sd2-field"><span>For</span><select id="sd2-for"><option value="">Anyone with the link</option>${st.map((s) => `<option value="${esc(s.id)}"${s.id === sid ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
        <p class="sd2-sheet-k">Choose the piece</p>
        <div class="sd2-pieces">${pieces
          .slice(0, 8)
          .map((p) => `<button type="button" data-piece="${esc(p.key)}"><strong>${esc(p.t)}</strong><span>${esc(p.c || "")}</span><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`)
          .join("")}
          <button type="button" data-find class="sd2-find"><strong>Find another piece</strong><span>Search 3,700+ scores</span><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M16 16l4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
        </div>
        <p class="sd2-sheet-foot">Next, you’ll select the bars on the score.</p>
      </div>`;
    d.showModal();
  }

  /** On the score: a calm guide until the bars are chosen and Assign is tapped. */
  function startAssigning(key, sid) {
    try {
      sessionStorage.setItem("lune.assign.for", sid || "");
    } catch {
      /* fine */
    }
    location.hash = `#/${key}/score`;
    const who = data().students.find((s) => s.id === sid);
    setTimeout(() => showGuide(who ? split(who.name).first : ""), 1200);
  }
  function showGuide(first) {
    let g = $("sd2-guide");
    if (!g) {
      g = document.createElement("div");
      g.id = "sd2-guide";
      g.className = "sd2-guide";
      g.setAttribute("role", "status");
      document.body.appendChild(g);
      g.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        if (b.dataset.g === "assign") document.getElementById("btn-assign")?.click();
        if (b.dataset.g === "cancel") hideGuide();
      });
    }
    const paintGuide = () => {
      let n = 0;
      try {
        n = selectedBarsSorted().length;
      } catch {
        n = 0;
      }
      g.innerHTML = `<p><strong>${first ? `Homework for ${esc(first)}` : "Homework"}</strong><span>${n ? `${n} ${n === 1 ? "bar" : "bars"} selected` : "Tap the bars you want to set"}</span></p>
        <button type="button" class="sd2-quiet" data-g="cancel">Cancel</button>
        <button type="button" class="sd2-primary" data-g="assign"${n ? "" : " disabled"}>Next</button>`;
    };
    paintGuide();
    g.hidden = false;
    clearInterval(g._t);
    g._t = setInterval(() => (document.body.classList.contains("is-studio") ? paintGuide() : hideGuide()), 500);
  }
  function hideGuide() {
    const g = $("sd2-guide");
    if (!g) return;
    clearInterval(g._t);
    g.hidden = true;
  }

  /* ---------------- the Studio tour ---------------- */

  const TOUR_KEY = "lune.studio.tour";
  const TOUR = [
    { sel: ".sd2-hero", title: "Welcome to your Studio", body: "Your teaching studio in Lune. In a minute you’ll know your way around." },
    { sel: "#sd2-add", title: "Add your students", body: "A name and a level is all it takes. Students never need an account." },
    { sel: "#sd2-send", title: "Send homework from any score", body: "Choose the student and the piece, select the bars, add a note and a target tempo, then copy it for WhatsApp." },
    { sel: "#s3-detail", title: "Know before the lesson", body: "Pick a student to see their week: the days they practised, the bars still hard, their homework, and a plan for the next lesson in three lines." },
    { sel: "#sd2-mail-sec", title: "A summary before you teach", body: "Pick the days and Lune emails you where each student stands. Or just ask Lune AI." },
  ];
  function maybeTour() {
    let seen = false;
    try {
      seen = localStorage.getItem(TOUR_KEY) === "done";
    } catch {
      seen = true;
    }
    if (!seen) setTimeout(() => tour(0), 700);
  }
  function tour(i) {
    let t = $("sd2-tour");
    if (!t) {
      t = document.createElement("div");
      t.id = "sd2-tour";
      t.className = "sd2-tour";
      t.innerHTML = `<div class="sd2-tour-ring" aria-hidden="true"></div><div class="sd2-tour-card" role="dialog" aria-modal="true" aria-labelledby="sd2-tour-h"></div>`;
      document.body.appendChild(t);
      t.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        if (b.dataset.t === "skip") endTour();
        if (b.dataset.t === "next") tour(Number(t.dataset.i) + 1);
      });
      document.addEventListener("keydown", (e) => {
        if (!t.hidden && e.key === "Escape") endTour();
      });
    }
    if (i >= TOUR.length) return endTour();
    const step = TOUR[i];
    const target = document.querySelector(step.sel);
    if (!target) return tour(i + 1);
    t.dataset.i = i;
    t.hidden = false;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    const last = i === TOUR.length - 1;
    t.querySelector(".sd2-tour-card").innerHTML = `
      <p class="sd2-tour-k">${i + 1} of ${TOUR.length}</p>
      <h3 id="sd2-tour-h">${esc(step.title)}</h3>
      <p>${esc(step.body)}</p>
      <div class="sd2-tour-act"><button type="button" class="sd2-quiet" data-t="skip">${last ? "Close" : "Skip"}</button><button type="button" class="sd2-primary" data-t="next">${last ? "Start teaching" : "Next"}</button></div>`;
    const place = () => {
      const r = target.getBoundingClientRect();
      const ring = t.querySelector(".sd2-tour-ring");
      const pad = 10;
      Object.assign(ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${Math.min(r.height + pad * 2, innerHeight - 40)}px` });
      const card = t.querySelector(".sd2-tour-card");
      const ch = card.offsetHeight || 200;
      const below = r.bottom + 18 + ch < innerHeight;
      card.style.top = `${below ? Math.min(r.bottom + 18, innerHeight - ch - 16) : Math.max(16, r.top - ch - 18)}px`;
      card.style.left = `${Math.max(16, Math.min(innerWidth - card.offsetWidth - 16, r.left + r.width / 2 - card.offsetWidth / 2))}px`;
    };
    setTimeout(place, 350);
    setTimeout(place, 700);
    setTimeout(() => t.querySelector('[data-t="next"]')?.focus(), 400);
  }
  function endTour() {
    const t = $("sd2-tour");
    if (t) t.hidden = true;
    try {
      localStorage.setItem(TOUR_KEY, "done");
    } catch {
      /* fine */
    }
    window.scrollTo?.({ top: 0, behavior: "smooth" });
    $("home")?.scrollTo?.({ top: 0, behavior: "smooth" });
  }

  async function onClick(e) {
    const b = e.target.closest("button");
    if (!b) return;
    const act = b.dataset.sd;
    if (act === "pick") {
      selected = b.dataset.id;
      $("home-studio")?.querySelectorAll(".s3-row").forEach((r) => {
        r.classList.toggle("on", r.dataset.id === selected);
        r.setAttribute("aria-current", String(r.dataset.id === selected));
      });
      $("s3-main")?.classList.add("show-detail");
      paintDetail();
      if (innerWidth <= 760) window.scrollTo?.({ top: 0 }), $("home")?.scrollTo?.({ top: 0 });
      return;
    }
    if (act === "back") return $("s3-main")?.classList.remove("show-detail");
    if (act === "replan") {
      const s = data().students.find((x) => x.id === b.dataset.id);
      const box = $("s3-prep");
      if (s && box) box.innerHTML = '<i class="sk sk-line"></i><i class="sk sk-line"></i><i class="sk sk-line sk-short"></i>';
      if (s) paintPlan(s, true);
      return;
    }
    if (act === "send") return openSendSheet(b.dataset.id || "");
    if (act === "student") return openStudentSheet(b.dataset.id || "");
    if (act === "mail-now") {
      const s = data().students.find((x) => x.id === b.dataset.id);
      if (!s) return;
      b.disabled = true;
      b.textContent = "Sending…";
      try {
        await emailNow(s.id);
        b.textContent = "Sent";
        window.toast?.(`Homework emailed to ${split(s.name).first}`);
      } catch (err) {
        b.disabled = false;
        b.textContent = "Email now";
        window.toast?.(err?.message || "Couldn’t send it just now.");
      }
      return;
    }
    if (act === "ask") return window.LuneAsk?.goAiPage?.();
    if (act === "tour") {
      try {
        localStorage.removeItem(TOUR_KEY);
      } catch {
        /* fine */
      }
      return tour(0);
    }
    if (act === "remove") {
      const s = data().students.find((x) => x.id === b.dataset.id);
      if (s && confirm(`Remove ${split(s.name).name} from your Studio? Their homework links keep working.`)) {
        removeStudent(s.id);
        paint();
      }
      return;
    }
    if (act === "open-hw" && b.dataset.url) {
      const h = b.dataset.url.split("#")[1];
      if (h) location.hash = h;
      return;
    }
    if (act === "prep") {
      const s = data().students.find((x) => x.id === b.dataset.id);
      const card = b.closest(".sd2-card");
      const box = card?.querySelector(".sd2-prep");
      if (!s || !box) return;
      if (!box.hidden) {
        box.hidden = true;
        b.textContent = "Lesson plan";
        card.classList.remove("is-open");
        return;
      }
      box.hidden = false;
      card.classList.add("is-open");
      box.innerHTML = `<p class="sd2-dim">Reading ${esc(split(s.name).first)}’s week…</p>`;
      b.disabled = true;
      const out = await prepareLesson(s);
      b.disabled = false;
      b.textContent = "Hide plan";
      box.innerHTML = `<p class="sd2-prep-k">Next lesson</p><ol>${out.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ol><p class="sd2-via">From ${esc(out.via)}, using ${esc(split(s.name).first)}’s check-ins.</p>`;
      return;
    }
    if (b.dataset.day) {
      const d = data();
      const day = Number(b.dataset.day);
      const days = d.email.days.includes(day) ? d.email.days.filter((x) => x !== day) : [...d.email.days, day].sort();
      if (!days.length) return;
      const err = await setEmail({ ...d.email, days });
      b.setAttribute("aria-pressed", days.includes(day));
      $("sd-mail-note").textContent = err || `${emailLine(data().email)}.`;
    }
  }
  function onSubmit(e) {
    const f = e.target.closest("form#sd2-add");
    if (!f) return;
    e.preventDefault();
    const input = f.querySelector("input");
    if (addStudent(input.value)) {
      input.value = "";
      paint().then(() => $("sd2-add-name")?.focus());
    } else input.focus();
  }
  async function onChange(e) {
    if (e.target.id === "sd-mail-on") {
      const on = e.target.checked;
      const err = await setEmail({ ...data().email, on });
      const w = $("home-studio").querySelector(".sd2-when");
      if (w) w.hidden = !on;
      $("sd-mail-note").textContent = err || (on ? `${emailLine(data().email)}.` : "Off.");
    }
    if (e.target.id === "sd-mail-hour") {
      const err = await setEmail({ ...data().email, hour: Number(e.target.value) });
      $("sd-mail-note").textContent = err || `${emailLine(data().email)}.`;
    }
  }

  const recheck = () => setTimeout(() => {
    if (store()?.status?.()?.signedIn && document.body.classList.contains("is-home")) window.LuneOnboard?.paintSignedHome?.();
  }, 300);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", recheck, { once: true });
  else recheck();

  // the landing page's showcase: For students | For teachers
  document.addEventListener("click", (e) => {
    const t = e.target.closest?.("[data-show]");
    if (!t) return;
    for (const b of document.querySelectorAll("[data-show]")) {
      const on = b === t;
      b.setAttribute("aria-selected", on);
      b.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(`show-${b.dataset.show}`);
      if (panel) panel.hidden = !on;
    }
  });
  document.addEventListener("keydown", (e) => {
    const t = e.target.closest?.("[data-show]");
    if (!t || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const all = [...document.querySelectorAll("[data-show]")];
    const next = all[(all.indexOf(t) + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length];
    next.focus();
    next.click();
  });

  // the body knows the role from the start, so the score shows Assign to teachers
  try {
    document.body.classList.toggle("is-teacher", role() === "teacher");
  } catch {
    /* store not ready yet */
  }

  /*
   * Review only, on this computer: ?preview=student or ?preview=teacher shows that
   * home as if signed in, with sample students, so both can be looked at side by side.
   * It never runs on lune.page.
   */
  try {
    const prev = new URLSearchParams(location.search).get("preview");
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    if (local && (prev === "student" || prev === "teacher")) {
      const S = store();
      const st0 = S.status.bind(S);
      S.status = () => ({ ...st0(), signedIn: true, mode: "cloud", email: "preview@lune.page" });
      previewRole = prev;
      if (prev === "teacher") {
        S.setPref("teacherName", "Ms Rao");
        const d0 = data();
        const ago = (days, h = 17) => new Date(Date.now() - days * 86400000 - (new Date().getHours() - h) * 3600000).toISOString();
        if (!d0.students.length) d0.students = [
          { id: "demoaarav", name: "Aarav, Grade 3" },
          { id: "demomeera", name: "Meera, Grade 5" },
        ];
        if (!d0.assignments.some((a) => a.id === "demoMeera01")) d0.assignments.push({ id: "demoMeera01", sid: "demomeera", key: "claude-debussy-claire-de-lune", t: "Clair de lune", c: "Claude Debussy", bars: [1, 2, 3, 4], m: "Keep the right hand singing over a very quiet left hand.", tb: "♩. = 44", goal: "clean3", at: ago(5), url: "" });
        d0.email = d0.email?.on ? d0.email : { on: true, days: [0], hour: 18 };
        // homework emails, kept in this tab only
        const pm = new Map([["demomeera", { student_key: "demomeera", student_name: "Meera", email: "meera.parent@example.com", days: [1], send_hour: 17, enabled: true }]]);
        S.homeworkMail = async () => [...pm.values()];
        S.setHomeworkMail = async (k, o) => void pm.set(k, { student_key: k, student_name: o.name, email: o.email, days: o.days, send_hour: o.hour, enabled: true });
        S.removeHomeworkMail = async (k) => void pm.delete(k);
        S.sendHomeworkNow = async () => new Promise((r) => setTimeout(() => r({ ok: true }), 700));
        save(d0);
        // sample check-ins for the sample homework, so the Studio shows a real week
        const real = S.assignmentProgress?.bind(S);
        S.assignmentProgress = async (aid) =>
          aid === "demoMeera01"
            ? [
                { who: "Meera", ratings: { 1: "good", 2: "good", 3: "hard", 4: "again" }, created_at: ago(1, 18) },
                { who: "Meera", ratings: { 1: "good", 2: "okay", 3: "hard", 4: "hard" }, created_at: ago(3, 17) },
              ]
            : real
              ? real(aid)
              : [];
      }
      document.addEventListener("DOMContentLoaded", () => setTimeout(() => window.LuneOnboard?.paintSignedHome?.(), 400));
    }
  } catch {
    /* not a preview */
  }

  return { previewingStudent: () => previewRole === "student", role, setRole, takeOver, paint, data, addStudent, recordAssignment, prepareLesson, parseEmailRequest, applyEmailRequest, emailLine, mailFor, emailNow, loadMail, openStudentSheet, parseHomeworkRequest, applyHomeworkRequest };
})();
