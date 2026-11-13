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

  /** "Meera, Grade 5" → { first: "Meera", level: "Grade 5" } */
  const split = (n) => {
    const [name, ...rest] = String(n || "").split(",");
    return { name: name.trim(), first: name.trim().split(/\s+/)[0], level: rest.join(",").trim() };
  };
  const barList = (bars) => (bars.length > 1 && bars[bars.length - 1] - bars[0] === bars.length - 1 ? `${bars[0]}–${bars[bars.length - 1]}` : bars.join(", "));

  async function paint() {
    const el = host();
    const d = data();
    // "Ms Rao" stays whole; "Anika Shah" is greeted as Anika
    const full = String(store()?.prefs?.()?.teacherName || store()?.prefs?.()?.displayName || "").trim();
    const name = /^(ms|mr|mrs|miss|mx|dr|prof)\.?\s/i.test(full) ? full.split(/\s+/).slice(0, 2).join(" ") : full.split(/\s+/)[0];
    el.innerHTML = `
      <section class="sd2-hero">
        <p class="sd2-kicker">Studio</p>
        <h1>${greeting()}${name ? `, ${esc(name)}` : ""}.</h1>
        <p class="sd2-lede" id="sd2-lede">${d.students.length ? "Reading your students’ week…" : "Your teaching studio. Add your students, send homework from any score, and see how the week went before each lesson."}</p>
        <div class="sd2-stats" aria-live="polite">
          <div><b id="sd2-n-students">${d.students.length}</b><span>${d.students.length === 1 ? "student" : "students"}</span></div>
          <div><b id="sd2-n-week">–</b><span>practised this week</span></div>
          <div><b id="sd2-n-hard">–</b><span>bars still hard</span></div>
        </div>
        <div class="sd2-cta">
          <button type="button" class="sd2-primary" data-sd="send" id="sd2-send">Send homework</button>
          <button type="button" class="sd2-quiet" data-sd="ask">Ask Lune</button>
        </div>
      </section>

      <section class="sd2-sec" aria-labelledby="sd2-students-h">
        <div class="sd2-head"><h2 id="sd2-students-h">Students</h2></div>
        <div class="sd2-grid" id="sd2-students">
          ${d.students.map((s) => studentCard(s)).join("")}
          <form class="sd2-card sd2-add" autocomplete="off" id="sd2-add">
            <span class="sd2-av sd2-av-add" aria-hidden="true">+</span>
            <label for="sd2-add-name" class="sd2-add-k">Add a student</label>
            <input id="sd2-add-name" maxlength="60" placeholder="Name, level  e.g. Aarav, Grade 3">
            <button type="submit" class="sd2-quiet">Add</button>
            <p class="sd2-add-note">Students never need an account.</p>
          </form>
        </div>
      </section>

      <section class="sd2-sec" aria-labelledby="sd2-hw-h">
        <div class="sd2-head"><h2 id="sd2-hw-h">Homework</h2></div>
        <div class="sd2-hw" id="sd2-homework">${
          d.assignments.length
            ? d.assignments.slice(0, 12).map((a) => homeworkRow(a, d)).join("")
            : `<p class="sd2-empty">Nothing sent yet. <button type="button" class="sd2-link" data-sd="send">Send the first piece of homework</button></p>`
        }</div>
      </section>

      <section class="sd2-sec" aria-labelledby="sd2-mail-h" id="sd2-mail-sec">
        <div class="sd2-head"><h2 id="sd2-mail-h">Before your lessons</h2></div>
        <div class="sd2-mail">
          <label class="sd2-switch"><span><strong>Email me a summary</strong><small>Who practised, which bars are still hard, and where to start.</small></span><input type="checkbox" id="sd-mail-on" role="switch"${d.email.on ? " checked" : ""}><span class="sd2-sw" aria-hidden="true"></span></label>
          <div class="sd2-when"${d.email.on ? "" : " hidden"}>
            <div class="sd2-days" role="group" aria-label="Days">${DAYS.map((x, i) => `<button type="button" data-day="${i}" aria-pressed="${d.email.days.includes(i)}" aria-label="${DAY_NAMES[i]}">${x.slice(0, 2)}</button>`).join("")}</div>
            <label class="sd2-hour">at <select id="sd-mail-hour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === d.email.hour ? " selected" : ""}>${String(h).padStart(2, "0")}:00</option>`).join("")}</select></label>
          </div>
          <p class="sd2-note" id="sd-mail-note">${d.email.on ? `${esc(emailLine(d.email))}.` : "Off."} Or just tell Lune AI: “email me a summary every Sunday at 6 pm”.</p>
        </div>
      </section>
      <p class="sd2-foot"><button type="button" class="sd2-link" data-sd="tour">Take the Studio tour</button></p>`;

    // each student's week, as the check-ins arrive
    const snaps = await Promise.all(d.students.map((s) => snapshot(s).then((snap) => ({ s, snap }))));
    if (!el.isConnected) return;
    let week = 0;
    let hardAll = 0;
    const said = [];
    for (const { s, snap } of snaps) {
      const card = el.querySelector(`[data-student="${s.id}"]`);
      const hard = snap.bars.filter((b) => hardish(b.grade)).map((b) => b.bar);
      const good = snap.bars.filter((b) => !hardish(b.grade)).map((b) => b.bar);
      if (snap.days) week += 1;
      hardAll += hard.length;
      const first = split(s.name).first;
      if (snap.last) said.push(`${first} practised ${when(snap.last)}.`);
      else if (snap.assignments.length) said.push(`${first} hasn’t started ${first.endsWith("s") ? "their" : "the"} homework yet.`);
      if (!card) continue;
      card.querySelector(".sd2-status").textContent = snap.last
        ? `Practised ${when(snap.last)} · ${snap.days} ${snap.days === 1 ? "day" : "days"} this week`
        : snap.assignments.length
          ? "Homework sent · not started yet"
          : "No homework yet";
      card.querySelector(".sd2-chips").innerHTML =
        [...hard.map((b) => `<span class="is-hard" title="Still hard">${b}</span>`), ...good.map((b) => `<span class="is-good" title="Feels good">${b}</span>`)].join("") ||
        `<span class="is-none">${snap.assignments.length ? "Waiting for the first practice" : "Send homework to see how it goes"}</span>`;
      card.classList.toggle("is-quiet", !snap.last);
    }
    const set = (id, v) => {
      const x = $(id);
      if (x) x.textContent = v;
    };
    set("sd2-n-week", d.students.length ? String(week) : "0");
    set("sd2-n-hard", String(hardAll));
    if (d.students.length) set("sd2-lede", said.length ? said.slice(0, 3).join(" ") : "Send your first homework and each student’s week shows here.");
    for (const a of d.assignments.slice(0, 12)) {
      progressFor(a.id).then((rows) => {
        const st = el.querySelector(`[data-hw="${a.id}"] .sd2-pill`);
        if (!st) return;
        st.textContent = rows?.length ? `Practised ${rows.length}×` : "Not started";
        st.classList.toggle("is-done", !!rows?.length);
      });
    }
    maybeTour();
  }

  function studentCard(s) {
    const p = split(s.name);
    return `<article class="sd2-card" data-student="${s.id}">
        <header>
          <span class="sd2-av" aria-hidden="true">${esc(p.first.charAt(0).toUpperCase())}</span>
          <div class="sd2-who"><h3>${esc(p.name)}</h3>${p.level ? `<p>${esc(p.level)}</p>` : ""}</div>
          <button type="button" class="sd2-x" data-sd="remove" data-id="${s.id}" aria-label="Remove ${esc(p.name)}" title="Remove">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </header>
        <p class="sd2-status">…</p>
        <div class="sd2-chips" aria-label="Bars: still hard, and feeling good"></div>
        <footer>
          <button type="button" class="sd2-quiet" data-sd="prep" data-id="${s.id}">Lesson plan</button>
          <button type="button" class="sd2-quiet" data-sd="send" data-id="${s.id}">Send homework</button>
        </footer>
        <div class="sd2-prep" hidden aria-live="polite"></div>
      </article>`;
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
    { sel: "#sd2-students", title: "Know before the lesson", body: "Each card shows who practised, on how many days, and which bars are still hard. Lesson plan writes your next lesson in three lines." },
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
    if (act === "send") return openSendSheet(b.dataset.id || "");
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
    const f = e.target.closest("#sd2-add");
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
