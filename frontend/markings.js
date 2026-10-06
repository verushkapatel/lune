/* Tap a marking on the score to learn what it means.
 *
 * Clefs, key and time signatures, dynamics, and every printed word (Andante,
 * con sordina, peu à peu cresc., rit.) can be tapped. Lune answers at once from
 * its own glossary, then Lune AI, when it is on, adds what it means in this
 * piece and how to play it. Nothing here guesses at the score: the key and time
 * come from the score itself.
 */
window.LuneMarkings = (function () {
  // Common performance terms in Italian, French and German, with plain meanings.
  const TERMS = {
    largo: "very slow and broad",
    lento: "slow",
    adagio: "slow, at ease",
    andante: "at a walking pace",
    andantino: "a little quicker than andante",
    moderato: "at a moderate speed",
    allegretto: "moderately quick, lighter than allegro",
    allegro: "quick and bright",
    vivace: "lively and fast",
    presto: "very fast",
    prestissimo: "as fast as possible",
    grave: "slow and solemn",
    "poco moto": "with a little motion",
    "con moto": "with motion, moving along",
    "tempo rubato": "with flexible time: hold back and push forward freely while keeping the overall pulse",
    rubato: "flexible time: stretch and give back within the pulse",
    "a tempo": "back to the main speed",
    "tempo primo": "back to the opening speed",
    "tempo i": "back to the opening speed",
    "l'istesso tempo": "the same beat as before",
    rit: "ritardando: gradually slower",
    "rit.": "ritardando: gradually slower",
    ritardando: "gradually slower",
    rall: "rallentando: gradually slower",
    "rall.": "rallentando: gradually slower",
    rallentando: "gradually slower",
    ritenuto: "held back, slower at once",
    accel: "accelerando: gradually faster",
    "accel.": "accelerando: gradually faster",
    accelerando: "gradually faster",
    stringendo: "pressing forward, getting faster",
    allargando: "broadening, slower and fuller",
    morendo: "dying away, softer and slower",
    smorzando: "fading away",
    calando: "getting softer and slower",
    cresc: "crescendo: gradually louder",
    "cresc.": "crescendo: gradually louder",
    crescendo: "gradually louder",
    dim: "diminuendo: gradually softer",
    "dim.": "diminuendo: gradually softer",
    diminuendo: "gradually softer",
    decresc: "decrescendo: gradually softer",
    "decresc.": "decrescendo: gradually softer",
    decrescendo: "gradually softer",
    "poco a poco": "little by little",
    poco: "a little",
    molto: "very, much",
    "più": "more",
    piu: "more",
    meno: "less",
    "sempre": "always, throughout",
    subito: "suddenly",
    "sotto voce": "in an undertone, very quietly",
    "mezza voce": "at half voice, softly",
    dolce: "sweetly, gently",
    dolcissimo: "very sweetly",
    cantabile: "in a singing style, with the melody sustained",
    espressivo: "with expression",
    espress: "espressivo: with expression",
    "espr.": "espressivo: with expression",
    legato: "smoothly, notes joined",
    staccato: "short and detached",
    leggiero: "lightly",
    leggero: "lightly",
    marcato: "marked, each note emphasised",
    tenuto: "held for its full length, slightly weighted",
    sostenuto: "sustained",
    agitato: "agitated, restless",
    animato: "animated, lively",
    appassionato: "passionately",
    brillante: "brilliantly",
    con: "with",
    "con brio": "with vigour and spirit",
    "con fuoco": "with fire",
    "con anima": "with soul",
    "con affetto": "with tenderness",
    "con sordina": "with the soft pedal (una corda) on the piano",
    "una corda": "press the soft (left) pedal",
    "tre corde": "release the soft pedal",
    "senza sordina": "without the dampers: let the sound ring (sustain pedal)",
    ped: "press the sustain pedal",
    "ped.": "press the sustain pedal",
    "m.d.": "mano destra: play with the right hand",
    "m.s.": "mano sinistra: play with the left hand",
    "m.g.": "main gauche: play with the left hand",
    "r.h.": "right hand",
    "l.h.": "left hand",
    "8va": "play an octave higher than written",
    "8vb": "play an octave lower than written",
    "loco": "back to the written octave",
    fine: "the end",
    "d.c.": "da capo: go back to the beginning",
    "d.s.": "dal segno: go back to the sign",
    "da capo": "go back to the beginning",
    "al fine": "and finish at Fine",
    coda: "the closing section",
    fermata: "hold the note longer than written",
    "attacca": "go straight on to the next section",
    // French
    "très": "very",
    tres: "very",
    "expressif": "expressive",
    "peu à peu": "little by little",
    "peu a peu": "little by little",
    "un peu": "a little",
    "animé": "animated, livelier",
    anime: "animated, livelier",
    "cédez": "yield: slow down a little",
    cedez: "yield: slow down a little",
    "retenu": "held back, slower",
    "en dehors": "bring this voice out above the rest",
    "doux": "gently, softly",
    "lent": "slow",
    "modéré": "moderate",
    "au mouvement": "back to the main speed",
    "en animant": "becoming livelier",
    "sans rigueur": "without strictness in time",
    // German
    langsam: "slowly",
    "mässig": "moderately",
    "massig": "moderately",
    lebhaft: "lively",
    schnell: "fast",
    ruhig: "calmly",
    innig: "intimately, with deep feeling",
    zart: "tenderly",
    "nicht zu schnell": "not too fast",
  };
  const DYNAMICS = {
    pppp: "as soft as possible",
    ppp: "extremely soft",
    pp: "pianissimo: very soft",
    p: "piano: soft",
    mp: "mezzo-piano: moderately soft",
    mf: "mezzo-forte: moderately loud",
    f: "forte: loud",
    ff: "fortissimo: very loud",
    fff: "extremely loud",
    sf: "sforzando: a sudden strong accent on one note",
    sfz: "sforzando: a sudden strong accent on one note",
    fz: "forzando: a strong accent",
    fp: "forte-piano: loud, then at once soft",
    rf: "rinforzando: a sudden reinforcement",
  };

  function glossFor(text) {
    const t = String(text || "").trim();
    const low = t.toLowerCase().replace(/\s+/g, " ");
    if (DYNAMICS[low]) return [`${t}: ${DYNAMICS[low]}.`];
    if (TERMS[low]) return [`${t}: ${TERMS[low]}.`];
    // a phrase of several terms: explain each one found, longest first so "peu à peu" wins over "peu"
    const found = [];
    let rest = ` ${low} `;
    for (const key of Object.keys(TERMS).sort((a, b) => b.length - a.length)) {
      const re = new RegExp(`(^|[\\s,(])${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[\\s,).]|$)`, "i");
      if (re.test(rest)) {
        found.push(`${key}: ${TERMS[key]}`);
        rest = rest.replace(re, "$1 ");
      }
    }
    return found.length ? found.map((f) => f[0].toUpperCase() + f.slice(1) + ".") : [];
  }

  const KEYS = { "-7": "C♭ major / A♭ minor", "-6": "G♭ major / E♭ minor", "-5": "D♭ major / B♭ minor", "-4": "A♭ major / F minor", "-3": "E♭ major / C minor", "-2": "B♭ major / G minor", "-1": "F major / D minor", 0: "C major / A minor", 1: "G major / E minor", 2: "D major / B minor", 3: "A major / F♯ minor", 4: "E major / C♯ minor", 5: "B major / G♯ minor", 6: "F♯ major / D♯ minor", 7: "C♯ major / A♯ minor" };
  const SHARPS = "FCGDAEB";
  function fromScore() {
    const xml = String(window.state?.piece?.musicxml || (typeof state !== "undefined" ? state.piece?.musicxml : "") || "");
    const fifths = Number((xml.match(/<fifths>\s*(-?\d+)\s*<\/fifths>/) || [])[1] || 0);
    const beats = Number((xml.match(/<beats>\s*(\d+)\s*<\/beats>/) || [])[1] || 0);
    const type = Number((xml.match(/<beat-type>\s*(\d+)\s*<\/beat-type>/) || [])[1] || 0);
    const clefs = [...xml.matchAll(/<clef\b[^>]*>[\s\S]*?<sign>\s*([GFC])\s*<\/sign>/g)].slice(0, 2).map((m) => m[1]);
    return { fifths, beats, type, clefs };
  }
  function explainKey() {
    const { fifths } = fromScore();
    const n = Math.abs(fifths);
    const list = fifths > 0 ? SHARPS.slice(0, n).split("").join(", ") : fifths < 0 ? SHARPS.split("").reverse().join("").slice(0, n).split("").join(", ") : "";
    const sign = fifths > 0 ? "sharp" : "flat";
    return fifths
      ? `Key signature: ${n} ${sign}${n === 1 ? "" : "s"} (${list}). Every ${list} is played ${sign} throughout unless an accidental says otherwise. It points to ${KEYS[fifths]}; the opening and closing chords tell you which.`
      : "Key signature: no sharps or flats, so C major or A minor; the opening and closing chords tell you which.";
  }
  function explainTime() {
    const { beats, type } = fromScore();
    if (!beats || !type) return "Time signature: how many beats are in each bar, and which note value gets the beat.";
    const unit = { 1: "whole notes", 2: "half notes", 4: "quarter notes (crotchets)", 8: "eighth notes (quavers)", 16: "sixteenth notes (semiquavers)" }[type] || `1/${type} notes`;
    const compound = beats > 3 && beats % 3 === 0 && type >= 4;
    return `Time signature ${beats}/${type}: ${beats} ${unit} in every bar.${compound ? ` It is compound time: the ${unit.split(" ")[0]} notes group in threes, so you feel ${beats / 3} beats a bar, each a dotted note.` : ` Count ${beats} beats a bar.`}`;
  }
  function explainClef(el) {
    const { clefs } = fromScore();
    // the clef nearest the top of its system is the right hand's
    const staves = [...document.querySelectorAll("#osmd svg .vf-clef")];
    const i = Math.max(0, staves.indexOf(el));
    const sign = clefs[i % Math.max(1, clefs.length)] || (i % 2 ? "F" : "G");
    return sign === "F"
      ? "Bass clef (F clef): its two dots surround the F line, the F below middle C. It is used for lower notes, usually the left hand."
      : sign === "C"
        ? "C clef: its centre marks middle C."
        : "Treble clef (G clef): its curl circles the G line, the G above middle C. It is used for higher notes, usually the right hand.";
  }

  /** What was tapped, as { label, gloss, question }. */
  function read(target) {
    const el = target.closest?.(".vf-clef, .vf-keysignature, .vf-timesignature, text");
    if (!el || el.closest(".lyrics, .lane-letter, .lane-spare")) return null;
    if (el.matches(".vf-clef")) return { label: "the clef", gloss: explainClef(el), question: "What does this clef mean for how I read the notes on this staff?" };
    if (el.matches(".vf-keysignature")) return { label: "the key signature", gloss: explainKey(), question: "What does this key signature mean for this piece, and which notes change?" };
    if (el.matches(".vf-timesignature")) return { label: "the time signature", gloss: explainTime(), question: "How should I count and feel this time signature in this piece?" };
    const word = (el.textContent || "").trim();
    // bar numbers, fingerings and the music font's own glyphs are not terms
    if (!word || /^\d+$/.test(word) || /^[-~]+$/.test(word)) return null;
    const gloss = glossFor(word);
    return { label: `“${word}”`, gloss: gloss.length ? gloss.join(" ") : "", question: `What does “${word}” mean, and how should I play it here?` };
  }

  function onScoreClick(e) {
    // the bar-selection layer sits above the engraving: look at everything under the finger
    let hit = read(e.target);
    if (!hit && typeof e.clientX === "number") {
      for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
        if (!el.closest?.("#osmd")) continue;
        hit = read(el);
        if (hit) break;
      }
    }
    // signs are thin glyphs on the staff: a tap anywhere inside a sign's box counts
    if (!hit && typeof e.clientX === "number") {
      const pad = 4;
      const inside = (el) => {
        const r = el.getBoundingClientRect();
        return e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - pad && e.clientY <= r.bottom + pad;
      };
      const signs = document.querySelectorAll("#osmd svg .vf-timesignature, #osmd svg .vf-keysignature, #osmd svg .vf-clef");
      for (const el of signs) if (inside(el)) {
        hit = read(el);
        if (hit) break;
      }
    }
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    window.LuneAsk?.explainMarking?.(hit);
  }

  function init() {
    const host = document.getElementById("score-scroll") || document.getElementById("osmd");
    if (!host || host.dataset.markings) return;
    host.dataset.markings = "1";
    // capture: a tap on a marking explains it instead of selecting the bar under it
    host.addEventListener("click", onScoreClick, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
  return { glossFor, read, init };
})();
