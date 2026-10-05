/* Piano playback with Tone.js Salamander samples + scrubbable timeline.
 * Playback rate (slow-mo ↔ faster) scales timeline progress and schedule timing.
 * Visual note-on/off callbacks stay locked to the playhead (foolproof sync).
 */

window.LunePiano = (function () {
  let sampler = null;
  let loading = null;
  let playing = false;
  let events = [];
  let startMs = 0;
  let pauseAt = 0;
  let raf = 0;
  let onTick = null;
  let onEnd = null;
  let onKeys = null; // ({ active: [{midi,finger,name}], progress, total, bar }) => void
  let output = null;
  let rate = 1;
  let lastActiveKey = "";
  let warmed = false;
  /** both | rh | lh — filters schedule + keyboard highlight. */
  let handFilter = "both";
  /** Keyboard UI: only light notes that attacked recently (not full sustain). */
  const KEY_ATTACK_WINDOW = 0.15;
  /** Bumped on stop/pause so look-ahead notes scheduled earlier are ignored. */
  let audioEpoch = 0;
  /** Notes handed to Web Audio, sounding or still waiting to start. */
  const liveSources = new Set();
  /** One clock for a run of playback: the audio time at which musical time anchorAt sounds. */
  let anchorAudio = null;
  let anchorAt = 0;
  /** Event indices already queued for the current audioEpoch. */
  const scheduled = new Set();
  // Seconds per quarter note (fallback when the score has no tempo map).
  let beat = 60 / 72;
  /** Written tempo map in quarter-note units: [{ q, bpm }, ...] sorted by q. */
  let tempoMapQ = [];
  /** First written marking — slider BPM is scaled against this. */
  let baseBpm = 72;
  /** practiceBpm / baseBpm — 1.0 keeps every written tempo change. */
  let tempoScale = 1;
  /** Original note list so tempo changes can rebuild the timeline in place. */
  let sourceNotes = [];
  /** Schedule a hair ahead of now so the first note never clicks against a cold bus. */
  const SCHEDULE_PAD = 0.055;
  /** Musical-time look-ahead: long enough that a busy moment (a page turn, a redraw)
   *  never starves the music. Stop still silences at once: every queued note is
   *  tracked in liveSources and cut. */
  const LOOKAHEAD = 1.2;
  /** When the tab is hidden, frames stop and timers slow to about one a second. */
  const LOOKAHEAD_HIDDEN = 2.2;

  const RATES = [0.5, 0.75, 1, 1.25, 1.5];

  /* -------- metronome (piece meter + current BPM) -------- */
  let metroOn = false;
  let metroBeats = 4;
  let metroUnit = 4; // bottom of time signature
  let metroBeat = 0;
  let metroTimer = 0;
  let metroClick = null;
  let metroAccent = null;
  let metroStartedAt = 0;

  const SALAMANDER_URLS = {
    A0: "A0.mp3",
    C1: "C1.mp3",
    "D#1": "Ds1.mp3",
    "F#1": "Fs1.mp3",
    A1: "A1.mp3",
    C2: "C2.mp3",
    "D#2": "Ds2.mp3",
    "F#2": "Fs2.mp3",
    A2: "A2.mp3",
    C3: "C3.mp3",
    "D#3": "Ds3.mp3",
    "F#3": "Fs3.mp3",
    A3: "A3.mp3",
    C4: "C4.mp3",
    "D#4": "Ds4.mp3",
    "F#4": "Fs4.mp3",
    A4: "A4.mp3",
    C5: "C5.mp3",
    "D#5": "Ds5.mp3",
    "F#5": "Fs5.mp3",
    A5: "A5.mp3",
    C6: "C6.mp3",
    "D#6": "Ds6.mp3",
    "F#6": "Fs6.mp3",
    A6: "A6.mp3",
    C7: "C7.mp3",
    "D#7": "Ds7.mp3",
    "F#7": "Fs7.mp3",
    A7: "A7.mp3",
    C8: "C8.mp3",
  };

  // Salamander Grand Piano (Alexander Holm, CC BY 3.0), served with Lune so the first note does not wait on another site
  const LOCAL_SAMPLES = (() => {
    try {
      return new URL("vendor/salamander/", document.currentScript?.src || location.href).href;
    } catch {
      return "static/vendor/salamander/";
    }
  })();
  const SAMPLE_BASES = [LOCAL_SAMPLES, "https://tonejs.github.io/audio/salamander/"];

  function buildChain() {
    if (output) {
      try {
        output.dispose();
      } catch {
        /* ignore */
      }
      output = null;
    }
    const limiter = new Tone.Limiter(-1.0).toDestination();
    const comp = new Tone.Compressor({
      threshold: -24,
      ratio: 2.2,
      attack: 0.018,
      release: 0.28,
      knee: 10,
    }).connect(limiter);
    // Soft shelf so the first hammer strike is less clicky at the top
    const filter = new Tone.Filter({
      type: "lowpass",
      frequency: 14000,
      Q: 0.5,
    }).connect(comp);
    // A small room around the instrument: dry samples sound like a keyboard, not a piano.
    let into = filter;
    try {
      const room = new Tone.Reverb({ decay: 2.4, preDelay: 0.018, wet: 0.17 });
      room.connect(filter);
      into = room;
    } catch {
      /* no reverb on this browser: play dry */
    }
    const vol = new Tone.Volume(-6.5).connect(into);
    output = vol;
    return vol;
  }

  async function loadSampler(baseUrl) {
    const dest = output || buildChain();
    const s = new Tone.Sampler({
      urls: SALAMANDER_URLS,
      baseUrl,
      // Gentle attack — zero attack reads as a digital click on Salamander
      attack: 0.022,
      release: 1.2,
      curve: "exponential",
    }).connect(dest);
    await Tone.loaded();
    if (!s.loaded) throw new Error("Sampler not loaded");
    return s;
  }

  async function unlockAudio() {
    if (typeof Tone === "undefined") throw new Error("Tone.js missing");
    await Tone.start();
    try {
      if (Tone.context.state !== "running") await Tone.context.resume();
    } catch {
      /* ignore */
    }
  }

  async function warmSampler(s) {
    if (warmed || !s) return;
    try {
      // Near-silent tick so the first real note isn't fighting a cold graph
      const t = Tone.now() + 0.04;
      s.triggerAttackRelease("A0", 0.04, t, 0.001);
      await new Promise((r) => setTimeout(r, 90));
      s.releaseAll();
      warmed = true;
    } catch {
      /* ignore warm failures */
    }
  }

  async function ensure() {
    if (sampler && sampler.loaded) {
      await unlockAudio();
      return sampler;
    }
    if (loading) return loading;
    if (typeof Tone === "undefined") throw new Error("Tone.js missing");
    loading = (async () => {
      await unlockAudio();
      buildChain();
      let lastErr = null;
      for (const base of SAMPLE_BASES) {
        try {
          const s = await loadSampler(base);
          await warmSampler(s);
          sampler = s;
          return sampler;
        } catch (err) {
          lastErr = err;
          try {
            if (sampler) sampler.dispose();
          } catch {
            /* ignore */
          }
          sampler = null;
          warmed = false;
        }
      }
      throw lastErr || new Error("Piano samples failed to load");
    })().finally(() => {
      loading = null;
    });
    return loading;
  }

  function midiToNote(midi) {
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const m = Math.round(midi);
    return names[((m % 12) + 12) % 12] + Math.floor(m / 12 - 1);
  }

  /** Soft velocity curve — chords stay musical, never brick-wall loud. */
  function velocityFor(midi, chordSize) {
    const register = 0.48 + Math.min(0.24, Math.max(0, (midi - 48) * 0.0055));
    const spread = chordSize > 1 ? Math.max(0.55, 1 - (chordSize - 1) * 0.07) : 1;
    // Mild curve so quiet notes still speak, loud notes don't harden
    const shaped = Math.pow(register * spread, 0.92);
    return Math.min(0.8, Math.max(0.34, shaped));
  }

  /** Seconds at quarter-position `q`, honouring the written tempo map × scale. */
  function secondsAtQuarter(q) {
    const qq = Math.max(0, Number(q) || 0);
    if (!tempoMapQ.length) {
      const spq = beat / Math.max(0.05, tempoScale);
      return qq * spq;
    }
    let sec = 0;
    let prevQ = 0;
    let bpm = tempoMapQ[0].bpm;
    for (let i = 0; i < tempoMapQ.length; i++) {
      const seg = tempoMapQ[i];
      const at = Math.max(0, Number(seg.q) || 0);
      if (at >= qq) break;
      if (at > prevQ) {
        sec += (at - prevQ) * (60 / Math.max(1, bpm * tempoScale));
        prevQ = at;
      }
      bpm = Number(seg.bpm) || bpm;
    }
    sec += (qq - prevQ) * (60 / Math.max(1, bpm * tempoScale));
    return sec;
  }

  /** Local seconds-per-quarter at quarter-position `q` (for note durations). */
  function spqAtQuarter(q) {
    if (!tempoMapQ.length) return beat / Math.max(0.05, tempoScale);
    let bpm = tempoMapQ[0].bpm;
    const qq = Math.max(0, Number(q) || 0);
    for (const seg of tempoMapQ) {
      if ((Number(seg.q) || 0) <= qq + 1e-9) bpm = Number(seg.bpm) || bpm;
      else break;
    }
    return 60 / Math.max(1, bpm * tempoScale);
  }

  function buildEvents(notes) {
    const raw = (notes || [])
      .filter((n) => n.midi)
      .map((n) => {
        const barOff = Number(n.offset) || 0;
        const absQ = Number(n.absOffset ?? n.offset) || 0;
        const barStartQ = absQ - barOff;
        const t = secondsAtQuarter(absQ);
        // Keep sounding length close to the written value — stretch made
        // long notes feel like they were re-attacking into the next bar.
        const dur = Math.max(0.1, (Number(n.duration) || 0.5) * spqAtQuarter(absQ) * 1.02);
        // How long it rings: the written length, or until the pedal lifts.
        const sound =
          n.sustainTo != null && n.sustainTo > absQ ? Math.max(dur, secondsAtQuarter(n.sustainTo) - t - 0.04) : dur;
        const finger =
          n.fingering != null && n.fingering !== ""
            ? String(n.fingering)
            : n.finger != null && n.finger !== ""
              ? String(n.finger)
              : null;
        return {
          t,
          dur,
          sound,
          dyn: Number(n.dyn) || 1,
          q: absQ,
          barOff,
          barStartQ,
          barStartT: secondsAtQuarter(barStartQ),
          midi: n.midi,
          bar: n.bar || null,
          name: midiToNote(n.midi),
          // the score's own spelling (A♭, not G♯) for labels
          label: String(n.letter || n.pitch || "")
            .replace(/-?\d+$/, "")
            .replace(/^([A-Ga-g])(.*)$/, (m, a, acc) => a.toUpperCase() + acc.replace(/b/g, "♭").replace(/#/g, "♯")),
          finger,
          hand: n.hand || null,
        };
      })
      .sort((a, b) => a.t - b.t || a.midi - b.midi);

    const density = new Map();
    for (const e of raw) {
      const key = Math.round(e.t * 40);
      density.set(key, (density.get(key) || 0) + 1);
    }
    for (const e of raw) {
      const key = Math.round(e.t * 40);
      // The score's dynamics and voicing, with the small unevenness of real fingers.
      const wobble = 1 + (((e.midi * 7919 + Math.round(e.t * 1000) * 31) % 100) / 100 - 0.5) * 0.07;
      e.vel = Math.min(0.94, Math.max(0.2, velocityFor(e.midi, density.get(key) || 1) * e.dyn * wobble));
    }
    return raw;
  }

  function duration() {
    if (!events.length) return 0;
    return Math.max(...events.map((e) => e.t + e.dur));
  }

  /** The audio time being heard right now (output latency included), or null. */
  function heardTime() {
    try {
      const ctx = Tone.getContext().rawContext;
      if (!ctx || ctx.state !== "running") return null;
      const ts = ctx.getOutputTimestamp?.();
      if (ts && ts.performanceTime > 0) return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
      return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    } catch {
      return null;
    }
  }

  function progress() {
    if (!playing) return pauseAt;
    // Follow the sound itself, so keys and the playhead light with the note you hear
    const heard = anchorAudio == null ? null : heardTime();
    const elapsed = heard == null ? ((performance.now() - startMs) / 1000) * rate : (heard - anchorAudio) * rate;
    return Math.min(duration(), anchorAudio == null ? pauseAt + Math.max(0, elapsed) : anchorAt + Math.max(0, elapsed));
  }

  function currentBar() {
    return barAtTime(progress());
  }

  function barAtTime(at) {
    const marks = barMarkers();
    if (!marks.length) {
      let bar = events[0]?.bar || null;
      for (const e of events) {
        if (e.t <= at + 0.01) bar = e.bar;
        else break;
      }
      return bar;
    }
    let bar = marks[0].bar;
    for (const m of marks) {
      if (m.t <= at + 0.001) bar = m.bar;
      else break;
    }
    return bar;
  }

  /**
   * Bar downbeats from the engraved bar start (absOffset − offset), not the
   * first sounding note — leading rests must keep the playhead in the new bar.
   */
  function barMarkers() {
    const seen = new Map();
    for (const e of events) {
      if (e.bar == null) continue;
      const t0 = Number.isFinite(e.barStartT)
        ? e.barStartT
        : Math.max(0, e.t - (Number(e.barOff) || 0) * (beat / Math.max(0.05, tempoScale)));
      if (!seen.has(e.bar) || t0 < seen.get(e.bar)) seen.set(e.bar, t0);
    }
    const total = duration();
    return [...seen.entries()]
      .sort((a, b) => a[1] - b[1] || a[0] - b[0])
      .map(([bar, t]) => ({ bar, t, ratio: total > 0 ? t / total : 0 }));
  }

  function passesHand(e) {
    if (handFilter === "both") return true;
    const h = String(e.hand || "").toLowerCase();
    const isLh = h === "lh" || h === "l" || h === "left";
    if (handFilter === "rh") return !isLh;
    if (handFilter === "lh") return isLh;
    return true;
  }

  /** Notes for keyboard highlight at timeline time `at` (seconds).
   * Cap to recent attacks so sustained chords don’t light the whole board. */
  function activeAt(at) {
    const active = [];
    for (const e of events) {
      if (e.t > at + 0.01) break;
      if (!passesHand(e)) continue;
      const onset = e.t <= at + 0.01 && at - e.t <= KEY_ATTACK_WINDOW;
      if (onset) {
        active.push({
          midi: e.midi,
          finger: e.finger,
          name: e.name,
          hand: e.hand,
        });
      }
    }
    return active;
  }

  function emitKeys(p) {
    if (!onKeys) return;
    const active = activeAt(p);
    const key = active
      .map((a) => `${a.midi}:${a.finger || ""}`)
      .sort()
      .join("|");
    if (key === lastActiveKey) {
      onKeys({
        active,
        progress: p,
        total: duration(),
        bar: currentBar(),
        changed: false,
      });
      return;
    }
    lastActiveKey = key;
    onKeys({
      active,
      progress: p,
      total: duration(),
      bar: currentBar(),
      changed: true,
    });
  }

  function openBus() {
    if (output) output.mute = false;
  }

  // Next event to consider. Events are sorted by time, so each one is looked
  // at once instead of the whole piece being scanned on every frame.
  let pumpCursor = 0;
  let pumpTimer = 0;

  function pumpSchedule(at) {
    if (!sampler || !playing) return;
    openBus();
    const r = Math.max(0.25, rate);
    // Look-ahead is in musical time, so scale it by the rate to keep the same
    // wall-clock margin; hidden tabs get a long one because timers crawl there.
    const horizon = at + (document.hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD) * r;
    const soonest = Tone.now() + 0.01;
    while (pumpCursor < events.length) {
      const i = pumpCursor;
      const e = events[i];
      if (e.t > horizon) break;
      pumpCursor += 1;
      if (e.t + e.sound <= at) continue;
      if (!passesHand(e)) continue;
      if (scheduled.has(i)) continue;
      scheduled.add(i);
      // Every note is placed on the one audio clock set when playback started, so
      // the spacing between notes is exact whatever the page is doing meanwhile
      const due = anchorAudio + (e.t - anchorAt) / r;
      const when = Math.max(soonest, due);
      // Keep a short release tail in wall time so notes don't chop at any rate
      const remain = Math.max(0.14, e.sound / r - Math.max(0, when - due));
      const vel = e.vel ?? 0.58;
      try {
        playNote(e.name, remain, when, vel);
      } catch {
        /* ignore sample glitches */
      }
    }
  }

  /** Start a note and keep hold of it, so Stop can cut it even before it sounds. */
  function playNote(name, dur, when, vel) {
    sampler.triggerAttack(name, when, vel);
    let src = null;
    try {
      const list = sampler._activeSources?.get(Math.round(Tone.Frequency(name).toMidi()));
      src = list?.length ? list.pop() : null;
    } catch {
      src = null;
    }
    if (!src) {
      sampler.triggerRelease(name, when + dur);
      return;
    }
    src.stop(when + dur);
    liveSources.add(src);
    const done = src.onended;
    src.onended = (x) => {
      liveSources.delete(src);
      if (typeof done === "function") done(x);
    };
  }

  function cutLiveSources() {
    const now = Tone.now();
    for (const src of liveSources) {
      try {
        src.fadeOut = 0.03;
        src.stop(now);
      } catch {
        /* already gone */
      }
    }
    liveSources.clear();
  }

  function setHandFilter(mode) {
    const next = ["both", "rh", "lh"].includes(mode) ? mode : "both";
    if (next === handFilter) return handFilter;
    handFilter = next;
    lastActiveKey = "";
    if (playing) {
      pauseAt = progress();
      startMs = performance.now() + SCHEDULE_PAD * 1000;
      clearAudio();
      playing = true;
      scheduleFrom(pauseAt);
      raf = requestAnimationFrame(tick);
    }
    emitKeys(playing ? progress() : pauseAt);
    return handFilter;
  }

  function getHandFilter() {
    return handFilter;
  }

  function scheduleFrom(at) {
    anchorAudio = null;
    if (!sampler) return;
    cutLiveSources();
    anchorAudio = Tone.now() + SCHEDULE_PAD;
    anchorAt = at;
    // Kill anything that may have started while the bus was muted
    try {
      sampler.releaseAll();
    } catch {
      /* ignore */
    }
    scheduled.clear();
    // Start from the first event still sounding at this point.
    pumpCursor = 0;
    while (pumpCursor < events.length && events[pumpCursor].t + events[pumpCursor].sound <= at) pumpCursor += 1;
    // Long notes that began earlier sit behind the cursor: rewind to cover them.
    let back = pumpCursor;
    while (back > 0 && events[back - 1].t > at - 30) back -= 1;
    pumpCursor = back;
    openBus();
    pumpSchedule(at);
    // Frames stop in a background tab; this keeps the music going there.
    clearInterval(pumpTimer);
    pumpTimer = setInterval(() => {
      if (playing) pumpSchedule(progress());
    }, 100);
  }

  function clearAudio() {
    cancelAnimationFrame(raf);
    raf = 0;
    clearInterval(pumpTimer);
    pumpTimer = 0;
    audioEpoch += 1;
    scheduled.clear();
    cutLiveSources();
    try {
      Tone.Transport.cancel();
      if (sampler) sampler.releaseAll();
      // Mute the bus so any look-ahead note that already crossed into Web Audio
      // cannot be heard — Stop / Pause must be instant.
      if (output) output.mute = true;
    } catch {
      /* ignore */
    }
  }

  function tick() {
    if (!playing) return;
    const p = progress();
    pumpSchedule(p);
    if (onTick) onTick({ progress: p, total: duration(), bar: currentBar() });
    emitKeys(p);
    if (p >= duration() - 0.02) {
      playing = false;
      clearAudio();
      pauseAt = duration();
      if (onTick) onTick({ progress: pauseAt, total: duration(), bar: currentBar() });
      lastActiveKey = "";
      if (onKeys) onKeys({ active: [], progress: pauseAt, total: duration(), bar: currentBar(), changed: true });
      if (onEnd) onEnd();
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  /** Seconds between metronome clicks for the current meter. */
  function metroInterval() {
    const bpm = getTempoBpm();
    // Click on each written beat (numerator), scaled by the beat unit.
    return (60 / bpm) * (4 / Math.max(1, metroUnit));
  }

  async function ensureMetroSounds() {
    await unlockAudio();
    if (!metroClick) {
      metroClick = new Tone.MembraneSynth({
        pitchDecay: 0.008,
        octaves: 2,
        oscillator: { type: "sine" },
        envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.04 },
      }).toDestination();
      metroClick.volume.value = -14;
    }
    if (!metroAccent) {
      metroAccent = new Tone.MembraneSynth({
        pitchDecay: 0.012,
        octaves: 3,
        oscillator: { type: "triangle" },
        envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.06 },
      }).toDestination();
      metroAccent.volume.value = -10;
    }
  }

  function stopMetroTimer() {
    if (metroTimer) {
      clearTimeout(metroTimer);
      metroTimer = 0;
    }
  }

  function fireMetroClick() {
    if (!metroOn) return;
    const accent = metroBeat % Math.max(1, metroBeats) === 0;
    try {
      const now = Tone.now();
      if (accent) metroAccent?.triggerAttackRelease("C3", "32n", now, 0.7);
      else metroClick?.triggerAttackRelease("C2", "32n", now, 0.45);
    } catch {
      /* ignore */
    }
    metroBeat += 1;
  }

  function scheduleMetro() {
    stopMetroTimer();
    if (!metroOn) return;
    fireMetroClick();
    const step = Math.max(0.12, metroInterval()) * 1000;
    metroTimer = setTimeout(scheduleMetro, step);
  }

  function setMeter(beats, unit) {
    const b = Math.max(1, Math.min(16, Number(beats) || 4));
    const u = [1, 2, 4, 8, 16].includes(Number(unit)) ? Number(unit) : 4;
    metroBeats = b;
    metroUnit = u;
    if (metroOn) {
      metroBeat = 0;
      scheduleMetro();
    }
  }

  function getMeter() {
    return { beats: metroBeats, unit: metroUnit };
  }

  async function setMetronome(on) {
    metroOn = !!on;
    if (!metroOn) {
      stopMetroTimer();
      metroBeat = 0;
      return false;
    }
    await ensureMetroSounds();
    metroBeat = 0;
    metroStartedAt = performance.now();
    scheduleMetro();
    return true;
  }

  function isMetronomeOn() {
    return metroOn;
  }

  /** Load a timeline without starting audio (for scrub-before-play). */
  /** Set practice BPM. Scales the written tempo map so 1.0× = original. */
  function setTempoBpm(bpm, { rebuild = true } = {}) {
    const n = Number(bpm);
    if (!Number.isFinite(n) || n <= 0) return getTempoBpm();
    const clamped = Math.max(40, Math.min(200, n));
    const prevTotal = duration();
    const ratio = prevTotal > 0 ? progress() / prevTotal : 0;
    const wasPlaying = playing;
    const base = Math.max(1, baseBpm || 72);
    tempoScale = clamped / base;
    beat = 60 / clamped;
    if (rebuild && sourceNotes.length) {
      clearAudio();
      playing = false;
      events = buildEvents(sourceNotes);
      pauseAt = Math.max(0, Math.min(1, ratio)) * (duration() || 0);
      lastActiveKey = "";
      if (onTick) onTick({ progress: pauseAt, total: duration(), bar: currentBar() });
      emitKeys(pauseAt);
      if (wasPlaying && events.length) {
        playing = true;
        startMs = performance.now() + SCHEDULE_PAD * 1000;
        scheduleFrom(pauseAt);
        raf = requestAnimationFrame(tick);
      }
    }
    if (metroOn) {
      metroBeat = 0;
      scheduleMetro();
    }
    return clamped;
  }

  function getTempoBpm() {
    return Math.round(baseBpm * tempoScale);
  }

  /**
   * Written tempo map: [{ bar, bpm }] or [{ q, bpm }].
   * `base` is the marking the practice slider is relative to (usually the first).
   */
  function setTempoMap(map, base) {
    const rows = Array.isArray(map) ? map : [];
    const byQ = [];
    for (const row of rows) {
      const bpm = Number(row?.bpm);
      if (!Number.isFinite(bpm) || bpm <= 0) continue;
      if (row.q != null && Number.isFinite(Number(row.q))) {
        byQ.push({ q: Math.max(0, Number(row.q)), bpm });
        continue;
      }
      // Bar-indexed maps are resolved against sourceNotes when arming.
      byQ.push({ bar: Number(row.bar), off: Math.max(0, Number(row.off) || 0), bpm, q: null });
    }
    tempoMapQ = byQ;
    if (Number.isFinite(Number(base)) && Number(base) > 0) {
      baseBpm = Number(base);
    } else if (byQ.length && Number.isFinite(byQ[0].bpm)) {
      baseBpm = byQ[0].bpm;
    }
    beat = 60 / Math.max(1, baseBpm * tempoScale);
    return tempoMapQ.slice();
  }

  /** Resolve any bar-keyed tempo rows using note bar starts, then rebuild times. */
  function resolveTempoMapAgainstNotes(notes) {
    if (!tempoMapQ.length) return;
    const barStart = new Map();
    for (const n of notes || []) {
      if (n.bar == null) continue;
      const absQ = Number(n.absOffset ?? n.offset) || 0;
      const off = Number(n.offset) || 0;
      const startQ = absQ - off;
      if (!barStart.has(n.bar) || startQ < barStart.get(n.bar)) {
        barStart.set(n.bar, startQ);
      }
    }
    const resolved = [];
    for (const row of tempoMapQ) {
      if (row.q != null && Number.isFinite(row.q)) {
        resolved.push({ q: row.q, bpm: row.bpm });
        continue;
      }
      // a change written partway through a bar starts there, not at the barline
      if (row.bar != null && barStart.has(row.bar)) {
        resolved.push({ q: barStart.get(row.bar) + (row.off || 0), bpm: row.bpm });
      }
    }
    resolved.sort((a, b) => a.q - b.q);
    // Collapse identical consecutive bpms at the same q
    const out = [];
    for (const r of resolved) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.q - r.q) < 1e-6) {
        last.bpm = r.bpm;
        continue;
      }
      if (last && Math.abs(last.bpm - r.bpm) < 1e-6) continue;
      out.push({ q: r.q, bpm: r.bpm });
    }
    if (out.length) tempoMapQ = out;
  }

  function getEvents() {
    return events.slice();
  }

  function arm(notes, opts = {}) {
    clearAudio();
    playing = false;
    sourceNotes = Array.isArray(notes) ? notes.slice() : [];
    if (opts.tempoMap) setTempoMap(opts.tempoMap, opts.baseBpm ?? opts.tempoBpm);
    else {
      tempoMapQ = [];
      if (opts.baseBpm != null) baseBpm = Number(opts.baseBpm) || baseBpm;
    }
    if (opts.tempoBpm != null) setTempoBpm(opts.tempoBpm, { rebuild: false });
    resolveTempoMapAgainstNotes(sourceNotes);
    events = buildEvents(sourceNotes);
    if (!events.length) return false;
    if (opts.onTick) onTick = opts.onTick;
    if (opts.onEnd !== undefined) onEnd = opts.onEnd;
    if (opts.onKeys) onKeys = opts.onKeys;
    lastActiveKey = "";
    const total = duration();
    const fromOpt = opts.from || 0;
    pauseAt =
      fromOpt > 0 && fromOpt <= 1 && total > 0
        ? fromOpt * total
        : Math.max(0, Math.min(fromOpt, Math.max(0, total - 0.05)));
    if (onTick) onTick({ progress: pauseAt, total, bar: currentBar() });
    emitKeys(pauseAt);
    return true;
  }

  async function play(notes, opts = {}) {
    await ensure();
    clearAudio();
    playing = false;
    sourceNotes = Array.isArray(notes) ? notes.slice() : [];
    if (opts.tempoMap) setTempoMap(opts.tempoMap, opts.baseBpm ?? opts.tempoBpm);
    else {
      tempoMapQ = [];
      if (opts.baseBpm != null) baseBpm = Number(opts.baseBpm) || baseBpm;
    }
    if (opts.tempoBpm != null) setTempoBpm(opts.tempoBpm, { rebuild: false });
    resolveTempoMapAgainstNotes(sourceNotes);
    events = buildEvents(sourceNotes);
    if (!events.length) return false;
    onTick = opts.onTick || null;
    onEnd = opts.onEnd || null;
    if (opts.onKeys) onKeys = opts.onKeys;
    lastActiveKey = "";
    const total = duration();
    const fromOpt = opts.from || 0;
    pauseAt =
      fromOpt > 0 && fromOpt <= 1 && total > 0
        ? fromOpt * total
        : Math.max(0, Math.min(fromOpt, Math.max(0, total - 0.05)));
    if (opts.armOnly) {
      if (onTick) onTick({ progress: pauseAt, total, bar: currentBar() });
      emitKeys(pauseAt);
      return true;
    }
    playing = true;
    // Align visual playhead with the audio pad so first note and keys agree
    startMs = performance.now() + SCHEDULE_PAD * 1000;
    scheduleFrom(pauseAt);
    emitKeys(pauseAt);
    raf = requestAnimationFrame(tick);
    return true;
  }

  function pause() {
    if (!playing) return pauseAt;
    pauseAt = progress();
    playing = false;
    clearAudio();
    if (onTick) onTick({ progress: pauseAt, total: duration(), bar: currentBar() });
    emitKeys(pauseAt);
    return pauseAt;
  }

  function resume() {
    if (playing || !events.length) return false;
    const total = duration();
    if (pauseAt >= total - 0.02) pauseAt = 0;
    playing = true;
    startMs = performance.now() + SCHEDULE_PAD * 1000;
    scheduleFrom(pauseAt);
    emitKeys(pauseAt);
    raf = requestAnimationFrame(tick);
    return true;
  }

  function seek(ratio, { resumeIfWasPlaying = true } = {}) {
    const total = duration();
    if (!total) return;
    const at = Math.max(0, Math.min(1, ratio)) * total;
    const was = playing;
    clearAudio();
    playing = false;
    pauseAt = at;
    lastActiveKey = "";
    if (onTick) onTick({ progress: pauseAt, total, bar: barAtTime(at) });
    emitKeys(at);
    if (resumeIfWasPlaying && was) {
      playing = true;
      startMs = performance.now() + SCHEDULE_PAD * 1000;
      scheduleFrom(pauseAt);
      raf = requestAnimationFrame(tick);
    }
  }

  function seekToTime(seconds, opts) {
    const total = duration();
    if (!total) return;
    seek(seconds / total, opts);
  }

  function seekToBar(bar, opts) {
    const marks = barMarkers();
    if (!marks.length) return;
    const hit = marks.find((m) => Number(m.bar) === Number(bar));
    if (!hit) return;
    seek(hit.ratio, opts);
  }

  function stop(silent) {
    playing = false;
    clearAudio();
    if (!silent) pauseAt = 0;
    lastActiveKey = "";
    if (onTick) onTick({ progress: pauseAt, total: duration(), bar: currentBar() });
    if (onKeys) onKeys({ active: [], progress: pauseAt, total: duration(), bar: currentBar(), changed: true });
  }

  function isPlaying() {
    return playing;
  }

  function hasTimeline() {
    return events.length > 0 && duration() > 0;
  }

  function setRate(r) {
    const next = Number(r);
    if (!Number.isFinite(next) || next <= 0) return rate;
    // Keep playhead continuous across rate changes; reschedule with musical release
    if (playing) {
      pauseAt = progress();
      startMs = performance.now() + SCHEDULE_PAD * 1000;
      clearAudio();
      rate = next;
      scheduleFrom(pauseAt);
      raf = requestAnimationFrame(tick);
    } else {
      rate = next;
    }
    return rate;
  }

  function getRate() {
    return rate;
  }

  function setKeysHandler(fn) {
    onKeys = typeof fn === "function" ? fn : null;
  }

  function isReady() {
    return !!(sampler && sampler.loaded);
  }

  return {
    ensure,
    play,
    arm,
    pause,
    resume,
    stop,
    seek,
    seekToTime,
    seekToBar,
    progress,
    duration,
    currentBar,
    barMarkers,
    isPlaying,
    hasTimeline,
    setRate,
    getRate,
    setTempoBpm,
    getTempoBpm,
    setTempoMap,
    getEvents,
    /** The live timeline itself (read only) — a new array whenever it is rebuilt. */
    eventsRef: () => events,
    setMeter,
    getMeter,
    setMetronome,
    isMetronomeOn,
    setKeysHandler,
    activeAt,
    setHandFilter,
    getHandFilter,
    isReady,
    rates: RATES,
    beat,
  };
})();

/* Falling-note piano tutorial.
 *
 * One canvas holds both the falling notes and the keyboard, so a note always
 * lands on exactly the key it belongs to. The keyboard covers the range the
 * piece uses (whole octaves, at least three) rather than all 88 keys, which
 * keeps the keys wide enough to read. Right hand is white, left hand is the
 * steel blue used for it elsewhere; each note carries its name and finger,
 * and bar lines scroll down with the music.
 */
window.LuneTutorial = (function () {
  const WHITE_PC = new Set([0, 2, 4, 5, 7, 9, 11]);
  const LOOK_AHEAD = 3.4; // seconds of music visible above the keys
  const DARK = {
    bg: "#050505",
    lane: "rgba(255,255,255,0.022)",
    c: "rgba(255,255,255,0.09)",
    f: "rgba(255,255,255,0.04)",
    barLine: "rgba(255,255,255,0.13)",
    barText: "rgba(255,255,255,0.38)",
    idle: "#7a7a7a",
    hit: "rgba(245,245,245,0.7)",
    bed: "#0a0a0a",
    rh: { note: "#f2f2f2", noteBlack: "#c4c4c4", key: "#bdbdbd", keyBlack: "#8f8f8f", ink: "#0a0a0a" },
    lh: { note: "#8fa0c0", noteBlack: "#6b7fa3", key: "#8799bb", keyBlack: "#4a6aa3", ink: "#0a0f1c" },
  };
  // In the light the roll is paper-coloured and the right hand is drawn in ink.
  const LIGHT = {
    bg: "#f4f4f2",
    lane: "rgba(0,0,0,0.035)",
    c: "rgba(0,0,0,0.14)",
    f: "rgba(0,0,0,0.06)",
    barLine: "rgba(0,0,0,0.16)",
    barText: "rgba(0,0,0,0.5)",
    idle: "#6a6a6a",
    hit: "rgba(20,20,20,0.75)",
    bed: "#dcdcdc",
    rh: { note: "#1c1c1c", noteBlack: "#454545", key: "#9a9a9a", keyBlack: "#6e6e6e", ink: "#fafafa" },
    lh: { note: "#4a6aa3", noteBlack: "#35507f", key: "#8799bb", keyBlack: "#4a6aa3", ink: "#fafafa" },
  };
  let COLORS = DARK;

  let canvas = null;
  let ctx = null;
  let host = null;
  let raf = 0;
  let ro = null;
  let handFilter = "both"; // both | rh | lh
  let eventsRef = null; // the timeline the layout below was built for
  let events = [];
  let maxDur = 0;
  let bars = [];
  let layout = null;

  const isBlack = (midi) => !WHITE_PC.has(((midi % 12) + 12) % 12);
  const isLeft = (e) => {
    const h = String(e.hand || "").toLowerCase();
    return h === "lh" || h === "l" || h === "left";
  };
  const shown = (e) => handFilter === "both" || (handFilter === "lh") === isLeft(e);

  function mount(el) {
    host = el;
    if (!host) return;
    canvas = host.querySelector("canvas") || document.createElement("canvas");
    if (!canvas.parentNode) host.appendChild(canvas);
    ctx = canvas.getContext("2d");
    if (!ro && "ResizeObserver" in window) {
      ro = new ResizeObserver(() => {
        resize();
        paint(window.LunePiano?.progress?.() || 0);
      });
    }
    ro?.disconnect();
    ro?.observe(host);
    resize();
  }

  function resize() {
    if (!host || !canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = host.clientWidth || 640;
    const h = host.clientHeight || 320;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout = null;
  }

  /** Pick up a new timeline (new piece, new tempo) without copying it every frame. */
  function syncEvents() {
    const ref = window.LunePiano?.eventsRef?.() || [];
    if (ref === eventsRef) return;
    eventsRef = ref;
    events = ref;
    maxDur = 0;
    for (const e of events) if (e.dur > maxDur) maxDur = e.dur;
    bars = window.LunePiano?.barMarkers?.() || [];
    layout = null;
  }

  /** Key geometry for the range this piece needs. */
  function buildLayout(w, h) {
    let lo = 60;
    let hi = 72;
    if (events.length) {
      lo = Infinity;
      hi = -Infinity;
      for (const e of events) {
        if (e.midi < lo) lo = e.midi;
        if (e.midi > hi) hi = e.midi;
      }
    }
    // whole octaves, C up to B, with a little air either side
    lo = Math.floor((lo - 1) / 12) * 12;
    hi = Math.ceil((hi + 2) / 12) * 12 - 1;
    while (hi - lo + 1 < 36) {
      if (lo > 24) lo -= 12;
      if (hi - lo + 1 < 36 && hi < 107) hi += 12;
      if (lo <= 24 && hi >= 107) break;
    }
    lo = Math.max(21, lo);
    hi = Math.min(108, hi);

    let whites = 0;
    for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites += 1;
    const whiteW = w / whites;
    const blackW = whiteW * 0.62;
    const keys = new Map();
    let wi = 0;
    for (let m = lo; m <= hi; m++) {
      if (isBlack(m)) keys.set(m, { x: wi * whiteW - blackW / 2, w: blackW, black: true });
      else {
        keys.set(m, { x: wi * whiteW, w: whiteW, black: false });
        wi += 1;
      }
    }
    const kbH = Math.max(72, Math.min(150, h * 0.27));
    const rollH = h - kbH;
    return { lo, hi, keys, whiteW, kbH, rollH, w, h, pps: rollH / LOOK_AHEAD };
  }

  function roundRect(c, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  /** First event that could still be on screen at this moment. */
  function firstVisible(at) {
    const from = at - maxDur - 0.1;
    let a = 0;
    let b = events.length;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (events[mid].t < from) a = mid + 1;
      else b = mid;
    }
    return a;
  }

  function paint(at) {
    if (!ctx || !canvas || !host) return;
    syncEvents();
    const w = host.clientWidth || 640;
    const h = host.clientHeight || 320;
    if (!layout || layout.w !== w || layout.h !== h) layout = buildLayout(w, h);
    const L = layout;
    const { rollH, kbH, pps, keys } = L;

    COLORS = document.documentElement.dataset.theme === "light" ? LIGHT : DARK;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, rollH);

    // lanes: a faint column under every black key, a line at each C
    for (let m = L.lo; m <= L.hi; m++) {
      const k = keys.get(m);
      if (k.black) {
        ctx.fillStyle = COLORS.lane;
        ctx.fillRect(k.x, 0, k.w, rollH);
      } else if (m % 12 === 0 || m % 12 === 5) {
        ctx.fillStyle = m % 12 === 0 ? COLORS.c : COLORS.f;
        ctx.fillRect(Math.round(k.x), 0, 1, rollH);
      }
    }

    if (!events.length) {
      ctx.fillStyle = COLORS.idle;
      ctx.font = "15px Fraunces, Georgia, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Press Play — the notes fall onto the keys.", w / 2, rollH / 2);
    }

    // bar lines travel down with the music
    ctx.font = "11px Fraunces, Georgia, serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    for (const b of bars) {
      if (b.t < at - 0.05) continue;
      if (b.t > at + LOOK_AHEAD) break;
      const y = Math.round(rollH - (b.t - at) * pps) + 0.5;
      ctx.strokeStyle = COLORS.barLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillStyle = COLORS.barText;
      ctx.fillText(String(b.bar), 6, y - 3);
    }

    // falling notes
    const pressed = new Map(); // midi → event sounding now
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, rollH);
    ctx.clip();
    for (let i = firstVisible(at); i < events.length; i++) {
      const e = events[i];
      if (e.t > at + LOOK_AHEAD) break;
      if (e.t + e.dur < at || !shown(e)) continue;
      const k = keys.get(e.midi);
      if (!k) continue;
      const tone = COLORS[isLeft(e) ? "lh" : "rh"];
      const active = e.t <= at;
      if (active) pressed.set(e.midi, e);
      const inset = k.black ? 0 : Math.min(3, k.w * 0.12);
      const x = k.x + inset;
      const bw = k.w - inset * 2;
      const bottom = rollH - (e.t - at) * pps;
      const top = bottom - e.dur * pps + 2; // a hair of air between repeated notes
      const bh = Math.max(6, bottom - top);
      ctx.fillStyle = k.black ? tone.noteBlack : tone.note;
      ctx.globalAlpha = active ? 1 : 0.86;
      if (active) {
        ctx.shadowColor = tone.note;
        ctx.shadowBlur = 14;
      }
      roundRect(ctx, x, bottom - bh, bw, bh, Math.min(5, bw / 2));
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      // name at the end that reaches the key first, finger above it
      if (bw >= 13) {
        ctx.fillStyle = tone.ink;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        const cx = x + bw / 2;
        const size = Math.max(9, Math.min(13, bw * 0.5));
        if (e.label && bh >= size + 6) {
          ctx.font = `600 ${size}px Fraunces, Georgia, serif`;
          ctx.fillText(e.label, cx, bottom - 5);
        }
        if (e.finger && bh >= size * 2 + 12) {
          ctx.font = `${size - 1}px Fraunces, Georgia, serif`;
          ctx.globalAlpha = 0.7;
          ctx.fillText(String(e.finger), cx, bottom - 8 - size);
          ctx.globalAlpha = 1;
        }
      }
    }
    ctx.restore();

    // keyboard
    const ky = rollH;
    ctx.fillStyle = COLORS.bed;
    ctx.fillRect(0, ky, w, kbH);
    for (let m = L.lo; m <= L.hi; m++) {
      const k = keys.get(m);
      if (k.black) continue;
      const hit = pressed.get(m);
      const tone = hit ? COLORS[isLeft(hit) ? "lh" : "rh"] : null;
      const g = ctx.createLinearGradient(0, ky, 0, ky + kbH);
      if (tone) {
        g.addColorStop(0, tone.key);
        g.addColorStop(1, tone.note);
      } else {
        g.addColorStop(0, "#e9e6de");
        g.addColorStop(1, "#f7f5ef");
      }
      ctx.fillStyle = g;
      roundRect(ctx, k.x + 0.5, ky + 2, k.w - 1, kbH - 3, 3);
      ctx.fill();
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      if (hit?.finger && k.w >= 12) {
        ctx.fillStyle = tone.ink;
        ctx.font = `600 ${Math.min(14, k.w * 0.55)}px Fraunces, Georgia, serif`;
        ctx.fillText(String(hit.finger), k.x + k.w / 2, ky + kbH - 10);
      } else if (m % 12 === 0 && k.w >= 14) {
        ctx.fillStyle = "#8d887c";
        ctx.font = "9px Fraunces, Georgia, serif";
        ctx.fillText(`C${m / 12 - 1}`, k.x + k.w / 2, ky + kbH - 8);
      }
    }
    const blackH = kbH * 0.62;
    for (let m = L.lo; m <= L.hi; m++) {
      const k = keys.get(m);
      if (!k.black) continue;
      const hit = pressed.get(m);
      const tone = hit ? COLORS[isLeft(hit) ? "lh" : "rh"] : null;
      ctx.fillStyle = tone ? tone.keyBlack : "#121212";
      roundRect(ctx, k.x, ky + 2, k.w, blackH, 2.5);
      ctx.fill();
      if (!tone) {
        ctx.fillStyle = "rgba(255,255,255,0.07)";
        ctx.fillRect(k.x + 1.5, ky + 3, k.w - 3, blackH - 8);
      } else if (hit.finger && k.w >= 11) {
        ctx.fillStyle = "#fafafa";
        ctx.font = `600 ${Math.min(12, k.w * 0.7)}px Fraunces, Georgia, serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(String(hit.finger), k.x + k.w / 2, ky + blackH - 6);
      }
    }

    // where the notes land
    ctx.fillStyle = COLORS.hit;
    ctx.fillRect(0, ky - 1, w, 2);
    for (const [m, e] of pressed) {
      const k = keys.get(m);
      const tone = COLORS[isLeft(e) ? "lh" : "rh"];
      const glow = ctx.createLinearGradient(0, ky - 26, 0, ky);
      glow.addColorStop(0, "rgba(255,255,255,0)");
      glow.addColorStop(1, tone.note);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = glow;
      ctx.fillRect(k.x, ky - 26, k.w, 26);
      ctx.globalAlpha = 1;
    }
  }

  function start() {
    cancelAnimationFrame(raf);
    let lastAt = -1;
    let lastRef = null;
    let lastTheme = "";
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!host || !host.offsetParent) return; // panel not on screen
      const at = window.LunePiano?.progress?.() || 0;
      const ref = window.LunePiano?.eventsRef?.() || null;
      // nothing moved: leave the last frame up
      const theme = document.documentElement.dataset.theme || "dark";
      if (at === lastAt && ref === lastRef && layout && theme === lastTheme) return;
      lastTheme = theme;
      lastAt = at;
      lastRef = ref;
      paint(at);
    };
    resize();
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  function drawOnce() {
    resize();
    paint(window.LunePiano?.progress?.() || 0);
  }

  function setHandFilter(mode) {
    handFilter = ["both", "rh", "lh"].includes(mode) ? mode : "both";
    layout = null;
    if (canvas) paint(window.LunePiano?.progress?.() || 0);
  }

  return { mount, start, stop, drawOnce, resize, setHandFilter };
})();

/* On-screen digital piano — acoustic B&W geometry, follows active notes. */
window.LuneKeyboard = (function () {
  const MIDI_LO = 21; // A0
  const MIDI_HI = 108; // C8
  const WHITE_PC = new Set([0, 2, 4, 5, 7, 9, 11]);

  function isBlack(midi) {
    return !WHITE_PC.has(((midi % 12) + 12) % 12);
  }

  function build(host) {
    if (!host) return null;
    host.innerHTML = "";
    host.classList.add("lune-kbd");
    const track = document.createElement("div");
    track.className = "lune-kbd-track";
    track.setAttribute("role", "group");
    // on a phone the keys scroll sideways; the track takes focus so arrow keys can scroll it too
    track.tabIndex = 0;
    track.setAttribute("aria-label", "Digital piano keyboard");

    const whites = document.createElement("div");
    whites.className = "lune-kbd-whites";
    const blacks = document.createElement("div");
    blacks.className = "lune-kbd-blacks";

    const whiteList = [];
    for (let m = MIDI_LO; m <= MIDI_HI; m++) {
      if (!isBlack(m)) whiteList.push(m);
    }

    const keyMap = new Map();
    whiteList.forEach((midi) => {
      const key = document.createElement("button");
      key.type = "button";
      key.className = "lune-key white";
      key.dataset.midi = String(midi);
      key.setAttribute("tabindex", "-1");
      key.setAttribute("aria-hidden", "true");
      // Octave notches for orientation (C keys)
      if (midi % 12 === 0) {
        const notch = document.createElement("span");
        notch.className = "lune-key-notch";
        notch.setAttribute("aria-hidden", "true");
        key.appendChild(notch);
      }
      const dig = document.createElement("span");
      dig.className = "lune-key-finger";
      dig.textContent = "";
      key.appendChild(dig);
      whites.appendChild(key);
      keyMap.set(midi, key);
    });

    // Black keys: acoustic group nudge within C–E (2) and F–B (3) clusters
    for (let m = MIDI_LO; m <= MIDI_HI; m++) {
      if (!isBlack(m)) continue;
      let whiteBefore = 0;
      for (let x = MIDI_LO; x < m; x++) {
        if (!isBlack(x)) whiteBefore += 1;
      }
      const pc = ((m % 12) + 12) % 12;
      // Slight inward bias so groups of 2 / 3 read like a real keyboard
      const nudge =
        pc === 1 || pc === 6 ? -0.08 : pc === 3 || pc === 10 ? 0.08 : 0; // C#/F# left, D#/A# right
      const key = document.createElement("button");
      key.type = "button";
      key.className = "lune-key black";
      key.dataset.midi = String(m);
      key.setAttribute("tabindex", "-1");
      key.setAttribute("aria-hidden", "true");
      key.style.left = `calc(${whiteBefore + nudge} * var(--key-w) - var(--black-w) / 2)`;
      const dig = document.createElement("span");
      dig.className = "lune-key-finger";
      dig.textContent = "";
      key.appendChild(dig);
      blacks.appendChild(key);
      keyMap.set(m, key);
    }

    track.appendChild(whites);
    track.appendChild(blacks);
    host.appendChild(track);

    // Start near middle C so the dock doesn't open on the far left
    requestAnimationFrame(() => {
      const mid = keyMap.get(60);
      if (mid && track) {
        const kr = mid.getBoundingClientRect();
        const tr = track.getBoundingClientRect();
        track.scrollLeft += kr.left + kr.width / 2 - (tr.left + tr.width / 2);
      }
    });

    return {
      host,
      track,
      keyMap,
      setActive(active) {
        for (const key of keyMap.values()) {
          key.classList.remove("on");
          const dig = key.querySelector(".lune-key-finger");
          if (dig) dig.textContent = "";
        }
        if (!active?.length) return;
        let minM = 128;
        let maxM = 0;
        for (const a of active) {
          const midi = Math.round(a.midi);
          const key = keyMap.get(midi);
          if (!key) continue;
          key.classList.add("on");
          const dig = key.querySelector(".lune-key-finger");
          if (dig && a.finger != null && a.finger !== "") {
            dig.textContent = String(a.finger);
          }
          if (midi < minM) minM = midi;
          if (midi > maxM) maxM = midi;
        }
        // The keyboard holds still while the notes are on screen; it glides only
        // when a note would fall off the edge, and then centres the whole hand
        if (minM <= maxM && track && track.scrollWidth > track.clientWidth + 2) {
          const lo = keyMap.get(minM);
          const hi = keyMap.get(maxM);
          if (lo && hi) {
            const tr = track.getBoundingClientRect();
            const a = lo.getBoundingClientRect();
            const z = hi.getBoundingClientRect();
            const margin = Math.min(36, tr.width * 0.06);
            if (a.left < tr.left + margin || z.right > tr.right - margin) {
              const delta = (a.left + z.right) / 2 - (tr.left + tr.width / 2);
              const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
              track.scrollTo({ left: track.scrollLeft + delta, behavior: reduced ? "auto" : "smooth" });
            }
          }
        }
      },
      clear() {
        this.setActive([]);
      },
      focusMidi(midi) {
        const key = keyMap.get(Math.round(midi));
        if (!key || !track) return;
        const kr = key.getBoundingClientRect();
        const tr = track.getBoundingClientRect();
        track.scrollLeft += kr.left + kr.width / 2 - (tr.left + tr.width / 2);
      },
    };
  }

  return { build, isBlack, MIDI_LO, MIDI_HI };
})();
