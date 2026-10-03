/* Lune — letters and finger numbers as an engraved "lyric lane".
 *
 * Instead of searching for empty space around each notehead (which can never
 * be guaranteed on dense pages), the labels are written into the MusicXML as
 * lyric lines before OSMD engraves it. The engraver then:
 *   - reserves a band under each staff for them (nothing else is drawn there),
 *   - centres every label under its own note,
 *   - widens bars when labels would touch, exactly as it does for sung text.
 * So labels can never sit on ink or on each other, at any width.
 *
 * Chords: one line per chord tone, highest pitch on the top line, across all
 * voices of the staff at that moment. Tied continuations get no label.
 */
window.LuneLane = (function () {
  const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const ACC = { "-2": "♭♭", "-1": "♭", 0: "", 1: "♯", 2: "♯♯" };
  // Placeholder text for the reserved spare line (hidden after engraving).
  const SPARE = "~";

  const kid = (el, tag) => {
    for (const c of el.children) if (c.nodeName === tag) return c;
    return null;
  };
  const kidText = (el, tag, d = "") => {
    const k = kid(el, tag);
    return k ? k.textContent.trim() : d;
  };

  function noteInfo(note) {
    const pitch = kid(note, "pitch");
    if (!pitch || kid(note, "rest") || kid(note, "grace")) return null;
    const step = kidText(pitch, "step", "C").toUpperCase();
    const alter = Math.round(Number(kidText(pitch, "alter", "0")) || 0);
    const octave = parseInt(kidText(pitch, "octave", "4"), 10);
    const ties = [...note.children].filter((c) => c.nodeName === "tie").map((t) => t.getAttribute("type"));
    return {
      midi: (octave + 1) * 12 + STEP_PC[step] + alter,
      letter: `${step}${ACC[alter] ?? ""}`,
      staff: parseInt(kidText(note, "staff", "1"), 10) || 1,
      tieStop: ties.includes("stop"), // continuation of a held note: no new label
    };
  }

  /** All pitched notes of a measure with their onset (in divisions). */
  function measureNotes(measure) {
    const out = [];
    let pos = 0;
    let lastOnset = 0;
    for (const el of measure.children) {
      const tag = el.nodeName;
      if (tag === "backup") pos -= parseInt(kidText(el, "duration", "0"), 10) || 0;
      else if (tag === "forward") pos += parseInt(kidText(el, "duration", "0"), 10) || 0;
      else if (tag === "note") {
        const isChord = !!kid(el, "chord");
        const isGrace = !!kid(el, "grace");
        const dur = parseInt(kidText(el, "duration", "0"), 10) || 0;
        const onset = isChord ? lastOnset : pos;
        if (!isChord) {
          lastOnset = pos;
          if (!isGrace) pos += dur;
        }
        const info = noteInfo(el);
        if (info) out.push({ el, onset, ...info });
      }
    }
    return out;
  }

  /* ---- fingers: pair each engraved note with the analysis by exact pitch ---- */

  function pitchFit(midis, d) {
    const pool = [...(d?.rh || []), ...(d?.lh || [])].map((n) => Number(n.midi) || 0);
    if (!pool.length || !midis.length) return 0;
    let score = 0;
    for (const g of midis) {
      let i = pool.indexOf(g);
      if (i >= 0) { score += 1; pool.splice(i, 1); continue; }
      i = pool.findIndex((x) => (x - g) % 12 === 0);
      if (i >= 0) { score += 0.6; pool.splice(i, 1); }
    }
    return score / Math.max(midis.length, 1);
  }

  function fingerMap(byNum, debriefs) {
    // printed bar → analysis bar, by note content (numbering can differ)
    const map = new Map();
    let shift = 0;
    const used = new Set();
    for (const [num, notes] of byNum) {
      const midis = notes.filter((n) => !n.tieStop).map((n) => n.midi);
      let best = null;
      let bestScore = 0.25;
      for (const s of [shift, 0, -1, 1, -2, 2]) {
        const key = String(num + s);
        if (used.has(key) || !debriefs[key]) continue;
        const sc = pitchFit(midis, debriefs[key]) - Math.abs(s - shift) * 0.02;
        if (sc > bestScore) { bestScore = sc; best = { key, s }; }
      }
      if (!best) continue;
      used.add(best.key);
      shift = best.s;
      const d = debriefs[best.key];
      const pool = [...(d.rh || []), ...(d.lh || [])].map((n) => ({ ...n }));
      for (const n of notes) {
        if (n.tieStop) continue;
        const preferHand = n.staff >= 2 ? "LH" : "RH";
        const take = (midi) => {
          let idx = pool.findIndex((p) => p.midi === midi && p.hand === preferHand);
          if (idx < 0) idx = pool.findIndex((p) => p.midi === midi);
          return idx >= 0 ? pool.splice(idx, 1)[0] : null;
        };
        const hit = take(n.midi) || take(n.midi + 12) || take(n.midi - 12);
        const f = hit && /^[1-5]$/.test(String(hit.fingering ?? "")) ? String(hit.fingering) : "";
        if (f) map.set(n.el, f);
      }
    }
    return map;
  }

  /**
   * Drop notes the edition marks as not printed (print-object="no").
   *
   * Engravers add hidden voices so playback can spell out a rolled chord.
   * The engraver here still drew their stems and ledger lines and left the
   * heads transparent, so a bar looked like it had lost its note heads.
   * For the page, a hidden note is only time passing: chord members are
   * removed and the first note becomes a <forward> of the same length.
   * Sound and analysis keep using the untouched MusicXML.
   */
  function printed(xml) {
    if (!xml || !xml.includes('print-object="no"')) return xml;
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) return xml;
    const hidden = (n) => n.getAttribute("print-object") === "no";
    let changed = false;
    for (const note of [...doc.getElementsByTagName("note")]) {
      if (!note.parentNode || !hidden(note) || !kid(note, "pitch")) continue;
      // Hidden notes inside a beam hold the beam together — leave those alone.
      if (kid(note, "beam")) continue;
      if (kid(note, "chord") || kid(note, "grace")) {
        note.remove();
        changed = true;
        continue;
      }
      // Printed notes stacked on a hidden one: the first printed note leads the chord.
      let next = note.nextElementSibling;
      let heir = null;
      while (next && next.nodeName === "note" && kid(next, "chord")) {
        if (!hidden(next)) { heir = next; break; }
        next = next.nextElementSibling;
      }
      if (heir) {
        kid(heir, "chord").remove();
        note.remove();
        changed = true;
        continue;
      }
      const dur = kid(note, "duration");
      if (!dur) continue;
      const fwd = doc.createElement("forward");
      fwd.appendChild(dur.cloneNode(true));
      note.replaceWith(fwd);
      changed = true;
    }
    return changed ? new XMLSerializer().serializeToString(doc) : xml;
  }

  /**
   * Return MusicXML with a lyric lane. mode: "letters" | "fingers" | "off".
   * Existing lyrics are removed (piano scores rarely carry any; a lane must
   * never mix with sung text).
   */
  /**
   * mode "both" engraves the letter names and remembers each label's finger
   * number beside it, so switching Notes / Fingers / Off afterwards is a text
   * swap on the page instead of a second engraving. Each label carries an
   * invisible tag (zero-width characters) that identifies it after the
   * engraver has drawn it; `labels` maps that tag back to letter and finger.
   */
  let labels = [];
  const ZW = ["\u200B", "\u200C"];
  const tag = (i) => "\u2060" + i.toString(2).split("").map((b) => ZW[Number(b)]).join("");
  function untag(text) {
    const at = String(text || "").indexOf("\u2060");
    if (at < 0) return null;
    const bits = [...text.slice(at + 1)].map((c) => ZW.indexOf(c)).filter((b) => b >= 0);
    return labels[parseInt(bits.join("") || "0", 2)] || null;
  }

  function build(xml, { mode = "letters", debriefs = {} } = {}) {
    if (!xml || mode === "off") return xml;
    const both = mode === "both";
    if (both) labels = [];
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) return xml;
    for (const l of [...doc.getElementsByTagName("lyric")]) l.remove();

    const parts = [...doc.documentElement.children].filter((c) => c.nodeName === "part");
    const byNum = new Map();
    const perMeasure = [];
    parts.forEach((part, pi) => {
      for (const m of [...part.children].filter((c) => c.nodeName === "measure")) {
        const notes = measureNotes(m).map((n) => ({ ...n, staff: parts.length > 1 ? (pi === 0 ? 1 : 2) : n.staff }));
        perMeasure.push(notes);
        const num = parseInt(m.getAttribute("number"), 10);
        const key = Number.isFinite(num) ? num : perMeasure.length;
        if (!byNum.has(key)) byNum.set(key, []);
        byNum.get(key).push(...notes);
      }
    });
    const fingers = mode === "fingers" || both ? fingerMap(byNum, debriefs || {}) : null;

    // Most label lines any chord needs, per staff — plus one spare line that
    // stays empty: labels in impossibly dense spots drop onto it (zig-zag),
    // and because the engraver reserved it, nothing else is drawn there.
    const maxLines = new Map();
    for (const notes of perMeasure) {
      const count = new Map();
      for (const n of notes) {
        if (n.tieStop) continue;
        const k = `${n.staff}@${n.onset}`;
        const set = count.get(k) || new Set();
        set.add(n.midi);
        count.set(k, set);
        maxLines.set(n.staff, Math.max(maxLines.get(n.staff) || 0, set.size));
      }
    }
    const addLyric = (el, number, text) => {
      const lyric = doc.createElement("lyric");
      lyric.setAttribute("number", String(number));
      lyric.setAttribute("placement", "below");
      const syl = doc.createElement("syllabic");
      syl.textContent = "single";
      const t = doc.createElement("text");
      t.textContent = text;
      lyric.appendChild(syl);
      lyric.appendChild(t);
      el.appendChild(lyric);
    };

    for (const notes of perMeasure) {
      // spare line: one invisible placeholder per staff per bar
      const firstByStaff = new Map();
      for (const n of notes) {
        if (n.tieStop) continue;
        const f = firstByStaff.get(n.staff);
        if (!f || n.onset < f.onset) firstByStaff.set(n.staff, n);
      }
      for (const [staff, n] of firstByStaff) addLyric(n.el, (maxLines.get(staff) || 1) + 1, SPARE);
      // group by staff + onset across voices → one chord column
      const groups = new Map();
      for (const n of notes) {
        if (n.tieStop) continue;
        const k = `${n.staff}@${n.onset}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(n);
      }
      for (const g of groups.values()) {
        g.sort((a, b) => b.midi - a.midi); // highest first → top line
        // a unison doubled across voices is one key → one label
        const uniq = g.filter((n, i) => i === 0 || n.midi !== g[i - 1].midi);
        uniq.forEach((n, i) => {
          if (both) {
            labels.push({ letter: n.letter, finger: fingers.get(n.el) || "" });
            addLyric(n.el, i + 1, n.letter + tag(labels.length - 1));
            return;
          }
          const text = fingers ? fingers.get(n.el) || "" : n.letter;
          if (!text) return;
          addLyric(n.el, i + 1, text);
        });
      }
    }
    return new XMLSerializer().serializeToString(doc);
  }

  return { build, printed, untag, SPARE };
})();
