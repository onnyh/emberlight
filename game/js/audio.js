'use strict';
/*
 * Emberlight sound: every effect and the ambient score are synthesised with
 * WebAudio oscillators and filtered noise. The game ships no audio files.
 * The context is created lazily on the first user gesture, as browsers ask.
 */
const EmberAudio = (() => {
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let musicBus = null;
  let muted = false;
  let musicTimer = null;
  let chordStep = 0;
  let bellCount = 0;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
    } catch (err) {
      return false;
    }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.5;
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.34;
    musicBus.connect(master);
    return true;
  }

  function tone(opts) {
    if (!ctx) return;
    const t0 = ctx.currentTime + (opts.delay || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.from, t0);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + opts.dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(opts.vol || 0.2, t0 + (opts.attack || 0.008));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    osc.connect(gain);
    gain.connect(opts.bus || sfxBus);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.05);
  }

  function noiseBurst(dur, vol, freq, delay) {
    if (!ctx) return;
    const t0 = ctx.currentTime + (delay || 0);
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(sfxBus);
    src.start(t0);
  }

  /* ---- one-shot effects ---- */

  function shoot() {
    tone({ type: 'square', from: 720 + Math.random() * 120, to: 240, dur: 0.09, vol: 0.055 });
  }

  function hit() {
    tone({ type: 'triangle', from: 300 + Math.random() * 60, to: 180, dur: 0.05, vol: 0.07 });
  }

  function die(big) {
    noiseBurst(big ? 0.4 : 0.18, big ? 0.4 : 0.2, big ? 900 : 1400, 0);
    tone({ type: 'sawtooth', from: big ? 220 : 340, to: 50, dur: big ? 0.45 : 0.2, vol: big ? 0.25 : 0.12 });
  }

  function pickup(step) {
    const base = 620 * Math.pow(1.059, Math.min(step, 12));
    tone({ type: 'sine', from: base, to: base * 1.5, dur: 0.12, vol: 0.11 });
  }

  function levelup() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.34, vol: 0.16, delay: i * 0.07 }));
    noiseBurst(0.3, 0.06, 4000, 0);
  }

  function hurt() {
    tone({ type: 'sawtooth', from: 160, to: 60, dur: 0.25, vol: 0.3 });
    noiseBurst(0.15, 0.2, 500, 0);
  }

  function roar() {
    tone({ type: 'sawtooth', from: 90, to: 45, dur: 0.9, vol: 0.32 });
    tone({ type: 'sawtooth', from: 96, to: 52, dur: 0.9, vol: 0.28, delay: 0.05 });
    noiseBurst(0.7, 0.16, 300, 0);
  }

  function click() {
    tone({ type: 'sine', from: 880, to: 660, dur: 0.07, vol: 0.12 });
  }

  function draft() {
    tone({ type: 'triangle', from: 440, dur: 0.2, vol: 0.12 });
    tone({ type: 'triangle', from: 587.33, dur: 0.26, vol: 0.12, delay: 0.08 });
  }

  function winJingle() {
    const notes = [392, 523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.5, vol: 0.16, delay: i * 0.11 }));
  }

  function loseTone() {
    const notes = [392, 329.63, 261.63, 196];
    notes.forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.5, vol: 0.16, delay: i * 0.16 }));
  }

  /* ---- ambient score: slow pads in A minor with sparse bells ---- */

  const CHORDS = [
    [110.0, 164.81, 261.63],   // Am
    [87.31, 174.61, 261.63],   // F
    [98.0, 196.0, 246.94],     // G
    [110.0, 220.0, 329.63],    // Am add
  ];
  const BELLS = [440, 523.25, 587.33, 659.25, 783.99, 880];

  function playChord() {
    if (!ctx) return;
    const chord = CHORDS[chordStep % CHORDS.length];
    chordStep += 1;
    const dur = 7.5;
    chord.forEach((f) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t0 = ctx.currentTime;
      osc.type = 'triangle';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.055, t0 + 2.4);
      gain.gain.setValueAtTime(0.055, t0 + dur - 2.4);
      gain.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(musicBus);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    });
    // A bell or two, never on every chord, from the pentatonic set.
    bellCount += 1;
    if (bellCount % 2 === 0) {
      const f = BELLS[Math.floor(Math.random() * BELLS.length)];
      tone({ type: 'sine', from: f, dur: 1.6, vol: 0.05, delay: 1.2 + Math.random() * 2, bus: musicBus });
    }
  }

  function startMusic() {
    if (!ensure() || musicTimer !== null) return;
    playChord();
    musicTimer = window.setInterval(playChord, 7000);
  }

  function stopMusic() {
    if (musicTimer !== null) {
      window.clearInterval(musicTimer);
      musicTimer = null;
    }
  }

  function toggleMute() {
    muted = !muted;
    if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.03);
    return muted;
  }

  return {
    ensure, shoot, hit, die, pickup, levelup, hurt, roar, click, draft,
    winJingle, loseTone, startMusic, stopMusic, toggleMute,
    isMuted: () => muted,
  };
})();
