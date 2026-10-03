/* Lune — feedback: what changed, in the pianist's or teacher's own words.
 *
 * Opens from the home page, the More menu, the footer, or a direct link
 * (#feedback, #feedback/teacher). Answers are emailed to the maker through
 * the relay in lune-config.js and also saved to the `feedback` table when it
 * exists (see supabase/schema.sql). If neither works the same answers open
 * as an email draft, so nothing a person wrote is lost. The form never asks
 * for the sender's email address.
 *
 * A quote is only ever usable when the person chose to allow it — the owner
 * view keeps "do not quote" rows out of everything it copies.
 */
window.LuneFeedback = (function () {
  const $ = (id) => document.getElementById(id);
  const store = () => window.LuneStore;
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const ROLES = [
    ["pianist", "I play"],
    ["teacher", "I teach"],
    ["supporter", "I support a pianist"],
  ];
  const READS = [
    ["print", "Standard print"],
    ["large-print", "Large print"],
    ["screen-reader", "Screen reader"],
    ["braille", "Braille"],
  ];
  const QUOTE = [
    ["no", "Keep this private"],
    ["anonymous", "You may quote it, without my name"],
    ["first-name", "You may quote it with my first name"],
  ];
  const QUOTE_LABEL = { no: "Private — do not quote", anonymous: "Quotable, anonymous", "first-name": "Quotable with first name" };
  const READ_LABEL = Object.fromEntries(READS);

  const closeRow = `<form method="dialog" class="credits-close-row">
    <button type="submit" class="icon-btn" aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
  </form>`;

  function dialog(id) {
    let d = $(id);
    if (!d) {
      d = document.createElement("dialog");
      d.id = id;
      document.body.appendChild(d);
    }
    d.className = "credits-dialog auth-dialog impact-dialog feedback-dialog";
    return d;
  }

  function feedbackEmail() {
    return window.LUNE_CONFIG?.feedbackEmail || "info@lune.page";
  }

  function summary(row) {
    return [
      `I am: ${row.role}`,
      row.reads.length ? `I read music with: ${row.reads.map((r) => READ_LABEL[r]).join(", ")}` : "",
      row.helped ? `How much Lune helped (1–5): ${row.helped}` : "",
      row.weeks != null ? `Weeks using Lune: ${row.weeks}` : "",
      "",
      "What changed:",
      row.changed,
      row.missing ? `\nWhat is missing or gets in the way:\n${row.missing}` : "",
      "",
      `Quote permission: ${QUOTE_LABEL[row.quote_ok]}`,
      row.name ? `First name: ${row.name}` : "",
    ]
      .filter((l) => l !== "")
      .join("\n");
  }

  /** The same answers as a mail draft — used only when nothing else could take them. */
  function mailDraft(row) {
    return `mailto:${feedbackEmail()}?subject=${encodeURIComponent("Lune feedback")}&body=${encodeURIComponent(summary(row))}`;
  }

  /** Email the answers to the maker through the form relay. Resolves true when accepted. */
  async function relay(row, trap) {
    const base = window.LUNE_CONFIG?.feedbackRelay;
    if (!base || trap) return false; // the hidden field is only ever filled by bots
    const res = await fetch(base + encodeURIComponent(feedbackEmail()), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        _subject: `Lune feedback — ${row.role}${row.quote_ok === "no" ? "" : " (quotable)"}`,
        _template: "table",
        _captcha: "false",
        role: row.role,
        reads: row.reads.map((r) => READ_LABEL[r]).join(", ") || "—",
        "what changed": row.changed,
        "what is missing": row.missing || "—",
        "helped (1-5)": row.helped ?? "—",
        "weeks of use": row.weeks ?? "—",
        "quote permission": QUOTE_LABEL[row.quote_ok],
        "first name": row.name || "—",
      }),
    });
    if (!res.ok) return false;
    const body = await res.json().catch(() => ({}));
    return String(body.success) === "true";
  }

  function open({ role = "pianist" } = {}) {
    const d = dialog("feedback-dialog");
    const radio = (name, list, picked) =>
      list
        .map(
          ([v, label]) =>
            `<label class="impact-check"><input type="radio" name="${name}" value="${v}" ${v === picked ? "checked" : ""}> ${esc(label)}</label>`
        )
        .join("");
    d.innerHTML = `${closeRow}
      <p class="auth-kicker">Feedback</p>
      <h2 id="feedback-h">What changed for you?</h2>
      <p class="create-account-story">I’m Verushka. I read every one of these myself. Two minutes — say it however you’d say it to a friend.</p>
      <form id="feedback-form" novalidate>
        <fieldset class="impact-fieldset">
          <legend>You</legend>
          ${radio("fb-role", ROLES, role)}
        </fieldset>
        <fieldset class="impact-fieldset">
          <legend>How you read music <span class="dim">(optional — tick any)</span></legend>
          ${READS.map(([v, label]) => `<label class="impact-check"><input type="checkbox" name="fb-reads" value="${v}"> ${esc(label)}</label>`).join("")}
        </fieldset>
        <label for="fb-changed">What changed in your practice or teaching?</label>
        <textarea id="fb-changed" rows="4" maxlength="1200" required aria-describedby="fb-changed-hint"></textarea>
        <p class="dim feedback-hint" id="fb-changed-hint">A bar you finally got, a student who came back prepared, something that still doesn’t work — all of it helps.</p>
        <label for="fb-missing">What’s missing or gets in your way? <span class="dim">(optional)</span></label>
        <textarea id="fb-missing" rows="2" maxlength="1200"></textarea>
        <div class="feedback-pair">
          <div>
            <label for="fb-helped">How much did Lune help?</label>
            <select id="fb-helped">
              <option value="">Choose</option>
              <option value="1">1 — not at all</option>
              <option value="2">2 — a little</option>
              <option value="3">3 — somewhat</option>
              <option value="4">4 — a lot</option>
              <option value="5">5 — I’d miss it</option>
            </select>
          </div>
          <div>
            <label for="fb-weeks">Weeks you’ve used it</label>
            <input id="fb-weeks" type="number" inputmode="numeric" min="0" max="520" placeholder="e.g. 3">
          </div>
        </div>
        <fieldset class="impact-fieldset">
          <legend>May I quote you?</legend>
          ${radio("fb-quote", QUOTE, "no")}
          <p class="dim feedback-hint">A quote might appear on Lune or in a school or university application. Never your surname, email, or school. Under 18? Please check with a parent or guardian first.</p>
        </fieldset>
        <label for="fb-name">First name <span class="dim">(optional)</span></label>
        <input id="fb-name" type="text" maxlength="40" autocomplete="given-name">
        <input id="fb-trap" class="visually-hidden" type="text" tabindex="-1" autocomplete="off" aria-hidden="true">
        <div class="onboard-nav auth-keep-nav">
          <button type="button" class="quiet" data-fb-cancel>Not now</button>
          <button type="submit" class="primary">Send</button>
        </div>
        <p class="auth-msg dim" id="feedback-msg" role="status" aria-live="polite"></p>
      </form>`;
    d.setAttribute("aria-labelledby", "feedback-h");
    if (!d.open) d.showModal();
    d.querySelector("[data-fb-cancel]")?.addEventListener("click", () => d.close());

    const form = d.querySelector("#feedback-form");
    const msg = d.querySelector("#feedback-msg");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const changed = d.querySelector("#fb-changed");
      const text = changed.value.trim();
      if (!text) {
        msg.textContent = "Write a sentence about what changed, then send.";
        changed.focus();
        return;
      }
      const weeksRaw = d.querySelector("#fb-weeks").value.trim();
      const weeks = weeksRaw === "" ? null : Math.max(0, Math.min(520, Math.round(Number(weeksRaw)) || 0));
      const quote = form.querySelector('input[name="fb-quote"]:checked')?.value || "no";
      const row = {
        role: form.querySelector('input[name="fb-role"]:checked')?.value || "pianist",
        reads: [...form.querySelectorAll('input[name="fb-reads"]:checked')].map((el) => el.value),
        helped: Number(d.querySelector("#fb-helped").value) || null,
        weeks,
        changed: text,
        missing: d.querySelector("#fb-missing").value.trim() || null,
        // a name is only kept when the person asked to be quoted by it
        name: quote === "first-name" ? d.querySelector("#fb-name").value.trim() || null : null,
        quote_ok: quote,
      };
      const send = form.querySelector('button[type="submit"]');
      send.disabled = true;
      msg.textContent = "Sending…";
      // Email it and save it; either one arriving means it was received.
      const trap = d.querySelector("#fb-trap").value;
      const [mailed, saved] = await Promise.all([
        relay(row, trap).catch(() => false),
        store()
          .addFeedback(row)
          .then((w) => w === "cloud")
          .catch(() => false),
      ]);
      send.disabled = false;
      if (mailed || saved) {
        form.innerHTML = `<p class="feedback-thanks" role="status">Thank you. I’ll read this tonight.</p>
          <div class="onboard-nav auth-keep-nav"><button type="button" class="primary" data-fb-cancel>Done</button></div>`;
        form.querySelector("[data-fb-cancel]").addEventListener("click", () => d.close());
        form.querySelector("[data-fb-cancel]").focus();
        return;
      }
      // Nothing took it — hand the same words to the person's mail app.
      msg.innerHTML = `Lune couldn’t send that just now. <a href="${esc(mailDraft(row))}">Send it as an email instead</a> — your answers are already filled in.`;
    });
    setTimeout(() => d.querySelector('input[name="fb-role"]:checked')?.focus(), 0);
  }

  /* ---------- owner: what has come in ---------- */

  function quoteLine(r) {
    const who =
      r.quote_ok === "first-name" && r.name
        ? r.name
        : r.role === "teacher"
          ? "A piano teacher"
          : r.role === "supporter"
            ? "A parent or supporter"
            : "A pianist";
    const how = (r.reads || []).filter((x) => x !== "print").map((x) => READ_LABEL[x].toLowerCase());
    return `“${r.changed}” — ${who}${how.length ? `, reads with ${how.join(" and ")}` : ""}`;
  }

  function csv(rows) {
    const cols = ["created_at", "role", "reads", "helped", "weeks", "quote_ok", "name", "changed", "missing"];
    const cell = (v) => `"${String(Array.isArray(v) ? v.join(" ") : v ?? "").replace(/"/g, '""')}"`;
    return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
  }

  async function openOwner() {
    const s = store();
    if (!s?.isOwner?.()) {
      window.toast?.("Owner sign-in required");
      return;
    }
    const d = dialog("owner-feedback-dialog");
    d.innerHTML = `${closeRow}<p class="auth-kicker">Owner</p><h2>Feedback received</h2>
      <div id="owner-feedback-body"><p class="dim">Loading…</p></div>
      <div class="onboard-nav auth-keep-nav">
        <button type="button" class="quiet" data-fb-csv hidden>Download CSV</button>
        <button type="button" class="quiet" data-fb-copy hidden>Copy quotable lines</button>
        <button type="button" class="primary" data-fb-done>Done</button>
      </div>
      <p class="auth-msg dim" id="owner-feedback-msg" role="status" aria-live="polite"></p>`;
    if (!d.open) d.showModal();
    d.querySelector("[data-fb-done]").addEventListener("click", () => d.close());
    const body = d.querySelector("#owner-feedback-body");
    const msg = d.querySelector("#owner-feedback-msg");
    let rows = [];
    try {
      rows = await s.ownerFeedback();
    } catch (err) {
      body.innerHTML = `<p class="dim">${esc(err.message || String(err))}</p>`;
      return;
    }
    const count = (fn) => rows.filter(fn).length;
    const helped = rows.map((r) => Number(r.helped)).filter(Boolean);
    const mean = helped.length ? (helped.reduce((a, b) => a + b, 0) / helped.length).toFixed(1) : "—";
    const quotable = rows.filter((r) => r.quote_ok !== "no");
    body.innerHTML = `
      <div class="impact-stats impact-stats-owner">
        <div><span class="impact-num">${count((r) => r.role === "pianist")}</span><span class="dim">pianists · goal 10</span></div>
        <div><span class="impact-num">${count((r) => r.role === "teacher")}</span><span class="dim">teachers · goal 2</span></div>
        <div><span class="impact-num">${count((r) => (r.reads || []).some((x) => x !== "print"))}</span><span class="dim">large print, screen reader or braille</span></div>
        <div><span class="impact-num">${mean}</span><span class="dim">mean “helped”, of 5 (${helped.length} answer${helped.length === 1 ? "" : "s"})</span></div>
      </div>
      ${
        rows.length
          ? `<ul class="feedback-list">${rows
              .map(
                (r) => `<li>
                  <p class="feedback-quote">${esc(r.changed)}</p>
                  ${r.missing ? `<p class="dim">Missing: ${esc(r.missing)}</p>` : ""}
                  <p class="dim feedback-meta">${esc(r.role)}${r.name ? ` · ${esc(r.name)}` : ""}${
                    (r.reads || []).length ? ` · ${esc(r.reads.map((x) => READ_LABEL[x]).join(", "))}` : ""
                  }${r.helped ? ` · helped ${esc(r.helped)}/5` : ""}${r.weeks != null ? ` · ${esc(r.weeks)} wk` : ""} · ${esc(
                    String(r.created_at || "").slice(0, 10)
                  )} · <strong>${esc(QUOTE_LABEL[r.quote_ok] || QUOTE_LABEL.no)}</strong></p>
                </li>`
              )
              .join("")}</ul>`
          : `<p class="dim">Nothing yet. Send people lune.page/#feedback — see docs/OUTREACH.md.</p>`
      }`;
    const csvBtn = d.querySelector("[data-fb-csv]");
    const copyBtn = d.querySelector("[data-fb-copy]");
    csvBtn.hidden = !rows.length;
    copyBtn.hidden = !quotable.length;
    csvBtn.addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv(rows)], { type: "text/csv" }));
      a.download = `lune-feedback-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(quotable.map(quoteLine).join("\n\n"));
        msg.textContent = `Copied ${quotable.length} — private answers were left out.`;
      } catch {
        msg.textContent = "Couldn’t copy — use Download CSV instead.";
      }
    });
  }

  /* ---------- entry points ---------- */

  function handleRoute() {
    const m = /^#feedback(?:\/(pianist|teacher|supporter))?$/.exec(location.hash || "");
    if (!m) return false;
    open({ role: m[1] || "pianist" });
    return true;
  }

  function init() {
    document.addEventListener("click", (e) => {
      const b = e.target.closest?.("[data-open-feedback]");
      if (!b) return;
      e.preventDefault();
      open({ role: b.getAttribute("data-open-feedback") || "pianist" });
    });
    window.addEventListener("hashchange", handleRoute);
    // let the app settle on its first screen before a dialog opens over it
    setTimeout(handleRoute, 600);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();

  return { open, openOwner, handleRoute };
})();
