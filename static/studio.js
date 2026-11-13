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
    return { last: rows[0]?.created_at || null, days: days.size, checkins: rows.length, bars: Object.values(bars), assignments: mine };
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

  async function paint() {
    const el = host();
    const d = data();
    // "Ms Rao" stays whole; "Anika Shah" is greeted as Anika
    const full = String(store()?.prefs?.()?.teacherName || store()?.prefs?.()?.displayName || "").trim();
    const name = /^(ms|mr|mrs|miss|mx|dr|prof)\.?\s/i.test(full) ? full.split(/\s+/).slice(0, 2).join(" ") : full.split(/\s+/)[0];
    el.innerHTML = `
      <section class="sd-hero">
        <p class="sd-kicker">Studio</p>
        <h1>${greeting()}${name ? `, ${esc(name)}` : ""}.</h1>
        <p class="sd-sum" id="sd-sum">${d.students.length ? `${d.students.length} ${d.students.length === 1 ? "student" : "students"} · ${d.assignments.length} ${d.assignments.length === 1 ? "piece of homework" : "pieces of homework"} sent` : "Add your students, then send homework from any score."}</p>
        <div class="sd-hero-act">
          <button type="button" class="primary" data-sd="assign">New homework</button>
          <button type="button" class="quiet" data-sd="ask">Ask Lune</button>
        </div>
      </section>

      <section class="sd-sec" aria-labelledby="sd-students-h">
        <div class="sd-sec-head"><h2 id="sd-students-h">Students</h2></div>
        <div class="sd-list" id="sd-students">${
          d.students.length
            ? d.students.map((s) => studentRow(s)).join("")
            : `<p class="sd-empty">No students yet. Add the first below; they never need an account.</p>`
        }</div>
        <form class="sd-add" autocomplete="off">
          <label class="visually-hidden" for="sd-add-name">Student’s name</label>
          <input id="sd-add-name" maxlength="60" placeholder="Add a student, e.g. Aarav, Grade 3">
          <button type="submit" class="quiet">Add</button>
        </form>
      </section>

      <section class="sd-sec" aria-labelledby="sd-hw-h">
        <div class="sd-sec-head"><h2 id="sd-hw-h">Homework sent</h2></div>
        <div class="sd-list" id="sd-homework">${
          d.assignments.length
            ? d.assignments.slice(0, 12).map((a) => homeworkRow(a, d)).join("")
            : `<p class="sd-empty">Open any score, select bars and tap <strong>Assign</strong>. Each piece of homework shows here with its progress.</p>`
        }</div>
      </section>

      <section class="sd-sec" aria-labelledby="sd-mail-h">
        <div class="sd-sec-head"><h2 id="sd-mail-h">Pre-lesson email</h2></div>
        <div class="sd-mail">
          <label class="sd-switch"><span><strong>Email me a summary before lessons</strong><small>Who practised, which bars are still hard, and where to start.</small></span><input type="checkbox" id="sd-mail-on" role="switch"${d.email.on ? " checked" : ""}><span class="sd-sw" aria-hidden="true"></span></label>
          <div class="sd-mail-when"${d.email.on ? "" : " hidden"}>
            <div class="sd-days" role="group" aria-label="Days">${DAYS.map((x, i) => `<button type="button" data-day="${i}" aria-pressed="${d.email.days.includes(i)}">${x[0]}${x[1]}</button>`).join("")}</div>
            <label class="sd-hour">at <select id="sd-mail-hour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === d.email.hour ? " selected" : ""}>${String(h).padStart(2, "0")}:00</option>`).join("")}</select></label>
          </div>
          <p class="sd-note" id="sd-mail-note">${d.email.on ? `${esc(emailLine(d.email))}. You can also ask Lune AI: “email me a summary every Sunday at 6 pm”.` : "Or just ask Lune AI: “email me a summary every Sunday at 6 pm”."}</p>
        </div>
      </section>`;
    // fill in each student's week as the check-ins arrive
    for (const s of d.students) {
      snapshot(s).then((snap) => {
        const row = el.querySelector(`[data-student="${s.id}"] .sd-status`);
        if (!row) return;
        const hard = snap.bars.filter((b) => hardish(b.grade)).map((b) => b.bar);
        const good = snap.bars.filter((b) => !hardish(b.grade)).map((b) => b.bar);
        row.innerHTML = snap.last
          ? `<span>Practised ${esc(when(snap.last))} · ${snap.days} ${snap.days === 1 ? "day" : "days"} this week</span>${hard.length || good.length ? `<span class="sd-bars">${hard.length ? `<em class="is-hard">Hard ${hard.join(", ")}</em>` : ""}${good.length ? `<em class="is-good">Good ${good.join(", ")}</em>` : ""}</span>` : ""}`
          : snap.assignments.length
            ? `<span>Homework sent · not practised yet</span>`
            : `<span>No homework yet</span>`;
      });
    }
    for (const a of d.assignments.slice(0, 12)) {
      progressFor(a.id).then((rows) => {
        const st = el.querySelector(`[data-hw="${a.id}"] .sd-hw-status`);
        if (!st) return;
        st.textContent = rows?.length ? `Practised ${rows.length} ${rows.length === 1 ? "time" : "times"} · last ${when(rows[0].created_at)}` : "Not practised yet";
        st.classList.toggle("is-done", !!rows?.length);
      });
    }
  }

  function studentRow(s) {
    const initial = esc(s.name.trim().charAt(0).toUpperCase());
    return `<article class="sd-student" data-student="${s.id}">
        <div class="sd-st-main">
          <span class="sd-av" aria-hidden="true">${initial}</span>
          <div class="sd-st-text"><h3>${esc(s.name)}</h3><p class="sd-status"><span>…</span></p></div>
          <div class="sd-st-act">
            <button type="button" class="quiet" data-sd="prep" data-id="${s.id}">Prepare next lesson</button>
            <button type="button" class="sd-more" data-sd="remove" data-id="${s.id}" aria-label="Remove ${esc(s.name)}" title="Remove">×</button>
          </div>
        </div>
        <div class="sd-prep" hidden aria-live="polite"></div>
      </article>`;
  }
  function homeworkRow(a, d) {
    const who = d.students.find((s) => s.id === a.sid)?.name || "Anyone with the link";
    return `<article class="sd-hw" data-hw="${a.id}">
        <div class="sd-hw-text"><h3>${esc(a.t)} <span>· ${a.bars.length === 1 ? "bar" : "bars"} ${esc(a.bars.length > 1 && a.bars[a.bars.length - 1] - a.bars[0] === a.bars.length - 1 ? `${a.bars[0]}–${a.bars[a.bars.length - 1]}` : a.bars.join(", "))}</span></h3>
        <p>${esc(who)} · sent ${esc(when(a.at))}${a.tb ? ` · target ${esc(a.tb)}` : ""}</p></div>
        <p class="sd-hw-status">…</p>
        <button type="button" class="quiet sd-open" data-sd="open-hw" data-url="${esc(a.url || "")}">Open</button>
      </article>`;
  }

  async function onClick(e) {
    const b = e.target.closest("button");
    if (!b) return;
    const act = b.dataset.sd;
    if (act === "assign") {
      // the last piece open, or the library: then select bars and tap Assign
      const last = (typeof state !== "undefined" && (state.piece || state.sessions?.[state.sessions.length - 1]?.piece)) || null;
      if (last) {
        location.hash = `#/${window.LunePractice?.keyFor?.(last) || last.id}/score`;
        setTimeout(() => window.toast?.("Select the bars, then tap Assign."), 900);
      } else {
        document.getElementById("search-input")?.focus();
        window.toast?.("Find a piece, select the bars, then tap Assign.");
      }
    }
    if (act === "ask") window.LuneAsk?.goAiPage?.();
    if (act === "remove") {
      const s = data().students.find((x) => x.id === b.dataset.id);
      if (s && confirm(`Remove ${s.name} from your Studio? Their homework links keep working.`)) {
        removeStudent(s.id);
        paint();
      }
    }
    if (act === "open-hw" && b.dataset.url) {
      const h = b.dataset.url.split("#")[1];
      if (h) location.hash = h;
    }
    if (act === "prep") {
      const s = data().students.find((x) => x.id === b.dataset.id);
      const box = b.closest(".sd-student").querySelector(".sd-prep");
      if (!s || !box) return;
      if (!box.hidden && box.dataset.ready) {
        box.hidden = true;
        b.textContent = "Prepare next lesson";
        return;
      }
      box.hidden = false;
      box.innerHTML = `<p class="sd-dim">Reading ${esc(s.name.split(/[,\s]/)[0])}’s week…</p>`;
      b.disabled = true;
      const out = await prepareLesson(s);
      b.disabled = false;
      b.textContent = "Hide plan";
      box.dataset.ready = "1";
      box.innerHTML = `<ol>${out.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ol><p class="sd-via">From ${esc(out.via)}, using ${esc(s.name.split(/[,\s]/)[0])}’s check-ins and ratings.</p>`;
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
    const f = e.target.closest(".sd-add");
    if (!f) return;
    e.preventDefault();
    const input = f.querySelector("input");
    if (addStudent(input.value)) {
      input.value = "";
      paint().then(() => $("sd-add-name")?.focus());
    }
  }
  async function onChange(e) {
    if (e.target.id === "sd-mail-on") {
      const on = e.target.checked;
      const err = await setEmail({ ...data().email, on });
      const when = $("home-studio").querySelector(".sd-mail-when");
      if (when) when.hidden = !on;
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

  return { previewingStudent: () => previewRole === "student", role, setRole, takeOver, paint, data, addStudent, recordAssignment, prepareLesson, parseEmailRequest, applyEmailRequest, emailLine };
})();
