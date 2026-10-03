/* Lune — in-browser score analysis.
 *
 * The static site (GitHub Pages) has no Python server, so an uploaded
 * MusicXML/MXL file is read here: notes per bar, fingering (a port of
 * backend/fingering.py's cost search), bar difficulty, practice advice and a
 * practice plan — the same shapes the server returns, so the studio works the
 * same either way.
 */
window.LuneLite = (function () {
  /* ---------------- file reading ---------------- */

  class LiteError extends Error {}

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined") {
      throw new LiteError("This browser cannot open compressed .mxl files — export as uncompressed MusicXML (.musicxml) instead.");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** Minimal ZIP reader for .mxl (central directory + deflate/store). */
  async function unzipMxl(buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new LiteError("This .mxl file looks damaged — it is not a valid compressed MusicXML file.");
    const count = view.getUint16(eocd + 10, true);
    let ptr = view.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (view.getUint32(ptr, true) !== 0x02014b50) break;
      const method = view.getUint16(ptr + 10, true);
      const csize = view.getUint32(ptr + 20, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const local = view.getUint32(ptr + 42, true);
      const name = dec.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
      files[name] = { method, csize, local };
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    const read = async (name) => {
      const f = files[name];
      if (!f) return null;
      const lNameLen = view.getUint16(f.local + 26, true);
      const lExtraLen = view.getUint16(f.local + 28, true);
      const start = f.local + 30 + lNameLen + lExtraLen;
      const raw = bytes.subarray(start, start + f.csize);
      const out = f.method === 0 ? raw : await inflateRaw(raw);
      return dec.decode(out);
    };
    let root = null;
    const container = await read("META-INF/container.xml");
    if (container) {
      const m = container.match(/full-path\s*=\s*"([^"]+)"/);
      if (m) root = m[1];
    }
    if (!root) root = Object.keys(files).find((n) => /\.(xml|musicxml)$/i.test(n) && !n.startsWith("META-INF"));
    const xml = root ? await read(root) : null;
    if (!xml) throw new LiteError("No score found inside this .mxl file.");
    return xml;
  }

  /**
   * Read an uploaded File → MusicXML text, or throw a LiteError with a
   * message a pianist can act on.
   */
  async function readScoreFile(file) {
    const name = (file?.name || "").toLowerCase();
    if (!file || file.size === 0) throw new LiteError("That file is empty — choose a MusicXML file exported from MuseScore, Finale, Sibelius or Dorico.");
    if (file.size > 25 * 1024 * 1024) throw new LiteError("That file is over 25 MB — too large for a single score.");
    if (/\.(pdf)$/i.test(name) || file.type === "application/pdf") {
      throw new LiteError("PDFs can’t be read as notes in the browser yet. In MuseScore (free), open the PDF with “Import PDF”, then export MusicXML and upload that.");
    }
    if (/\.(png|jpe?g|heic|gif|webp|tiff?)$/i.test(name) || /^image\//.test(file.type)) {
      throw new LiteError("Photos can’t be read as notes in the browser yet. Export the piece as MusicXML from a notation app (MuseScore is free) and upload that.");
    }
    if (/\.mid(i)?$/i.test(name)) {
      throw new LiteError("MIDI files have no written notation. Open the MIDI in MuseScore, then export MusicXML and upload that.");
    }
    const buffer = await file.arrayBuffer();
    const head = new Uint8Array(buffer.slice(0, 4));
    let xml;
    if (/\.mxl$/i.test(name) || (head[0] === 0x50 && head[1] === 0x4b)) {
      xml = await unzipMxl(buffer);
    } else {
      xml = new TextDecoder().decode(buffer);
    }
    return validateMusicXml(xml);
  }

  function validateMusicXml(xml) {
    const text = String(xml || "").replace(/^﻿/, "");
    if (!text.trim()) throw new LiteError("That file is empty.");
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) {
      throw new LiteError("That file isn’t valid MusicXML — it may be damaged or a different kind of file. Try exporting it again as MusicXML.");
    }
    const root = doc.documentElement?.nodeName;
    if (root === "score-timewise") {
      throw new LiteError("This MusicXML is in the rare “timewise” layout. Re-export it from your notation app (the default “partwise” layout works).");
    }
    if (root !== "score-partwise") {
      throw new LiteError("That file isn’t a MusicXML score. Upload a .musicxml, .xml or .mxl file exported from a notation app.");
    }
    if (!doc.getElementsByTagName("note").length) {
      throw new LiteError("This score has no notes in it.");
    }
    return text;
  }

  /* ---------------- MusicXML → notes ---------------- */

  const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const ACC = { "-2": "bb", "-1": "b", 0: "", 1: "#", 2: "##" };
  const kid = (el, tag) => {
    if (!el) return null;
    for (const c of el.children) if (c.nodeName === tag) return c;
    return null;
  };
  const txt = (el, tag, d = "") => {
    const k = kid(el, tag);
    return k ? k.textContent.trim() : d;
  };

  function parseNotes(xml) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const title =
      txt(kid(doc.documentElement, "work"), "work-title") ||
      txt(doc.documentElement, "movement-title") ||
      [...doc.getElementsByTagName("credit-words")].map((c) => c.textContent.trim()).filter(Boolean)[0] ||
      "";
    let composer = "";
    for (const c of doc.getElementsByTagName("creator")) {
      if ((c.getAttribute("type") || "") === "composer") composer = c.textContent.trim();
    }
    const parts = [...doc.documentElement.children].filter((c) => c.nodeName === "part");
    const bars = new Map(); // number → { rh:[], lh:[], expressions:[], ql }
    let timeSignature = "";
    let tempo = "";
    let pickup = false;
    const order = [];

    parts.forEach((part, pi) => {
      let divisions = 1;
      let beatsQl = 4;
      const measures = [...part.children].filter((c) => c.nodeName === "measure");
      let seq = 0;
      measures.forEach((m, mi) => {
        const raw = parseInt(m.getAttribute("number"), 10);
        let num = Number.isFinite(raw) ? raw : seq + 1;
        if (mi === 0 && m.getAttribute("implicit") === "yes" && num === 1) num = 0;
        seq = num;
        if (!bars.has(num)) {
          bars.set(num, { rh: [], lh: [], expressions: [], ql: 0 });
          if (pi === 0) order.push(num);
        }
        const bar = bars.get(num);
        let pos = 0;
        let lastOnset = 0;
        let maxPos = 0;
        for (const el of m.children) {
          const tag = el.nodeName;
          if (tag === "attributes") {
            const dv = parseInt(txt(el, "divisions"), 10);
            if (dv > 0) divisions = dv;
            const time = kid(el, "time");
            if (time) {
              const b = parseInt(txt(time, "beats"), 10);
              const bt = parseInt(txt(time, "beat-type"), 10);
              if (b > 0 && bt > 0) {
                beatsQl = (b * 4) / bt;
                if (!timeSignature) timeSignature = `${b}/${bt}`;
              }
            }
          } else if (tag === "backup") {
            pos -= parseInt(txt(el, "duration", "0"), 10) || 0;
          } else if (tag === "forward") {
            pos += parseInt(txt(el, "duration", "0"), 10) || 0;
          } else if (tag === "direction") {
            const words = [...el.getElementsByTagName("words")].map((w) => w.textContent.trim()).filter(Boolean);
            bar.expressions.push(...words.slice(0, 2));
            const snd = el.getElementsByTagName("sound")[0];
            if (!tempo && snd?.getAttribute("tempo")) tempo = `${Math.round(Number(snd.getAttribute("tempo")))} bpm`;
            for (const dyn of el.getElementsByTagName("dynamics")) {
              const d = dyn.children[0]?.nodeName;
              if (d) bar.expressions.push(d);
            }
          } else if (tag === "note") {
            const isChord = !!kid(el, "chord");
            const isGrace = !!kid(el, "grace");
            const dur = parseInt(txt(el, "duration", "0"), 10) || 0;
            const onset = isChord ? lastOnset : pos;
            if (!isChord) {
              lastOnset = pos;
              if (!isGrace) pos += dur;
            }
            maxPos = Math.max(maxPos, pos);
            const pitch = kid(el, "pitch");
            if (!pitch || isGrace || kid(el, "rest")) continue;
            const step = txt(pitch, "step", "C").toUpperCase();
            const alter = Math.round(Number(txt(pitch, "alter", "0")) || 0);
            const octave = parseInt(txt(pitch, "octave", "4"), 10);
            const midi = (octave + 1) * 12 + STEP_PC[step] + alter;
            const staff = parseInt(txt(el, "staff", "1"), 10) || 1;
            const hand = parts.length > 1 ? (pi === 0 ? "RH" : "LH") : staff >= 2 ? "LH" : "RH";
            const ties = [...el.children].filter((c) => c.nodeName === "tie").map((t) => t.getAttribute("type"));
            const name = `${step}${ACC[alter] ?? ""}${octave}`;
            const note = {
              pitch: name,
              letter: name,
              midi,
              voice: parseInt(txt(el, "voice", "1"), 10) || 1,
              fingering: null,
              fingeringNote: "",
              duration: Math.round((dur / divisions) * 1000) / 1000,
              offset: Math.round((onset / divisions) * 1000) / 1000,
              black: [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12),
              hand,
              tieStop: ties.includes("stop"),
              tieStart: ties.includes("start"),
              slur: !!el.getElementsByTagName("slur").length,
            };
            (hand === "RH" ? bar.rh : bar.lh).push(note);
          }
        }
        bar.ql = Math.max(bar.ql, maxPos / divisions);
        if (mi === 0 && maxPos / divisions < beatsQl - 1e-6 && maxPos > 0) pickup = true;
      });
    });
    return { title, composer, timeSignature: timeSignature || "4/4", tempo, pickup, bars, order };
  }

  /* ---------------- fingering (port of backend/fingering.py) ---------------- */

  const ADJ = { "1,2": [1, 5, -4, 10], "2,3": [1, 3, -2, 5], "3,4": [1, 3, -2, 5], "4,5": [1, 3, -2, 5] };
  const THUMB_PASS = { 2: 3.0, 3: 1.0, 4: 1.6, 5: 6.0 };
  function span(lo, hi) {
    let a = 0, b = 0, c = 0, d = 0;
    for (let f = lo; f < hi; f++) {
      const s = ADJ[`${f},${f + 1}`];
      a += s[0]; b += s[1]; c += s[2]; d += s[3];
    }
    return [a, b, c, d];
  }
  function spanCost(fa, fb, iv) {
    if (iv === 0) return fa === fb ? 0 : 2.5;
    if (fa === fb) {
      const dist = Math.abs(iv);
      return dist <= 2 ? 9 : dist <= 5 ? 5 : 3;
    }
    const crossing = fb < fa;
    const [lo, hi] = crossing ? [fb, fa] : [fa, fb];
    const [rMin, rMax, pMin, pMax] = span(lo, hi);
    const er = crossing ? [-rMax, -rMin] : [rMin, rMax];
    const ep = crossing ? [-pMax, -pMin] : [pMin, pMax];
    if (iv >= er[0] && iv <= er[1]) return 0;
    if (iv < ep[0]) return 6 * (ep[0] - iv) + 2;
    if (iv > ep[1]) return 6 * (iv - ep[1]) + 2;
    if (iv < er[0]) return 2 * (er[0] - iv);
    return 2 * (iv - er[1]);
  }
  function noteCost(n, f) {
    let c = 0;
    if (n.black) c += f === 1 ? 4.5 : f === 5 ? 1.5 : 0;
    if ((f === 4 || f === 5) && n.duration >= 2) c += 0.8;
    return c;
  }
  function transitionCost(p, n, fa, fb, hand) {
    const iv = hand === "RH" ? n.midi - p.midi : p.midi - n.midi;
    if (iv === 0) return spanCost(fa, fb, 0);
    const outward = iv > 0;
    const under = outward && fb === 1 && fa > 1;
    const over = !outward && fa === 1 && fb > 1;
    if (under || over) {
      const long = under ? fa : fb;
      let c = THUMB_PASS[long] ?? 4;
      if (Math.abs(iv) > 5) c += 1.5 * (Math.abs(iv) - 5);
      return c;
    }
    let c = spanCost(fa, fb, iv);
    const crossing = fb < fa;
    if (crossing && outward) c += 5;
    else if (!crossing && !outward) c += 4.5;
    if (p.slur && n.slur && fa === fb) c += 5;
    return c;
  }
  function solveRun(notes, hand) {
    if (!notes.length) return;
    const F = [1, 2, 3, 4, 5];
    let best = Object.fromEntries(F.map((f) => [f, noteCost(notes[0], f)]));
    const back = [];
    for (let i = 1; i < notes.length; i++) {
      const nb = {}, bk = {};
      for (const fb of F) {
        const base = noteCost(notes[i], fb);
        let bt = Infinity, bp = 1;
        for (const fa of F) {
          const t = best[fa] + transitionCost(notes[i - 1], notes[i], fa, fb, hand) + base;
          if (t < bt) { bt = t; bp = fa; }
        }
        nb[fb] = bt;
        bk[fb] = bp;
      }
      best = nb;
      back.push(bk);
    }
    let f = F.reduce((a, b) => (best[b] < best[a] ? b : a), 1);
    const out = [f];
    for (let s = back.length - 1; s >= 0; s--) {
      f = back[s][f];
      out.unshift(f);
    }
    notes.forEach((n, i) => (n.fingering = out[i]));
  }
  function combos(k) {
    const res = [];
    const rec = (start, acc) => {
      if (acc.length === k) return res.push(acc.slice());
      for (let f = start; f <= 5; f++) { acc.push(f); rec(f + 1, acc); acc.pop(); }
    };
    rec(1, []);
    return res;
  }
  function solveChord(notes, hand) {
    const ord = [...notes].sort((a, b) => a.midi - b.midi).slice(0, 5);
    if (ord.length === 1) return solveRun(ord, hand);
    let bestC = Infinity, bestA = null;
    for (const cand of combos(ord.length)) {
      const asg = hand === "RH" ? cand : [...cand].reverse();
      let c = 0;
      ord.forEach((n, i) => (c += noteCost(n, asg[i])));
      const anchor = hand === "RH" ? asg[0] : asg[asg.length - 1];
      const outer = hand === "RH" ? asg[asg.length - 1] : asg[0];
      if (anchor !== 1) c += 0.6;
      if (ord[ord.length - 1].midi - ord[0].midi >= 7 && outer !== 5) c += 0.8;
      c -= 0.01 * (Math.max(...asg) - Math.min(...asg));
      for (let i = 1; i < ord.length; i++) {
        const iv = ord[i].midi - ord[i - 1].midi;
        const lo = Math.min(asg[i - 1], asg[i]), hi = Math.max(asg[i - 1], asg[i]);
        const [rMin, rMax, pMin, pMax] = span(lo, hi);
        c += 0.3 * Math.abs(iv - (rMin + rMax) / 2);
        if (iv >= rMin && iv <= rMax) continue;
        if (iv > pMax) c += 6 * (iv - pMax) + 2;
        else if (iv < pMin) c += 6 * (pMin - iv) + 2;
        else if (iv > rMax) c += 2 * (iv - rMax);
        else c += 2 * (rMin - iv);
      }
      if (c < bestC) { bestC = c; bestA = asg; }
    }
    if (bestA) ord.forEach((n, i) => (n.fingering = bestA[i]));
  }
  function assignFingering(parsed) {
    const starts = new Map();
    let pos = 0;
    parsed.order.forEach((num, i) => {
      starts.set(num, pos);
      const bar = parsed.bars.get(num);
      const [b, bt] = parsed.timeSignature.split("/").map(Number);
      const full = (b * 4) / bt || 4;
      pos += i === 0 && parsed.pickup ? bar.ql || full : full;
    });
    for (const hand of ["RH", "LH"]) {
      const notes = [];
      for (const num of parsed.order) {
        const bar = parsed.bars.get(num);
        for (const n of hand === "RH" ? bar.rh : bar.lh) {
          if (n.tieStop) continue;
          n._g = starts.get(num) + n.offset;
          notes.push(n);
        }
      }
      notes.sort((a, b) => a._g - b._g || a.midi - b.midi);
      const events = [];
      for (const n of notes) {
        const last = events[events.length - 1];
        if (last && Math.abs(last[0]._g - n._g) < 0.001) last.push(n);
        else events.push([n]);
      }
      let run = [];
      for (const ev of events) {
        if (ev.length > 1) {
          if (run.length) solveRun(run, hand);
          run = [];
          solveChord(ev, hand);
          continue;
        }
        const n = ev[0];
        if (run.length) {
          const p = run[run.length - 1];
          const gap = n._g - (p._g + p.duration);
          const leap = Math.abs(n.midi - p.midi);
          if (gap >= 0.5 || (gap >= 0.25 && leap >= 5) || gap > 2 || leap > 16) {
            solveRun(run, hand);
            run = [];
          }
        }
        run.push(n);
      }
      if (run.length) solveRun(run, hand);
      // tied continuations repeat the held finger
      for (const num of parsed.order) {
        const list = hand === "RH" ? parsed.bars.get(num).rh : parsed.bars.get(num).lh;
        let held = new Map();
        for (const n of list) {
          if (n.tieStop && n.fingering == null) n.fingering = held.get(n.midi) ?? null;
          if (n.fingering != null) held.set(n.midi, n.fingering);
        }
      }
    }
  }

  /* ---------------- bar coaching ---------------- */

  const INTERVALS = ["unison", "minor 2nd", "major 2nd", "minor 3rd", "major 3rd", "perfect 4th", "tritone", "perfect 5th", "minor 6th", "major 6th", "minor 7th", "major 7th", "octave"];
  const intervalName = (s) => (s <= 12 ? INTERVALS[s] : s === 24 ? "two octaves" : `${s} semitones`);
  const handName = (h) => (h === "RH" ? "Right hand" : "Left hand");
  const onsets = (list) => {
    const g = [];
    for (const n of [...list].sort((a, b) => a.offset - b.offset || b.midi - a.midi)) {
      const last = g[g.length - 1];
      if (last && Math.abs(last[0].offset - n.offset) < 1e-4) last.push(n);
      else g.push([n]);
    }
    return g;
  };

  function barDebrief(num, bar, beatsQl) {
    const rh = bar.rh, lh = bar.lh;
    const all = [...rh, ...lh];
    if (!all.length) return { measure: num, found: false, rh: [], lh: [], playback: [] };
    const advice = [], tags = [], reasons = [];
    let score = 0;
    const lineAdvice = { rh: [], lh: [], together: [] };
    for (const [hand, list] of [["RH", rh], ["LH", lh]]) {
      const groups = onsets(list.filter((n) => !n.tieStop));
      if (!groups.length) continue;
      const top = groups.map((g) => (hand === "RH" ? g[0] : g[g.length - 1]));
      let maxLeap = 0, leapFrom = null, leapTo = null;
      for (let i = 1; i < top.length; i++) {
        const d = Math.abs(top[i].midi - top[i - 1].midi);
        if (d > maxLeap) { maxLeap = d; leapFrom = top[i - 1]; leapTo = top[i]; }
      }
      const key = hand === "RH" ? "rh" : "lh";
      lineAdvice[key].push(`Line: ${top.slice(0, 8).map((n) => n.letter).join(" → ")}${top.length > 8 ? " …" : ""}`);
      const fingers = groups.map((g) => g.map((n) => n.fingering ?? "·").join("/")).join("–");
      if (fingers.replace(/[·–/]/g, "")) lineAdvice[key].push(`${handName(hand)} fingers: ${fingers}`);
      if (maxLeap >= 7) {
        score += maxLeap / 3;
        tags.push("leap");
        reasons.push("wide leaps");
        advice.push(
          `${handName(hand)} leaps ${leapTo.midi < leapFrom.midi ? "down" : "up"} a ${intervalName(maxLeap)} — ${leapFrom.letter} to ${leapTo.letter}. Practise the jump silently first: eyes find ${leapTo.letter} before the hand leaves ${leapFrom.letter}, then add sound.`
        );
        lineAdvice[key].push(`${handName(hand)}: prepare leaps by looking at the landing note before you leave.`);
      }
      const chords = groups.filter((g) => g.length >= 3);
      if (chords.length) {
        score += chords.length * 1.5;
        tags.push("chords");
        reasons.push("chords");
        const c = chords[0];
        advice.push(
          `${handName(hand)} chord ${c.map((n) => n.letter).join("–")}: set the whole shape silently over the keys, then drop into it together with a loose wrist.`
        );
      }
      if (groups.length >= 8) {
        score += groups.length / 3;
        tags.push("run");
        reasons.push("busy texture");
        advice.push(
          `${handName(hand)} has ${groups.length} notes in this bar — play it in short groups (stop on each beat), then join the groups once each is even.`
        );
      }
      const blacks = list.filter((n) => n.black && !n.tieStop).length;
      if (blacks >= 3) {
        score += blacks / 3;
        tags.push("accidentals");
        advice.push(
          `${handName(hand)} uses ${blacks} black keys here — say the sharps and flats out loud before playing so the hand isn’t surprised.`
        );
      }
    }
    if (rh.length && lh.length) {
      score += 1;
      tags.push("hands-together");
      advice.push(
        `Both hands are active (${rh.filter((n) => !n.tieStop).length} right-hand and ${lh.filter((n) => !n.tieStop).length} left-hand notes) — practise hands separately until each is easy, then join at half speed.`
      );
      lineAdvice.together.push("Hands together only after each hand’s line is clean alone.");
    }
    score += all.length / 6;
    const isHard = score >= 6;
    const LABELS = { leap: "wide leap", chords: "chords", run: "busy run", accidentals: "accidentals", "hands-together": "both hands busy" };
    const uniqTags = [...new Set(tags)];
    const headline = uniqTags.slice(0, 2).map((t) => LABELS[t] || t).join(" · ");
    const packFingers = (list) =>
      list.filter((n) => n.fingering != null).map((n) => ({ letter: n.letter, finger: n.fingering, why: "" }));
    const longRun = (list) => onsets(list.filter((n) => !n.tieStop)).length >= 8;
    const split = { needed: false, chunks: [], practiceNotes: [] };
    for (const [hand, list] of [["RH", rh], ["LH", lh]]) {
      if (!longRun(list)) continue;
      split.needed = true;
      const g = onsets(list.filter((n) => !n.tieStop));
      for (let i = 0; i < g.length; i += 4) {
        const part = g.slice(i, i + 4);
        split.chunks.push({
          hand: handName(hand),
          how: `${part.map((x) => x.map((n) => n.letter).join("+")).join(" ")} — fingers ${part.map((x) => x.map((n) => n.fingering ?? "·").join("/")).join("-")}. Loop it 3× slowly, then add the next note.`,
        });
      }
    }
    if (split.needed) split.practiceNotes.push("Stop on the first note of each chunk — the pause trains the hand to land, not to rush.");
    const strip = (n) => {
      const { tieStop, tieStart, slur, _g, ...rest } = n;
      return rest;
    };
    const playback = [];
    const held = new Map();
    for (const n of [...rh, ...lh].sort((a, b) => a.offset - b.offset)) {
      if (n.tieStop) continue;
      playback.push(strip(n));
      held.set(n.midi, n);
    }
    return {
      measure: num,
      found: true,
      difficulty: { measure: num, score: Math.round(score * 100) / 100, reasons: reasons.length ? [...new Set(reasons)] : ["straightforward"], noteCount: all.length, isHard },
      advice,
      tags: uniqTags,
      headline,
      focus: advice.slice(0, 2),
      lineAdvice,
      rh: rh.filter((n) => !n.tieStop).map(strip),
      lh: lh.filter((n) => !n.tieStop).map(strip),
      dynamics: [],
      harmony: [],
      expressions: [...new Set(bar.expressions)].slice(0, 4),
      howToPlay: advice,
      fingerings: { rh: packFingers(rh), lh: packFingers(lh) },
      split,
      playback,
    };
  }

  /** Full piece payload for an uploaded score (same shape as the server's). */
  function analyze(xml, { filename = "" } = {}) {
    const parsed = parseNotes(xml);
    assignFingering(parsed);
    const [b, bt] = parsed.timeSignature.split("/").map(Number);
    const beatsQl = (b * 4) / bt || 4;
    const debriefs = {};
    for (const num of parsed.order) debriefs[String(num)] = barDebrief(num, parsed.bars.get(num), beatsQl);
    const ranked = Object.values(debriefs).filter((d) => d.found).map((d) => d.difficulty).sort((a, b) => b.score - a.score);
    const hardSpots = ranked.slice(0, 5).map((d) => ({ ...d, isHard: true }));
    const base = (filename || "").replace(/\.(musicxml|xml|mxl)$/i, "").replace(/[_-]+/g, " ").trim();
    const title = parsed.title || base || "Your score";
    return {
      kind: "score",
      opened: true,
      needsAnalysis: false,
      local: true,
      title,
      composer: parsed.composer || "",
      timeSignature: parsed.timeSignature,
      tempo: parsed.tempo,
      hasPickup: parsed.pickup,
      debriefs,
      hardSpots,
      musicxml: xml,
      filename,
      downloadName: filename || "score.musicxml",
      overview: {
        title,
        composer: parsed.composer || "",
        summary: "Your own score — opened in your browser. Nothing was uploaded anywhere.",
        history: "",
        highlights: [],
        playingCards: [
          { label: "Time", value: parsed.timeSignature },
          ...(parsed.tempo ? [{ label: "Tempo", value: parsed.tempo }] : []),
          { label: "Bars", value: String(parsed.order.length) },
        ],
        hardSpots: hardSpots.map((h) => `Bar ${h.measure}: ${h.reasons.join(", ")}`),
      },
    };
  }

  /** Practice plan for the chosen bars (port of backend/coach.practice_plan). */
  function practicePlan(piece, bars) {
    const spots = (piece?.hardSpots || []).map((s) => s.measure ?? s);
    const focus = bars?.length ? bars : spots.slice(0, 3).length ? spots.slice(0, 3) : [1];
    const steps = [
      { title: "Name the notes", minutes: 3, detail: "Say the letter names out loud, one hand at a time.", bars: focus.slice(0, 1) },
      { title: "Own the hard bits", minutes: 5, detail: "Loop only the tricky chunk slowly with the finger numbers written in.", bars: focus.slice(0, 1) },
      { title: "Join the neighbours", minutes: 4, detail: "Play the bar before + this bar + the bar after at half speed.", bars: focus },
      { title: "Add the markings", minutes: 3, detail: "One slow pass just for soft/loud and accents.", bars: focus },
    ];
    return { focusBars: focus, totalMinutes: steps.reduce((a, s) => a + s.minutes, 0), steps };
  }

  return { readScoreFile, validateMusicXml, analyze, practicePlan, LiteError };
})();
