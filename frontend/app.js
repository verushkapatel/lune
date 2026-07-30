/* Lune — chat client with local accounts */

const $ = (id) => document.getElementById(id);

const state = {
  account: null,
  status: { hasAccounts: false, sharedKey: false },
  threads: [],
  activeId: null,
  messages: [],
  pending: [],
  busy: false,
  authMode: "login",
};

const PREF_FIELDS = [
  "instrument",
  "level",
  "noteNames",
  "handSpan",
  "verbosity",
  "provider",
  "model",
  "textSize",
  "romanNumerals",
  "alwaysFingering",
  "practiceTips",
  "detailBars",
  "sendOnEnter",
];

async function api(path, options = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...options });
  if (res.status === 401 && !path.startsWith("/api/auth")) {
    showGate();
    throw new Error("Please sign in.");
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data.detail) detail = data.detail;
    } catch {
      /* keep default */
    }
    throw new Error(detail);
  }
  return res.status === 204 ? null : res.json();
}

const json = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const put = (body) => ({ ...json(body), method: "PUT" });

/* gate */

function showGate() {
  state.account = null;
  $("gate").hidden = false;
  $("app").hidden = true;
  setAuthMode(state.status.hasAccounts ? "login" : "signup");
  $("auth-username").focus();
}

function showApp() {
  $("gate").hidden = true;
  $("app").hidden = false;
  grow();
}

function setAuthMode(mode) {
  const status = state.status;
  if (mode === "signup" && status.signupsOpen === false) mode = "login";

  state.authMode = mode;
  $("field-display").hidden = mode !== "signup";
  $("field-invite").hidden = !(mode === "signup" && status.inviteRequired);
  $("auth-submit").textContent = mode === "signup" ? "Create account" : "Sign in";
  $("auth-password").autocomplete =
    mode === "signup" ? "new-password" : "current-password";
  $("auth-error").hidden = true;

  document.querySelectorAll("#auth-tabs .tab").forEach((tab) => {
    tab.classList.toggle("on", tab.dataset.mode === mode);
    if (tab.dataset.mode === "signup") tab.hidden = status.signupsOpen === false;
  });

  // Hosted and local installs make very different promises about the data.
  const hosted = Boolean(status.sharedKey);
  $("gate-tag").textContent = hosted
    ? "Ask a musician, not a chatbot."
    : "Your music assistant, on your own machine.";
  $("gate-note").textContent = hosted
    ? "Your conversations are stored on this server. There is no password reset, so pick something you will remember."
    : "Accounts are stored only on this computer. Nothing is uploaded to us, and there is no password reset, so pick something you will remember.";
}

document.querySelectorAll("#auth-tabs .tab").forEach((tab) =>
  tab.addEventListener("click", () => setAuthMode(tab.dataset.mode))
);

$("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const username = $("auth-username").value.trim();
  const password = $("auth-password").value;
  const displayName = $("auth-display").value.trim();
  const inviteCode = $("auth-invite").value.trim();
  const path = state.authMode === "signup" ? "/api/auth/signup" : "/api/auth/login";

  $("auth-submit").disabled = true;
  try {
    state.account = await api(
      path,
      json({ username, password, displayName, inviteCode })
    );
    $("auth-password").value = "";
    state.status.hasAccounts = true;
    showApp();
    applyAccount();
    await loadThreads();
  } catch (err) {
    const box = $("auth-error");
    box.textContent = err.message;
    box.hidden = false;
  } finally {
    $("auth-submit").disabled = false;
  }
});

/* account and preferences */

function prefs() {
  return (state.account && state.account.preferences) || {};
}

function applyAccount() {
  const account = state.account;
  if (!account) return;

  const p = account.preferences;
  document.body.dataset.text = p.textSize || "medium";

  $("settings-label").textContent = account.displayName || "Settings";
  $("acct-display").value = account.displayName || "";
  $("acct-username").textContent = `Signed in as ${account.username}.`;

  for (const field of PREF_FIELDS) {
    const el = $(`pref-${field}`);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = Boolean(p[field]);
    else el.value = p[field];
  }

  const isPiano = p.instrument === "piano";
  $("field-span").hidden = !isPiano;
  $("span-note").hidden = !isPiano;

  drawKeyNote();
  drawFoot();
}

function drawKeyNote() {
  const account = state.account;
  if (!account) return;

  const note = $("key-note");
  const allowance = account.allowance || {};

  if (account.apiKey.locked) {
    note.textContent =
      "Your saved key is locked until you sign in again. Until then Lune uses the shared allowance.";
    note.className = "note warn";
  } else if (account.apiKey.saved) {
    const provider = account.apiKey.provider === "anthropic" ? "Anthropic" : "OpenAI";
    note.textContent = `${provider} key saved (${account.apiKey.hint}). Your usage is unlimited and billed to you.`;
    note.className = "note";
  } else if (account.usingSharedKey) {
    note.textContent =
      allowance.remaining === null || allowance.remaining === undefined
        ? "Using the key provided with Lune."
        : `Using the shared allowance: ${allowance.remaining} of ${allowance.perDay} messages left today. Add your own key for unlimited use.`;
    note.className = "note";
  } else {
    note.textContent = "No key saved yet. Lune cannot answer until you add one.";
    note.className = "note warn";
  }
}

function drawFoot(remaining) {
  const foot = $("foot");
  const account = state.account;

  if (account && account.needsKey) {
    foot.className = "foot warn";
    foot.textContent = "Add your API key in Settings to start.";
    return;
  }

  const allowance = (account && account.allowance) || {};
  const left = remaining === undefined ? allowance.remaining : remaining;

  if (allowance.metered && typeof left === "number" && left <= 5) {
    foot.className = "foot warn";
    foot.textContent =
      left === 0
        ? "You've used today's messages. Add your own API key in Settings to keep going."
        : `${left} message${left === 1 ? "" : "s"} left today.`;
    return;
  }

  foot.className = "foot";
  foot.textContent = "Lune can misread unclear images and will say so.";
}

let saveTimer = null;

function flash(message) {
  const note = $("saved-note");
  note.textContent = message;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => (note.textContent = ""), 2200);
}

function collectPrefs() {
  const next = { ...prefs() };
  for (const field of PREF_FIELDS) {
    const el = $(`pref-${field}`);
    if (!el) continue;
    if (el.type === "checkbox") next[field] = el.checked;
    else if (el.type === "number") next[field] = Number(el.value) || 80;
    else next[field] = el.value;
  }
  return next;
}

async function savePrefs() {
  const next = collectPrefs();
  document.body.dataset.text = next.textSize || "medium";
  $("field-span").hidden = next.instrument !== "piano";
  $("span-note").hidden = next.instrument !== "piano";

  try {
    const data = await api("/api/preferences", put({ preferences: next }));
    state.account.preferences = data.preferences;
    flash("Saved");
  } catch (err) {
    flash(err.message);
  }
}

for (const field of PREF_FIELDS) {
  const el = $(`pref-${field}`);
  if (!el) continue;
  const event = el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input";
  el.addEventListener(event, () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(savePrefs, el.type === "checkbox" || el.tagName === "SELECT" ? 0 : 500);
  });
}

$("save-key").addEventListener("click", async () => {
  const value = $("api-key").value.trim();
  if (!value) return flash("Paste a key first");
  try {
    state.account = await api("/api/account/key", put({ apiKey: value }));
    $("api-key").value = "";
    applyAccount();
    flash("Key saved");
  } catch (err) {
    flash(err.message);
  }
});

$("clear-key").addEventListener("click", async () => {
  try {
    state.account = await api("/api/account/key", put({ apiKey: "" }));
    $("api-key").value = "";
    applyAccount();
    flash("Key removed");
  } catch (err) {
    flash(err.message);
  }
});

$("acct-display").addEventListener("change", async () => {
  const displayName = $("acct-display").value.trim();
  if (!displayName) return;
  try {
    state.account = await api("/api/account/profile", put({ displayName }));
    applyAccount();
    flash("Saved");
  } catch (err) {
    flash(err.message);
  }
});

$("save-password").addEventListener("click", async () => {
  const currentPassword = $("pw-current").value;
  const newPassword = $("pw-new").value;
  try {
    await api("/api/account/password", put({ currentPassword, newPassword }));
    $("pw-current").value = "";
    $("pw-new").value = "";
    flash("Password updated");
  } catch (err) {
    flash(err.message);
  }
});

$("sign-out").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  $("settings").hidden = true;
  state.threads = [];
  state.messages = [];
  state.activeId = null;
  showGate();
});

$("delete-account").addEventListener("click", async () => {
  const sure = window.confirm(
    "Delete this account and every conversation in it? This cannot be undone."
  );
  if (!sure) return;
  await api("/api/account", { method: "DELETE" }).catch(() => {});
  $("settings").hidden = true;
  state.status.hasAccounts = false;
  showGate();
});

/* threads */

async function loadThreads() {
  const data = await api("/api/threads");
  state.threads = data.threads;

  if (!state.threads.length) {
    await newChat();
    return;
  }

  if (!state.activeId || !state.threads.some((t) => t.id === state.activeId)) {
    await openThread(state.threads[0].id);
  } else {
    drawThreads();
  }
}

async function newChat() {
  const existing = state.threads.find((t) => t.count === 0);
  if (existing) return openThread(existing.id);

  const thread = await api("/api/threads", { method: "POST" });
  state.threads.unshift({ id: thread.id, title: thread.title, count: 0 });
  state.activeId = thread.id;
  state.messages = [];
  drawThreads();
  drawMessages();
  $("input").focus();
}

async function openThread(id) {
  const data = await api(`/api/threads/${id}`);
  state.activeId = id;
  state.messages = data.messages;
  drawThreads();
  drawMessages();
}

function drawThreads() {
  const holder = $("threads");
  holder.innerHTML = "";

  for (const thread of state.threads) {
    if (!thread.count && thread.id !== state.activeId) continue;

    const row = document.createElement("div");
    row.className = "thread-row" + (thread.id === state.activeId ? " on" : "");

    const label = document.createElement("span");
    label.textContent = thread.title;
    row.appendChild(label);

    const del = document.createElement("button");
    del.type = "button";
    del.title = "Delete";
    del.innerHTML = '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
    del.addEventListener("click", async (event) => {
      event.stopPropagation();
      await api(`/api/threads/${thread.id}`, { method: "DELETE" }).catch(() => {});
      state.threads = state.threads.filter((t) => t.id !== thread.id);
      if (state.activeId === thread.id) {
        state.activeId = null;
        state.messages = [];
      }
      await loadThreads();
    });
    row.appendChild(del);

    row.addEventListener("click", () => openThread(thread.id));
    holder.appendChild(row);
  }
}

/* messages */

function drawMessages() {
  const thread = $("thread");
  thread.querySelectorAll(".msg").forEach((node) => node.remove());

  const has = state.messages.length > 0;
  $("hero").hidden = has;

  const active = state.threads.find((t) => t.id === state.activeId);
  $("top-title").textContent = has && active ? active.title : "";

  if (!has) return;
  for (const message of state.messages) thread.appendChild(node(message));
  bottom();
}

function node(message) {
  const wrap = document.createElement("article");
  wrap.className = `msg ${message.role}`;

  const holder = document.createElement("div");

  if (message.files && message.files.length) {
    const thumbs = document.createElement("div");
    thumbs.className = "thumbs";
    for (const file of message.files) {
      if (file.preview) {
        const img = document.createElement("img");
        img.src = file.preview;
        img.alt = file.name;
        thumbs.appendChild(img);
      } else {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = file.name;
        thumbs.appendChild(tag);
      }
    }
    holder.appendChild(thumbs);
  }

  const body = document.createElement("div");
  body.className = "body";
  if (message.role === "user") body.textContent = message.content;
  else body.innerHTML = LuneMarkdown.render(message.content);
  holder.appendChild(body);

  wrap.appendChild(holder);
  return wrap;
}

function bottom() {
  const thread = $("thread");
  thread.scrollTop = thread.scrollHeight;
}

/* attachments */

function drawFiles() {
  const holder = $("files");
  holder.innerHTML = "";
  holder.hidden = !state.pending.length;

  state.pending.forEach((entry, index) => {
    const item = document.createElement("div");
    item.className = "file";

    if (entry.preview) {
      const img = document.createElement("img");
      img.src = entry.preview;
      img.alt = "";
      item.appendChild(img);
    }

    const name = document.createElement("span");
    name.textContent = entry.file.name;
    item.appendChild(name);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.innerHTML = '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
    remove.addEventListener("click", () => {
      state.pending.splice(index, 1);
      drawFiles();
    });
    item.appendChild(remove);

    holder.appendChild(item);
  });
}

function addFiles(list) {
  for (const file of list) {
    const entry = { file, preview: null };
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => {
        entry.preview = reader.result;
        drawFiles();
      };
      reader.readAsDataURL(file);
    }
    state.pending.push(entry);
  }
  drawFiles();
}

/* send */

async function send() {
  if (state.busy || !state.account) return;

  const input = $("input");
  const text = input.value.trim();
  if (!text && !state.pending.length) return;

  if (!state.activeId) await newChat();

  const files = state.pending.map((e) => ({ name: e.file.name, preview: e.preview }));
  const content =
    text || "I've attached a page of music. Read it and tell me what you see.";

  state.messages.push({ role: "user", content, files });

  input.value = "";
  grow();
  $("hero").hidden = true;
  $("thread").appendChild(node(state.messages[state.messages.length - 1]));

  const reply = node({ role: "assistant", content: "" });
  const body = reply.querySelector(".body");
  body.innerHTML = '<span class="caret"></span>';
  $("thread").appendChild(reply);
  bottom();

  const form = new FormData();
  form.append("payload", JSON.stringify({ threadId: state.activeId, content }));
  for (const entry of state.pending) form.append("files", entry.file, entry.file.name);

  state.pending = [];
  drawFiles();

  state.busy = true;
  $("send").disabled = true;
  let answer = "";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });

    if (res.status === 401) {
      showGate();
      throw new Error("Your session expired. Please sign in again.");
    }

    if (!res.ok || !res.body) {
      let detail = `Request failed (${res.status})`;
      try {
        const data = await res.json();
        if (data.detail) detail = data.detail;
      } catch {
        /* keep default */
      }
      throw new Error(detail);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        const type = (part.match(/^event:\s*(\w+)/m) || [])[1];
        const raw = (part.match(/^data:\s*(.*)$/m) || [])[1];
        if (!type || !raw) continue;

        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          continue;
        }

        if (type === "delta" && data.text) {
          answer += data.text;
          body.innerHTML = LuneMarkdown.render(answer);
          bottom();
        } else if (type === "done") {
          if (typeof data.remaining === "number" && state.account.allowance) {
            state.account.allowance.remaining = data.remaining;
            drawFoot(data.remaining);
          }
        } else if (type === "error") {
          throw new Error(data.message || "Something went wrong");
        }
      }
    }

    state.messages.push({ role: "assistant", content: answer });
    const data = await api("/api/threads");
    state.threads = data.threads;
    drawThreads();
    const active = state.threads.find((t) => t.id === state.activeId);
    if (active) $("top-title").textContent = active.title;
  } catch (err) {
    body.innerHTML = `<p class="error">${LuneMarkdown.escapeHtml(err.message)}</p>`;
  } finally {
    state.busy = false;
    $("send").disabled = false;
    $("input").focus();
  }
}

/* composer events */

function grow() {
  const input = $("input");
  input.style.height = "auto";
  // Measuring while the app is hidden reports zero, which would collapse the box.
  const height = Math.min(input.scrollHeight, 200);
  input.style.height = height > 0 ? `${height}px` : "";
}

$("input").addEventListener("input", grow);

$("input").addEventListener("keydown", (event) => {
  const enterSends = prefs().sendOnEnter !== false;
  if (event.key !== "Enter") return;

  if (enterSends && !event.shiftKey) {
    event.preventDefault();
    send();
  } else if (!enterSends && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    send();
  }
});

$("composer").addEventListener("submit", (event) => {
  event.preventDefault();
  send();
});

$("attach").addEventListener("click", () => $("file-input").click());

$("file-input").addEventListener("change", () => {
  const picker = $("file-input");
  if (picker.files.length) addFiles(picker.files);
  picker.value = "";
});

document.addEventListener("paste", (event) => {
  if ($("app").hidden) return;
  const files = Array.from(event.clipboardData?.files || []);
  if (files.length) {
    event.preventDefault();
    addFiles(files);
  }
});

["dragover", "dragenter"].forEach((type) =>
  $("composer").addEventListener(type, (event) => {
    event.preventDefault();
    $("composer").classList.add("drop");
  })
);

["dragleave", "drop"].forEach((type) =>
  $("composer").addEventListener(type, (event) => {
    event.preventDefault();
    $("composer").classList.remove("drop");
    if (type === "drop" && event.dataTransfer?.files.length) {
      addFiles(event.dataTransfer.files);
    }
  })
);

document.querySelectorAll(".chip").forEach((chip) =>
  chip.addEventListener("click", () => {
    $("input").value = chip.dataset.prompt;
    grow();
    $("input").focus();
  })
);

$("new-chat").addEventListener("click", newChat);
$("toggle-sidebar").addEventListener("click", () => $("app").classList.add("collapsed"));
$("show-sidebar").addEventListener("click", () => $("app").classList.remove("collapsed"));

/* settings modal */

function openSettings() {
  applyAccount();
  $("settings").hidden = false;
}

function closeSettings() {
  $("settings").hidden = true;
  $("saved-note").textContent = "";
}

$("open-settings").addEventListener("click", openSettings);
$("close-settings").addEventListener("click", closeSettings);
$("done-settings").addEventListener("click", closeSettings);

$("settings").addEventListener("click", (event) => {
  if (event.target === $("settings")) closeSettings();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSettings();
});

/* layout */

const NARROW = 860;

if (window.innerWidth < NARROW) $("app").classList.add("collapsed");

window.addEventListener("resize", () => {
  if (window.innerWidth >= NARROW) $("app").classList.remove("collapsed");
});

$("thread").addEventListener("click", () => {
  if (window.innerWidth < NARROW) $("app").classList.add("collapsed");
});

/* boot */

async function boot() {
  try {
    state.status = await (await fetch("/api/status")).json();
  } catch {
    state.status = { hasAccounts: false, sharedKey: false };
  }

  try {
    const res = await fetch("/api/me", { credentials: "same-origin" });
    if (!res.ok) throw new Error("signed out");
    state.account = await res.json();
    showApp();
    applyAccount();
    await loadThreads();
  } catch {
    showGate();
  }

  grow();
}

boot();
