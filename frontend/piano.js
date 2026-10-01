/* Piano playback with Tone.js Salamander samples + scrubbable timeline */

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
  const beat = 0.42;

  async function ensure() {
    if (sampler) return sampler;
    if (loading) return loading;
    if (typeof Tone === "undefined") throw new Error("Tone.js missing");
    loading = (async () => {
      await Tone.start();
      sampler = new Tone.Sampler({
        urls: {
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
        },
        release: 1,
        baseUrl: "https://tonejs.github.io/audio/salamander/",
      }).toDestination();
      await Tone.loaded();
      return sampler;
    })();
    return loading;
  }

  function midiToNote(midi) {
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const m = Math.round(midi);
    return names[((m % 12) + 12) % 12] + Math.floor(m / 12 - 1);
  }

  function buildEvents(notes) {
    return (notes || [])
      .filter((n) => n.midi)
      .map((n) => {
        const t = (Number(n.absOffset ?? n.offset) || 0) * beat;
        const dur = Math.max(0.12, (Number(n.duration) || 0.5) * beat);
        return {
          t,
          dur,
          midi: n.midi,
          bar: n.bar || null,
          name: midiToNote(n.midi),
        };
      })
      .sort((a, b) => a.t - b.t);
  }

  function duration() {
    if (!events.length) return 0;
    return Math.max(...events.map((e) => e.t + e.dur));
  }

  function progress() {
    if (!playing) return pauseAt;
    return Math.min(duration(), pauseAt + (performance.now() - startMs) / 1000);
  }

  function currentBar() {
    const p = progress();
    let bar = events[0]?.bar || null;
    for (const e of events) {
      if (e.t <= p + 0.01) bar = e.bar;
      else break;
    }
    return bar;
  }

  function scheduleFrom(at) {
    const now = Tone.now();
    const remaining = events.filter((e) => e.t + e.dur > at);
    for (const e of remaining) {
      const when = now + Math.max(0, e.t - at);
      const dur = Math.max(0.08, e.dur - Math.max(0, at - e.t));
      try {
        sampler.triggerAttackRelease(e.name, dur, when, 0.7);
      } catch {}
    }
  }

  function tick() {
    if (!playing) return;
    const p = progress();
    if (onTick) onTick({ progress: p, total: duration(), bar: currentBar() });
    if (p >= duration() - 0.02) {
      stop();
      if (onEnd) onEnd();
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  async function play(notes, opts = {}) {
    await ensure();
    stop(true);
    events = buildEvents(notes);
    if (!events.length) return false;
    onTick = opts.onTick || null;
    onEnd = opts.onEnd || null;
    pauseAt = Math.max(0, Math.min(opts.from || 0, duration() - 0.05));
    playing = true;
    startMs = performance.now();
    Tone.Transport.cancel();
    scheduleFrom(pauseAt);
    raf = requestAnimationFrame(tick);
    return true;
  }

  function seek(ratio) {
    const total = duration();
    if (!total) return;
    const at = Math.max(0, Math.min(1, ratio)) * total;
    const was = playing;
    stop(true);
    pauseAt = at;
    if (onTick) onTick({ progress: pauseAt, total, bar: currentBar() });
    if (was) {
      playing = true;
      startMs = performance.now();
      scheduleFrom(pauseAt);
      raf = requestAnimationFrame(tick);
    }
  }

  function stop(silent) {
    playing = false;
    cancelAnimationFrame(raf);
    try {
      Tone.Transport.cancel();
      if (sampler) sampler.releaseAll();
    } catch {}
    if (!silent) pauseAt = 0;
  }

  function isPlaying() {
    return playing;
  }

  return { ensure, play, stop, seek, progress, duration, currentBar, isPlaying, beat };
})();
