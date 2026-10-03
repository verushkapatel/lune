/* Lune — personal data: Repertoire, bar notes, review cards, stumbles.
 *
 * One API, two homes:
 *   - Supabase (when frontend/lune-config.js has a project URL + anon key and
 *     the pianist is signed in): synced across devices, private per user
 *     through row-level security (see supabase/schema.sql).
 *   - This browser (signed out, or no Supabase configured): the same data in
 *     localStorage, so everything works before anyone makes an account.
 * Signing in offers to move the browser's data into the account.
 */
window.LuneStore = (function () {
  const LOCAL_KEY = "lune.local.v1";
  const cfg = window.LUNE_CONFIG || {};
  const listeners = new Set();
  let client = null;
  let session = null;

  const nowIso = () => new Date().toISOString();
  const uuid = () =>
    (crypto.randomUUID && crypto.randomUUID()) ||
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });

  /* ---------------- local backend ---------------- */

  function readLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      const data = raw ? JSON.parse(raw) : null;
      if (data && data.v === 1) return data;
    } catch {
      /* private mode or blocked storage */
    }
    return { v: 1, repertoire: [], notes: [], cards: [], stumbles: [], scores: {}, prefs: {}, tasks: [], localAccount: null };
  }
  function writeLocal(data) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
      return true;
    } catch {
      return false; // quota (very large uploads) or blocked storage
    }
  }
  function mutateLocal(fn) {
    const data = readLocal();
    const out = fn(data);
    writeLocal(data);
    return out;
  }

  /* ---------------- Supabase backend ---------------- */

  function configured() {
    return !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  }
  function loadClientLibrary() {
    if (window.supabase?.createClient) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = cfg.supabaseScript || "static/vendor/supabase.js";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Couldn’t load the account library"));
      document.head.appendChild(s);
    });
  }
  function remote() {
    return !!(client && session?.user);
  }
  async function init() {
    if (!configured()) return;
    try {
      await loadClientLibrary(); // only fetched when accounts are switched on
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      const { data } = await client.auth.getSession();
      session = data?.session || null;
      client.auth.onAuthStateChange((_event, s) => {
        const was = !!session?.user;
        session = s || null;
        if (was !== !!session?.user) emit();
      });
    } catch (err) {
      console.warn("[lune] Supabase unavailable — keeping data in this browser", err);
      client = null;
    }
    emit();
  }
  function emit() {
    for (const fn of listeners) {
      try {
        fn(status());
      } catch {
        /* listener errors never break storage */
      }
    }
  }
  function localAccount() {
    return readLocal().localAccount || null;
  }
  function status() {
    const local = localAccount();
    if (remote()) {
      return {
        cloud: configured(),
        signedIn: true,
        email: session?.user?.email || "",
        userId: session?.user?.id || "",
        mode: "cloud",
      };
    }
    if (local?.email) {
      // OTP requested but not verified yet — must not count as signed in,
      // or onboarding skips the code step and dumps users onto the landing sim.
      if (local.awaitingCode || local.awaitingLink) {
        return {
          cloud: configured(),
          signedIn: false,
          email: local.email,
          userId: "",
          mode: "awaiting-otp",
          awaitingCode: true,
        };
      }
      return {
        cloud: configured(),
        signedIn: true,
        email: local.email,
        userId: local.id || "local",
        mode: configured() ? "pending-cloud" : "local",
      };
    }
    return {
      cloud: configured(),
      signedIn: false,
      email: "",
      userId: "",
      mode: configured() ? "cloud-ready" : "local-ready",
    };
  }
  function check(res) {
    if (res?.error) throw new Error(res.error.message || "Could not reach your Repertoire");
    return res?.data;
  }

  /* ---------------- accounts ---------------- */

  function ownerEmail() {
    return String(window.LUNE_CONFIG?.ownerEmail || "")
      .trim()
      .toLowerCase();
  }
  function isOwner() {
    const st = status();
    const mine = ownerEmail();
    return !!(st.signedIn && mine && String(st.email || "").trim().toLowerCase() === mine);
  }

  /**
   * Owner-only user count for documentation. Prefers the secured RPC
   * `owner_user_count` (see supabase/schema.sql); falls back to a documented
   * dashboard query if the RPC isn't installed yet.
   */
  async function ownerUserCount() {
    if (!isOwner()) throw new Error("Owner sign-in required.");
    if (!configured() || !client) {
      return { users: null, mode: "local", note: "Cloud accounts aren’t configured on this build." };
    }
    try {
      const { data, error } = await client.rpc("owner_user_count");
      if (error) throw error;
      const n = typeof data === "number" ? data : Number(data);
      if (!Number.isFinite(n)) throw new Error("Unexpected count");
      return { users: n, mode: "rpc" };
    } catch (err) {
      return {
        users: null,
        mode: "dashboard",
        note:
          "Run the owner_user_count function from supabase/schema.sql in the Supabase SQL editor, or count users there: select count(*) from auth.users;",
        error: err?.message || String(err),
      };
    }
  }

  async function signIn(email) {
    const clean = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error("That doesn’t look like an email address.");
    // Cloud email OTP when Supabase is wired; otherwise create a local account so the
    // gate + onboarding work before mail is set up.
    // Email must use the OTP template with {{ .Token }} (see docs/ACCOUNTS.md).
    if (configured() && client) {
      check(
        await client.auth.signInWithOtp({
          email: clean,
          options: {
            shouldCreateUser: true,
            // Omit emailRedirectTo so the mailer prefers the OTP code path
            // when the Magic Link / Confirm signup templates use {{ .Token }}.
          },
        })
      );
      mutateLocal((d) => {
        d.localAccount = {
          email: clean,
          id: d.localAccount?.id || uuid(),
          created_at: nowIso(),
          awaitingLink: true,
          awaitingCode: true,
        };
      });
      emit();
      return { mode: "otp", email: clean };
    }
    mutateLocal((d) => {
      d.localAccount = { email: clean, id: uuid(), created_at: nowIso(), awaitingLink: false, awaitingCode: false };
    });
    emit();
    return { mode: "local", email: clean };
  }
  /** Confirm the email OTP from Supabase (`verifyOtp`, type email). Codes are typically 8 digits. */
  async function verifyOtp(email, token) {
    const clean = String(email || "").trim().toLowerCase();
    const code = String(token || "").replace(/\D+/g, "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error("That doesn’t look like an email address.");
    if (!/^\d{6,8}$/.test(code)) throw new Error("Enter the code from your email (usually 8 digits).");
    if (configured() && client) {
      check(await client.auth.verifyOtp({ email: clean, token: code, type: "email" }));
      const { data } = await client.auth.getSession();
      session = data?.session || null;
      mutateLocal((d) => {
        d.localAccount = {
          email: clean,
          id: d.localAccount?.id || session?.user?.id || uuid(),
          created_at: d.localAccount?.created_at || nowIso(),
          awaitingLink: false,
          awaitingCode: false,
        };
      });
      emit();
      // Merge cloud prefs, then push local onboarding answers if newer.
      try {
        await pullPrefs();
        await syncPrefs();
      } catch {
        /* prefs optional */
      }
      return { mode: "otp", email: clean };
    }
    completeLocalSignIn(clean);
    return { mode: "local", email: clean };
  }
  /** Confirm local signup (used when cloud OTP isn’t available yet). */
  function completeLocalSignIn(email) {
    const clean = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error("That doesn’t look like an email address.");
    mutateLocal((d) => {
      d.localAccount = {
        email: clean,
        id: d.localAccount?.id || uuid(),
        created_at: nowIso(),
        awaitingLink: false,
        awaitingCode: false,
      };
    });
    emit();
    return true;
  }
  async function signOut() {
    if (client) await client.auth.signOut();
    session = null;
    mutateLocal((d) => {
      d.localAccount = null;
    });
    emit();
  }
  async function deleteAccount() {
    if (remote()) {
      check(await client.rpc("delete_my_account"));
      await client.auth.signOut();
      session = null;
    }
    mutateLocal((d) => {
      d.localAccount = null;
      d.repertoire = [];
      d.notes = [];
      d.cards = [];
      d.stumbles = [];
      d.scores = {};
      d.tasks = [];
      d.prefs = {};
    });
    emit();
  }

  /* ---------------- practice tasks (self-set plans) ---------------- */

  function listTasks() {
    const d = readLocal();
    return [...(d.tasks || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }
  function addTask(task) {
    const row = {
      id: uuid(),
      piece_key: task.piece_key || "",
      title: String(task.title || "Practice").slice(0, 200),
      composer: String(task.composer || "").slice(0, 120),
      bars: [...new Set((task.bars || []).map(Number).filter((n) => n > 0))].sort((a, b) => a - b).slice(0, 64),
      notes: String(task.notes || "").slice(0, 800),
      plan: task.plan || null,
      done: false,
      created_at: nowIso(),
    };
    mutateLocal((d) => {
      d.tasks = d.tasks || [];
      d.tasks.unshift(row);
    });
    emit();
    return row;
  }
  function updateTask(id, patch) {
    mutateLocal((d) => {
      const row = (d.tasks || []).find((t) => t.id === id);
      if (!row) return;
      if ("done" in patch) row.done = !!patch.done;
      if ("plan" in patch) row.plan = patch.plan;
      if ("notes" in patch) row.notes = String(patch.notes || "").slice(0, 800);
      if ("bars" in patch) {
        row.bars = [...new Set((patch.bars || []).map(Number).filter((n) => n > 0))].sort((a, b) => a - b).slice(0, 64);
      }
    });
    emit();
  }
  function removeTask(id) {
    mutateLocal((d) => {
      d.tasks = (d.tasks || []).filter((t) => t.id !== id);
    });
    emit();
  }

  /** Copy everything kept in this browser into the signed-in account. */
  async function importLocalIntoAccount() {
    if (!remote()) return 0;
    const data = readLocal();
    let moved = 0;
    for (const p of data.repertoire) {
      await addPiece({ ...p, musicxml: data.scores[p.piece_key] || null });
      moved++;
    }
    for (const n of data.notes) {
      await addNote({ pieceKey: n.piece_key, bar: n.bar, body: n.body, tags: n.tags, source: n.source });
      moved++;
    }
    for (const c of data.cards) {
      check(await client.from("bar_cards").upsert(stripLocal(c), { onConflict: "user_id,piece_key,bar" }));
      moved++;
    }
    for (const s of data.stumbles) {
      check(await client.from("stumbles").insert(stripLocal(s)));
    }
    writeLocal({ ...readLocal(), repertoire: [], notes: [], cards: [], stumbles: [], scores: {} });
    return moved;
  }
  function stripLocal(row) {
    const { id, user_id, ...rest } = row;
    return rest;
  }
  function hasLocalData() {
    const d = readLocal();
    return d.repertoire.length + d.notes.length + d.cards.length > 0;
  }

  /* ---------------- Repertoire ---------------- */

  async function listPieces() {
    if (remote()) {
      return check(await client.from("repertoire").select("*").order("last_practised_at", { ascending: false, nullsFirst: false })) || [];
    }
    const d = readLocal();
    return [...d.repertoire].sort((a, b) => String(b.last_practised_at || b.added_at).localeCompare(String(a.last_practised_at || a.added_at)));
  }
  async function getPiece(pieceKey) {
    const all = await listPieces();
    return all.find((p) => p.piece_key === pieceKey) || null;
  }
  async function addPiece({ piece_key, pieceKey, title, composer = "", status = "learning", source = "catalogue", musicxml = null }) {
    const key = piece_key || pieceKey;
    if (!key || !title) throw new Error("Missing piece");
    if (remote()) {
      let score_path = null;
      if (source === "upload" && musicxml) {
        score_path = `${session.user.id}/${key.replace(/[^A-Za-z0-9_-]/g, "_")}.musicxml`;
        const blob = new Blob([musicxml], { type: "application/vnd.recordare.musicxml+xml" });
        check(await client.storage.from("scores").upload(score_path, blob, { upsert: true, contentType: blob.type }));
      }
      const row = { piece_key: key, title, composer, status, source, score_path };
      return check(await client.from("repertoire").upsert(row, { onConflict: "user_id,piece_key" }).select().single());
    }
    return mutateLocal((d) => {
      let row = d.repertoire.find((p) => p.piece_key === key);
      if (!row) {
        row = { id: uuid(), piece_key: key, title, composer, status, source, added_at: nowIso(), last_practised_at: null };
        d.repertoire.push(row);
      } else Object.assign(row, { title, composer });
      if (source === "upload" && musicxml) d.scores[key] = musicxml;
      return row;
    });
  }
  async function updatePiece(pieceKey, patch) {
    const allowed = {};
    for (const k of ["status", "last_practised_at", "title"]) if (k in patch) allowed[k] = patch[k];
    if (remote()) {
      check(await client.from("repertoire").update(allowed).eq("piece_key", pieceKey));
      return;
    }
    mutateLocal((d) => {
      const row = d.repertoire.find((p) => p.piece_key === pieceKey);
      if (row) Object.assign(row, allowed);
    });
  }
  async function removePiece(pieceKey) {
    if (remote()) {
      const row = await getPiece(pieceKey);
      if (row?.score_path) await client.storage.from("scores").remove([row.score_path]);
      check(await client.from("repertoire").delete().eq("piece_key", pieceKey));
      return;
    }
    mutateLocal((d) => {
      d.repertoire = d.repertoire.filter((p) => p.piece_key !== pieceKey);
      delete d.scores[pieceKey];
    });
  }
  /** MusicXML for an uploaded piece kept in Repertoire. */
  async function loadUploadedScore(pieceKey) {
    if (remote()) {
      const row = await getPiece(pieceKey);
      if (!row?.score_path) return null;
      const { data, error } = await client.storage.from("scores").download(row.score_path);
      if (error) return null;
      return await data.text();
    }
    return readLocal().scores[pieceKey] || null;
  }
  async function markPractised(pieceKey) {
    if (!(await getPiece(pieceKey))) return;
    await updatePiece(pieceKey, { last_practised_at: nowIso() });
  }

  /* ---------------- bar notes ---------------- */

  async function listNotes(pieceKey) {
    if (remote()) {
      return check(await client.from("bar_notes").select("*").eq("piece_key", pieceKey).order("created_at")) || [];
    }
    return readLocal().notes.filter((n) => n.piece_key === pieceKey);
  }
  async function countNotesByPiece() {
    if (remote()) {
      const rows = check(await client.from("bar_notes").select("piece_key")) || [];
      return rows.reduce((m, r) => ((m[r.piece_key] = (m[r.piece_key] || 0) + 1), m), {});
    }
    return readLocal().notes.reduce((m, r) => ((m[r.piece_key] = (m[r.piece_key] || 0) + 1), m), {});
  }
  async function addNote({ pieceKey, bar, body, tags = [], source = "text" }) {
    const text = String(body || "").trim().slice(0, 500);
    if (!text) throw new Error("Write or say something first.");
    const row = { piece_key: pieceKey, bar: Number(bar) || 0, body: text, tags, source };
    if (remote()) return check(await client.from("bar_notes").insert(row).select().single());
    return mutateLocal((d) => {
      const full = { id: uuid(), created_at: nowIso(), ...row };
      d.notes.push(full);
      return full;
    });
  }
  async function deleteNote(id) {
    if (remote()) {
      check(await client.from("bar_notes").delete().eq("id", id));
      return;
    }
    mutateLocal((d) => {
      d.notes = d.notes.filter((n) => n.id !== id);
    });
  }

  /* ---------------- review cards (spaced repetition) ---------------- */

  const DAY = 86400000;
  /** SM-2 style scheduling, tuned for practice (minutes → days → weeks). */
  function schedule(card, grade) {
    const c = { ease: 2.5, interval_days: 0, reps: 0, lapses: 0, ...card };
    if (grade === "again") {
      c.lapses += 1;
      c.reps = 0;
      c.ease = Math.max(1.3, c.ease - 0.2);
      c.interval_days = 0; // later today
      c.due_at = new Date(Date.now() + 10 * 60000).toISOString();
    } else {
      c.reps += 1;
      if (grade === "hard") c.ease = Math.max(1.3, c.ease - 0.15);
      if (grade === "easy") c.ease = c.ease + 0.15;
      const base = c.reps === 1 ? 1 : c.reps === 2 ? 3 : c.interval_days * c.ease;
      const mult = grade === "hard" ? 0.6 : grade === "easy" ? 1.4 : 1;
      c.interval_days = Math.max(1, Math.round(base * mult * 10) / 10);
      c.due_at = new Date(Date.now() + c.interval_days * DAY).toISOString();
    }
    c.last_grade = grade;
    c.updated_at = nowIso();
    return c;
  }
  async function listCards(pieceKey = null) {
    if (remote()) {
      let q = client.from("bar_cards").select("*");
      if (pieceKey) q = q.eq("piece_key", pieceKey);
      return check(await q.order("due_at")) || [];
    }
    const cards = readLocal().cards;
    return (pieceKey ? cards.filter((c) => c.piece_key === pieceKey) : cards).sort((a, b) => a.due_at.localeCompare(b.due_at));
  }
  async function dueCards(limit = 12) {
    const now = nowIso();
    return (await listCards()).filter((c) => c.due_at <= now).slice(0, limit);
  }
  async function reviewBar(pieceKey, bar, grade) {
    const existing = (await listCards(pieceKey)).find((c) => c.bar === Number(bar)) || { piece_key: pieceKey, bar: Number(bar) };
    const next = schedule(existing, grade);
    const row = {
      piece_key: pieceKey,
      bar: Number(bar),
      ease: next.ease,
      interval_days: next.interval_days,
      reps: next.reps,
      lapses: next.lapses,
      due_at: next.due_at,
      last_grade: next.last_grade,
      updated_at: next.updated_at,
    };
    if (remote()) {
      check(await client.from("bar_cards").upsert(row, { onConflict: "user_id,piece_key,bar" }));
    } else {
      mutateLocal((d) => {
        const i = d.cards.findIndex((c) => c.piece_key === pieceKey && c.bar === Number(bar));
        if (i >= 0) d.cards[i] = row;
        else d.cards.push(row);
      });
    }
    await markPractised(pieceKey);
    return row;
  }
  /** Put a bar in the review queue without grading it (e.g. from a stumble). */
  async function queueBar(pieceKey, bar) {
    const existing = (await listCards(pieceKey)).find((c) => c.bar === Number(bar));
    if (existing) return existing;
    const row = { piece_key: pieceKey, bar: Number(bar), ease: 2.5, interval_days: 0, reps: 0, lapses: 0, due_at: nowIso(), last_grade: null, updated_at: nowIso() };
    if (remote()) check(await client.from("bar_cards").upsert(row, { onConflict: "user_id,piece_key,bar" }));
    else mutateLocal((d) => d.cards.push(row));
    return row;
  }

  /* ---------------- stumbles (listening mode) ---------------- */

  async function addStumbles(pieceKey, perBar) {
    const rows = Object.entries(perBar)
      .filter(([, v]) => (v.wrong || 0) + (v.hesitations || 0) > 0)
      .map(([bar, v]) => ({ piece_key: pieceKey, bar: Number(bar), wrong: v.wrong || 0, hesitations: v.hesitations || 0 }));
    if (!rows.length) return 0;
    if (remote()) check(await client.from("stumbles").insert(rows));
    else mutateLocal((d) => d.stumbles.push(...rows.map((r) => ({ id: uuid(), created_at: nowIso(), ...r }))));
    return rows.length;
  }
  /** bar → { wrong, hesitations, sessions } over the last 30 days. */
  async function stumbleMap(pieceKey) {
    const since = new Date(Date.now() - 30 * DAY).toISOString();
    let rows;
    if (remote()) rows = check(await client.from("stumbles").select("*").eq("piece_key", pieceKey).gte("created_at", since)) || [];
    else rows = readLocal().stumbles.filter((s) => s.piece_key === pieceKey && s.created_at >= since);
    const map = {};
    for (const r of rows) {
      const m = (map[r.bar] = map[r.bar] || { wrong: 0, hesitations: 0, sessions: 0 });
      m.wrong += r.wrong;
      m.hesitations += r.hesitations;
      m.sessions += 1;
    }
    return map;
  }

  /* ---------------- study (anonymous) ---------------- */

  async function addStudyRows(rows) {
    if (client) {
      const { error } = await client.from("study_results").insert(rows);
      if (!error) return "cloud";
    }
    mutateLocal((d) => {
      d.study = d.study || [];
      d.study.push(...rows);
    });
    return "device";
  }
  function localStudyRows() {
    return readLocal().study || [];
  }

  /* ---------------- preferences + export ---------------- */

  function prefs() {
    return readLocal().prefs || {};
  }
  function setPref(key, value) {
    mutateLocal((d) => {
      d.prefs = d.prefs || {};
      d.prefs[key] = value;
    });
  }
  /** Cloud-safe subset of onboarding / studio prefs (no huge blobs). */
  function prefsForCloud() {
    const p = prefs();
    const keys = [
      "onboarded",
      "grade",
      "aspireGrade",
      "composers",
      "practiceDays",
      "practiceMins",
      "dreamPiece",
      "recommendations",
      "progression",
      "welcomeVersion",
      "seenWelcome",
    ];
    const out = {};
    for (const k of keys) if (p[k] !== undefined) out[k] = p[k];
    return out;
  }
  async function syncPrefs() {
    if (!remote()) return false;
    try {
      const uid = session.user.id;
      const payload = { id: uid, prefs: prefsForCloud() };
      await client.from("profiles").upsert(payload, { onConflict: "id" });
      return true;
    } catch (err) {
      console.warn("[lune] prefs sync skipped", err);
      return false;
    }
  }
  async function pullPrefs() {
    if (!remote()) return false;
    try {
      const uid = session.user.id;
      const { data, error } = await client.from("profiles").select("prefs").eq("id", uid).maybeSingle();
      if (error) throw error;
      const remotePrefs = data?.prefs;
      if (!remotePrefs || typeof remotePrefs !== "object") return false;
      mutateLocal((d) => {
        d.prefs = { ...(d.prefs || {}), ...remotePrefs };
      });
      emit();
      return true;
    } catch (err) {
      console.warn("[lune] prefs pull skipped", err);
      return false;
    }
  }
  async function exportAll() {
    const pieces = await listPieces();
    const notes = [];
    for (const p of pieces) notes.push(...(await listNotes(p.piece_key)));
    return {
      exported_at: nowIso(),
      account: status().email || "this browser",
      repertoire: pieces,
      bar_notes: notes,
      bar_cards: await listCards(),
      tasks: listTasks(),
      prefs: prefs(),
    };
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /** Tests only: use a ready-made client + session (no email round trip). */
  function __attach(c, s) {
    client = c;
    session = s;
    emit();
  }

  return {
    __attach,
    init,
    status,
    configured,
    onChange,
    signIn,
    verifyOtp,
    completeLocalSignIn,
    signOut,
    deleteAccount,
    isOwner,
    ownerUserCount,
    importLocalIntoAccount,
    hasLocalData,
    listPieces,
    getPiece,
    addPiece,
    updatePiece,
    removePiece,
    loadUploadedScore,
    markPractised,
    listNotes,
    countNotesByPiece,
    addNote,
    deleteNote,
    listCards,
    dueCards,
    reviewBar,
    queueBar,
    schedule,
    addStumbles,
    stumbleMap,
    addStudyRows,
    localStudyRows,
    listTasks,
    addTask,
    updateTask,
    removeTask,
    prefs,
    setPref,
    syncPrefs,
    pullPrefs,
    exportAll,
  };
})();
