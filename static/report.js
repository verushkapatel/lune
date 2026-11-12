/* Lune — the session report.
 *
 * When you leave a piece after real practice, one quiet full-screen page:
 * the composer, the minutes, the bars you worked, how each bar you rated went,
 * Lune AI's two lines, and the bars that come back next. Done closes it.
 */
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const GRADE = { again: "Again", hard: "Hard", okay: "Okay", good: "Good", strong: "Strong", easy: "Strong" };
  const when = (iso) => {
    const d = new Date(iso);
    const days = Math.round((new Date(d.toDateString()) - new Date(new Date().toDateString())) / 86400000);
    if (days <= 0) return "later today";
    if (days === 1) return "tomorrow";
    if (days < 7) return d.toLocaleDateString("en-GB", { weekday: "long" });
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  };
  function show(r) {
    // only after real practice: a rating, or several bars played, or a question asked
    if (!r || (!r.rated?.length && (r.played || 0) < 4 && !r.asked)) return;
    document.querySelector(".lr-sheet")?.remove();
    const face = window.luneFace?.(r.composer);
    const stats = [
      [r.mins || "<1", (r.mins || 0) <= 1 ? "minute" : "minutes"],
      [r.played || 0, r.played === 1 ? "bar played" : "bars played"],
      [r.rated?.length || 0, r.rated?.length === 1 ? "bar rated" : "bars rated"],
    ];
    const el = document.createElement("div");
    el.className = "lr-sheet";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", `Session report: ${r.title}`);
    el.innerHTML = `
      <div class="lr-card">
        ${face ? `<span class="lr-face" aria-hidden="true" style="background-image:url('${face}')"></span>` : ""}
        <p class="lr-k">Tonight's practice</p>
        <h2>${esc(r.title)}</h2>
        ${r.composer ? `<p class="lr-by">${esc(r.composer)}</p>` : ""}
        <dl class="lr-stats">${stats.map(([n, l]) => `<div><dt>${esc(n)}</dt><dd>${esc(l)}</dd></div>`).join("")}</dl>
        ${
          r.rated?.length
            ? `<p class="lr-h">How the bars went</p><ul class="lr-bars">${r.rated
                .slice(0, 12)
                .map((b) => `<li class="g-${esc(b.grade)}"><b>Bar ${esc(b.bar)}</b><span>${esc(GRADE[b.grade] || b.grade)}</span></li>`)
                .join("")}</ul>`
            : ""
        }
        ${r.text ? `<p class="lr-h">${r.via === "model" ? "Lune AI" : "In short"}</p><p class="lr-text">${esc(r.text)}</p>` : ""}
        ${
          r.soon?.length
            ? `<p class="lr-h">Coming back</p><p class="lr-soon">${r.soon.map((x) => `Bar ${esc(x.bar)} ${esc(when(x.due))}`).join(" · ")}</p>`
            : ""
        }
        <div class="lr-nav">
          <button type="button" class="lr-rep">Open my Repertoire</button>
          <button type="button" class="lr-done">Done</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("on"));
    const close = () => {
      el.classList.remove("on");
      setTimeout(() => el.remove(), 380);
    };
    el.querySelector(".lr-done").addEventListener("click", close);
    el.querySelector(".lr-rep").addEventListener("click", () => {
      close();
      location.hash = "#/repertoire";
    });
    el.addEventListener("click", (e) => e.target === el && close());
    document.addEventListener("keydown", function esc2(e) {
      if (e.key === "Escape") {
        close();
        document.removeEventListener("keydown", esc2);
      }
    });
    setTimeout(() => el.querySelector(".lr-done")?.focus(), 60);
  }
  document.addEventListener("lune:session-report", (e) => show(e.detail));
  window.LuneReport = { show };
})();
