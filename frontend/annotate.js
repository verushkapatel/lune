/* Letter names + fingerings for OSMD — READ → PLAN → PLACE.
 *
 * Read:  after OSMD render, walk every pitched graphic note; MIDI-pair to
 *        debrief; emit one job per tone (chords keep every tone).
 *        OSMD may list the same MeasureNumber more than once (system /
 *        fragment splits) — we merge those into ONE pool so a sparse
 *        fragment cannot leftover-synthesize a vertical label pile.
 * Plan:  decide side/stack/x/y/font for every job; resolve label↔label
 *        rectangle collisions. Chord stacks stay beside their heads with
 *        tight gaps — never an equal-gap tower through the staff.
 * Place: draw once from the plan. Re-run after resize / OSMD render.
 *
 * Thinning policy (engraver-like, dense Romantic pages):
 *   - Simultaneous chord tones (triad/tetrad/…) are NEVER dropped.
 *   - In ultra-dense melodic runs, prefer chord tones + near-downbeats
 *     over every demisemiquaver when labels would otherwise mash.
 *   - Pitch-class only on dense/chord labels (Ab not Ab4).
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
    host?.querySelectorAll(".lune-letter-layer, .lune-finger-layer, .lune-letter-html").forEach((n) =>
      n.remove()
    );
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
    // Quiet glyphs — readable, not billboard.
    const targetPx =
      dens > 0.75 ? 8.2 : dens > 0.55 ? 9.0 : dens > 0.35 ? 9.8 : dens > 0.2 ? 10.6 : 11.4;
    let uu = targetPx / Math.max(scale, 0.25);
    uu = Math.min(uu, Math.max(8.0, avgH * (dens > 0.55 ? 0.82 : 0.95)));
    uu = Math.max(8.0, Math.min(11.2, uu));
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
    HALO_STROKE = Math.min(0.5, Math.max(0.2, 0.4 / Math.max(scale, 0.4)));
    return { fontSize: FONT_LETTER, dens, avgH, medDx, scale, hostW, halo: HALO_STROKE };
  }

  function labelWidth(label, kind, fontSize) {
    const fs = fontSize || (kind === "finger" ? FONT_FINGER : FONT_LETTER);
    if (kind === "finger") return Math.max(fs * 0.52, FINGER_W);
    const n = String(label || "").length;
    return Math.max(fs * 0.62, n * fs * 0.48);
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

  function isPitchedGraphicNote(gn) {
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
    t.textContent = label;
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
      const measureNum =
        staffMeasures[0]?.parentSourceMeasure?.MeasureNumber ||
        staffMeasures[0]?.measureNumber ||
        mi + 1;
      if (!byNum.has(measureNum)) byNum.set(measureNum, []);
      byNum.get(measureNum).push({ mi, staffMeasures });
    }

    for (const [measureNum, fragments] of byNum.entries()) {
      const d = debriefs[String(measureNum)];
      if (!d) continue;

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
          let info = takeBestInfo(pool, item.midi, { preferHand, maxDist: 0 });
          if (!info) info = takeBestInfo(pool, item.midi, { preferHand, maxDist: 1 });
          if (!info) info = takeBestInfo(pool, item.midi, { preferHand, maxDist: 12 });
          paired.push({ ...item, info });
          if (info) usedInfos.push(info);
        }

        // Same-offset chord siblings still in the pool (OSMD dropped a head).
        // Only when this stack is already a real multi-head chord.
        const leftover = [];
        const usedSameOffset =
          usedInfos.length >= 2 &&
          usedInfos.every(
            (u) => Math.abs((u.offset || 0) - (usedInfos[0].offset || 0)) < 1e-4
          );
        if (usedInfos.length && sub.length > 1 && usedSameOffset) {
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
          if (leftover.length > 2) leftover.length = 2;
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

      // Leftover pool tones: do NOT synthesize floating labels onto an
      // anchor x (that created the Ab/Eb/C tower). Record as missing only.
      // True chord-sibling gaps were already handled above.
      if (pool.length) {
        for (const info of pool) {
          completeness.missing.push({
            measure: measureNum,
            pitch: info?.pitch || info?.letter,
            midi: info?.midi,
            reason: "no-graphic-head",
          });
        }
        if (pool.length) completeness.chordComplete = false;
        pool.length = 0;
      }
    }

    return { jobs, completeness, metrics };
  }

  /* ---------- PLAN ---------- */

  function planJobs(jobs, opts, metrics) {
    const letters = !!opts.letters;
    const fingers = !!opts.fingers;
    const dens = metrics?.dens || 0;
    const medDx = metrics?.medDx || 40;
    const plans = [];

    // Group by chordId for stack planning
    const groups = new Map();
    const singles = [];
    for (const job of jobs) {
      if (job.isChord && job.chordId) {
        if (!groups.has(job.chordId)) groups.set(job.chordId, []);
        groups.get(job.chordId).push(job);
      } else {
        singles.push(job);
      }
    }

    function planChordStack(group) {
      // Visual order by headCy (top→bottom); pitch used only as tie-break
      const ordered = [...group].sort(
        (a, b) => a.headCy - b.headCy || (b.midi || 0) - (a.midi || 0)
      );

      // If heads span horizontally (mis-tagged arpeggio), treat as singles
      const hxSpan =
        Math.max(...ordered.map((j) => j.headCx)) -
        Math.min(...ordered.map((j) => j.headCx));
      if (hxSpan > 22 && ordered.length >= 2) {
        for (const job of ordered) {
          job.isChord = false;
          job.chordId = null;
          singles.push(job);
        }
        return;
      }

      const colLeft = Math.min(...ordered.map((j) => j.accidentalLeft ?? j.headLeft));
      const colRight = Math.max(...ordered.map((j) => j.headRight));
      const minCx = Math.min(...ordered.map((j) => j.headCx));
      let side = "left";
      if (minCx < 165) side = "right";
      const hasAcc = ordered.some((j) => {
        const headLeft = j.headCx - (j.headW || 12) / 2;
        return (j.accidentalLeft ?? j.headLeft) < headLeft - 1.5;
      });
      // Tight glue — MuseScore-clear, not floating far left
      const pad =
        Math.max(LETTER_X_PAD + 3.5, FONT_LETTER * 0.72, 8.5) + (hasAcc ? 5 : 1);
      const baseX = side === "left" ? colLeft - pad : colRight + pad;
      const anchor = side === "left" ? "end" : "start";
      // Chord gaps track the heads; never invent a mid-staff tower
      const letterGap = Math.max(
        FONT_LETTER * 0.92,
        Math.min(MIN_LETTER_GAP, FONT_LETTER * 1.05)
      );
      const fingerGap = Math.max(FONT_FINGER * 0.9, Math.min(MIN_FINGER_GAP, FONT_FINGER * 1.05));
      const letterYs = stackYsEqual(
        ordered.map((j) => j.headCy),
        letterGap,
        { maxExtra: FONT_LETTER * 0.55 }
      );
      const fingerYs = stackYsEqual(
        ordered.map((j) => j.headTop - FINGER_Y_PAD * 0.85),
        fingerGap,
        { maxExtra: FONT_FINGER * 0.5 }
      );
      const chordFont =
        ordered.length >= 5
          ? Math.max(8.2, FONT_LETTER - 1.6)
          : ordered.length >= 4
            ? Math.max(8.5, FONT_LETTER - 1.1)
            : ordered.length >= 3
              ? Math.max(8.8, FONT_LETTER - 0.6)
              : FONT_LETTER;

      for (let i = 0; i < ordered.length; i++) {
        const job = ordered[i];
        if (fingers) {
          const digit = fingerDigit(job.info) || (
            job.fingering != null && /^[1-5]$/.test(String(job.fingering).trim())
              ? String(job.fingering).trim()
              : null
          );
          if (digit) {
            plans.push({
              job,
              kind: "finger",
              label: digit,
              x: job.headCx,
              y: fingerYs[i],
              anchor: "middle",
              side: "above",
              isChord: true,
              chordId: job.chordId,
              fontSize: Math.max(8.5, FONT_FINGER - (ordered.length >= 4 ? 0.8 : 0)),
              essential: true,
            });
          }
        }
        if (letters) {
          const label = scoreLabel(job.info, { withOctave: false });
          if (label) {
            plans.push({
              job,
              kind: "letter",
              label,
              x: baseX,
              y: letterYs[i],
              anchor,
              side,
              isChord: true,
              chordId: job.chordId,
              fontSize: chordFont,
              essential: true,
            });
          }
        }
      }
    }

    for (const group of groups.values()) planChordStack(group);

    // Density tracker for singles only
    const lastX = { letter: {}, finger: {} };
    // Sort singles left→right so thinning prefers earlier / downbeat notes
    singles.sort(
      (a, b) =>
        a.headCx - b.headCx ||
        (a.offset || 0) - (b.offset || 0) ||
        a.headCy - b.headCy
    );

    function nearDownbeat(job) {
      const off = Number(job.offset ?? job.info?.offset ?? 0);
      const frac = Math.abs(off - Math.round(off));
      return frac < 0.08 || frac > 0.92;
    }

    for (const job of singles) {
      const staff = job.staff;
      if (fingers) {
        const digit = fingerDigit(job.info) || (
          job.fingering != null && /^[1-5]$/.test(String(job.fingering).trim())
            ? String(job.fingering).trim()
            : null
        );
        if (digit) {
          let skip = false;
          if (dens >= 0.32 || medDx < 26) {
            const prev = lastX.finger[staff];
            const need = dens > 0.75 ? FINGER_W * 1.4 : dens > 0.55 ? FINGER_W * 1.15 : FINGER_W * 0.95;
            if (prev != null && job.headCx - prev < need) {
              // Keep downbeats when thinning dense finger runs
              skip = !nearDownbeat(job);
            }
          }
          if (!skip) {
            lastX.finger[staff] = job.headCx;
            plans.push({
              job,
              kind: "finger",
              label: digit,
              x: job.headCx,
              y: job.headTop - FINGER_Y_PAD * 0.9,
              anchor: "middle",
              side: "above",
              isChord: false,
              chordId: null,
              fontSize: FONT_FINGER,
              essential: false,
            });
          }
        }
      }
      if (letters) {
        // Pitch class only — octave digits billboard dense Romantic pages.
        let label = scoreLabel(job.info, { withOctave: false });
        if (!label) continue;

        let skip = false;
        const lw = labelWidth(label, "letter");
        if (dens >= 0.22 || medDx < 30) {
          const prev = lastX.letter[staff];
          const need =
            dens > 0.7
              ? lw * 1.85
              : dens > 0.5
                ? lw * 1.55
                : dens > 0.32
                  ? lw * 1.25
                  : lw * 1.05;
          if (prev != null && job.headCx - prev < need) {
            // Ultra-dense melodic runs: keep downbeats, drop in-between
            // demisemiquavers. Chord tones are never in this singles path.
            skip = dens > 0.55 ? !nearDownbeat(job) : true;
          }
        }
        if (skip) continue;
        const runIndex = (lastX.letterCount = (lastX.letterCount || 0) + 1);
        lastX.letter[staff] = job.headCx;

        // Side labels glued to the head — quieter and clearer than below-lane runs.
        let side = job.preferRight ? "right" : "left";
        if (fingers) side = "left";
        if (dens > 0.55 && runIndex % 2 === 0) {
          side = side === "left" ? "right" : "left";
        }
        const pad = Math.max(LETTER_X_PAD + 0.8, FONT_LETTER * 0.42);
        const x = side === "left" ? job.headLeft - pad : job.headRight + pad;
        const yStagger =
          dens > 0.5 ? ((runIndex % 2 === 0 ? -1 : 1) * FONT_LETTER * 0.28) : 0;
        plans.push({
          job,
          kind: "letter",
          label,
          x,
          y: job.headCy + yStagger,
          anchor: side === "left" ? "end" : "start",
          side,
          isChord: false,
          chordId: null,
          fontSize: dens > 0.65 ? Math.max(9.0, FONT_LETTER - 0.6) : FONT_LETTER,
          essential: false,
        });
      }
    }

    resolvePlanCollisions(plans);
    return plans;
  }

  /**
   * Global collision planner on planned bboxes.
   * Prefer: shrink font slightly → shift chord stack as unit → stagger singles
   * → thin octave digits. NEVER drop essential (chord) labels.
   */
  function resolvePlanCollisions(plans) {
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

    const layerLetters = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layerLetters.setAttribute("class", "lune-letter-layer");
    const layerFingers = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layerFingers.setAttribute("class", "lune-finger-layer");
    svg.appendChild(layerLetters);
    svg.appendChild(layerFingers);

    let placed = 0;
    for (const p of plans) {
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
      if (t.closest?.(".lune-letter-layer, .lune-finger-layer")) return;
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
      if (t.closest?.(".lune-letter-layer, .lune-finger-layer")) return;
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
      if (el.closest?.(".lune-letter-layer, .lune-finger-layer")) return;
      if (el.classList?.contains("lune-finger-layer")) return;
      el.style.opacity = "0";
      el.setAttribute("data-lune-hidden-finger", "1");
    });
    // Circles / markers OSMD sometimes draws around fingering digits — never our layers
    host?.querySelectorAll("g[class*='finger'], .vf-modifiers").forEach((el) => {
      if (el.classList?.contains("lune-finger-layer") || el.classList?.contains("lune-letter-layer")) return;
      if (el.closest?.(".lune-letter-layer, .lune-finger-layer")) return;
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
      // Bail if heads span horizontally — not a true vertical chord column
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
    const letters = [
      ...(host?.querySelectorAll(".lune-letter-layer text.lune-letter, text.lune-letter") || []),
    ]
      .filter((t) => t.getAttribute("data-lune-hidden-lyric") !== "1")
      .map((el) => approxBBox(el, "letter"));
    if (letters.length < 2) return 0;
    letters.sort((a, b) => a.left - b.left || a.y - b.y);
    let hidden = 0;
    for (let pass = 0; pass < 8; pass++) {
      let moved = false;
      for (let i = 0; i < letters.length; i++) {
        const a = letters[i];
        if (!a || a.el.getAttribute("data-lune-soft-hide") === "1") continue;
        for (let j = i + 1; j < letters.length; j++) {
          const b = letters[j];
          if (!b || b.el.getAttribute("data-lune-soft-hide") === "1") continue;
          if (b.left - a.right > FONT_LETTER * 3) break;
          if (edgeGap(a, b) >= MIN_EDGE_GAP) continue;
          // Prefer hiding non-chord (non-essential) labels.
          let victim = null;
          if (!a.essential && !b.essential) victim = b.x >= a.x ? b : a;
          else if (!a.essential) victim = a;
          else if (!b.essential) victim = b;
          if (!victim) {
            // Both essential (chord): expand vertical gap + shrink font before giving up.
            const lower = b.y >= a.y ? b : a;
            const upper = lower === b ? a : b;
            if (pass < 5) {
              const need = Math.max(3.5, FONT_LETTER * 0.55);
              const ny = Number(lower.el.getAttribute("y") || lower.y) + need;
              lower.el.setAttribute("y", String(ny));
              lower.y = ny;
              lower.top = ny - lower.h / 2;
              lower.bottom = ny + lower.h / 2;
              const fs = Math.max(7.5, Number(lower.el.getAttribute("font-size") || FONT_LETTER) - 0.5);
              lower.el.setAttribute("font-size", String(fs));
              lower.h = fs * 0.92;
              lower.top = lower.y - lower.h / 2;
              lower.bottom = lower.y + lower.h / 2;
              // Fan chords slightly in x to break vertical mash.
              const side = lower.el.getAttribute("data-lune-side") || "left";
              const nx = Number(lower.el.getAttribute("x") || lower.x) + (side === "left" ? -1.2 : 1.2) * (pass + 1);
              lower.el.setAttribute("x", String(nx));
              lower.x = nx;
              if (lower.anchor === "end" || lower.el.getAttribute("text-anchor") === "end") {
                lower.left = nx - lower.w;
                lower.right = nx;
              } else {
                lower.left = nx;
                lower.right = nx + lower.w;
              }
              moved = true;
            }
            continue;
          }
          victim.el.style.opacity = "0";
          victim.el.setAttribute("data-lune-soft-hide", "1");
          victim.el.setAttribute("aria-hidden", "true");
          hidden += 1;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return hidden;
  }

    function assertOverlaySeparation(host) {
    const letters = [
      ...(host?.querySelectorAll(".lune-letter-layer text.lune-letter, text.lune-letter") || []),
    ]
      .filter((t) => t.getAttribute("data-lune-hidden-lyric") !== "1")
      .map((el) => approxBBox(el, "letter"));
    const fingers = [
      ...(host?.querySelectorAll(".lune-finger-layer text.lune-finger, text.lune-finger") || []),
    ].map((el) => approxBBox(el, "finger"));

    let letterLetter = 0;
    let letterMin = Infinity;
    const colTol = 2.4;
    for (let i = 0; i < letters.length; i++) {
      for (let j = i + 1; j < letters.length; j++) {
        const a = letters[i];
        const b = letters[j];
        const dx = Math.abs(a.x - b.x);
        const dy = Math.abs(a.y - b.y);
        if (dx < letterMin && dy < letterMin) letterMin = Math.hypot(dx, dy);
        if (dx <= colTol && dy < MIN_LETTER_GAP - 1.25 && dy < FONT_LETTER * 5 && edgeGap(a, b) < MIN_EDGE_GAP) {
          letterLetter += 1;
          continue;
        }
        if (dx < FONT_LETTER * 4.5 && dy < FONT_LETTER * 3.5 && edgeGap(a, b) < 0) {
          letterLetter += 1;
        }
      }
    }
    if (!Number.isFinite(letterMin)) letterMin = null;

    let fingerFinger = 0;
    let fingerMin = Infinity;
    for (let i = 0; i < fingers.length; i++) {
      for (let j = i + 1; j < fingers.length; j++) {
        const a = fingers[i];
        const b = fingers[j];
        if (Math.abs(a.x - b.x) > 3.25) continue;
        const dy = Math.abs(a.y - b.y);
        if (dy < fingerMin) fingerMin = dy;
        if (dy < MIN_FINGER_GAP - 0.5 && dy < FONT_FINGER * 5) fingerFinger += 1;
      }
    }
    if (!Number.isFinite(fingerMin)) fingerMin = null;

    return {
      ok: letterLetter === 0 && fingerFinger === 0,
      collisions: letterLetter + fingerFinger,
      letterLetter,
      fingerFinger,
      letterFinger: 0,
      minDistance: letterMin,
      fingerMinDistance: fingerMin,
      crossMinDistance: null,
      letterCount: letters.length,
      fingerCount: fingers.length,
      count: letters.length,
      fontSize: FONT_LETTER,
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
      { ...opts, narrow: (metrics.hostW || 900) < 520 },
      metrics
    );
    const placed = placePlans(host, plans);

    if (opts.letters) hideOsmdLetterLyrics(host);
    // XOR: never leave OSMD digits visible beside letter names
    hideOsmdFingerings(host);
    hideSoftCollidingLetters(host);
    restackChordLetterColumns(host);
    if (opts.fingers) restackChordFingerColumns(host);

    const check = assertOverlaySeparation(host);
    const chords = assertChordCompleteness(host, debriefs, completeness);
    return {
      placed,
      via: "read-plan-place",
      ok: check.ok && chords.ok,
      check,
      chords,
      completeness,
      metrics,
      jobCount: jobs.length,
      planCount: plans.length,
    };
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
        sm0.parentSourceMeasure?.MeasureNumber || sm0.measureNumber || mi + 1;
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

  function measureAtPoint(osmd, host, clientX, clientY) {
    const svg = host?.querySelector("svg");
    if (!svg || !osmd?.graphic?.measureList) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = pt.matrixTransform(svg.getScreenCTM().inverse());

    let best = null;
    let bestDist = Infinity;
    const measureList = osmd.graphic.measureList;
    for (let mi = 0; mi < measureList.length; mi++) {
      const staffMeasures = measureList[mi];
      if (!staffMeasures?.[0]) continue;
      const sm = staffMeasures[0];
      const num = sm.parentSourceMeasure?.MeasureNumber || sm.measureNumber || mi + 1;
      let x0 = null;
      let x1 = null;
      try {
        const pos = sm.PositionAndShape;
        if (pos?.AbsolutePosition && pos?.Size) {
          x0 = pos.AbsolutePosition.x * 10;
          x1 = x0 + pos.Size.width * 10;
        }
      } catch {
        /* skip */
      }
      if (x0 == null) {
        try {
          const xs = [];
          for (const entry of sm.staffEntries || []) {
            for (const voice of entry.graphicalVoiceEntries || []) {
              for (const gn of voice.notes || []) {
                const box = gnBox(gn, svg, osmd);
                if (box) xs.push(box.cx);
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
      const mid = (x0 + x1) / 2;
      const inside = local.x >= x0 && local.x <= x1;
      const dist = inside ? 0 : Math.abs(local.x - mid);
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
    readJobs,
    planJobs,
    MIN_LETTER_GAP,
    MIN_FINGER_GAP,
    MIN_CROSS_GAP,
  };
})();
