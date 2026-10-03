/* Lune — reading study: does the letter row under the notes help students
 * learn to read, or do they lean on it?
 *
 * Design (see docs/study-protocol.md):
 *   pre-test (16 notes, no labels) → training (24 notes, with or without the
 *   letter row, by condition) → post-test (16 new notes, no labels).
 * Condition comes from the participant code (balanced codes are made by
 * scripts/study_codes.py), so neither the student nor the teacher picks it.
 * Results are anonymous: participant code, answers, correctness, time.
 */
window.LuneStudy = (function () {
  const STUDY = "labels-v1";
  const TREBLE = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5", "D5", "E5", "F5", "G5", "A5"];
  const BASS = ["E2", "F2", "G2", "A2", "B2", "C3", "D3", "E3", "F3", "G3", "A3", "B3", "C4"];
  const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
  const N_TEST = 16;
  const N_TRAIN = 24;

  let osmd = null;
  let s = null; // session

  /** FNV-1a — the same function as scripts/study_codes.py. */
  function fnv(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  function conditionFor(code) {
    return fnv(code.toUpperCase()) % 2 === 0 ? "labels" : "no-labels";
  }
  function rng(seed) {
    let x = fnv(seed) || 1;
    return () => {
      x ^= x << 13;
      x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      return x / 4294967296;
    };
  }
  /** Half treble, half bass, shuffled, no note twice in a row. */
  function items(code, phase, n) {
    const r = rng(`${code.toUpperCase()}|${phase}`);
    const out = [];
    for (let i = 0; i < n; i++) {
      const clef = i < n / 2 ? "G" : "F";
      const pool = clef === "G" ? TREBLE : BASS;
      out.push({ clef, pitch: pool[Math.floor(r() * pool.length)] });
    }
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    for (let i = 1; i < out.length; i++) {
      if (out[i].pitch === out[i - 1].pitch && out[i].clef === out[i - 1].clef) {
        const k = (i + 2) % out.length;
        [out[i], out[k]] = [out[k], out[i]];
      }
    }
    return out;
  }
  function xmlFor(item) {
    const step = item.pitch[0];
    const octave = item.pitch.slice(1);
    const clef = item.clef === "G" ? "<sign>G</sign><line>2</line>" : "<sign>F</sign><line>4</line>";
    return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1"><part-list><score-part id="P1"><part-name print-object="no">P</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key>
<time print-object="no"><beats>4</beats><beat-type>4</beat-type></time><clef>${clef}</clef></attributes>
<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>4</duration><type>whole</type></note>
<barline location="right"><bar-style>none</bar-style></barline></measure></part></score-partwise>`;
  }

  /* ---------------- view ---------------- */

  function ensureView() {
    let main = $("study");
    if (main) return main;
    main = document.createElement("main");
    main.id = "study";
    main.className = "study";
    main.hidden = true;
    main.innerHTML = `<div class="study-inner" id="study-inner"></div>`;
    ($("repertoire") || $("studio"))?.after(main);
    main.addEventListener("keydown", (e) => e.stopPropagation());
    document.addEventListener("keydown", (e) => {
      if (main.hidden || !s?.awaiting) return;
      const k = e.key.toUpperCase();
      if (LETTERS.includes(k) && !e.target.closest?.("input, textarea")) {
        e.preventDefault();
        answer(k);
      }
    });
    return main;
  }
  const inner = () => $("study-inner");

  function show() {
    ensureView();
    stopAll?.();
    state.mode = "study";
    showView("study");
    document.title = "Reading study — Lune";
    intro();
  }

  function intro() {
    s = null;
    inner().innerHTML = `
      <p class="eyebrow">Lune reading study</p>
      <h1>How fast can you name a note?</h1>
      <p class="rep-lead">About ten minutes. You’ll see one note at a time and press its letter. First a short test, then some practice, then another short test.</p>
      <form class="study-start" id="study-start" autocomplete="off">
        <label for="study-code">Your participant code</label>
        <input id="study-code" required pattern="[A-Za-z0-9-]{2,24}" maxlength="24" placeholder="e.g. K7-QF" autocapitalize="characters">
        <p class="dim">Use the code your teacher gave you — never your name.</p>
        <label class="lp-switch"><input type="checkbox" id="study-consent" required>
          <span><strong>I agree to take part</strong><small>My parent or guardian and my teacher have said yes, and I know I can stop at any time.</small></span></label>
        <button type="submit" class="primary">Start</button>
      </form>
      <details class="study-about"><summary>What is recorded?</summary>
        <p>Only your code, which letter you pressed, whether it was right, and how long you took. No name, no email, no audio. Results go to the study’s private table${LuneStore.configured() ? "" : " — or stay on this device if the study’s storage isn’t set up — "} and are used only to find out whether letter names under the notes help people learn to read music.</p>
      </details>`;
    $("study-start").addEventListener("submit", (e) => {
      e.preventDefault();
      const code = $("study-code").value.trim().toUpperCase();
      if (!/^[A-Z0-9-]{2,24}$/.test(code)) return toast("Codes use letters, numbers and dashes.");
      s = {
        code,
        condition: conditionFor(code),
        phases: [
          { name: "pre", items: items(code, "pre", N_TEST), labels: false, feedback: false },
          { name: "train", items: items(code, "train", N_TRAIN), labels: null, feedback: true },
          { name: "post", items: items(code, "post", N_TEST), labels: false, feedback: false },
        ],
        phase: 0,
        i: 0,
        rows: [],
        summary: {},
      };
      s.phases[1].labels = s.condition === "labels";
      phaseIntro();
    });
  }

  function phaseIntro() {
    const ph = s.phases[s.phase];
    const copy = {
      pre: ["Test 1 of 2", "Name each note as quickly as you can without guessing. 16 notes."],
      train: ["Practice", `${N_TRAIN} notes. After each one you’ll see the right answer.${ph.labels ? " The letter is printed under the note — use it to learn the spot on the staff." : ""}`],
      post: ["Test 2 of 2", "Same as the first test, with new notes. 16 notes."],
    }[ph.name];
    inner().innerHTML = `<p class="eyebrow">${copy[0]}</p><h1>${ph.name === "train" ? "Practice" : "Name the note"}</h1>
      <p class="rep-lead">${copy[1]}</p><p class="dim">Press the letter on your keyboard, or tap it.</p>
      <button type="button" class="primary big" id="study-go">Begin</button>`;
    $("study-go").onclick = () => {
      s.i = 0;
      trial();
    };
    $("study-go").focus();
  }

  async function trial() {
    const ph = s.phases[s.phase];
    const item = ph.items[s.i];
    inner().innerHTML = `
      <div class="study-progress" aria-hidden="true"><i style="width:${(100 * s.i) / ph.items.length}%"></i></div>
      <p class="eyebrow">${ph.name === "train" ? "Practice" : ph.name === "pre" ? "Test 1" : "Test 2"} · ${s.i + 1} / ${ph.items.length}</p>
      <div class="study-staff" id="study-staff" aria-label="A note on a ${item.clef === "G" ? "treble" : "bass"} staff"></div>
      <div class="study-keys" role="group" aria-label="Note letters">
        ${LETTERS.map((l) => `<button type="button" class="study-key" data-l="${l}">${l}</button>`).join("")}
      </div>
      <p class="study-feedback" id="study-feedback" aria-live="assertive"></p>`;
    inner().querySelector(".study-keys").onclick = (e) => {
      const b = e.target.closest("[data-l]");
      if (b) answer(b.dataset.l);
    };
    await drawNote(item, ph.labels);
    s.awaiting = true;
    s.t = performance.now();
  }

  async function drawNote(item, labels) {
    const host = $("study-staff");
    host.innerHTML = "";
    osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(host, {
      autoResize: false,
      backend: "svg",
      drawTitle: false,
      drawComposer: false,
      drawCredits: false,
      drawPartNames: false,
      drawMeasureNumbers: false,
      drawLyrics: !!labels,
    });
    try {
      osmd.EngravingRules.LyricsHeight = 2.4;
      osmd.EngravingRules.LyricsYOffsetToStaffHeight = 1.4;
    } catch {
      /* older OSMD */
    }
    let xml = xmlFor(item);
    if (labels) xml = LuneLane.build(xml, { mode: "letters" });
    await osmd.load(xml);
    osmd.zoom = 2.2; // after load(), which resets zoom
    osmd.render();
    host.querySelectorAll("g.lyrics text").forEach((t) => {
      if (t.textContent.trim() === LuneLane.SPARE) t.style.display = "none";
      else t.classList.add("lane-letter");
    });
    await new Promise((r) => requestAnimationFrame(() => r()));
  }

  function answer(letter) {
    if (!s?.awaiting) return;
    s.awaiting = false;
    const ms = Math.min(120000, Math.round(performance.now() - s.t));
    const ph = s.phases[s.phase];
    const item = ph.items[s.i];
    const correct = letter === item.pitch[0];
    if (ph.name !== "train") {
      s.rows.push({ study: STUDY, participant: s.code, phase: ph.name, condition: s.condition, item: s.i, answer: letter, correct, ms });
    }
    const sum = (s.summary[ph.name] = s.summary[ph.name] || { n: 0, right: 0, ms: [] });
    sum.n++;
    if (correct) sum.right++;
    sum.ms.push(ms);
    const next = () => {
      s.i++;
      if (s.i < ph.items.length) trial();
      else endPhase();
    };
    inner().querySelectorAll(".study-key").forEach((b) => {
      b.disabled = true;
      if (ph.feedback && b.dataset.l === item.pitch[0]) b.classList.add("right");
      if (ph.feedback && b.dataset.l === letter && !correct) b.classList.add("wrong");
    });
    if (ph.feedback) {
      $("study-feedback").textContent = correct ? "Yes!" : `It’s ${item.pitch[0]}.`;
      setTimeout(next, correct ? 550 : 1300);
    } else setTimeout(next, 220);
  }

  async function endPhase() {
    const ph = s.phases[s.phase];
    if (ph.name !== "train") {
      const rows = s.rows.filter((r) => r.phase === ph.name);
      try {
        s.saved = await LuneStore.addStudyRows(rows);
      } catch {
        s.saved = "device";
      }
    }
    s.phase++;
    if (s.phase < s.phases.length) phaseIntro();
    else finish();
  }

  function stat(p) {
    const x = s.summary[p];
    if (!x) return { acc: 0, med: 0 };
    const m = [...x.ms].sort((a, b) => a - b);
    return { acc: Math.round((100 * x.right) / x.n), med: (m[Math.floor(m.length / 2)] / 1000).toFixed(1) };
  }
  function finish() {
    const a = stat("pre");
    const b = stat("post");
    inner().innerHTML = `<p class="eyebrow">All done</p><h1>Thank you!</h1>
      <div class="study-result">
        <div><span>Test 1</span><strong>${a.acc}%</strong><small>${a.med}s per note</small></div>
        <div><span>Test 2</span><strong>${b.acc}%</strong><small>${b.med}s per note</small></div>
      </div>
      <p class="rep-lead">Your answers were saved ${s.saved === "cloud" ? "to the study" : "on this device"} under code <strong>${escapeHtml(s.code)}</strong>.</p>
      <div class="lp-row">
        ${s.saved === "cloud" ? "" : `<button type="button" class="primary" id="study-csv">Download results (CSV)</button>`}
        <button type="button" class="quiet" id="study-again">Next participant</button>
        <button type="button" class="quiet" id="study-home">Back to Lune</button>
      </div>`;
    $("study-csv")?.addEventListener("click", downloadCsv);
    $("study-again").onclick = intro;
    $("study-home").onclick = () => goHome();
  }

  function downloadCsv() {
    const rows = LuneStore.localStudyRows();
    const head = ["study", "participant", "phase", "condition", "item", "answer", "correct", "ms"];
    const csv = [head.join(",")].concat(rows.map((r) => head.map((k) => JSON.stringify(r[k] ?? "")).join(","))).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "lune-study-results.csv";
    a.click();
  }

  return { show, conditionFor, items, fnv };
})();
