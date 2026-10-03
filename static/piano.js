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
  /** Bumped on stop/pause so look-ahead notes scheduled earlier are ignored. */
  let audioEpoch = 0;
  /** Event indices already queued for the current audioEpoch. */
  const scheduled = new Set();
  // Seconds per quarter note. Default ≈ 72 bpm — calm practice pace (was 0.42 ≈ 143 bpm).
  let beat = 60 / 72;
  /** Schedule a hair ahead of now so the first note never clicks against a cold bus. */
  const SCHEDULE_PAD = 0.055;
  /** Musical-time look-ahead — keeps Stop able to silence (no long Tone queue). */
  const LOOKAHEAD = 0.14;

  const RATES = [0.5, 0.75, 1, 1.25, 1.5];

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

  const SAMPLE_BASES = ["https://tonejs.github.io/audio/salamander/"];

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
    const vol = new Tone.Volume(-6.5).connect(filter);
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
      release: 4.2,
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

  function buildEvents(notes) {
    const raw = (notes || [])
      .filter((n) => n.midi)
      .map((n) => {
        const t = (Number(n.absOffset ?? n.offset) || 0) * beat;
        // Keep sounding length close to the written value — stretch made
        // long notes feel like they were re-attacking into the next bar.
        const dur = Math.max(0.1, (Number(n.duration) || 0.5) * beat * 1.02);
        const finger =
          n.fingering != null && n.fingering !== ""
            ? String(n.fingering)
            : n.finger != null && n.finger !== ""
              ? String(n.finger)
              : null;
        return {
          t,
          dur,
          midi: n.midi,
          bar: n.bar || null,
          name: midiToNote(n.midi),
          finger,
          hand: n.hand || null,
        };
      })
      .sort((a, b) => a.t - b.t);

    const density = new Map();
    for (const e of raw) {
      const key = Math.round(e.t * 40);
      density.set(key, (density.get(key) || 0) + 1);
    }
    for (const e of raw) {
      const key = Math.round(e.t * 40);
      e.vel = velocityFor(e.midi, density.get(key) || 1);
    }
    return raw;
  }

  function duration() {
    if (!events.length) return 0;
    return Math.max(...events.map((e) => e.t + e.dur));
  }

  function progress() {
    if (!playing) return pauseAt;
    const elapsed = Math.max(0, ((performance.now() - startMs) / 1000) * rate);
    return Math.min(duration(), pauseAt + elapsed);
  }

  function currentBar() {
    return barAtTime(progress());
  }

  function barAtTime(at) {
    let bar = events[0]?.bar || null;
    for (const e of events) {
      if (e.t <= at + 0.01) bar = e.bar;
      else break;
    }
    return bar;
  }

  function barMarkers() {
    const seen = new Map();
    for (const e of events) {
      if (e.bar == null) continue;
      if (!seen.has(e.bar)) seen.set(e.bar, e.t);
    }
    return [...seen.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([bar, t]) => ({ bar, t, ratio: duration() ? t / duration() : 0 }));
  }

  /** Notes sounding at timeline time `at` (seconds). */
  function activeAt(at) {
    const active = [];
    for (const e of events) {
      if (e.t > at + 0.01) break;
      if (e.t <= at + 0.01 && e.t + e.dur > at) {
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

  function pumpSchedule(at) {
    if (!sampler || !playing) return;
    openBus();
    const epoch = audioEpoch;
    const r = Math.max(0.25, rate);
    const horizon = at + LOOKAHEAD;
    const now = Tone.now() + SCHEDULE_PAD;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.t > horizon) break;
      if (e.t + e.dur <= at) continue;
      const key = `${epoch}:${i}`;
      if (scheduled.has(key)) continue;
      scheduled.add(key);
      // Wall-clock delay scaled by playback rate (slow-mo stretches attacks)
      const when = now + Math.max(0, (e.t - at) / r);
      // Keep a short release tail in wall time so notes don't chop at any rate
      const remain = Math.max(0.14, (e.dur - Math.max(0, at - e.t)) / r);
      const vel = e.vel ?? 0.58;
      try {
        sampler.triggerAttackRelease(e.name, remain, when, vel);
      } catch {
        /* ignore sample glitches */
      }
    }
  }

  function scheduleFrom(at) {
    if (!sampler) return;
    // Kill anything that may have started while the bus was muted
    try {
      sampler.releaseAll();
    } catch {
      /* ignore */
    }
    scheduled.clear();
    openBus();
    pumpSchedule(at);
  }

  function clearAudio() {
    cancelAnimationFrame(raf);
    raf = 0;
    audioEpoch += 1;
    scheduled.clear();
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

  /** Load a timeline without starting audio (for scrub-before-play). */
  /** Set seconds-per-quarter from a BPM (clamped for practice). */
  function setTempoBpm(bpm) {
    const n = Number(bpm);
    if (!Number.isFinite(n) || n <= 0) return 60 / beat;
    const clamped = Math.max(40, Math.min(108, n));
    beat = 60 / clamped;
    return clamped;
  }

  function getTempoBpm() {
    return Math.round(60 / beat);
  }

  function arm(notes, opts = {}) {
    clearAudio();
    playing = false;
    if (opts.tempoBpm != null) setTempoBpm(opts.tempoBpm);
    events = buildEvents(notes);
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
    if (opts.tempoBpm != null) setTempoBpm(opts.tempoBpm);
    events = buildEvents(notes);
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
    setKeysHandler,
    activeAt,
    isReady,
    rates: RATES,
    beat,
  };
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
    track.setAttribute("role", "img");
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

    // Black keys centered on the gap after the preceding white
    for (let m = MIDI_LO; m <= MIDI_HI; m++) {
      if (!isBlack(m)) continue;
      let whiteBefore = 0;
      for (let x = MIDI_LO; x < m; x++) {
        if (!isBlack(x)) whiteBefore += 1;
      }
      const key = document.createElement("button");
      key.type = "button";
      key.className = "lune-key black";
      key.dataset.midi = String(m);
      key.setAttribute("tabindex", "-1");
      key.setAttribute("aria-hidden", "true");
      key.style.left = `calc(${whiteBefore} * var(--key-w) - var(--black-w) / 2)`;
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
        if (minM <= maxM) {
          const mid = Math.round((minM + maxM) / 2);
          const midKey = keyMap.get(mid) || keyMap.get(minM);
          if (midKey && track) {
            const kr = midKey.getBoundingClientRect();
            const tr = track.getBoundingClientRect();
            const delta = kr.left + kr.width / 2 - (tr.left + tr.width / 2);
            if (Math.abs(delta) > 8) track.scrollLeft += delta;
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
