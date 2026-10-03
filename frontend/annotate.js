/* Letter names + fingerings for OSMD — READ → PLAN → PLACE.
 *
 * Read:  after OSMD render, walk every pitched graphic note; MIDI-pair to
 *        debrief; emit one job per tone (chords keep every tone).
 *        OSMD may list the same MeasureNumber more than once (system /
 *        fragment splits) — we merge those into ONE pool so a sparse
 *        fragment cannot leftover-synthesize a vertical label pile.
 * Plan:  obstacle map + candidate slots around each notehead. Chord tones
 *        stay in pitch order; singles are never dropped. If a run still
 *        collides, the caller raises OSMD spacing, then we drop font to
 *        9.5px, then a staff-lane with a hairline leader.
 * Place: draw once from the plan. Re-run after resize / OSMD render.
 *
 * Labels are one per debrief pitched tone (collectLetters), not one per
 * engraved notehead. Grace notes are skipped in isPitchedGraphicNote.
 * Tied continuations that share a debrief tone do not get a second label.
 *
 * Letters XOR Fingers is enforced by the caller (app.js toggles).
 */

window.LuneAnnotate = (function () {
  let MIN_LETTER_GAP = 12;
  let MIN_FINGER_GAP = 12;
  let MIN_CROSS_GAP = 5;
  let LETTER_X_PAD = 6;
  let FINGER_Y_PAD = 10;
  let LETTER_BELOW = 8;
  let LETTER_H = 11;
  let FINGER_H = 11;
  let LETTER_CHAR_W = 5.5;
  let FINGER_W = 7;
  let FONT_LETTER = 12;
  let FONT_FINGER = 12;
  let HALO_STROKE = 0.55;
  const MIN_EDGE_GAP = 3.0;
  const Y_BREAK = 36;
  const FONT_FLOOR_PX = 10.5;
  const SLOT_PAD = 1.5;
  const MAX_SPACING_PASSES = 3;
  const LEADER_STAFF_GAP = 10;
  let LAST_LEADERS = [];
  // Labels come from engraved heads only; never invent a label for a tone
  // the page does not show.
  const SYNTHESIZE_UNSEEN = false;
  // printed bar number → analysis (debrief) key, filled by readJobs
  const MEASURE_TO_DEBRIEF = new Map();

  function text(el, value) {
    el.textContent = value;
  }

  function isRest(note) {
    return note.getElementsByTagName("rest").length > 0;
  }

  function hasPitch(note) {
    return note.getElementsByTagName("pitch").length > 0;
  }

  function isChordMember(note) {
    return note.getElementsByTagName("chord").length > 0;
  }

  function noteStaff(note) {
    const el = note.getElementsByTagName("staff")[0];
    return el ? el.textContent.trim() : "1";
  }

  function noteMidi(note) {
    const pitch = note.getElementsByTagName("pitch")[0];
    if (!pitch) return null;
    const step = (pitch.getElementsByTagName("step")[0]?.textContent || "C").toUpperCase();
    const octave = Number(pitch.getElementsByTagName("octave")[0]?.textContent || 4);
    const alter = Number(pitch.getElementsByTagName("alter")[0]?.textContent || 0);
    const pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[step];
    if (pc == null) return null;
    return (octave + 1) * 12 + pc + alter;
  }

  function scoreLabel(info, { withOctave = false } = {}) {
    const raw = String(info?.pitch || info?.letter || "")
      .replace(/-/g, "b")
      .replace(/♭/g, "b")
      .replace(/♯/g, "#")
      .trim();
    if (!raw) return "";
    if (withOctave) return raw;
    return raw.replace(/(\d+)$/, "");
  }

  function fingerDigit(info) {
    const raw = info?.fingering;
    if (raw == null || raw === "") return null;
    const s = String(raw).trim();
    if (!/^[1-5]$/.test(s)) return null;
    return s;
  }

  function clearLuneFingerings(note) {
    const notations = note.getElementsByTagName("notations")[0];
    if (!notations) return;
    [...notations.getElementsByTagName("technical")].forEach((t) => {
      if (t.getAttribute("data-lune") === "1") t.remove();
    });
  }

  function addFingering(doc, note, finger) {
    const digit = fingerDigit({ fingering: finger });
    if (!digit) return;
    clearLuneFingerings(note);
    let notations = note.getElementsByTagName("notations")[0];
    if (!notations) {
      notations = doc.createElement("notations");
      note.appendChild(notations);
    }
    const technical = doc.createElement("technical");
    technical.setAttribute("data-lune", "1");
    const fingering = doc.createElement("fingering");
    fingering.setAttribute("placement", "above");
    text(fingering, digit);
    technical.appendChild(fingering);
    notations.appendChild(technical);
  }

  function pairStack(stack, infos) {
    const remaining = [...(infos || [])];
    return stack.map((note) => {
      const midi = noteMidi(note);
      let best = -1;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = Math.abs((remaining[i].midi || 0) - (midi ?? -999));
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      const info = best >= 0 ? remaining.splice(best, 1)[0] : null;
      return { note, info, midi };
    });
  }

  function partHandHint(part, cache) {
    if (!part) return "RH";
    if (cache.has(part)) return cache.get(part);
    let sign = "";
    const clefs = part.getElementsByTagName("clef");
    for (const c of clefs) {
      const s = c.getElementsByTagName("sign")[0];
      if (s?.textContent) {
        sign = s.textContent.trim();
        break;
      }
    }
    const hand = sign === "F" ? "LH" : "RH";
    cache.set(part, hand);
    return hand;
  }

  function sortPack(arr) {
    return [...(arr || [])].sort(
      (a, b) => (a.offset || 0) - (b.offset || 0) || (b.midi || 0) - (a.midi || 0)
    );
  }

  function stacksFromNotes(rawNotes) {
    const stacks = [];
    let current = null;
    for (const note of rawNotes) {
      if (isRest(note) || !hasPitch(note)) {
        current = null;
        continue;
      }
      if (!isChordMember(note) || !current) {
        current = [note];
        stacks.push(current);
      } else {
        current.push(note);
      }
    }
    return stacks;
  }

  function applyStack(doc, stack, infos, { fingers }) {
    const paired = pairStack(stack, infos);
    for (const { note } of paired) clearLuneFingerings(note);
    if (fingers) {
      for (const { note, info } of paired) {
        if (info) addFingering(doc, note, info.fingering);
      }
    }
  }

  function annotate(musicxml, debriefs, { fingers = false } = {}) {
    if (!musicxml || !fingers) return musicxml;
    const parser = new DOMParser();
    const doc = parser.parseFromString(musicxml, "text/xml");
    if (doc.querySelector("parsererror")) return musicxml;

    const partHint = new WeakMap();
    const byNum = new Map();
    for (const measure of doc.getElementsByTagName("measure")) {
      const num = Number(measure.getAttribute("number") || "0");
      if (!byNum.has(num)) byNum.set(num, []);
      byNum.get(num).push(measure);
    }

    for (const [num, group] of byNum) {
      const d = debriefs?.[String(num)];
      if (!d) continue;
      const rhQ = sortPack(d.rh);
      const lhQ = sortPack(d.lh);
      let ri = 0;
      let li = 0;
      const staffSet = new Set();
      for (const measure of group) {
        for (const note of measure.getElementsByTagName("note")) {
          if (isRest(note) || !hasPitch(note)) continue;
          staffSet.add(noteStaff(note));
        }
      }
      const multiStaff = staffSet.size > 1;
      const multiPart = group.length > 1;

      for (const measure of group) {
        const part = measure.parentNode;
        const partHand = partHandHint(part, partHint);
        const stacks = stacksFromNotes([...measure.getElementsByTagName("note")]);
        for (const stack of stacks) {
          let hand = partHand;
          if (multiStaff) hand = noteStaff(stack[0]) === "2" ? "LH" : "RH";
          else if (!multiPart) hand = ri < rhQ.length ? "RH" : "LH";
          const queue = hand === "LH" ? lhQ : rhQ;
          let idx = hand === "LH" ? li : ri;
          const infos = [];
          for (let i = 0; i < stack.length; i++) {
            const info = queue[idx];
            idx += 1;
            if (info) infos.push(info);
          }
          if (hand === "LH") li = idx;
          else ri = idx;
          applyStack(doc, stack, infos, { fingers });
        }
      }
    }
    return new XMLSerializer().serializeToString(doc);
  }

  /* ---------- geometry helpers ---------- */

  function clearLetterOverlays(host) {
    host?.querySelectorAll(
      ".lune-letter-layer, .lune-finger-layer, .lune-leader-layer, .lune-audit-layer, .lune-letter-html"
    ).forEach((n) => n.remove());
  }

  function collectLetters(debriefs) {
    const letters = [];
    const nums = Object.keys(debriefs || {})
      .map(Number)
      .sort((a, b) => a - b);
    for (const num of nums) {
      const d = debriefs[String(num)];
      const pack = [...sortPack(d.rh), ...sortPack(d.lh)];
      for (const n of pack) {
        const label = scoreLabel(n, { withOctave: false });
        if (label) letters.push(label);
      }
    }
    return letters;
  }

  function countDebriefPitched(debriefs) {
    let n = 0;
    for (const key of Object.keys(debriefs || {})) {
      const d = debriefs[key];
      for (const pack of [d?.rh || [], d?.lh || []]) {
        for (const info of pack) {
          if (info?.midi != null || scoreLabel(info)) n += 1;
        }
      }
    }
    return n;
  }

  function svgPoint(svg, el) {
    try {
      const b = el.getBBox();
      if (!(b.width > 0 && b.height > 0)) return null;
      return {
        cx: b.x + b.width / 2,
        cy: b.y + b.height / 2,
        right: b.x + b.width,
        left: b.x,
        top: b.y,
        bottom: b.y + b.height,
        w: b.width,
        h: b.height,
      };
    } catch {
      return null;
    }
  }

  function noteheadBoxes(root) {
    const svgs =
      root.tagName?.toLowerCase() === "svg" ? [root] : [...root.querySelectorAll("svg")];
    const usable = [];
    for (const svg of svgs) {
      let heads = [...svg.querySelectorAll(".vf-notehead, g.vf-notehead, .NoteHead")];
      if (!heads.length) {
        heads = [...svg.querySelectorAll("g.vf-stavenote ellipse, g.vf-stavenote path")];
      }
      for (const h of heads) {
        const pt = svgPoint(svg, h);
        if (pt) usable.push({ el: h, box: pt, svg });
      }
    }
    usable.sort((a, b) => a.box.cx - b.box.cx || a.box.cy - b.box.cy);
    return usable;
  }

  function spaceYs(naturalYs, gap) {
    if (!naturalYs.length) return [];
    const ys = [...naturalYs];
    for (let i = 1; i < ys.length; i++) {
      if (ys[i] < ys[i - 1] + gap) ys[i] = ys[i - 1] + gap;
    }
    return ys;
  }

  /**
   * Space labels in a chord column without inventing a tall tower.
   * Prefer natural head Ys; only nudge to honor `gap`. Cap expansion so the
   * stack stays near the chord's own vertical span (MuseScore clarity).
   */
  function stackYsEqual(naturalYs, gap, { maxExtra = null } = {}) {
    if (!naturalYs.length) return [];
    if (naturalYs.length === 1) return [...naturalYs];
    const n = naturalYs.length;
    const first = naturalYs[0];
    const last = naturalYs[n - 1];
    const naturalSpan = Math.max(0, last - first);
    const needSpan = gap * (n - 1);
    if (naturalSpan >= needSpan - 0.01) return spaceYs(naturalYs, gap);
    // Allow a little breathing room, but never a mid-staff tower.
    const extraCap =
      maxExtra != null
        ? maxExtra
        : Math.max(gap * 0.85, Math.min(gap * 1.35, 14));
    const allowedSpan = naturalSpan + extraCap * Math.max(1, n - 1);
    const useSpan = Math.min(needSpan, Math.max(naturalSpan, allowedSpan));
    const useGap = useSpan / Math.max(1, n - 1);
    const mid = (first + last) / 2;
    const start = mid - useSpan / 2;
    const spaced = naturalYs.map((_, i) => start + i * useGap);
    return spaceYs(spaced, Math.min(gap, useGap));
  }

  function screenScale(svg) {
    try {
      const ctm = svg?.getScreenCTM?.();
      if (!ctm) return 1;
      const s = Math.hypot(ctm.a, ctm.b);
      return s > 0.05 ? s : 1;
    } catch {
      return 1;
    }
  }

  function applyOverlayMetrics(host) {
    const svg = host?.querySelector?.("svg");
    const heads = noteheadBoxes(host);
    let avgH = 10;
    if (heads.length) {
      avgH = heads.reduce((s, h) => s + (h.box.h || 10), 0) / heads.length;
    }
    const gaps = [];
    const n = Math.min(heads.length, 800);
    for (let i = 0; i < n; i++) {
      const a = heads[i].box;
      for (let j = i + 1; j < n; j++) {
        const b = heads[j].box;
        const dx = b.cx - a.cx;
        if (dx > 140) break;
        if (dx < 10) continue;
        if (Math.abs(b.cy - a.cy) > 36) continue;
        gaps.push(dx);
        break;
      }
    }
    gaps.sort((a, b) => a - b);
    const medDx = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 40;
    let dens = Math.max(0, Math.min(1, (40 - medDx) / 26));
    const scale = screenScale(svg);
    const hostW = host?.clientWidth || host?.getBoundingClientRect?.().width || 900;
    // Phone / narrow score: treat as denser so letters shrink + thin harder.
    if (hostW < 520) dens = Math.min(1, dens + 0.28);
    else if (hostW < 720) dens = Math.min(1, dens + 0.14);
    if (scale > 1.35) dens = Math.min(1, dens + 0.12);
    // Quiet glyphs — readable beside the head, not on it.
    const targetPx =
      dens > 0.75 ? 10.8 : dens > 0.55 ? 11.4 : dens > 0.35 ? 12.2 : dens > 0.2 ? 12.8 : 13.4;
    let uu = targetPx / Math.max(scale, 0.25);
    // readable on screen, but never towering over a notehead
    uu = Math.min(uu, Math.max(10.5 / Math.max(scale, 0.25), avgH * (dens > 0.55 ? 1.2 : 1.35)));
    const floorUu = FONT_FLOOR_PX / Math.max(scale, 0.25);
    uu = Math.max(floorUu, Math.min(15, uu));
    if (hostW < 520) uu = Math.max(floorUu, Math.min(uu, 11.2));
    FONT_LETTER = Math.round(uu * 10) / 10;
    FONT_FINGER = FONT_LETTER;
    LETTER_H = FONT_LETTER * 0.86;
    FINGER_H = FONT_FINGER * 0.86;
    LETTER_CHAR_W = FONT_LETTER * 0.46;
    FINGER_W = FONT_FINGER * 0.52;
    MIN_LETTER_GAP = Math.max(10.8, LETTER_H + 2.6);
    MIN_FINGER_GAP = Math.max(10.5, FINGER_H + 2.2);
    MIN_CROSS_GAP = Math.max(2.5, FONT_LETTER * 0.25);
    LETTER_X_PAD = Math.max(4.2, FONT_LETTER * 0.4);
    FINGER_Y_PAD = Math.max(6.5, FONT_FINGER * 0.6);
    LETTER_BELOW = Math.max(FONT_LETTER * 0.68, LETTER_H * 0.65 + 2.5);
    HALO_STROKE = Math.min(0.55, Math.max(0.25, 0.45 / Math.max(scale, 0.4)));
    return { fontSize: FONT_LETTER, dens, avgH, medDx, scale, hostW, halo: HALO_STROKE };
  }

  // Real glyph widths, measured once per (text, size) in the live score SVG
  // with the same CSS class — estimates under-sized "Bb"/"F#" and let them
  // clip neighbouring accidentals.
  let MEASURE_SVG = null;
  const WIDTH_CACHE = new Map();
  function measuredWidth(label, kind, fs) {
    if (!MEASURE_SVG || !label) return null;
    const key = `${kind}|${label}|${fs}`;
    if (WIDTH_CACHE.has(key)) return WIDTH_CACHE.get(key);
    try {
      const t = makeText(kind === "finger" ? "lune-finger" : "lune-letter", 0, 0, label, "start", {}, fs);
      t.setAttribute("visibility", "hidden");
      MEASURE_SVG.appendChild(t);
      const w = t.getBBox().width;
      t.remove();
      if (Number.isFinite(w) && w > 0) {
        WIDTH_CACHE.set(key, w);
        return w;
      }
    } catch {
      /* fall back to the estimate */
    }
    return null;
  }

  function labelWidth(label, kind, fontSize) {
    const fs = fontSize || (kind === "finger" ? FONT_FINGER : FONT_LETTER);
    const real = measuredWidth(String(label || ""), kind, fs);
    if (real) return real;
    if (kind === "finger") return Math.max(fs * 0.72, FINGER_W);
    const n = String(label || "").length;
    return Math.max(fs * 0.82, n * fs * 0.72);
  }

  function unitPx(osmd) {
    try {
      return osmd?.rules?.UnitInPixels || osmd?.EngravingRules?.UnitInPixels || 10;
    } catch {
      return 10;
    }
  }

  function graphicMidi(gn) {
    try {
      const sn = gn?.sourceNote || gn?.SourceNote;
      if (!sn) return null;
      const pitch = sn.Pitch || sn.pitch;
      const ht = sn.halfTone;
      // OSMD sometimes exposes halfTone=0 with no Pitch for non-notes / markers.
      if (ht != null && !Number.isNaN(Number(ht))) {
        const n = Number(ht);
        if (n === 0 && !pitch) return null;
        const midi = n + 12;
        // Piano score range guard — reject wild marker values.
        if (midi < 12 || midi > 120) return null;
        return midi;
      }
      if (pitch && typeof pitch.getHalfTone === "function") {
        const pht = pitch.getHalfTone();
        if (pht != null && !Number.isNaN(Number(pht))) {
          const midi = Number(pht) + 12;
          if (midi < 12 || midi > 120) return null;
          return midi;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Printed bar number. A pickup bar is 0 — never let `||` turn it into 1. */
  function measureNumOf(sm, mi) {
    const a = sm?.parentSourceMeasure?.MeasureNumber;
    if (Number.isFinite(a)) return a;
    const b = sm?.measureNumber;
    if (Number.isFinite(b)) return b;
    return mi + 1;
  }

  const STEP_NAMES = { 0: "C", 2: "D", 4: "E", 5: "F", 7: "G", 9: "A", 11: "B" };
  const ACC_TEXT = { "-2": "bb", "-1": "b", "0": "", "1": "#", "2": "##" };

  /** Spelled pitch straight from the engraved note, e.g. "D#5" / "Bb3". */
  function spellGraphicPitch(gn) {
    try {
      const p = gn?.sourceNote?.Pitch;
      const midi = graphicMidi(gn);
      if (!p || midi == null) return null;
      const step = STEP_NAMES[p.FundamentalNote];
      if (!step) return null;
      const alt = Math.round(Number(p.AccidentalHalfTones) || 0);
      const acc = ACC_TEXT[String(alt)] ?? "";
      const octave = Math.floor((midi - alt) / 12) - 1;
      return `${step}${acc}${octave}`;
    } catch {
      return null;
    }
  }

  /** Second+ note of a tie chain: the key is already held, so no new label. */
  function isTieContinuation(gn) {
    try {
      const sn = gn?.sourceNote;
      const tie = sn?.NoteTie;
      if (!tie) return false;
      const start = tie.StartNote ?? tie.Notes?.[0];
      return !!start && start !== sn;
    } catch {
      return false;
    }
  }

  function isPitchedGraphicNote(gn) {
    // Grace notes are unlabelled on purpose (debrief omits them).
    // Tied continuations share the start tone's debrief entry — no second label.
    try {
      if (gn?.isRest?.() || gn?.isRest) return false;
      if (gn?.isGraceNote || gn?.sourceNote?.IsGraceNote || gn?.sourceNote?.isGraceNote) {
        return false;
      }
      const sn = gn?.sourceNote || gn?.SourceNote;
      // Require a real pitch object when halfTone alone is ambiguous.
      const pitch = sn?.Pitch || sn?.pitch;
      const ht = sn?.halfTone;
      if ((ht == null || Number(ht) === 0) && !pitch) return false;
      return graphicMidi(gn) != null;
    } catch {
      return false;
    }
  }

  function noteheadSvgPoint(gn, svg, noteIndex = 0, osmd = null) {
    try {
      const g =
        (typeof gn.getSVGGElement === "function" && gn.getSVGGElement()) ||
        (typeof gn.getSVGElement === "function" && gn.getSVGElement());
      if (!g) return null;
      const heads = [
        ...(g.querySelectorAll?.(".vf-notehead, g.vf-notehead, .NoteHead") || []),
      ];
      let candidates = heads;
      if (!candidates.length) {
        candidates = [...(g.querySelectorAll?.("ellipse, path") || [])];
      }
      if (!candidates.length) candidates = [g];

      const u = unitPx(osmd);
      let absY = null;
      try {
        const abs = gn.PositionAndShape?.AbsolutePosition;
        if (abs?.y != null) absY = abs.y * u;
      } catch {
        absY = null;
      }

      let head = null;
      if (candidates.length === 1) {
        head = candidates[0];
      } else if (absY != null) {
        let best = null;
        let bestDist = Infinity;
        for (const el of candidates) {
          const pt = svgPoint(svg, el);
          if (!pt) continue;
          const d = Math.abs(pt.cy - absY);
          if (d < bestDist) {
            bestDist = d;
            best = el;
          }
        }
        head = best || candidates[noteIndex] || candidates[0];
      } else {
        head = candidates[noteIndex] || candidates[0];
      }

      const pt = svgPoint(svg, head);
      if (!pt) return null;

      let left = pt.left;
      try {
        const root =
          (g.classList?.contains?.("vf-note") && g.closest?.(".vf-stavenote")) ||
          g.closest?.(".vf-stavenote") ||
          g.parentElement ||
          g;
        const modPaths = [
          ...(root.querySelectorAll?.(".vf-modifiers path, .vf-modifiers text") || []),
        ];
        for (const a of modPaths) {
          const ab = svgPoint(svg, a);
          if (!ab) continue;
          if (ab.h < 6 || ab.h > 42 || ab.w > 28) continue;
          if (Math.abs(ab.cy - pt.cy) > Math.max(18, pt.h * 2.2)) continue;
          if (ab.right > pt.left + 3) continue;
          if (ab.left < left) left = ab.left;
        }
        const accs = [
          ...(root.querySelectorAll?.(".vf-accidental, g.vf-accidental, .Accidental") || []),
        ];
        for (const a of accs) {
          const ab = svgPoint(svg, a);
          if (!ab) continue;
          if (Math.abs(ab.cy - pt.cy) > Math.max(14, pt.h * 1.8)) continue;
          if (ab.left < left) left = ab.left;
        }
      } catch {
        /* keep head left */
      }
      return { ...pt, left };
    } catch {
      return null;
    }
  }

  function gnBox(gn, svg, osmd, { chord = false, noteIndex = 0 } = {}) {
    const u = unitPx(osmd);
    let abs = null;
    try {
      abs = gn.PositionAndShape?.AbsolutePosition || null;
    } catch {
      abs = null;
    }
    const svgPt = noteheadSvgPoint(gn, svg, noteIndex, osmd);
    const halfW = 6;
    const halfH = 5;

    if (svgPt && svgPt.cx != null && svgPt.cy != null) {
      return {
        cx: svgPt.cx,
        cy: svgPt.cy,
        right: svgPt.right ?? svgPt.cx + halfW,
        left: svgPt.left ?? svgPt.cx - halfW,
        top: svgPt.top ?? svgPt.cy - halfH,
        bottom: svgPt.bottom ?? svgPt.cy + halfH,
        w: svgPt.w || halfW * 2,
        h: svgPt.h || halfH * 2,
      };
    }

    if (abs && (abs.x != null || abs.y != null)) {
      const cx = abs.x * u;
      const cy = abs.y * u + (chord ? 0 : 6);
      return {
        cx,
        cy,
        right: cx + halfW,
        left: cx - halfW,
        top: cy - halfH,
        bottom: cy + halfH,
        w: halfW * 2,
        h: halfH * 2,
      };
    }
    return null;
  }

  function stemDir(gn) {
    // VexFlow knows the engraved direction: 1 = up, -1 = down. OSMD's own
    // enum is Up = 0 / Down = 1 and usually lives on the voice entry, so the
    // source-note check below is only a fallback.
    try {
      const vf = gn?.vfnote?.[0];
      if (vf && typeof vf.getStemDirection === "function" && (!vf.hasStem || vf.hasStem())) {
        const d = vf.getStemDirection();
        if (d === 1 || d === -1) return d;
      }
    } catch {
      /* rests / stemless notes throw — fall through */
    }
    try {
      const ve = gn?.sourceNote?.ParentVoiceEntry;
      const d = ve?.StemDirection ?? ve?.stemDirection;
      if (d === 0) return 1;
      if (d === 1) return -1;
    } catch {
      /* ignore */
    }
    try {
      const sn = gn?.sourceNote || gn?.SourceNote;
      const dir = sn?.StemDirection || sn?.stemDirection;
      if (dir === 1 || dir === "up" || dir === "Up") return 1;
      if (dir === -1 || dir === "down" || dir === "Down") return -1;
    } catch {
      /* ignore */
    }
    return 0;
  }

  function pairInfosToGraphics(stack, infos) {
    const remaining = [...(infos || [])];
    return stack.map((gn) => {
      const midi = graphicMidi(gn);
      let best = -1;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = Math.abs((remaining[i]?.midi || 0) - (midi ?? -999));
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      const info = best >= 0 ? remaining.splice(best, 1)[0] : null;
      return { gn, info, midi, leftover: remaining };
    });
  }

  function makeText(className, x, y, label, anchor, attrs = {}, fontSize) {
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("class", className);
    t.setAttribute("x", String(x));
    t.setAttribute("y", String(y));
    t.setAttribute("text-anchor", anchor || "start");
    t.setAttribute("dominant-baseline", "middle");
    const fs = fontSize || (className === "lune-finger" ? FONT_FINGER : FONT_LETTER);
    t.setAttribute("font-size", String(fs));
    t.setAttribute("stroke-width", String(HALO_STROKE));
    for (const [k, v] of Object.entries(attrs)) {
      if (v != null) t.setAttribute(k, String(v));
    }
    // Letter + accidental: the ♯/♭ is a smaller, tucked-in superscript so a
    // label like "D♯" stays as narrow as a plain letter and fits beside its
    // own note instead of being pushed above/below it.
    const m = className === "lune-letter" ? String(label || "").match(/^([A-G])([♯♭]+)$/) : null;
    if (m) {
      t.textContent = m[1];
      const acc = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      acc.setAttribute("class", "lune-acc");
      acc.setAttribute("font-size", String(Math.round(fs * 0.72 * 10) / 10));
      acc.setAttribute("dx", String(-fs * 0.04));
      acc.setAttribute("dy", String(-fs * 0.22));
      acc.textContent = m[2];
      t.appendChild(acc);
    } else {
      t.textContent = label;
    }
    return t;
  }

  function plannedBBox(plan) {
    const w = labelWidth(plan.label, plan.kind, plan.fontSize);
    const h = (plan.fontSize || FONT_LETTER) * 0.92;
    let left = plan.x;
    if (plan.anchor === "middle") left = plan.x - w / 2;
    else if (plan.anchor === "end") left = plan.x - w;
    return {
      left,
      right: left + w,
      top: plan.y - h / 2,
      bottom: plan.y + h / 2,
      w,
      h,
      x: plan.x,
      y: plan.y,
    };
  }

  function edgeGap(a, b) {
    const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    if (overlapX > 0 && overlapY > 0) return -Math.min(overlapX, overlapY);
    const dx = overlapX > 0 ? 0 : Math.max(a.left - b.right, b.left - a.right);
    const dy = overlapY > 0 ? 0 : Math.max(a.top - b.bottom, b.top - a.bottom);
    return Math.hypot(dx, dy);
  }

  /* ---------- READ ---------- */

  /** Take best MIDI match from a shared pool (cross-staff safe). */
  function takeBestInfo(pool, midi, { preferHand = null, maxDist = 1 } = {}) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const info = pool[i];
      if (!info) continue;
      const d = Math.abs((info.midi || 0) - (midi ?? -999));
      if (d > maxDist) continue;
      const handBoost = preferHand && info.hand === preferHand ? -0.01 : 0;
      const score = d + handBoost;
      if (score < bestDist) {
        bestDist = score;
        best = i;
      }
    }
    if (best < 0) return null;
    return pool.splice(best, 1)[0];
  }

  /**
   * Walk OSMD graphics + debriefs → note jobs.
   * Pool is measure-level (RH+LH) so cross-staff writing still pairs by MIDI.
   * Chord leftovers at the same offset are synthesized so triads never drop a tone.
   *
   * CRITICAL: OSMD's measureList can contain multiple entries that share the
   * same MeasureNumber (system / container fragments). Pairing each fragment
   * against a fresh debrief pool left most tones "unmatched" on the sparse
   * fragment and leftover-synthesis dumped them onto one x → vertical piles.
   * We merge all fragments for a measure number before pairing.
   */
  function readJobs(host, osmd, debriefs, metrics) {
    const svg = host?.querySelector("svg");
    const jobs = [];
    const completeness = { expected: 0, read: 0, missing: [], chordStacks: 0, chordComplete: true };
    if (!svg || !osmd?.graphic?.measureList) return { jobs, completeness };

    const measureList = osmd.graphic.measureList;

    // Group measureList indices by printed MeasureNumber
    const byNum = new Map();
    for (let mi = 0; mi < measureList.length; mi++) {
      const staffMeasures = measureList[mi];
      if (!staffMeasures) continue;
      const measureNum = measureNumOf(staffMeasures[0], mi);
      if (!byNum.has(measureNum)) byNum.set(measureNum, []);
      byNum.get(measureNum).push({ mi, staffMeasures });
    }

    // Bar numbers can disagree between the analysis (music21) and the page
    // (OSMD): pickups numbered 0 vs 1, repeat endings, etc. Match each printed
    // bar to the analysed bar whose notes actually fit, searching nearby
    // numbers and keeping the running offset when it already works.
    const pcScore = (graphicMidis, d) => {
      const pool = [...(d?.rh || []), ...(d?.lh || [])].map((n) => Number(n.midi) || 0);
      if (!pool.length || !graphicMidis.length) return 0;
      const left = pool.slice();
      let score = 0;
      for (const g of graphicMidis) {
        let i = left.indexOf(g);
        if (i >= 0) { score += 1; left.splice(i, 1); continue; }
        i = left.findIndex((x) => (x - g) % 12 === 0);
        if (i >= 0) { score += 0.6; left.splice(i, 1); }
      }
      return score / Math.max(graphicMidis.length, pool.length);
    };
    let runningShift = 0;
    const usedKeys = new Set();
    const pickDebrief = (measureNum, fragments) => {
      const g = [];
      for (const { staffMeasures } of fragments) {
        for (const sm of staffMeasures || []) {
          for (const entry of sm?.staffEntries || []) {
            for (const voice of entry.graphicalVoiceEntries || []) {
              for (const gn of voice.notes || []) {
                if (!isPitchedGraphicNote(gn) || isTieContinuation(gn)) continue;
                const m = graphicMidi(gn);
                if (m != null) g.push(m);
              }
            }
          }
        }
      }
      let best = null;
      let bestScore = -1;
      for (const shift of [runningShift, 0, -1, 1, -2, 2]) {
        const key = String(measureNum + shift);
        const d = debriefs[key];
        if (!d || usedKeys.has(key)) continue;
        const sc = pcScore(g, d) - Math.abs(shift - runningShift) * 0.02;
        if (sc > bestScore + 1e-6) { bestScore = sc; best = { key, d, shift }; }
      }
      if (!best || (g.length && bestScore < 0.25)) {
        const d = debriefs[String(measureNum)];
        return d && !usedKeys.has(String(measureNum)) ? { key: String(measureNum), d, shift: 0 } : null;
      }
      runningShift = best.shift;
      return best;
    };

    for (const [measureNum, fragments] of byNum.entries()) {
      // No analysed bar fits: letters still come from the engraved notes.
      const picked = pickDebrief(measureNum, fragments) || { key: null, d: { rh: [], lh: [] } };
      if (picked.key != null) {
        usedKeys.add(picked.key);
        MEASURE_TO_DEBRIEF.set(measureNum, picked.key);
      }
      const d = picked.d;

      const pool = [
        ...sortPack(d.rh).map((n) => ({ ...n, hand: n.hand || "RH" })),
        ...sortPack(d.lh).map((n) => ({ ...n, hand: n.hand || "LH" })),
      ];
      completeness.expected += pool.length;

      // Collect graphic stacks across ALL fragments for this measure number
      const graphicStacks = [];
      const seenHead = new Set();
      for (const { staffMeasures } of fragments) {
        staffMeasures.forEach((sm, staffIndex) => {
          if (!sm?.staffEntries) return;
          const preferRight = staffIndex === 0;
          const preferHand = staffIndex === 0 ? "RH" : "LH";
          for (const entry of sm.staffEntries) {
            const stack = [];
            const noteIndices = [];
            for (const voice of entry.graphicalVoiceEntries || []) {
              const notes = voice.notes || [];
              notes.forEach((gn, ni) => {
                if (!isPitchedGraphicNote(gn)) return;
                stack.push(gn);
                noteIndices.push(ni);
              });
            }
            if (!stack.length) continue;

            const rawItems = [];
            for (let si = 0; si < stack.length; si++) {
              const gn = stack[si];
              const box = gnBox(gn, svg, osmd, {
                chord: stack.length > 1,
                noteIndex: noteIndices[si] || 0,
              });
              if (!box) continue;
              if (!Number.isFinite(box.cx) || !Number.isFinite(box.cy)) continue;
              const midi = graphicMidi(gn);
              // Dedup heads that appear in multiple OSMD fragments of the same bar
              const headKey = `${Math.round(box.cx / 2)}_${Math.round(box.cy / 2)}_${midi ?? "x"}`;
              if (seenHead.has(headKey)) continue;
              seenHead.add(headKey);
              rawItems.push({
                gn,
                box,
                noteIndex: noteIndices[si] || 0,
                midi,
              });
            }
            if (!rawItems.length) continue;
            rawItems.sort((a, b) => a.box.cy - b.box.cy);

            // Split wildly-separated vertical groups (two hands sharing an entry)
            const subStacks = [];
            let cur = [rawItems[0]];
            for (let i = 1; i < rawItems.length; i++) {
              if (rawItems[i].box.cy - cur[cur.length - 1].box.cy > Y_BREAK) {
                subStacks.push(cur);
                cur = [rawItems[i]];
              } else {
                cur.push(rawItems[i]);
              }
            }
            subStacks.push(cur);

            for (const sub of subStacks) {
              graphicStacks.push({ sub, staffIndex, preferRight, preferHand });
            }
          }
        });
      }

      // Left→right; larger stacks first at the same x so real chords claim the pool
      graphicStacks.sort((a, b) => {
        const ax = a.sub[0]?.box?.cx ?? 0;
        const bx = b.sub[0]?.box?.cx ?? 0;
        if (Math.abs(ax - bx) > 4) return ax - bx;
        return b.sub.length - a.sub.length;
      });

      for (const { sub, staffIndex, preferRight, preferHand } of graphicStacks) {
        const paired = [];
        const usedInfos = [];
        for (const item of sub) {
          if (isTieContinuation(item.gn)) continue;
          // Exact pitch only: a near miss (D vs D#, or an octave off) used to
          // borrow another note's name and finger. The engraved note is the
          // truth for the letter; the analysis only adds the finger digit.
          let info = takeBestInfo(pool, item.midi, { preferHand, maxDist: 0 });
          // 8va / 8vb: page shows written pitch, analysis has sounding pitch
          if (!info && item.midi != null) info = takeBestInfo(pool, item.midi + 12, { preferHand, maxDist: 0 });
          if (!info && item.midi != null) info = takeBestInfo(pool, item.midi - 12, { preferHand, maxDist: 0 });
          const spelled = spellGraphicPitch(item.gn);
          if (info && spelled) info = { ...info, pitch: spelled };
          if (!info && spelled) {
            info = { pitch: spelled, midi: item.midi, fingering: null, hand: preferHand, fromScore: true };
          }
          paired.push({ ...item, info });
          if (info && !info.fromScore) usedInfos.push(info);
        }

        // Same-offset chord siblings still in the pool (OSMD dropped a head).
        // Only when this stack is already a real multi-head chord.
        const leftover = [];
        const usedSameOffset =
          usedInfos.length >= 2 &&
          usedInfos.every(
            (u) => Math.abs((u.offset || 0) - (usedInfos[0].offset || 0)) < 1e-4
          );
        if (SYNTHESIZE_UNSEEN && usedInfos.length && sub.length > 1 && usedSameOffset) {
          const midOff =
            usedInfos.reduce((a, i) => a + (Number(i.offset) || 0), 0) /
            usedInfos.length;
          const midis = usedInfos.map((u) => Number(u.midi) || 0).filter(Boolean);
          const lo = midis.length ? Math.min(...midis) : 0;
          const hi = midis.length ? Math.max(...midis) : 0;
          const handHint = usedInfos[0]?.hand || preferHand;
          for (let pi = pool.length - 1; pi >= 0; pi--) {
            const cand = pool[pi];
            if (!cand) continue;
            if (Math.abs((cand.offset || 0) - midOff) > 1e-4) continue;
            const cm = Number(cand.midi) || 0;
            if (usedInfos.some((u) => Math.abs((u.midi || 0) - cm) < 0.5)) continue;
            if (cm < lo - 14 || cm > hi + 14) continue;
            if (handHint && cand.hand && cand.hand !== handHint) {
              if (cm < lo - 1 || cm > hi + 1) continue;
            }
            leftover.unshift(pool.splice(pi, 1)[0]);
          }
          // Cap synthesis — never invent a pile of phantom labels
          if (leftover.length > 8) leftover.length = 8;
        }

        const isChord = sub.length > 1 || leftover.length > 0;
        if (isChord) completeness.chordStacks += 1;

        const chordId = `m${measureNum}-s${staffIndex}-x${Math.round(sub[0].box.cx)}-n${
          sub.length + leftover.length
        }`;

        const toneJobs = [];
        const seenMidi = new Set();
        for (const { gn, box, midi, info } of paired) {
          if (!box || !info) continue;
          const m = midi ?? info.midi;
          // Deduplicate identical pitch claimed twice on the same head cluster
          const key = `${Math.round(m)}@${Math.round(box.cx)}`;
          if (seenMidi.has(key)) continue;
          seenMidi.add(key);
          toneJobs.push({
            measure: measureNum,
            staff: staffIndex,
            midi: m,
            pitchLabel: scoreLabel(info, { withOctave: true }),
            fingering: info.fingering,
            info,
            headCx: box.cx,
            headCy: box.cy,
            headW: box.w,
            headH: box.h,
            headLeft: box.left,
            headRight: box.right,
            headTop: box.top,
            headBottom: box.bottom,
            accidentalLeft: box.left,
            isChord,
            chordId,
            stemDir: stemDir(gn),
            vfNote: gn,
            preferRight,
            synthetic: false,
            offset: Number(info.offset) || 0,
          });
        }

        if (leftover.length && toneJobs.length) {
          const ys = toneJobs.map((j) => j.headCy);
          const avgCx = toneJobs.reduce((a, j) => a + j.headCx, 0) / toneJobs.length;
          const minCy = Math.min(...ys);
          const maxCy = Math.max(...ys);
          const naturalGap =
            toneJobs.length > 1
              ? (maxCy - minCy) / Math.max(1, toneJobs.length - 1)
              : MIN_LETTER_GAP * 0.75;
          const gap = Math.min(MIN_LETTER_GAP, Math.max(8, naturalGap));
          leftover.sort((a, b) => (b.midi || 0) - (a.midi || 0));
          leftover.forEach((info, li) => {
            const maxMidi = Math.max(...toneJobs.map((j) => j.midi || 0));
            const above = (info.midi || 0) > maxMidi;
            const cy = above
              ? minCy - (li + 1) * gap
              : maxCy + (li + 1) * gap;
            const ref = toneJobs[0];
            toneJobs.push({
              measure: measureNum,
              staff: staffIndex,
              midi: info.midi,
              pitchLabel: scoreLabel(info, { withOctave: true }),
              fingering: info.fingering,
              info,
              headCx: avgCx,
              headCy: cy,
              headW: ref.headW,
              headH: ref.headH,
              headLeft: Math.min(...toneJobs.map((j) => j.headLeft)),
              headRight: Math.max(...toneJobs.map((j) => j.headRight)),
              headTop: cy - ref.headH / 2,
              headBottom: cy + ref.headH / 2,
              accidentalLeft: Math.min(...toneJobs.map((j) => j.accidentalLeft)),
              isChord: true,
              chordId,
              stemDir: 0,
              preferRight,
              synthetic: true,
              offset: Number(info.offset) || 0,
            });
          });
        }

        if (toneJobs.length > 1) {
          for (const j of toneJobs) {
            j.isChord = true;
            j.chordId = chordId;
          }
        }

        for (const j of toneJobs) {
          jobs.push(j);
          completeness.read += 1;
        }
      }

      // Remaining unmatched debrief tones: still place them, glued to the
      // nearest real head in this bar (never a shared dump-x tower).
      if (pool.length && !SYNTHESIZE_UNSEEN) {
        // Analysis tones with no engraved head (grace notes, tie tails):
        // nothing to point at, so no label — a floating letter misleads.
        pool.length = 0;
      }
      if (pool.length) {
        const barJobs = jobs.filter((j) => j.measure === measureNum);
        for (const info of pool) {
          const label = scoreLabel(info, { withOctave: false });
          if (!label || !barJobs.length) {
            completeness.missing.push({
              measure: measureNum,
              pitch: info?.pitch || info?.letter,
              midi: info?.midi,
              reason: "no-graphic-head",
            });
            completeness.chordComplete = false;
            continue;
          }
          let best = barJobs[0];
          let bd = Math.abs((best.midi || 0) - (info.midi || 0));
          for (const j of barJobs) {
            const d = Math.abs((j.midi || 0) - (info.midi || 0));
            if (d < bd) {
              bd = d;
              best = j;
            }
          }
          const dy = ((info.midi || 0) >= (best.midi || 0) ? -1 : 1) * Math.max(8, MIN_LETTER_GAP * 0.7);
          jobs.push({
            measure: measureNum,
            staff: best.staff,
            midi: info.midi,
            pitchLabel: scoreLabel(info, { withOctave: true }),
            fingering: info.fingering,
            info,
            headCx: best.headCx,
            headCy: best.headCy + dy,
            headW: best.headW,
            headH: best.headH,
            headLeft: best.headLeft,
            headRight: best.headRight,
            headTop: best.headCy + dy - best.headH / 2,
            headBottom: best.headCy + dy + best.headH / 2,
            accidentalLeft: best.accidentalLeft,
            isChord: true,
            chordId: best.chordId || `m${measureNum}-s${best.staff}-rest`,
            stemDir: best.stemDir,
            preferRight: best.preferRight,
            synthetic: true,
            offset: Number(info.offset) || 0,
          });
          completeness.read += 1;
        }
        pool.length = 0;
      }
    }

    return { jobs, completeness, metrics };
  }

  /* ---------- OBSTACLE MAP + CANDIDATE SLOTS ---------- */


  function svgUserBox(el, svg) {
    try {
      const b = el.getBBox();
      if (!Number.isFinite(b.x) || !Number.isFinite(b.width)) return null;
      if (b.width < 0.35 || b.height < 0.35) return null;
      const root = svg || el.ownerSVGElement;
      const elCtm = el.getScreenCTM?.();
      const svgCtm = root?.getScreenCTM?.();
      if (root && elCtm && svgCtm) {
        let inv;
        try {
          inv = svgCtm.inverse();
        } catch {
          inv = null;
        }
        if (inv) {
          const pts = [
            [b.x, b.y],
            [b.x + b.width, b.y],
            [b.x, b.y + b.height],
            [b.x + b.width, b.y + b.height],
          ].map(([x, y]) => {
            const pt = root.createSVGPoint();
            pt.x = x;
            pt.y = y;
            return pt.matrixTransform(elCtm).matrixTransform(inv);
          });
          const xs = pts.map((p) => p.x);
          const ys = pts.map((p) => p.y);
          const left = Math.min(...xs);
          const top = Math.min(...ys);
          const right = Math.max(...xs);
          const bottom = Math.max(...ys);
          return { left, top, right, bottom, w: right - left, h: bottom - top };
        }
      }
      return {
        left: b.x,
        top: b.y,
        right: b.x + b.width,
        bottom: b.y + b.height,
        w: b.width,
        h: b.height,
      };
    } catch {
      return null;
    }
  }

  // Obstacles only change when OSMD re-renders, so build them once per
  // render (svg node + note count + size) and reuse for plan, audit, nudge.
  let OBST_CACHE = null;
  function obstacleKey(svg) {
    return `${svg.getAttribute("width")}|${svg.getAttribute("height")}|${svg.querySelectorAll("g.vf-stavenote").length}`;
  }
  function collectObstacles(host) {
    const svg = host?.querySelector?.("svg");
    if (!svg) return { svg: null, items: [] };
    const key = obstacleKey(svg);
    if (OBST_CACHE && OBST_CACHE.svg === svg && OBST_CACHE.key === key) return OBST_CACHE.result;
    const result = collectObstaclesUncached(host, svg);
    result.grid = buildGrid(result.items);
    Object.defineProperty(result.items, "__grid", { value: result.grid, enumerable: false });
    OBST_CACHE = { svg, key, result };
    return result;
  }

  const CELL = 48;
  function buildGrid(items) {
    const grid = new Map();
    items.forEach((it, idx) => {
      const x0 = Math.floor(it.box.left / CELL), x1 = Math.floor(it.box.right / CELL);
      const y0 = Math.floor(it.box.top / CELL), y1 = Math.floor(it.box.bottom / CELL);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const k = x * 100003 + y;
        let arr = grid.get(k);
        if (!arr) grid.set(k, (arr = []));
        arr.push(idx);
      }
    });
    return grid;
  }
  function gridQuery(grid, items, box, pad) {
    const p = pad || 0;
    const x0 = Math.floor((box.left - p) / CELL), x1 = Math.floor((box.right + p) / CELL);
    const y0 = Math.floor((box.top - p) / CELL), y1 = Math.floor((box.bottom + p) / CELL);
    const seen = new Set();
    const out = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const arr = grid.get(x * 100003 + y);
      if (!arr) continue;
      for (const idx of arr) {
        if (seen.has(idx)) continue;
        seen.add(idx);
        out.push(items[idx]);
      }
    }
    return out;
  }

  function collectObstaclesUncached(host, svg) {
    const items = [];
    const skip = (el) =>
      el.closest?.(".lune-letter-layer, .lune-finger-layer, .lune-leader-layer, .lune-audit-layer");

    const add = (els, kind, precise) => {
      for (const el of els) {
        if (skip(el)) continue;
        const box = svgUserBox(el, svg);
        if (!box) continue;
        const tag = (el.tagName || "").toLowerCase();
        const canSample =
          typeof el.isPointInFill === "function" &&
          (tag === "path" || tag === "ellipse" || tag === "polygon");
        const bulky = box.w > 70 || box.h > 90;
        // Long text ("Poco moto", "cresc.") is a solid block and must stay.
        if (bulky && !canSample && kind !== "text") continue;
        // Shape sampling only pays off for big diagonal ink (beams, slurs,
        // flags, clefs). Small glyphs — augmentation dots are 4×4 — fall
        // between sample points, so they use their plain box.
        // stems/flags are thin: their box IS their ink
        const big = box.w > 14 && box.h > 6;
        items.push({ kind, el, box, precise: big && (!!precise || canSample) });
      }
    };

    const addGlyphs = (selector, kind, precise) => {
      const roots = [...svg.querySelectorAll(selector)];
      const glyphs = [];
      for (const root of roots) {
        if (skip(root)) continue;
        const inner = [...root.querySelectorAll("path, ellipse, polygon, text")];
        if (inner.length) glyphs.push(...inner);
        else glyphs.push(root);
      }
      add(glyphs, kind, precise);
    };

    add(svg.querySelectorAll(".vf-notehead, g.vf-notehead"), "notehead", false);
    add(
      svg.querySelectorAll("g.vf-modifiers path, g.vf-modifiers ellipse, .vf-accidental, .vf-dot"),
      "accidental",
      false
    );
    add(svg.querySelectorAll(".vf-stem, g.vf-stem line, g.vf-stem path, .vf-stem path"), "stem", false);
    addGlyphs("g.vf-beam, .vf-beam", "beam", true);
    addGlyphs("g.vf-flag, .vf-flag", "flag", true);
    addGlyphs("g.vf-curve, .vf-curve", "tie", true);
    add(svg.querySelectorAll("g.vf-text text, text.vf-annotation"), "text", false);
    add(
      [...svg.querySelectorAll("text")].filter((t) => {
        if (skip(t)) return false;
        if (t.classList?.contains("lune-letter") || t.classList?.contains("lune-finger")) return false;
        const s = (t.textContent || "").trim();
        return s.length >= 2 || /^(pp|p|mp|mf|f|ff|sf|sfz|\d+)$/i.test(s);
      }),
      "text",
      false
    );
    addGlyphs(
      "g.vf-clef, .vf-clef, g.vf-timesignature, .vf-timesignature, g.vf-keysignature, .vf-keysignature",
      "clef",
      true
    );
    addGlyphs("g.vf-barline, .vf-barline, .vf-staveconnector", "barline", false);
    // OSMD 1.8 draws barlines as bare <rect>s and repeat dots as arc <path>s
    // directly under g.vf-measure (no vf-barline class) — catch those too.
    const barRects = [];
    const repeatDots = [];
    for (const m of svg.querySelectorAll("g.vf-measure")) {
      for (const c of m.children) {
        const tag = (c.tagName || "").toLowerCase();
        if (tag === "rect") barRects.push(c);
        else if (tag === "path" && /A/.test(c.getAttribute("d") || "")) repeatDots.push(c);
      }
    }
    add(barRects, "barline", false);
    add(repeatDots, "accidental", false);
    add(svg.querySelectorAll("g.vf-rest path, .vf-rest path"), "notehead", false);
    return { svg, items };
  }

  function aabbHits(a, b, pad) {
    const p = pad ?? 0;
    return a.left < b.right + p && a.right + p > b.left && a.top < b.bottom + p && a.bottom + p > b.top;
  }

  function labelBoxAt(x, y, w, h, anchor) {
    // y is vertical centre (dominant-baseline: middle on placed text).
    let left = x;
    if (anchor === "middle") left = x - w / 2;
    else if (anchor === "end") left = x - w;
    return { left, top: y - h / 2, right: left + w, bottom: y + h / 2, w, h };
  }

  function sampleShapeHit(svg, obs, box) {
    const el = obs.el;
    if (typeof el.isPointInFill !== "function") return true;
    if (!obs.toLocal) {
      // svg user space → element local space; scroll-invariant, so compute once
      try {
        const svgCtm = svg.getScreenCTM?.();
        const ctm = el.getScreenCTM?.();
        if (!svgCtm || !ctm) return true;
        obs.toLocal = ctm.inverse().multiply(svgCtm);
      } catch {
        return true;
      }
    }
    const toLocal = obs.toLocal;
    if (obs.stroked === undefined) {
      const f = (el.getAttribute("fill") || "").toLowerCase();
      obs.stroked = f === "none" || f === "transparent";
    }
    // ~2px grid: slurs and beam edges are thin enough to slip between a
    // coarse 4×3 sample and still cut through a letter.
    const cols = Math.min(10, Math.max(4, Math.ceil(box.w / 2)));
    const rows = Math.min(8, Math.max(3, Math.ceil(box.h / 2)));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = box.left + ((c + 0.5) / cols) * box.w;
        const y = box.top + ((r + 0.5) / rows) * box.h;
        const pt = svg.createSVGPoint();
        pt.x = x;
        pt.y = y;
        const loc = pt.matrixTransform(toLocal);
        try {
          if (el.isPointInFill(loc)) return true;
          if (obs.stroked && el.isPointInStroke(loc)) return true;
        } catch {
          /* ignore */
        }
      }
    }
    return false;
  }

  function obstacleHitsLabel(svg, obs, box, pad) {
    if (!aabbHits(obs.box, box, pad)) return false;
    if (!obs.precise) return true;
    const p = (pad ?? 0) + 0.6;
    const grown = { left: box.left - p, top: box.top - p, right: box.right + p, bottom: box.bottom + p, w: box.w + 2 * p, h: box.h + 2 * p };
    return sampleShapeHit(svg, obs, grown);
  }

  function slotHitsObstacles(svg, obstacles, box, pad) {
    const list = obstacles && obstacles.__grid ? gridQuery(obstacles.__grid, obstacles, box, pad) : obstacles;
    for (const obs of list) {
      if (obstacleHitsLabel(svg, obs, box, pad)) return obs.kind;
    }
    return null;
  }

  function slotHitsPlaced(placed, box, pad) {
    for (const p of placed) {
      if (aabbHits(p.box, box, pad)) return true;
    }
    return false;
  }

  function staffExtentsForY(staffYs, y) {
    if (!staffYs.length) return { top: y - 40, bottom: y + 40 };
    let best = staffYs[0];
    let bestD = Infinity;
    for (const s of staffYs) {
      const mid = (s.top + s.bottom) / 2;
      const d = Math.abs(y - mid);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  function collectStaffYs(host) {
    const svg = host?.querySelector?.("svg");
    if (!svg) return [];
    const out = [];
    for (const g of svg.querySelectorAll("g.vf-stave")) {
      const box = svgUserBox(g);
      if (box) out.push({ top: box.top, bottom: box.bottom, left: box.left, right: box.right });
    }
    if (out.length) return out;
    // OSMD 1.8: each g.vf-measure starts with five horizontal staff-line paths.
    for (const m of svg.querySelectorAll("g.vf-measure")) {
      const ys = [];
      let left = Infinity;
      let right = -Infinity;
      for (const c of m.children) {
        if ((c.tagName || "").toLowerCase() !== "path") continue;
        const d = c.getAttribute("d") || "";
        const mm = d.match(/^M\s*([\d.-]+)[ ,]([\d.-]+)\s*L\s*([\d.-]+)[ ,]([\d.-]+)\s*$/);
        if (!mm || Math.abs(Number(mm[2]) - Number(mm[4])) > 0.01) continue;
        ys.push(Number(mm[2]));
        left = Math.min(left, Number(mm[1]), Number(mm[3]));
        right = Math.max(right, Number(mm[1]), Number(mm[3]));
      }
      // five evenly spaced lines = the staff (ignore stray brackets/ledgers)
      const u = [...new Set(ys.map((y) => Math.round(y * 10) / 10))].sort((a, b) => a - b);
      for (let i = 0; i + 4 < u.length; i++) {
        const g = u[i + 1] - u[i];
        if (g < 2) continue;
        let even = true;
        for (let k = 1; k < 4; k++) {
          if (Math.abs(u[i + k + 1] - u[i + k] - g) > 0.6) even = false;
        }
        if (even) {
          out.push({ top: u[i], bottom: u[i + 4], left, right });
          break;
        }
      }
    }
    if (out.length) {
      // Merge measures of the same staff row into one band per system staff.
      out.sort((a, b) => a.top - b.top || a.left - b.left);
      const rows = [];
      for (const s of out) {
        const r = rows.find((x) => Math.abs(x.top - s.top) < 2 && Math.abs(x.bottom - s.bottom) < 2);
        if (r) {
          r.left = Math.min(r.left, s.left);
          r.right = Math.max(r.right, s.right);
        } else rows.push({ ...s });
      }
      return rows;
    }
    const lines = [...svg.querySelectorAll(".vf-stave line, g.vf-stave line")];
    const buckets = [];
    for (const ln of lines) {
      const box = svgUserBox(ln);
      if (!box) continue;
      const mid = (box.top + box.bottom) / 2;
      let hit = buckets.find((b) => Math.abs(b.mid - mid) < 3);
      if (!hit) {
        hit = { mid, top: box.top, bottom: box.bottom, left: box.left, right: box.right };
        buckets.push(hit);
      } else {
        hit.top = Math.min(hit.top, box.top);
        hit.bottom = Math.max(hit.bottom, box.bottom);
        hit.left = Math.min(hit.left, box.left);
        hit.right = Math.max(hit.right, box.right);
      }
    }
    buckets.sort((a, b) => a.mid - b.mid);
    const staves = [];
    for (const b of buckets) {
      const last = staves[staves.length - 1];
      if (last && b.mid - last.bottom < 14) {
        last.bottom = Math.max(last.bottom, b.bottom);
        last.top = Math.min(last.top, b.top);
        last.right = Math.max(last.right, b.right);
        last.left = Math.min(last.left, b.left);
      } else {
        staves.push({ top: b.top, bottom: b.bottom, left: b.left, right: b.right });
      }
    }
    return staves;
  }

  function jobHead(job) {
    const w = job.headW || 12;
    const h = job.headH || 10;
    return {
      cx: job.headCx,
      cy: job.headCy,
      left: job.headLeft ?? job.headCx - w / 2,
      right: job.headRight ?? job.headCx + w / 2,
      top: job.headTop ?? job.headCy - h / 2,
      bottom: job.headBottom ?? job.headCy + h / 2,
      w,
      h,
    };
  }

  function jobLabel(job, kind) {
    if (kind === "finger") {
      return (
        fingerDigit(job.info) ||
        (job.fingering != null && /^[1-5]$/.test(String(job.fingering).trim())
          ? String(job.fingering).trim()
          : null)
      );
    }
    return musicalAccidentals(scoreLabel(job.info, { withOctave: false }));
  }

  /** "F#" → "F♯", "Bb" → "B♭": real accidentals read as music, not typing. */
  function musicalAccidentals(label) {
    const m = String(label || "").match(/^([A-G])(##|#|bb|b)?$/);
    if (!m) return label;
    const acc = { "##": "♯♯", "#": "♯", bb: "♭♭", b: "♭" }[m[2] || ""] || "";
    return m[1] + acc;
  }

  function jobLabelSize(job, kind) {
    const label = jobLabel(job, kind);
    const fs = kind === "finger" ? FONT_FINGER : FONT_LETTER;
    const w = labelWidth(label || "C", kind, fs) + 1.8;
    const h = fs * 1.18;
    return { label, w, h, fs };
  }

  function jobStemDir(job) {
    return Number(job.stemDir) >= 0 ? 1 : -1;
  }

  function nearbyKind(obstacles, head, kind, padX) {
    const hits = [];
    const q = { left: head.left - padX, right: head.right + padX, top: head.top - 28, bottom: head.bottom + 28 };
    const list = obstacles && obstacles.__grid ? gridQuery(obstacles.__grid, obstacles, q, 0) : obstacles || [];
    for (const obs of list) {
      if (obs.kind !== kind) continue;
      if (obs.box.right < head.left - padX || obs.box.left > head.right + padX) continue;
      if (obs.box.bottom < head.top - 28 || obs.box.top > head.bottom + 28) continue;
      hits.push(obs);
    }
    return hits;
  }

  function beamPrefersBelow(job, obstacles) {
    const head = jobHead(job);
    const beams = nearbyKind(obstacles, head, "beam", 18);
    let above = 0;
    let below = 0;
    for (const b of beams) {
      const mid = (b.box.top + b.box.bottom) / 2;
      if (mid <= head.cy) above += 1;
      else below += 1;
    }
    if (above > below) return true;
    if (below > above) return false;
    return jobStemDir(job) > 0;
  }

  function tieOnSide(job, obstacles, below) {
    const head = jobHead(job);
    const ties = nearbyKind(obstacles, head, "tie", 22);
    for (const t of ties) {
      const mid = (t.box.top + t.box.bottom) / 2;
      if (below && mid >= head.cy - 2) return true;
      if (!below && mid <= head.cy + 2) return true;
    }
    return false;
  }

  function letterCandidates(job, w, h, staff, obstacles) {
    const head = jobHead(job);
    const pad = LETTER_X_PAD;
    const stem = jobStemDir(job);
    const cy = head.cy;
    const above = head.top - 2 - h / 2;
    const below = head.bottom + 2 + h / 2;
    const stems = nearbyKind(obstacles, head, "stem", 10);
    const dots = nearbyKind(obstacles, head, "accidental", 14);
    let pastR = head.right + pad;
    let pastL = head.left - pad;
    for (const s of stems) {
      pastR = Math.max(pastR, s.box.right + pad);
      pastL = Math.min(pastL, s.box.left - pad);
    }
    for (const d of dots) {
      if (d.box.left >= head.cx) pastR = Math.max(pastR, d.box.right + pad);
      else pastL = Math.min(pastL, d.box.left - pad);
    }
    const flags = nearbyKind(obstacles, head, "flag", 16);
    const clefs = nearbyKind(obstacles, head, "clef", 40);
    for (const f of flags) {
      pastR = Math.max(pastR, f.box.right + pad + 5);
      pastL = Math.min(pastL, f.box.left - pad);
    }
    for (const c of clefs) {
      pastR = Math.max(pastR, c.box.right + pad + 2);
    }
    const laneAbove = staff.top - LEADER_STAFF_GAP - h / 2;
    const laneBelow = staff.bottom + LEADER_STAFF_GAP + h / 2;
    const out = [];
    const push = (x, y, anchor, lane) => out.push({ x, y, anchor, lane: !!lane });
    const systemStart = head.cx < (staff.left || 0) + 95 || head.cx < 145;
    // Reading order: a letter belongs to the note on its LEFT. So try the
    // right side first, then straight above/below (unambiguous because it is
    // centred on the head), and only then the left side.
    const tight = Math.max(3.5, pad * 0.6);
    push(head.right + tight, cy, "start", false);
    push(head.right + pad, cy, "start", false);
    push(pastR, cy, "start", false);
    if (systemStart) {
      push(pastR + 6, cy, "start", false);
      push(pastR + 12, cy, "start", false);
    }
    // stem up (stem on the right, rising) → below is clear; stem down → above
    const firstV = stem > 0 ? below : above;
    const secondV = stem > 0 ? above : below;
    const stepV = h * 0.9;
    push(head.cx, firstV, "middle", false);
    // just above/below but nudged right, clear of the note's own ♯/♭ glyph
    push(head.cx - 1, firstV, "start", false);
    push(head.cx, secondV, "middle", false);
    push(head.cx - 1, secondV, "start", false);
    push(head.right + tight, firstV, "start", false);
    push(head.right + tight, secondV, "start", false);
    push(head.cx, firstV + (stem > 0 ? stepV : -stepV), "middle", false);
    push(head.right + tight, cy - h * 0.55, "start", false);
    push(head.right + tight, cy + h * 0.55, "start", false);
    if (!systemStart) {
      push(head.left - pad, cy, "end", false);
      push(pastL, cy, "end", false);
    }
    push(head.cx, secondV + (stem > 0 ? -stepV : stepV), "middle", false);
    if (stem < 0) {
      push(head.cx, laneBelow, "middle", true);
      push(head.cx, laneAbove, "middle", true);
    } else {
      push(head.cx, laneAbove, "middle", true);
      push(head.cx, laneBelow, "middle", true);
    }
    return out;
  }

  function fingerCandidates(job, w, h, staff, obstacles) {
    const head = jobHead(job);
    const preferBelow = beamPrefersBelow(job, obstacles);
    const tied = tieOnSide(job, obstacles, preferBelow);
    const cy = head.cy;
    const above = head.top - FINGER_Y_PAD - h / 2;
    const below = head.bottom + FINGER_Y_PAD + h / 2;
    const laneAbove = staff.top - LEADER_STAFF_GAP - h / 2;
    const laneBelow = staff.bottom + LEADER_STAFF_GAP + h / 2;
    const out = [];
    const push = (x, y, anchor, lane) => out.push({ x, y, anchor, lane: !!lane });
    // Engraver order: the side away from the stem/beam (unless a tie sits
    // there), stepping further out before ever switching sides, and only
    // then beside the head. Digits beside a head inside the staff read as
    // belonging to the neighbouring note, so that is a late fallback.
    const firstBelow = tied ? !preferBelow : preferBelow;
    const step = h * 0.95;
    const tiers = [0, 0.45, 1, 1.6, 2.3];
    for (const t of tiers) {
      if (firstBelow) push(head.cx, below + t * step, "middle", false);
      else push(head.cx, above - t * step, "middle", false);
    }
    for (const t of [0, 0.5, 1]) {
      if (firstBelow) push(head.cx, above - t * step, "middle", false);
      else push(head.cx, below + t * step, "middle", false);
    }
    for (const dx of [3, 6]) {
      if (firstBelow) push(head.cx + dx, below + step * 0.45, "middle", false);
      else push(head.cx + dx, above - step * 0.45, "middle", false);
    }
    push(head.right + 3, cy, "start", false);
    push(head.left - 3, cy, "end", false);
    if (preferBelow) {
      push(head.cx, laneBelow, "middle", true);
      push(head.cx, laneAbove, "middle", true);
    } else {
      push(head.cx, laneAbove, "middle", true);
      push(head.cx, laneBelow, "middle", true);
    }
    return out;
  }

  function pickSlot(job, kind, w, h, svg, obstacles, placed, staff, allowLane) {
    const cands = (kind === "finger"
      ? fingerCandidates(job, w, h, staff, obstacles)
      : letterCandidates(job, w, h, staff, obstacles)
    ).filter((c) => allowLane || !c.lane);
    for (const c of cands) {
      const box = labelBoxAt(c.x, c.y, w, h, c.anchor);
      if (slotHitsPlaced(placed, box, SLOT_PAD)) continue;
      if (slotHitsObstacles(svg, obstacles, box, SLOT_PAD)) continue;
      return { ...c, box, w, h };
    }
    const head = jobHead(job);
    // Nearest clear spot on rings around the head — always prefer a label a
    // little further away over one sitting on ink.
    const ringStep = Math.max(3, h * 0.35);
    for (let r = ringStep; r <= h * 4.2; r += ringStep) {
      const pts = [];
      const n = Math.max(8, Math.round((2 * Math.PI * r) / ringStep));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        pts.push([head.cx + Math.cos(a) * (r + w / 2), head.cy + Math.sin(a) * (r + h / 2)]);
      }
      // right side first (reading order), then vertical, then left
      pts.sort((p, q) => {
        const sp = p[0] >= head.cx - 1 ? 0 : 1;
        const sq = q[0] >= head.cx - 1 ? 0 : 1;
        if (sp !== sq) return sp - sq;
        return Math.hypot(p[0] - head.cx, p[1] - head.cy) - Math.hypot(q[0] - head.cx, q[1] - head.cy);
      });
      for (const [x, y] of pts) {
        const box = labelBoxAt(x, y, w, h, "middle");
        if (slotHitsPlaced(placed, box, SLOT_PAD)) continue;
        if (slotHitsObstacles(svg, obstacles, box, SLOT_PAD)) continue;
        return { x, y, anchor: "middle", lane: false, box, w, h };
      }
    }
    const nudges = [6, 12, 18, -6, -12];
    for (const dx of nudges) {
      const x = head.cx + dx;
      const y = allowLane ? (staff.top - LEADER_STAFF_GAP - h / 2) : head.cy;
      const box = labelBoxAt(x, y, w, h, "middle");
      if (slotHitsPlaced(placed, box, SLOT_PAD)) continue;
      if (slotHitsObstacles(svg, obstacles, box, SLOT_PAD)) continue;
      return { x, y, anchor: "middle", lane: !!allowLane, box, w, h };
    }
    const last = cands[cands.length - 1] || { x: jobHead(job).cx, y: jobHead(job).cy, anchor: "middle", lane: !!allowLane };
    const box = labelBoxAt(last.x, last.y, w, h, last.anchor);
    return { ...last, box, w, h, failed: true };
  }

  function chordColumnX(tones, kind, w, stem, obstacles) {
    const pad = LETTER_X_PAD * 0.7 + 1;
    let right = Math.max(...tones.map((t) => jobHead(t).right));
    // clear the chord's own stem / dots / flag on the right-hand side
    const top = Math.min(...tones.map((t) => jobHead(t).top));
    const bottom = Math.max(...tones.map((t) => jobHead(t).bottom));
    const cxs = tones.map((t) => t.headCx);
    const minCx = Math.min(...cxs);
    const maxCx = Math.max(...cxs);
    for (const o of obstacles || []) {
      if (!["stem", "accidental", "flag"].includes(o.kind)) continue;
      if (o.box.bottom < top - 2 || o.box.top > bottom + 2) continue;
      if (o.box.left < minCx - 2 || o.box.left > maxCx + 16) continue;
      if (o.kind === "accidental" && o.box.left < maxCx) continue; // accidentals sit left
      right = Math.max(right, o.box.right);
    }
    return { x: right + pad, anchor: "start" };
  }

  function boxClear(svg, obstacles, placed, box) {
    return !slotHitsPlaced(placed, box, SLOT_PAD) && !slotHitsObstacles(svg, obstacles, box, SLOT_PAD);
  }

  function placeChordSlots(tones, kind, svg, obstacles, placed, staffYs, allowLane) {
    tones.sort((a, b) => (a.midi || 0) - (b.midi || 0)); // low → high
    const stem = jobStemDir(tones[0]);
    const plans = [];
    const sizes = tones.map((t) => jobLabelSize(t, kind));

    if (kind === "finger") {
      // One vertical stack, pitch order top→bottom (top digit = top note),
      // on the side away from the stem/beam; push further out until clear.
      const preferBelow = beamPrefersBelow(tones[0], obstacles);
      const cx = tones.reduce((s, t) => s + t.headCx, 0) / tones.length;
      const chordTop = Math.min(...tones.map((t) => jobHead(t).top));
      const chordBottom = Math.max(...tones.map((t) => jobHead(t).bottom));
      const h = Math.max(...sizes.map((z) => z.h));
      const lineH = h * 0.92;
      const n = tones.length;
      const tryStack = (below, extra, dx) => {
        const boxes = [];
        for (let i = 0; i < n; i++) {
          // i = 0 is the LOWEST note
          const { w } = sizes[i];
          const y = below
            ? chordBottom + FINGER_Y_PAD * 0.7 + extra + lineH * (n - 1 - i) + h / 2
            : chordTop - FINGER_Y_PAD * 0.7 - extra - lineH * i - h / 2;
          const box = labelBoxAt(cx + dx, y, w, h, "middle");
          if (!boxClear(svg, obstacles, placed.concat(boxes.map((b) => ({ box: b.box }))), box)) return null;
          boxes.push({ x: cx + dx, y, box, w, h });
        }
        return boxes;
      };
      let stack = null;
      for (const below of [preferBelow, !preferBelow]) {
        for (const extra of [0, h * 0.5, h, h * 1.6, h * 2.4]) {
          for (const dx of [0, 4, -4]) {
            stack = tryStack(below, extra, dx);
            if (stack) break;
          }
          if (stack) break;
        }
        if (stack) break;
      }
      if (stack) {
        for (let i = 0; i < n; i++) {
          const s = stack[i];
          const slot = { x: s.x, y: s.y, anchor: "middle", lane: false, box: s.box, w: s.w, h: s.h, fs: sizes[i].fs };
          const plan = jobToPlan(tones[i], kind, slot, sizes[i].label);
          plans.push(plan);
          placed.push({ box: s.box, plan });
        }
        return plans;
      }
    } else {
      // Letters: one column right of the whole chord (past its stem), each
      // letter level with its own head. Seconds alternate into a 2nd column.
      const col = chordColumnX(tones, kind, sizes[0].w, stem, obstacles);
      const altShift = Math.max(...sizes.map((z) => z.w)) + 2.5;
      const ys = tones.map((t) => jobHead(t).cy);
      const hgt = Math.max(...sizes.map((z) => z.h));
      // labels in one column must not overlap vertically: spread minimally
      const colYs = ys.slice();
      const useAlt = new Array(tones.length).fill(false);
      for (let i = 1; i < tones.length; i++) {
        if (colYs[i - 1] - colYs[i] < hgt * 0.88) {
          // too close to the label below it → second column
          if (!useAlt[i - 1]) useAlt[i] = true;
        }
      }
      let ok = true;
      const slots = [];
      for (let i = 0; i < tones.length; i++) {
        const { w, h } = sizes[i];
        const x = useAlt[i] ? col.x + altShift : col.x;
        const box = labelBoxAt(x, colYs[i], w, h, "start");
        if (!boxClear(svg, obstacles, placed.concat(slots.map((b) => ({ box: b.box }))), box)) {
          ok = false;
          break;
        }
        slots.push({ x, y: colYs[i], anchor: "start", lane: false, box, w, h, fs: sizes[i].fs });
      }
      if (ok) {
        for (let i = 0; i < tones.length; i++) {
          const plan = jobToPlan(tones[i], kind, slots[i], sizes[i].label);
          plans.push(plan);
          placed.push({ box: slots[i].box, plan });
        }
        return plans;
      }
    }

    // Fallback: place each tone on its own (highest note first so the top
    // of the chord gets the nearest slot), never dropping a tone.
    const order = tones.map((t, i) => i).reverse();
    for (const i of order) {
      const job = tones[i];
      const { label, w, h, fs } = sizes[i];
      if (!label) continue;
      const staff = staffExtentsForY(staffYs, jobHead(job).cy);
      const slot = pickSlot(job, kind, w, h, svg, obstacles, placed, staff, allowLane);
      slot.fs = fs;
      const plan = jobToPlan(job, kind, slot, label);
      plans.push(plan);
      placed.push({ box: slot.box, plan });
    }
    return plans;
  }

  function jobToPlan(job, kind, slot, label) {
    const fontSize = slot.fs || FONT_LETTER;
    const head = jobHead(job);
    const text = label || jobLabel(job, kind) || "";
    return {
      kind,
      job,
      label: text,
      text,
      x: slot.x,
      y: slot.y,
      fontSize,
      w: slot.w,
      h: slot.h,
      anchor: slot.anchor || "start",
      baseline: "middle",
      side: slot.lane ? "lane" : slot.anchor === "middle" ? "above" : slot.anchor === "end" ? "left" : "right",
      essential: true,
      chordId: job.chordId || null,
      isChord: job.isChord,
      midi: job.midi,
      octave: job.octave,
      leader: slot.lane
        ? { x1: head.cx, y1: head.cy, x2: slot.x, y2: slot.y }
        : null,
      failed: !!slot.failed,
    };
  }

  function placeAllJobs(jobs, host, kind, allowLane) {
    const { svg, items: obstacles } = collectObstacles(host);
    if (MEASURE_SVG !== svg) WIDTH_CACHE.clear();
    MEASURE_SVG = svg;
    const staffYs = collectStaffYs(host);
    const placed = [];
    const plans = [];
    const groups = new Map();
    const singles = [];
    for (const job of jobs) {
      if (!jobLabel(job, kind)) continue;
      if (job.isChord && job.chordId) {
        if (!groups.has(job.chordId)) groups.set(job.chordId, []);
        groups.get(job.chordId).push(job);
      } else {
        singles.push(job);
      }
    }
    const chordGroups = [...groups.values()].sort((a, b) => {
      const ax = Math.min(...a.map((j) => j.headCx));
      const bx = Math.min(...b.map((j) => j.headCx));
      if (ax !== bx) return ax - bx;
      return Math.min(...a.map((j) => j.midi || 0)) - Math.min(...b.map((j) => j.midi || 0));
    });
    for (const tones of chordGroups) {
      plans.push(...placeChordSlots(tones, kind, svg, obstacles, placed, staffYs, allowLane));
    }
    singles.sort((a, b) => {
      const offA = Number(a.offset ?? a.info?.offset ?? 1);
      const offB = Number(b.offset ?? b.info?.offset ?? 1);
      const da = Math.abs(offA - Math.round(offA)) < 0.08 ? 0 : 1;
      const db = Math.abs(offB - Math.round(offB)) < 0.08 ? 0 : 1;
      if (da !== db) return da - db;
      if (a.headCx !== b.headCx) return a.headCx - b.headCx;
      return a.headCy - b.headCy;
    });
    for (const job of singles) {
      const { label, w, h, fs } = jobLabelSize(job, kind);
      if (!label) continue;
      const staff = staffExtentsForY(staffYs, job.headCy);
      const slot = pickSlot(job, kind, w, h, svg, obstacles, placed, staff, allowLane);
      slot.fs = fs;
      const plan = jobToPlan(job, kind, slot, label);
      plans.push(plan);
      placed.push({ box: slot.box, plan });
    }
    return plans;
  }

  const AUDIT_KIND_KEYS = {
    notehead: "notehead",
    accidental: "accidentalOrDot",
    stem: "stem",
    beam: "beam",
    flag: "flag",
    tie: "tieOrSlur",
    text: "text",
    clef: "clefOrTimeOrKey",
    barline: "barline",
  };

  function emptyAuditCounts() {
    return {
      labelVsLabel: 0,
      notehead: 0,
      accidentalOrDot: 0,
      stem: 0,
      beam: 0,
      flag: 0,
      tieOrSlur: 0,
      text: 0,
      clefOrTimeOrKey: 0,
      barline: 0,
    };
  }

  function auditOverlays(host) {
    const svg = host?.querySelector?.("svg");
    const counts = emptyAuditCounts();
    const offenders = [];
    if (!svg) return { ok: true, counts, offenders, labelCount: 0 };
    const labels = [...svg.querySelectorAll("text.lune-letter, text.lune-finger")].filter(
      (el) => el.getAttribute("visibility") !== "hidden"
    );
    const boxes = labels.map((el) => {
      // our label layers carry no transform: getBBox is already svg user space
      let box = null;
      try {
        const b = el.getBBox();
        box = { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height, w: b.width, h: b.height };
      } catch {
        box = svgUserBox(el, svg);
      }
      const measureRaw = el.getAttribute("data-lune-measure");
      const measure = measureRaw ? Number(measureRaw) : null;
      return { el, box, text: (el.textContent || "").trim(), measure };
    }).filter((row) => row.box);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (aabbHits(boxes[i].box, boxes[j].box, SLOT_PAD)) {
          counts.labelVsLabel += 1;
          if (offenders.length < 80) {
            offenders.push({
              category: "labelVsLabel",
              text: `${boxes[i].text}+${boxes[j].text}`,
              x: boxes[i].box.left,
              y: boxes[i].box.top,
              measure: boxes[i].measure,
              box: boxes[i].box,
            });
          }
        }
      }
    }
    const { items } = collectObstacles(host);
    for (const row of boxes) {
      for (const obs of gridQuery(items.__grid, items, row.box, SLOT_PAD)) {
        if (!obstacleHitsLabel(svg, obs, row.box, SLOT_PAD)) continue;
        const key = AUDIT_KIND_KEYS[obs.kind] || obs.kind;
        counts[key] = (counts[key] || 0) + 1;
        if (offenders.length < 80) {
          offenders.push({
            category: key,
            text: row.text,
            x: row.box.left,
            y: row.box.top,
            measure: row.measure,
            box: row.box,
          });
        }
        break;
      }
    }
    const ok = Object.values(counts).every((n) => n === 0);
    return { ok, counts, offenders, labelCount: labels.length };
  }

  function nudgeOffenderNodes(host) {
    const svg = host?.querySelector?.("svg");
    if (!svg) return auditOverlays(host);
    const audit = auditOverlays(host);
    if (audit.ok || !audit.offenders.length) return audit;
    // Local repair: move only the flagged labels, checking each move against
    // nearby ink and the other labels — never a full re-audit per try.
    const { items } = collectObstacles(host);
    const nodes = [...svg.querySelectorAll("text.lune-letter, text.lune-finger")];
    const boxOf = (el) => {
      const b = el.getBBox();
      return { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height, w: b.width, h: b.height };
    };
    const boxes = new Map(nodes.map((el) => [el, boxOf(el)]));
    const clashes = (el, box) => {
      for (const obs of gridQuery(items.__grid, items, box, SLOT_PAD)) {
        if (obstacleHitsLabel(svg, obs, box, SLOT_PAD)) return true;
      }
      for (const [other, ob] of boxes) {
        if (other !== el && aabbHits(ob, box, SLOT_PAD)) return true;
      }
      return false;
    };
    const tries = [[4, 0], [8, 0], [0, -6], [0, 6], [12, 0], [0, -11], [0, 11], [-6, 0], [10, -8], [10, 8], [-10, -8], [-10, 8], [16, 0], [0, -16], [0, 16]];
    const done = new Set();
    for (const off of audit.offenders) {
      const el = nodes.find((t) => {
        if (done.has(t)) return false;
        const b = boxes.get(t);
        return b && Math.abs(b.left - off.x) < 1.5 && Math.abs(b.top - off.y) < 1.5;
      });
      if (!el) continue;
      done.add(el);
      const b0 = boxes.get(el);
      if (!clashes(el, b0)) continue;
      const x0 = Number(el.getAttribute("x"));
      const y0 = Number(el.getAttribute("y"));
      for (const [dx, dy] of tries) {
        const nb = { ...b0, left: b0.left + dx, right: b0.right + dx, top: b0.top + dy, bottom: b0.bottom + dy };
        if (clashes(el, nb)) continue;
        el.setAttribute("x", String(x0 + dx));
        el.setAttribute("y", String(y0 + dy));
        boxes.set(el, nb);
        break;
      }
    }
    return auditOverlays(host);
  }

  function drawAuditBoxes(host, audit) {
    const svg = host?.querySelector?.("svg");
    if (!svg) return;
    svg.querySelector(".lune-audit-layer")?.remove();
    const params = new URLSearchParams(window.location.search);
    if (params.get("audit") !== "1" || !audit?.offenders?.length) return;
    const ns = "http://www.w3.org/2000/svg";
    const g = document.createElementNS(ns, "g");
    g.classList.add("lune-audit-layer");
    for (const off of audit.offenders) {
      if (!off.box) continue;
      const r = document.createElementNS(ns, "rect");
      r.setAttribute("x", String(off.box.left - 1));
      r.setAttribute("y", String(off.box.top - 1));
      r.setAttribute("width", String(off.box.w + 2));
      r.setAttribute("height", String(off.box.h + 2));
      r.setAttribute("fill", "none");
      r.setAttribute("stroke", "#c44");
      r.setAttribute("stroke-width", "0.9");
      r.setAttribute("pointer-events", "none");
      g.appendChild(r);
    }
    svg.appendChild(g);
  }

  function logFailedLeaders(plans) {
    const failed = plans.filter((p) => p.failed);
    for (const p of failed) {
      const m = p.job?.measure ?? "?";
      console.warn("[lune overlay] unresolved label", {
        measure: m,
        text: p.label || p.text,
        x: p.x,
        y: p.y,
      });
    }
    return plans.filter((p) => p.leader).map((p) => ({
      measure: p.job?.measure ?? null,
      text: p.label || p.text,
      x: p.x,
      y: p.y,
      kind: p.kind,
    }));
  }

  /* ---------- PLAN ---------- */

  function planJobs(jobs, opts, metrics, host) {
    const letters = !!opts.letters;
    const fingers = !!opts.fingers;
    const kind = fingers ? "finger" : "letter";
    if (!letters && !fingers) return [];
    const allowLane = !!opts.allowLane;
    return placeAllJobs(jobs, host, kind, allowLane);
  }

  /** Nested name kept for callers / grep; chord stacks live in placeChordSlots. */
  function planChordStack(tones, kind, svg, obstacles, placed, staffYs, allowLane) {
    return placeChordSlots(tones, kind, svg, obstacles, placed, staffYs, allowLane);
  }

  function resolvePlanCollisions(plans) {
    // Slot picker already tested obstacles + placed labels. Do not drop or shrink.
    return;
    if (plans.length < 2) return;

    const refresh = () =>
      plans.map((p, i) => {
        const b = plannedBBox(p);
        return { ...b, i, plan: p };
      });

    // Restack each chord column first — keep glued to head Ys, shared column x
    const byChord = new Map();
    for (const p of plans) {
      if (!p.isChord || !p.chordId || p.kind !== "letter") continue;
      if (!byChord.has(p.chordId)) byChord.set(p.chordId, []);
      byChord.get(p.chordId).push(p);
    }
    for (const group of byChord.values()) {
      if (group.length < 2) continue;
      if (group[0].side === "on") continue;
      group.sort((a, b) => a.job.headCy - b.job.headCy || a.y - b.y);
      const gap = Math.max(
        (group[0].fontSize || FONT_LETTER) * 0.92,
        Math.min(MIN_LETTER_GAP, (group[0].fontSize || FONT_LETTER) * 1.05)
      );
      const ys = stackYsEqual(
        group.map((p) => p.job.headCy),
        gap,
        { maxExtra: (group[0].fontSize || FONT_LETTER) * 0.55 }
      );
      const x = group[0].x;
      for (let i = 0; i < group.length; i++) {
        group[i].x = x;
        group[i].y = ys[i];
      }
    }

    // Finger chord restack
    const byChordF = new Map();
    for (const p of plans) {
      if (!p.isChord || !p.chordId || p.kind !== "finger") continue;
      if (!byChordF.has(p.chordId)) byChordF.set(p.chordId, []);
      byChordF.get(p.chordId).push(p);
    }
    for (const group of byChordF.values()) {
      if (group.length < 2) continue;
      if (group[0].side === "on") continue;
      group.sort((a, b) => a.job.headCy - b.job.headCy || a.y - b.y);
      const gap = Math.max(
        (group[0].fontSize || FONT_FINGER) * 0.9,
        Math.min(MIN_FINGER_GAP, (group[0].fontSize || FONT_FINGER) * 1.05)
      );
      const ys = stackYsEqual(
        group.map((p) => p.job.headTop - FINGER_Y_PAD * 0.85),
        gap,
        { maxExtra: (group[0].fontSize || FONT_FINGER) * 0.5 }
      );
      for (let i = 0; i < group.length; i++) {
        group[i].y = ys[i];
        group[i].x = group[i].job.headCx;
      }
      for (let i = 1; i < group.length; i++) {
        if (group[i].y - group[i - 1].y < gap * 0.85) {
          group[i].y = group[i - 1].y + gap * 0.85;
        }
      }
    }

    for (let pass = 0; pass < 16; pass++) {
      const boxes = refresh();
      boxes.sort((a, b) => a.left - b.left || a.y - b.y);
      let moved = 0;

      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          if (b.left - a.right > FONT_LETTER * 2.6) break;
          if (a.plan.kind !== b.plan.kind) continue;
          const g = edgeGap(a, b);
          if (g >= MIN_EDGE_GAP) continue;

          const pa = a.plan;
          const pb = b.plan;
          if (pa.side === "on" && pb.side === "on") {
            const minFs = 8.0;
            if ((pa.fontSize || FONT_LETTER) > minFs) {
              pa.fontSize = Math.max(minFs, (pa.fontSize || FONT_LETTER) - 0.35);
              pb.fontSize = Math.max(minFs, (pb.fontSize || FONT_LETTER) - 0.35);
              moved += 1;
            }
            continue;
          }
          const sameChord =
            pa.isChord && pb.isChord && pa.chordId && pa.chordId === pb.chordId;

          // Same chord column only — NEVER merge unrelated chords that share an x
          if (sameChord) {
            const lower = pb.y >= pa.y ? pb : pa;
            const upper = lower === pb ? pa : pb;
            const need = MIN_LETTER_GAP * 0.9 - (lower.y - upper.y);
            if (need > 0) {
              lower.y += need;
              moved += 1;
            }
            continue;
          }

          // Different chords near the same x: fan horizontally, don't stack into a tower
          if (pa.isChord && pb.isChord && Math.abs(pa.x - pb.x) < 6) {
            const mover = pb.x >= pa.x ? pb : pa;
            const dir = mover.side === "left" ? -1 : 1;
            mover.x += dir * Math.max(3.2, FONT_LETTER * 0.35);
            moved += 1;
            continue;
          }

          if (pa.isChord !== pb.isChord) {
            const victim = pa.isChord ? pb : pa;
            if (pass <= 2 && thinPlanOctave(victim)) {
              moved += 1;
              continue;
            }
            victim.y += Math.max(2.8, LETTER_H * 0.4);
            if (victim.side === "left") victim.x -= 2.2;
            if (victim.side === "right") victim.x += 2.2;
            moved += 1;
            continue;
          }

          if (pass <= 2) {
            const longer =
              (pb.label || "").length >= (pa.label || "").length ? pb : pa;
            if (thinPlanOctave(longer)) {
              moved += 1;
              continue;
            }
          }

          // Shrink earlier on dense Romantic pages
          if (pass >= 2 && (pa.fontSize || FONT_LETTER) > 8.5 && (pb.fontSize || FONT_LETTER) > 8.5) {
            pa.fontSize = Math.max(8.2, (pa.fontSize || FONT_LETTER) - 0.55);
            pb.fontSize = Math.max(8.2, (pb.fontSize || FONT_LETTER) - 0.55);
            moved += 1;
            continue;
          }

          const mover = pb.left >= pa.left ? pb : pa;
          mover.y += Math.max(2.8, LETTER_H * 0.45);
          if (mover.side === "left") mover.x -= Math.max(2.2, FONT_LETTER * 0.22);
          if (mover.side === "right") mover.x += Math.max(2.2, FONT_LETTER * 0.22);
          if (mover.side === "below") mover.y += 2;
          moved += 1;
        }
      }
      if (!moved) break;
    }

    // Shift whole chord stacks that still collide with neighbors
    for (const group of byChord.values()) {
      if (group.length < 2) continue;
      const others = plans.filter(
        (p) => p.kind === "letter" && (!p.isChord || p.chordId !== group[0].chordId)
      );
      for (let attempt = 0; attempt < 5; attempt++) {
        let hit = false;
        for (const g of group) {
          const gb = plannedBBox(g);
          for (const o of others) {
            if (edgeGap(gb, plannedBBox(o)) < MIN_EDGE_GAP) {
              hit = true;
              break;
            }
          }
          if (hit) break;
        }
        if (!hit) break;
        const dir = group[0].side === "left" ? -1 : 1;
        for (const g of group) g.x += dir * Math.max(3.5, FONT_LETTER * 0.32);
      }
    }

    // Last resort: drop non-essential labels still mashed (never drop chord tones).
    cullOverlappingPlans(plans);
  }

  function cullOverlappingPlans(plans) {
    if (plans.length < 2) return;
    for (let pass = 0; pass < 6; pass++) {
      const boxes = plans.map((p, i) => {
        const b = plannedBBox(p);
        return { ...b, i, plan: p };
      });
      boxes.sort((a, b) => a.left - b.left || a.y - b.y);
      let dropped = false;
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          if (b.left - a.right > FONT_LETTER * 2.8) break;
          if (a.plan.kind !== b.plan.kind) continue;
          if (edgeGap(a, b) >= MIN_EDGE_GAP) continue;
          const pa = a.plan;
          const pb = b.plan;
          // Prefer dropping the later non-essential single.
          let victim = null;
          if (!pa.essential && !pb.essential) {
            victim = pb.x >= pa.x ? pb : pa;
          } else if (!pa.essential) victim = pa;
          else if (!pb.essential) victim = pb;
          if (!victim) continue;
          const idx = plans.indexOf(victim);
          if (idx >= 0) {
            plans.splice(idx, 1);
            dropped = true;
            break;
          }
        }
        if (dropped) break;
      }
      if (!dropped) break;
    }
  }

  function thinPlanOctave(plan) {
    if (!plan || plan.isChord) return false; // chords never carry octave
    const s = String(plan.label || "");
    if (!/\d$/.test(s)) return false;
    const thinned = s.replace(/(\d+)$/, "");
    if (!thinned || thinned === s) return false;
    plan.label = thinned;
    plan.thinned = true;
    return true;
  }

  /* ---------- PLACE ---------- */

  function placePlans(host, plans) {
    const svg = host?.querySelector("svg");
    if (!svg || !plans.length) return 0;

    svg.querySelector(".lune-leader-layer")?.remove();
    const layerLeaders = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layerLeaders.setAttribute("class", "lune-leader-layer");
    const layerLetters = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layerLetters.setAttribute("class", "lune-letter-layer");
    const layerFingers = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layerFingers.setAttribute("class", "lune-finger-layer");
    svg.appendChild(layerLeaders);
    svg.appendChild(layerLetters);
    svg.appendChild(layerFingers);

    let placed = 0;
    for (const p of plans) {
      if (p.leader) {
        const ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
        ln.setAttribute("x1", String(p.leader.x1));
        ln.setAttribute("y1", String(p.leader.y1));
        ln.setAttribute("x2", String(p.leader.x2));
        ln.setAttribute("y2", String(p.leader.y2));
        ln.setAttribute("class", "lune-leader");
        ln.setAttribute("pointer-events", "none");
        layerLeaders.appendChild(ln);
      }
      const cls = p.kind === "finger" ? "lune-finger" : "lune-letter";
      const layer = p.kind === "finger" ? layerFingers : layerLetters;
      layer.appendChild(
        makeText(
          cls,
          p.x,
          p.y,
          p.label,
          p.anchor,
          {
            "data-lune-side": p.side || "",
            "data-lune-chord": p.isChord ? "1" : "0",
            "data-lune-chord-id": p.chordId || undefined,
            "data-lune-head-x": p.job.headCx,
            "data-lune-head-y": p.job.headCy,
            "data-lune-midi": p.job.midi,
            "data-lune-measure": p.job.measure ?? "",
            "data-lune-essential": p.essential ? "1" : "0",
          },
          p.fontSize
        )
      );
      placed += 1;
    }
    return placed;
  }

  function hideOsmdLetterLyrics(host) {
    host?.querySelectorAll("text").forEach((t) => {
      if (t.closest?.(".lune-letter-layer, .lune-finger-layer, .lune-leader-layer")) return;
      const s = (t.textContent || "").trim();
      if (/^[A-Ga-g][#b♭♯]?$/.test(s) || /^[A-Ga-g][#b♭♯]?\d$/.test(s)) {
        t.style.opacity = "0";
        t.setAttribute("data-lune-hidden-lyric", "1");
        t.setAttribute("aria-hidden", "true");
      }
    });
  }

  function hideOsmdFingerings(host) {
    host?.querySelectorAll("text").forEach((t) => {
      if (t.closest?.(".lune-letter-layer, .lune-finger-layer, .lune-leader-layer")) return;
      if (t.classList?.contains("lune-finger") || t.classList?.contains("lune-letter")) return;
      const cls = (t.getAttribute("class") || "").toLowerCase();
      const s = (t.textContent || "").trim();
      if (cls.includes("finger") || (cls.includes("vf-") && /^[1-5]$/.test(s))) {
        t.style.opacity = "0";
        t.setAttribute("data-lune-hidden-finger", "1");
        t.setAttribute("aria-hidden", "true");
      }
    });
    host?.querySelectorAll(".vf-fingering, g.vf-fingering").forEach((el) => {
      if (el.closest?.(".lune-letter-layer, .lune-finger-layer, .lune-leader-layer")) return;
      if (el.classList?.contains("lune-finger-layer")) return;
      el.style.opacity = "0";
      el.setAttribute("data-lune-hidden-finger", "1");
    });
    // Circles / markers OSMD sometimes draws around fingering digits — never our layers
    host?.querySelectorAll("g[class*='finger'], .vf-modifiers").forEach((el) => {
      if (el.classList?.contains("lune-finger-layer") || el.classList?.contains("lune-letter-layer")) return;
      if (el.closest?.(".lune-letter-layer, .lune-finger-layer, .lune-leader-layer")) return;
      const own = el.querySelector?.(":scope > text, text");
      const txt = ((own && own.textContent) || "").trim();
      if (!/^[1-5]$/.test(txt)) return;
      el.style.opacity = "0";
      el.setAttribute("data-lune-hidden-finger", "1");
    });
  }

  function approxBBox(el, kind) {
    const x = Number(el.getAttribute("x") || 0);
    const y = Number(el.getAttribute("y") || 0);
    const anchor = el.getAttribute("text-anchor") || "start";
    const label = el.textContent || "";
    const fs = Number(el.getAttribute("font-size") || (kind === "finger" ? FONT_FINGER : FONT_LETTER));
    const w = labelWidth(label, kind, fs);
    const h = fs * 0.92;
    let left = x;
    if (anchor === "middle") left = x - w / 2;
    else if (anchor === "end") left = x - w;
    return {
      el,
      kind,
      x,
      y,
      w,
      h,
      left,
      right: left + w,
      top: y - h / 2,
      bottom: y + h / 2,
      label: label.trim(),
      chord: el.getAttribute("data-lune-chord") === "1",
      essential: el.getAttribute("data-lune-essential") === "1",
    };
  }


  function restackChordLetterColumns(host) {
    return 0;
    const nodes = [
      ...(host?.querySelectorAll(".lune-letter-layer text.lune-letter[data-lune-chord='1']") || []),
    ].filter((t) => t.getAttribute("data-lune-soft-hide") !== "1");
    const byId = new Map();
    for (const el of nodes) {
      const id = el.getAttribute("data-lune-chord-id") || "";
      if (!id) continue;
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(el);
    }
    for (const group of byId.values()) {
      if (group.length < 2) continue;
      if (group[0].getAttribute("data-lune-side") === "on") continue;
      const hxs = group.map((el) => Number(el.getAttribute("data-lune-head-x") || 0));
      if (Math.max(...hxs) - Math.min(...hxs) > 22) continue;
      group.sort((a, b) => {
        const ay = Number(a.getAttribute("data-lune-head-y") || a.getAttribute("y") || 0);
        const by = Number(b.getAttribute("data-lune-head-y") || b.getAttribute("y") || 0);
        return ay - by;
      });
      const fs = Number(group[0].getAttribute("font-size") || FONT_LETTER);
      const gap = Math.max(fs * 0.92, Math.min(MIN_LETTER_GAP, fs * 1.05));
      const natural = group.map(
        (el) => Number(el.getAttribute("data-lune-head-y") || el.getAttribute("y") || 0)
      );
      const spaced = stackYsEqual(natural, gap, { maxExtra: fs * 0.55 });
      const x = Number(group[0].getAttribute("x") || 0);
      for (let i = 0; i < group.length; i++) {
        group[i].setAttribute("y", String(spaced[i]));
        group[i].setAttribute("x", String(x));
      }
    }
  }

  function restackChordFingerColumns(host) {
    return 0;
    const nodes = [
      ...(host?.querySelectorAll(".lune-finger-layer text.lune-finger[data-lune-chord='1']") || []),
    ];
    const byId = new Map();
    for (const el of nodes) {
      const id = el.getAttribute("data-lune-chord-id") || "";
      if (!id) continue;
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(el);
    }
    for (const group of byId.values()) {
      if (group.length < 2) continue;
      if (group[0].getAttribute("data-lune-side") === "on") continue;
      const hxs = group.map((el) => Number(el.getAttribute("data-lune-head-x") || 0));
      if (Math.max(...hxs) - Math.min(...hxs) > 22) continue;
      group.sort((a, b) => {
        const ay = Number(a.getAttribute("data-lune-head-y") || a.getAttribute("y") || 0);
        const by = Number(b.getAttribute("data-lune-head-y") || b.getAttribute("y") || 0);
        return ay - by;
      });
      const fs = Number(group[0].getAttribute("font-size") || FONT_FINGER);
      const gap = Math.max(fs * 0.9, Math.min(MIN_FINGER_GAP, fs * 1.05));
      const natural = group.map((el) => {
        const hy = Number(el.getAttribute("data-lune-head-y") || el.getAttribute("y") || 0);
        return hy - FINGER_Y_PAD * 0.85;
      });
      const spaced = stackYsEqual(natural, gap, { maxExtra: fs * 0.5 });
      for (let i = 0; i < group.length; i++) {
        group[i].setAttribute("y", String(spaced[i]));
      }
      for (let i = 1; i < group.length; i++) {
        const prev = Number(group[i - 1].getAttribute("y") || 0);
        const cur = Number(group[i].getAttribute("y") || 0);
        if (cur - prev < gap * 0.85) {
          group[i].setAttribute("y", String(prev + gap * 0.85));
        }
      }
    }
  }

  function hideSoftCollidingLetters(host) {
    // Labels are never removed. Slot picking + spacing/font/lane escalation
    // own collision handling.
    return 0;
  }

  function assertOverlaySeparation(host) {
    const audit = auditOverlays(host);
    drawAuditBoxes(host, audit);
    const letters = [...(host?.querySelectorAll("text.lune-letter") || [])].filter(
      (t) => t.getAttribute("visibility") !== "hidden"
    );
    const fingers = [...(host?.querySelectorAll("text.lune-finger") || [])].filter(
      (t) => t.getAttribute("visibility") !== "hidden"
    );
    const collisions = Object.values(audit.counts).reduce((a, n) => a + n, 0);
    return {
      ok: audit.ok,
      collisions,
      letterLetter: audit.counts.labelVsLabel,
      fingerFinger: audit.counts.labelVsLabel,
      letterFinger: 0,
      minDistance: null,
      fingerMinDistance: null,
      crossMinDistance: null,
      letterCount: letters.length,
      fingerCount: fingers.length,
      count: letters.length || fingers.length,
      fontSize: FONT_LETTER,
      audit,
      counts: audit.counts,
      offenders: audit.offenders,
    };
  }

  function assertLetterSeparation(host) {
    return assertOverlaySeparation(host);
  }

  function assertChordCompleteness(host, debriefs, completeness) {
    const chordLabels = [
      ...(host?.querySelectorAll('text.lune-letter[data-lune-chord="1"]') || []),
    ];
    const byId = new Map();
    for (const el of chordLabels) {
      const id = el.getAttribute("data-lune-chord-id") || "";
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(el.textContent.trim());
    }
    const stacks = [...byId.values()].filter((s) => s.length > 0);
    // True multi-tone stacks only
    const multi = stacks.filter((s) => s.length >= 2);
    // Missing "no-graphic-head" is intentional (we refuse floating synthesis piles).
    const hardMissing = (completeness?.missing || []).filter(
      (m) => m?.reason && m.reason !== "no-graphic-head"
    );
    const readOk =
      !completeness ||
      (hardMissing.length === 0 &&
        completeness.read >= Math.floor((completeness.expected || 0) * 0.55));
    return {
      ok: readOk,
      chordStacks: multi.length,
      triadStacks: multi.filter((s) => s.length >= 3).length,
      stacks: multi.map((s) => s.join("+")),
      missing: completeness?.missing || [],
      read: completeness?.read,
      expected: completeness?.expected ?? countDebriefPitched(debriefs),
    };
  }

  function countVisibleLetters(host) {
    const texts = host?.querySelectorAll(".lune-letter-layer text, text.lune-letter") || [];
    let hits = 0;
    texts.forEach((t) => {
      if (t.getAttribute("data-lune-hidden-lyric") === "1") return;
      const s = (t.textContent || "").trim();
      if (/^[A-Ga-g][#b♭♯]?$/.test(s) || /^[A-Ga-g][#b♭♯]?\d$/.test(s)) hits += 1;
    });
    return hits;
  }

  /**
   * Main entry: READ → PLAN → PLACE.
   */
  function placeLetterOverlays(host, osmd, debriefs, options = {}) {
    const letters = options.letters !== false;
    const fingers = !!options.fingers;
    clearLetterOverlays(host);
    if (!host || !debriefs) return { placed: 0, ok: true };

    const expected = collectLetters(debriefs).length;
    if (!expected && !fingers) return { placed: 0, ok: true };

    const metrics = applyOverlayMetrics(host);
    const opts = { letters: letters && expected > 0, fingers, dens: metrics.dens, medDx: metrics.medDx };

    let jobs = [];
    let completeness = { expected: 0, read: 0, missing: [], chordComplete: true };
    try {
      const read = readJobs(host, osmd, debriefs, metrics);
      jobs = read.jobs;
      completeness = read.completeness;
    } catch (err) {
      console.warn("[lune] readJobs failed", err);
    }

    // Fallback: notehead scan if graphic read produced almost nothing
    if (opts.letters && jobs.length < Math.max(1, Math.floor(expected * 0.12))) {
      try {
        jobs = readJobsViaNoteheads(host, debriefs, metrics);
        completeness.read = jobs.length;
        completeness.expected = expected;
      } catch {
        /* keep empty */
      }
    }

    const plans = planJobs(
      jobs,
      { ...opts, allowLane: false, narrow: (metrics.hostW || 900) < 520 },
      metrics,
      host
    );
    let placed = placePlans(host, plans);

    const finishPaint = (planList, placedCount) => {
      if (opts.letters) hideOsmdLetterLyrics(host);
      hideOsmdFingerings(host);
      LAST_LEADERS = logFailedLeaders(planList);
      nudgeOffenderNodes(host);
      const check = assertOverlaySeparation(host);
      const chords = assertChordCompleteness(host, debriefs, completeness);
      return {
        placed: placedCount,
        via: "read-plan-place",
        ok: check.ok && chords.ok,
        check,
        chords,
        completeness,
        metrics,
        jobCount: jobs.length,
        planCount: planList.length,
        leaders: LAST_LEADERS,
        fontSize: FONT_LETTER,
      };
    };

    const shrinkOverlayFont = () => {
      const floorUu = FONT_FLOOR_PX / Math.max(metrics.scale || 1, 0.25);
      if (FONT_LETTER <= floorUu + 0.02) return false;
      FONT_LETTER = Math.max(floorUu, FONT_LETTER - 0.85);
      FONT_FINGER = FONT_LETTER;
      LETTER_H = FONT_LETTER * 0.86;
      FINGER_H = FONT_FINGER * 0.86;
      LETTER_CHAR_W = FONT_LETTER * 0.46;
      FINGER_W = FONT_FINGER * 0.52;
      return true;
    };

    const paint = (allowLane) => {
      clearLetterOverlays(host);
      const next = planJobs(
        jobs,
        { ...opts, allowLane, narrow: (metrics.hostW || 900) < 520 },
        metrics,
        host
      );
      const n = placePlans(host, next);
      return finishPaint(next, n);
    };

    let result = finishPaint(plans, placed);
    if (!result.check.ok && options.allowFontDrop) {
      while (!result.check.ok && shrinkOverlayFont()) {
        result = paint(false);
      }
    }
    if (!result.check.ok && options.allowLane) {
      result = paint(true);
    }
    return result;
  }

  function readJobsViaNoteheads(host, debriefs) {
    const pack = [];
    const nums = Object.keys(debriefs || {})
      .map(Number)
      .sort((a, b) => a - b);
    for (const num of nums) {
      const d = debriefs[String(num)];
      pack.push(...sortPack(d.rh), ...sortPack(d.lh));
    }
    const usable = noteheadBoxes(host);
    if (!usable.length || !pack.length) return [];

    let allCy = usable.map((u) => u.box.cy);
    const midY =
      allCy.length > 0 ? (Math.min(...allCy) + Math.max(...allCy)) / 2 : 0;

    const stacks = [];
    const X_TOL = 10;
    for (const h of usable) {
      const last = stacks[stacks.length - 1];
      if (
        last &&
        Math.abs(last[0].box.cx - h.box.cx) <= X_TOL &&
        Math.abs(last[last.length - 1].box.cy - h.box.cy) <= Y_BREAK
      ) {
        last.push(h);
      } else {
        stacks.push([h]);
      }
    }

    const jobs = [];
    let i = 0;
    for (const stack of stacks) {
      const isChord = stack.length > 1;
      const chordId = isChord
        ? `nh-${Math.round(stack[0].box.cx)}-${Math.round(stack[0].box.cy)}-${stack.length}`
        : null;
      const stackMid = stack.reduce((s, h) => s + h.box.cy, 0) / stack.length;
      const preferRight = stackMid <= midY;
      for (const h of stack) {
        if (i >= pack.length) break;
        const info = pack[i++];
        const box = h.box;
        jobs.push({
          measure: 0,
          staff: preferRight ? 0 : 1,
          midi: info.midi,
          pitchLabel: scoreLabel(info, { withOctave: true }),
          fingering: info.fingering,
          info,
          headCx: box.cx,
          headCy: box.cy,
          headW: box.w,
          headH: box.h,
          headLeft: box.left,
          headRight: box.right,
          headTop: box.top,
          headBottom: box.bottom,
          accidentalLeft: box.left,
          isChord,
          chordId,
          stemDir: 0,
          preferRight,
          synthetic: false,
        });
      }
    }
    return jobs;
  }

  /**
   * Onset anchors for the playhead inside a measure — engraved X vs quarter
   * offset in the bar. Skips clef/key padding by using real note positions.
   * Returns [{ q, x }] in score-scroll host coordinates, or null.
   */
  function playheadAnchorsInHost(osmd, host, measureNum) {
    const svg = host?.querySelector("svg");
    if (!svg || !osmd?.graphic?.measureList) return null;
    const want = Number(measureNum);
    if (!Number.isFinite(want)) return null;
    const measureList = osmd.graphic.measureList;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const scroll = host.closest?.(".score-scroll") || host.parentElement;
    const scrollRect = scroll?.getBoundingClientRect?.() || host.getBoundingClientRect();
    const u = unitPx(osmd);
    const byQ = new Map();

    const fractionToQuarters = (ts) => {
      if (ts == null) return null;
      try {
        if (typeof ts.RealValue === "number") return ts.RealValue * 4;
        if (typeof ts.realValue === "number") return ts.realValue * 4;
        const num = ts.Numerator ?? ts.numerator;
        const den = ts.Denominator ?? ts.denominator;
        if (num != null && den) return (Number(num) / Number(den)) * 4;
      } catch {
        /* ignore */
      }
      return null;
    };

    const svgXToHost = (sx) => {
      const pt = svg.createSVGPoint();
      pt.x = sx;
      pt.y = 0;
      const s = pt.matrixTransform(ctm);
      return s.x - scrollRect.left + (scroll?.scrollLeft || 0);
    };

    for (let mi = 0; mi < measureList.length; mi++) {
      const staffMeasures = measureList[mi];
      if (!staffMeasures?.length) continue;
      if (Number(measureNumOf(staffMeasures[0], mi)) !== want) continue;
      for (const sm of staffMeasures) {
        if (!sm?.staffEntries) continue;
        for (const entry of sm.staffEntries) {
          let q = fractionToQuarters(
            entry.relInMeasureTimestamp || entry.RelInMeasureTimestamp
          );
          if (q == null) q = 0;

          let svgX = null;
          for (const voice of entry.graphicalVoiceEntries || []) {
            for (const gn of voice.notes || []) {
              if (!isPitchedGraphicNote(gn)) continue;
              try {
                const abs = gn.PositionAndShape?.AbsolutePosition;
                if (abs && abs.x != null) {
                  svgX = abs.x * u;
                  break;
                }
              } catch {
                /* try box */
              }
              const box = gnBox(gn, svg, osmd);
              if (box && Number.isFinite(box.cx)) {
                svgX = box.cx;
                break;
              }
            }
            if (svgX != null) break;
          }
          if (svgX == null) {
            try {
              const abs = entry.PositionAndShape?.AbsolutePosition;
              if (abs && abs.x != null) svgX = abs.x * u;
            } catch {
              /* skip */
            }
          }
          if (svgX == null || !Number.isFinite(svgX)) continue;
          const key = Math.round(q * 1000);
          if (!byQ.has(key)) byQ.set(key, svgXToHost(svgX));
        }
      }
    }

    if (!byQ.size) return null;
    return [...byQ.entries()]
      .map(([k, x]) => ({ q: k / 1000, x }))
      .sort((a, b) => a.q - b.q);
  }

  /**
   * Bounding box of a measure in SVG user units (union across staves).
   * Returns { num, x0, x1, y0, y1 } or null.
   */
  function measureBoundsSvg(osmd, measureNum) {
    if (!osmd?.graphic?.measureList) return null;
    const want = Number(measureNum);
    if (!Number.isFinite(want)) return null;
    const measureList = osmd.graphic.measureList;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    let found = false;
    for (let mi = 0; mi < measureList.length; mi++) {
      const staffMeasures = measureList[mi];
      if (!staffMeasures?.length) continue;
      const sm0 = staffMeasures[0];
      const num =
        measureNumOf(sm0, mi);
      if (Number(num) !== want) continue;
      for (const sm of staffMeasures) {
        if (!sm) continue;
        try {
          const pos = sm.PositionAndShape;
          if (pos?.AbsolutePosition && pos?.Size) {
            const ax = pos.AbsolutePosition.x * 10;
            const ay = pos.AbsolutePosition.y * 10;
            const aw = pos.Size.width * 10;
            const ah = pos.Size.height * 10;
            x0 = Math.min(x0, ax);
            x1 = Math.max(x1, ax + aw);
            y0 = Math.min(y0, ay);
            y1 = Math.max(y1, ay + ah);
            found = true;
          }
        } catch {
          /* skip staff */
        }
      }
    }
    if (!found || !Number.isFinite(x0)) return null;
    return { num: want, x0, x1, y0, y1 };
  }

  /**
   * Measure bounds mapped into the score host's local pixel space
   * (accounts for SVG CTM vs host getBoundingClientRect).
   */
  function measureBoundsInHost(osmd, host, measureNum) {
    const svg = host?.querySelector("svg");
    const box = measureBoundsSvg(osmd, measureNum);
    if (!svg || !box) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const hostRect = host.getBoundingClientRect();
    const scroll = host.closest?.(".score-scroll") || host.parentElement;
    const scrollRect = scroll?.getBoundingClientRect?.() || hostRect;

    const tl = svg.createSVGPoint();
    tl.x = box.x0;
    tl.y = box.y0;
    const br = svg.createSVGPoint();
    br.x = box.x1;
    br.y = box.y1;
    const sTL = tl.matrixTransform(ctm);
    const sBR = br.matrixTransform(ctm);

    // Position relative to score-scroll content (for absolute overlays)
    const left =
      sTL.x - scrollRect.left + (scroll?.scrollLeft || 0);
    const top = sTL.y - scrollRect.top + (scroll?.scrollTop || 0);
    const width = Math.max(4, sBR.x - sTL.x);
    const height = Math.max(4, sBR.y - sTL.y);
    return {
      num: box.num,
      left,
      top,
      width,
      height,
      midX: left + width / 2,
      // Screen coords for scrollIntoView math
      screenLeft: sTL.x,
      screenTop: sTL.y,
      screenRight: sBR.x,
      screenBottom: sBR.y,
    };
  }

  /**
   * All measure numbers engraved on the same system (line) as `measureNum`.
   * Prefers OSMD's parentMusicSystem link; falls back to vertical-band
   * grouping of measure bounds. Returns a sorted array or null.
   */
  function systemBarsFor(osmd, measureNum) {
    const measureList = osmd?.graphic?.measureList;
    const want = Number(measureNum);
    if (!measureList || !Number.isFinite(want)) return null;

    const items = [];
    for (let mi = 0; mi < measureList.length; mi++) {
      const sm0 = measureList[mi]?.[0];
      if (!sm0) continue;
      const num = Number(
        measureNumOf(sm0, mi)
      );
      let sys = null;
      try {
        sys =
          sm0.ParentStaffLine?.ParentMusicSystem ||
          sm0.parentStaffLine?.parentMusicSystem ||
          sm0.ParentMusicSystem ||
          sm0.parentMusicSystem ||
          null;
      } catch {
        sys = null;
      }
      let y = null;
      try {
        const pos = sm0.PositionAndShape?.AbsolutePosition;
        if (pos?.y != null) y = pos.y;
      } catch {
        y = null;
      }
      items.push({ num, sys, y });
    }
    const mine = items.find((it) => it.num === want);
    if (!mine) return null;

    let group = [];
    if (mine.sys) {
      group = items.filter((it) => it.sys && it.sys === mine.sys).map((it) => it.num);
    }
    if (!group.length && mine.y != null) {
      // Same vertical band = same engraved line (OSMD staff units; 4 ≈ safe tolerance)
      group = items
        .filter((it) => it.y != null && Math.abs(it.y - mine.y) < 4)
        .map((it) => it.num);
    }
    if (!group.length) return null;
    return [...new Set(group)].sort((a, b) => a - b);
  }

  function measureAtPoint(osmd, host, clientX, clientY) {
    const svg = host?.querySelector("svg");
    if (!svg || !osmd?.graphic?.measureList) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = pt.matrixTransform(svg.getScreenCTM().inverse());

    // Y matters: systems stack vertically, so an x-only match would map a
    // click on line 2 back to a line-1 bar that shares the same x range.
    let best = null;
    let bestDist = Infinity;
    const measureList = osmd.graphic.measureList;
    for (let mi = 0; mi < measureList.length; mi++) {
      const staffMeasures = measureList[mi];
      if (!staffMeasures?.[0]) continue;
      const sm0 = staffMeasures[0];
      const num =
        measureNumOf(sm0, mi);
      let x0 = null;
      let x1 = null;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const sm of staffMeasures) {
        if (!sm) continue;
        try {
          const pos = sm.PositionAndShape;
          if (pos?.AbsolutePosition && pos?.Size) {
            const ax = pos.AbsolutePosition.x * 10;
            const ay = pos.AbsolutePosition.y * 10;
            if (x0 == null) {
              x0 = ax;
              x1 = ax + pos.Size.width * 10;
            }
            y0 = Math.min(y0, ay);
            y1 = Math.max(y1, ay + pos.Size.height * 10);
          }
        } catch {
          /* skip staff */
        }
      }
      if (x0 == null) {
        try {
          const xs = [];
          for (const entry of sm0.staffEntries || []) {
            for (const voice of entry.graphicalVoiceEntries || []) {
              for (const gn of voice.notes || []) {
                const box = gnBox(gn, svg, osmd);
                if (box) {
                  xs.push(box.cx);
                  y0 = Math.min(y0, box.top);
                  y1 = Math.max(y1, box.bottom);
                }
              }
            }
          }
          if (xs.length) {
            x0 = Math.min(...xs) - 12;
            x1 = Math.max(...xs) + 12;
          }
        } catch {
          continue;
        }
      }
      if (x0 == null) continue;
      const hasY = Number.isFinite(y0) && Number.isFinite(y1);
      // Generous vertical pad so clicks between the staves still hit the bar
      const padY = 28;
      const dx =
        local.x >= x0 && local.x <= x1
          ? 0
          : Math.min(Math.abs(local.x - x0), Math.abs(local.x - x1));
      const dy = !hasY
        ? 0
        : local.y >= y0 - padY && local.y <= y1 + padY
          ? 0
          : Math.min(Math.abs(local.y - (y0 - padY)), Math.abs(local.y - (y1 + padY)));
      // Weight y heavily — never jump across systems on an x tie
      const dist = dx + dy * 6;
      if (dist < bestDist) {
        bestDist = dist;
        best = Number(num);
      }
    }
    return best;
  }

  // Compat stubs — collision is handled in the plan phase now.
  function separateOverlappingLetters() {
    return 0;
  }
  function separateOverlappingFingers() {
    return 0;
  }
  function resolveLetterFingerCollisions() {
    return 0;
  }
  function finalizeOverlayLayout(host) {
    return assertOverlaySeparation(host).collisions;
  }

  return {
    debriefKeyFor: (n) => MEASURE_TO_DEBRIEF.get(Number(n)) ?? String(n),
    __debug: { collectObstacles, collectStaffYs, readJobs, placeAllJobs, svgUserBox, clearCache: () => { OBST_CACHE = null; WIDTH_CACHE.clear(); } },
    annotate,
    placeLetterOverlays,
    clearLetterOverlays,
    scoreLabel,
    collectLetters,
    countVisibleLetters,
    countDebriefPitched,
    separateOverlappingLetters,
    separateOverlappingFingers,
    resolveLetterFingerCollisions,
    finalizeOverlayLayout,
    assertLetterSeparation,
    assertOverlaySeparation,
    assertChordCompleteness,
    measureAtPoint,
    measureBoundsSvg,
    measureBoundsInHost,
    playheadAnchorsInHost,
    systemBarsFor,
    readJobs,
    planJobs,
    planChordStack,
    auditOverlays,
    lastLeaderLines: () => LAST_LEADERS,
    FONT_FLOOR_PX,
    MAX_SPACING_PASSES,
    MIN_LETTER_GAP,
    MIN_FINGER_GAP,
    MIN_CROSS_GAP,
  };
})();

window.__luneAudit = function __luneAudit(host) {
  const el = host || document.getElementById("osmd");
  const audit = window.LuneAnnotate?.auditOverlays?.(el);
  if (audit) {
    console.table(audit.counts);
    if (audit.offenders?.length) console.warn("[lune audit] offenders", audit.offenders);
  }
  return audit;
};
