/* Lune — facts printed in a score, read once from its MusicXML.
 *
 * The key signature, key changes, time signatures, tempo marks, every
 * written word (con sordina, rall., Tempo I…), dynamics and pedal marks,
 * each with the bar it is in, plus the range each hand covers. Ask Lune and
 * the piece header use these so they never have to guess what the page
 * already says.
 *
 * MusicXML gives the key signature as a number of sharps or flats and only
 * sometimes says major or minor. When it doesn't, the mode is read from the
 * last bass note; if that is inconclusive both possibilities are given.
 */
window.LuneScoreFacts = (function () {
  const MAJOR = { "-7": "C♭", "-6": "G♭", "-5": "D♭", "-4": "A♭", "-3": "E♭", "-2": "B♭", "-1": "F", 0: "C", 1: "G", 2: "D", 3: "A", 4: "E", 5: "B", 6: "F♯", 7: "C♯" };
  const MINOR = { "-7": "A♭", "-6": "E♭", "-5": "B♭", "-4": "F", "-3": "C", "-2": "G", "-1": "D", 0: "A", 1: "E", 2: "B", 3: "F♯", 4: "C♯", 5: "G♯", 6: "D♯", 7: "A♯" };
  const COUNT = ["no", "one", "two", "three", "four", "five", "six", "seven"];
  const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const PC = { C: 0, "C♯": 1, "D♭": 1, D: 2, "D♯": 3, "E♭": 3, E: 4, F: 5, "F♯": 6, "G♭": 6, G: 7, "G♯": 8, "A♭": 8, A: 9, "A♯": 10, "B♭": 10, B: 11, "C♭": 11 };
  const UNIT = { whole: "semibreve", half: "minim", quarter: "crotchet", eighth: "quaver", "16th": "semiquaver" };
  const CROTCHETS = { whole: 4, half: 2, quarter: 1, eighth: 0.5, "16th": 0.25 };
  const cache = new WeakMap();

  const kid = (el, tag) => [...el.children].find((c) => c.nodeName === tag) || null;
  const text = (el, tag) => (kid(el, tag)?.textContent || "").trim();

  function signatureWords(fifths) {
    if (!fifths) return "no sharps or flats";
    const n = Math.abs(fifths);
    return `${COUNT[n] || n} ${fifths < 0 ? "flat" : "sharp"}${n === 1 ? "" : "s"}`;
  }

  function keyName(fifths, mode, lastBassPc) {
    const maj = MAJOR[fifths];
    const min = MINOR[fifths];
    if (!maj) return null;
    let m = /minor/i.test(mode || "") ? "minor" : /major/i.test(mode || "") ? "major" : null;
    if (!m && lastBassPc != null) {
      if (lastBassPc === PC[maj]) m = "major";
      else if (lastBassPc === PC[min]) m = "minor";
    }
    return {
      fifths,
      signature: signatureWords(fifths),
      name: m === "minor" ? `${min} minor` : m === "major" ? `${maj} major` : `${maj} major or ${min} minor`,
      certain: !!m,
    };
  }

  function read(xml) {
    const doc = typeof xml === "string" ? new DOMParser().parseFromString(xml, "application/xml") : xml;
    if (!doc || doc.getElementsByTagName("parsererror").length) return null;
    const parts = [...doc.getElementsByTagName("part")];
    if (!parts.length) return null;
    const out = { key: null, keyChanges: [], time: null, timeChanges: [], tempo: [], words: [], dynamics: [], pedalMarks: 0, range: {} };

    let lastBassPc = null;
    parts.forEach((part, pi) => {
      const measures = [...part.children].filter((m) => m.nodeName === "measure");
      measures.forEach((m, mi) => {
        const bar = parseInt(m.getAttribute("number"), 10) || mi + 1;
        for (const el of m.getElementsByTagName("*")) {
          const tag = el.nodeName;
          if (pi === 0 && tag === "key") {
            const fifths = parseInt(text(el, "fifths"), 10);
            if (Number.isFinite(fifths) && (out.keyChanges.length === 0 || out.keyChanges[out.keyChanges.length - 1].fifths !== fifths)) {
              out.keyChanges.push({ bar, fifths, mode: text(el, "mode") });
            }
          } else if (pi === 0 && tag === "time") {
            const t = `${text(el, "beats")}/${text(el, "beat-type")}`;
            if (t !== "/" && (!out.timeChanges.length || out.timeChanges[out.timeChanges.length - 1].time !== t)) out.timeChanges.push({ bar, time: t });
          } else if (pi === 0 && tag === "words") {
            const w = el.textContent.replace(/\s+/g, " ").trim();
            if (w && !out.words.some((x) => x.bar === bar && x.text === w)) out.words.push({ bar, text: w });
          } else if (pi === 0 && tag === "dynamics") {
            const d = el.firstElementChild?.nodeName;
            if (d && d !== "other-dynamics" && !out.dynamics.some((x) => x.bar === bar && x.mark === d)) out.dynamics.push({ bar, mark: d });
          } else if (pi === 0 && tag === "pedal") {
            if (el.getAttribute("type") === "start") out.pedalMarks += 1;
          } else if (pi === 0 && tag === "metronome") {
            const unit = text(el, "beat-unit");
            const per = parseFloat(text(el, "per-minute"));
            const dotted = !!kid(el, "beat-unit-dot");
            if (UNIT[unit] && per > 0) {
              out.tempo.push({ bar, mark: `${dotted ? "dotted " : ""}${UNIT[unit]} = ${per}`, crotchetsPerMinute: per * CROTCHETS[unit] * (dotted ? 1.5 : 1) });
            }
          } else if (tag === "note" && !kid(el, "rest")) {
            const p = kid(el, "pitch");
            if (!p) continue;
            const midi = (parseInt(text(p, "octave"), 10) + 1) * 12 + (STEP[text(p, "step")] ?? 0) + Math.round(Number(text(p, "alter")) || 0);
            const staff = parts.length > 1 ? (pi === 0 ? 1 : 2) : parseInt(text(el, "staff"), 10) || 1;
            const hand = staff >= 2 ? "leftHand" : "rightHand";
            const r = (out.range[hand] = out.range[hand] || { low: midi, high: midi });
            r.low = Math.min(r.low, midi);
            r.high = Math.max(r.high, midi);
            if (mi === measures.length - 1 && (lastBassPc == null || staff >= 2)) lastBassPc = ((midi % 12) + 12) % 12;
          }
        }
      });
    });
    // a sounding tempo with no printed metronome mark
    if (!out.tempo.length) {
      const s = doc.querySelector("sound[tempo]");
      const t = parseFloat(s?.getAttribute("tempo"));
      if (t > 0) out.tempo.push({ bar: 1, mark: `crotchet = ${Math.round(t)}`, crotchetsPerMinute: t, fromPlayback: true });
    }
    const first = out.keyChanges[0];
    if (first) out.key = keyName(first.fifths, first.mode, lastBassPc);
    out.keyChanges = out.keyChanges.slice(1).map((k) => ({ bar: k.bar, ...keyName(k.fifths, k.mode, null) }));
    out.time = out.timeChanges[0]?.time || null;
    out.timeChanges = out.timeChanges.slice(1);
    const name = (midi) => {
      const n = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][((midi % 12) + 12) % 12];
      return `${n}${Math.floor(midi / 12) - 1}`;
    };
    for (const h of Object.keys(out.range)) out.range[h] = { lowest: name(out.range[h].low), highest: name(out.range[h].high) };
    return out;
  }

  /** Facts for a piece, read once and kept with it. */
  function forPiece(piece) {
    if (!piece?.musicxml) return null;
    if (cache.has(piece)) return cache.get(piece);
    let facts = null;
    try {
      facts = read(piece.musicxml);
    } catch {
      facts = null;
    }
    cache.set(piece, facts);
    return facts;
  }

  /** Printed words and dynamics in a bar range (for a bar's context). */
  function near(facts, from, to = from) {
    if (!facts) return { words: [], dynamics: [] };
    const inRange = (x) => x.bar >= from && x.bar <= to;
    // a word printed before the bar still applies (con sordina in bar 1 governs bar 2)
    const before = facts.words.filter((w) => w.bar < from).slice(-2);
    return { words: [...before, ...facts.words.filter(inRange)], dynamics: facts.dynamics.filter(inRange) };
  }

  return { read, forPiece, near };
})();
