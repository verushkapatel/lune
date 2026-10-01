/* Letter names + fingerings for OSMD — fingers in MusicXML, letters as SVG overlays */

window.LuneAnnotate = (function () {
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

  /**
   * Inject fingerings onto every sounding note, including chord tones
   * (MusicXML marks non-first chord notes with <chord/>).
   */
  function annotate(musicxml, debriefs, { fingers = false } = {}) {
    if (!musicxml || !fingers) return musicxml;
    const parser = new DOMParser();
    const doc = parser.parseFromString(musicxml, "text/xml");
    if (doc.querySelector("parsererror")) return musicxml;

    const measures = [...doc.getElementsByTagName("measure")];
    for (const measure of measures) {
      const num = Number(measure.getAttribute("number") || "0");
      const d = debriefs?.[String(num)];
      if (!d) continue;

      // Match analyzer order: RH then LH, within hand by offset then high→low midi
      const wanted = [...(d.rh || []), ...(d.lh || [])].sort(
        (a, b) => (a.offset || 0) - (b.offset || 0) || (b.midi || 0) - (a.midi || 0)
      );
      let idx = 0;

      // Walk notes in document order, grouping chord stacks together then
      // sorting each stack high→low so it lines up with `wanted`.
      const raw = [...measure.getElementsByTagName("note")];
      const stacks = [];
      let current = null;
      for (const note of raw) {
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

      for (const stack of stacks) {
        // Approximate high→low by staff position: later we just assign in stack
        // order after sorting by midi from wanted. Stack length must match.
        const infos = [];
        for (let i = 0; i < stack.length; i++) {
          const info = wanted[idx];
          idx += 1;
          if (info) infos.push(info);
        }
        // Pair highest midi with top of chord visually: MusicXML chord order is
        // usually bottom→top (main note first, then <chord/> above). Reverse infos
        // that are high→low so index 0 (main/bottom note) gets lowest midi.
        const byLow = [...infos].sort((a, b) => (a.midi || 0) - (b.midi || 0));
        stack.forEach((note, i) => {
          const info = byLow[i];
          if (!info?.fingering) return;

          let notations = note.getElementsByTagName("notations")[0];
          if (!notations) {
            notations = doc.createElement("notations");
            note.appendChild(notations);
          }
          [...notations.getElementsByTagName("technical")].forEach((t) => {
            if (t.getAttribute("data-lune") === "1") t.remove();
          });
          const technical = doc.createElement("technical");
          technical.setAttribute("data-lune", "1");
          const fingering = doc.createElement("fingering");
          text(fingering, String(info.fingering));
          technical.appendChild(fingering);
          notations.appendChild(technical);
        });
      }
    }

    return new XMLSerializer().serializeToString(doc);
  }

  function clearLetterOverlays(host) {
    host?.querySelectorAll(".lune-letter-layer").forEach((n) => n.remove());
  }

  function collectLetters(debriefs) {
    const letters = [];
    const nums = Object.keys(debriefs || {})
      .map(Number)
      .sort((a, b) => a - b);
    for (const num of nums) {
      const d = debriefs[String(num)];
      // Same order as coach packs: RH then LH, offset, high→low (all chord tones)
      const pack = [...(d.rh || []), ...(d.lh || [])].sort(
        (a, b) => (a.offset || 0) - (b.offset || 0) || (b.midi || 0) - (a.midi || 0)
      );
      for (const n of pack) {
        if (n.letter) letters.push(n.letter);
      }
    }
    return letters;
  }

  function noteheadBoxes(svg) {
    let heads = [...svg.querySelectorAll(".vf-notehead")];
    if (!heads.length) {
      heads = [...svg.querySelectorAll("g.vf-stavenote .vf-notehead, g.vf-stavenote ellipse")];
    }
    if (!heads.length) {
      heads = [...svg.querySelectorAll("ellipse")].filter((el) => {
        try {
          const b = el.getBBox();
          return b.width > 3 && b.width < 28 && b.height > 2 && b.height < 22;
        } catch {
          return false;
        }
      });
    }

    const usable = [];
    for (const h of heads) {
      try {
        const b = h.getBBox();
        if (b.width > 0 && b.height > 0) usable.push({ el: h, box: b });
      } catch {
        /* skip */
      }
    }
    // Reading order: top→bottom (high pitch first on a staff), then left→right
    usable.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
    return usable;
  }

  /**
   * Walk OSMD graphic notes so every chord tone (each GraphicalNote) gets a letter.
   */
  function placeViaGraphic(host, osmd, debriefs) {
    const svg = host.querySelector("svg");
    if (!svg || !osmd?.graphic?.measureList) return 0;

    const layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layer.setAttribute("class", "lune-letter-layer");
    svg.appendChild(layer);

    let placed = 0;
    const measureList = osmd.graphic.measureList;
    for (let mi = 0; mi < measureList.length; mi++) {
      const staffMeasures = measureList[mi];
      if (!staffMeasures) continue;
      const measureNum =
        staffMeasures[0]?.parentSourceMeasure?.MeasureNumber ||
        staffMeasures[0]?.measureNumber ||
        mi + 1;
      const d = debriefs[String(measureNum)];
      if (!d) continue;
      const wanted = [...(d.rh || []), ...(d.lh || [])].sort(
        (a, b) => (a.offset || 0) - (b.offset || 0) || (b.midi || 0) - (a.midi || 0)
      );
      let w = 0;

      for (const sm of staffMeasures) {
        if (!sm?.staffEntries) continue;
        for (const entry of sm.staffEntries) {
          // Collect all sounding notes at this entry (full chord), high→low
          const stack = [];
          for (const voice of entry.graphicalVoiceEntries || []) {
            for (const gn of voice.notes || []) {
              if (gn.isRest?.() || gn.isRest) continue;
              stack.push(gn);
            }
          }
          stack.sort((a, b) => {
            try {
              return (a.PositionAndShape?.AbsolutePosition?.y || 0) - (b.PositionAndShape?.AbsolutePosition?.y || 0);
            } catch {
              return 0;
            }
          });

          for (const gn of stack) {
            const info = wanted[w];
            w += 1;
            if (!info?.letter) continue;

            let x = 0;
            let y = 0;
            try {
              const g =
                (typeof gn.getSVGGElement === "function" && gn.getSVGGElement()) ||
                (typeof gn.getSVGElement === "function" && gn.getSVGElement());
              if (g?.getBBox) {
                const box = g.getBBox();
                x = box.x + box.width + 3;
                y = box.y + box.height * 0.72;
              }
            } catch {
              /* fall through */
            }
            if (!x && !y) {
              try {
                const abs = gn.PositionAndShape?.AbsolutePosition;
                if (abs) {
                  x = abs.x * 10 + 8;
                  y = abs.y * 10;
                }
              } catch {
                continue;
              }
            }
            if (!x && !y) continue;

            const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
            t.setAttribute("class", "lune-letter");
            t.setAttribute("x", String(x));
            t.setAttribute("y", String(y));
            t.setAttribute("text-anchor", "start");
            t.textContent = info.letter;
            layer.appendChild(t);
            placed += 1;
          }
        }
      }
    }
    return placed;
  }

  /**
   * Place letter names beside every notehead — including each tone in a chord.
   */
  function placeLetterOverlays(host, osmd, debriefs) {
    clearLetterOverlays(host);
    if (!host || !debriefs) return;

    let placed = 0;
    try {
      placed = placeViaGraphic(host, osmd, debriefs);
    } catch {
      placed = 0;
    }

    const letters = collectLetters(debriefs);
    if (placed >= Math.min(letters.length, 3)) return;

    // Fallback: every painted notehead ↔ every letter (chords = multiple heads)
    clearLetterOverlays(host);
    const svg = host.querySelector("svg");
    if (!svg || !letters.length) return;

    const layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layer.setAttribute("class", "lune-letter-layer");
    svg.appendChild(layer);

    const usable = noteheadBoxes(svg);
    const count = Math.min(usable.length, letters.length);
    for (let i = 0; i < count; i++) {
      const { box } = usable[i];
      const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("class", "lune-letter");
      t.setAttribute("x", String(box.x + box.width + 4));
      t.setAttribute("y", String(box.y + box.height * 0.78));
      t.setAttribute("text-anchor", "start");
      t.textContent = letters[i];
      layer.appendChild(t);
    }
  }

  return { annotate, placeLetterOverlays, clearLetterOverlays };
})();
