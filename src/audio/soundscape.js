import { mixLevels, MUSIC_FADE_IN, MUSIC_FADE_OUT } from './soundMix.js';
import { FALL_MUSIC_URL } from './tracks.js';

// Seconds for the drone to fade in after unlock, and for on/off toggles.
const UNLOCK_FADE = 2;
const TOGGLE_FADE = 0.4;
// Length of the looped brown-noise buffer (s): long enough that the loop
// never sounds like a loop under the low-pass.
const NOISE_SECONDS = 6;

/**
 * Generated "space" ambience: low-passed brown noise whose cutoff drifts
 * slowly (a distant rumble), and three low drones (A1, E2, A2, the third a
 * little detuned) that swell in and out. Nothing is loaded, so it is free to
 * ship and needs no licence.
 * @param {AudioContext} ctx
 * @param {AudioNode} out
 */
function buildDrone(ctx, out) {
  const length = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let last = 0;
    for (let i = 0; i < length; i++) {
      // Leaky integral of white noise = brown (1/f²) noise.
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 220;
  lowpass.Q.value = 0.5;
  const sweep = ctx.createOscillator();
  sweep.frequency.value = 0.04;
  const sweepDepth = ctx.createGain();
  sweepDepth.gain.value = 120;
  sweep.connect(sweepDepth).connect(lowpass.frequency);
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.5;
  noise.connect(lowpass).connect(noiseGain).connect(out);
  noise.start();
  sweep.start();

  const voices = [
    { freq: 55, type: 'sine', level: 0.25, pan: -0.35 },
    { freq: 82.41, type: 'sine', level: 0.18, pan: 0.35 },
    { freq: 110.6, type: 'triangle', level: 0.06, pan: 0 },
  ];
  voices.forEach((v, i) => {
    const osc = ctx.createOscillator();
    osc.type = v.type;
    osc.frequency.value = v.freq;
    const gain = ctx.createGain();
    gain.gain.value = v.level;
    // Slow swell, out of step between voices.
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.05 + i * 0.017;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = v.level * 0.4;
    swell.connect(swellDepth).connect(gain.gain);
    let node = osc.connect(gain);
    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = v.pan;
      node = node.connect(pan);
    }
    node.connect(out);
    osc.start();
    swell.start();
  });
}

/**
 * Background sound: the generated drone everywhere, and the fall track (if
 * one is set in tracks.js) during the intro fall, with crossfades.
 *
 * Browsers start audio only after a user gesture, so nothing is built until
 * unlock() is called from one (the start-box click). A silent no-op where
 * Web Audio is missing.
 *
 * @param {{ fallMusicUrl?: string, win?: Window, doc?: Document }} [options]
 */
export function createSoundscape({ fallMusicUrl = FALL_MUSIC_URL, win = window, doc = document } = {}) {
  const AudioCtx = win.AudioContext ?? win.webkitAudioContext;
  const hasMusic = Boolean(fallMusicUrl);
  // True once the track can play; a missing file (404) or a bad URL leaves it
  // false, and the drone keeps playing through the fall.
  let musicReady = false;
  let ctx = null;
  let master = null;
  let ambientGain = null;
  let musicGain = null;
  let music = null;
  let enabled = true;
  let mode = 'ambient';
  let stopTimer = null;
  let suspendTimer = null;

  function build() {
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.connect(ctx.destination);
    ambientGain = ctx.createGain();
    ambientGain.gain.value = 0;
    ambientGain.connect(master);
    buildDrone(ctx, ambientGain);
    if (hasMusic) {
      music = new Audio();
      music.crossOrigin = 'anonymous';
      music.preload = 'auto';
      music.addEventListener('canplaythrough', () => {
        if (musicReady) return;
        musicReady = true;
        apply(mode === 'fall' ? MUSIC_FADE_IN : TOGGLE_FADE);
      });
      music.addEventListener('error', () => {
        musicReady = false;
        apply(TOGGLE_FADE);
      });
      music.src = fallMusicUrl;
      musicGain = ctx.createGain();
      musicGain.gain.value = 0;
      ctx.createMediaElementSource(music).connect(musicGain).connect(master);
    }
  }

  /** Ramp a gain from its current value (no clicks). */
  function ramp(node, value, seconds) {
    const g = node.gain;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(value, t + seconds);
  }

  function apply(seconds) {
    const levels = mixLevels({ enabled, mode, hasMusic: musicReady });
    ramp(ambientGain, levels.ambient, seconds);
    if (musicGain) ramp(musicGain, levels.music, seconds);
  }

  function onVisibility() {
    if (!ctx) return;
    if (doc.visibilityState === 'hidden') ctx.suspend().catch(() => {});
    else if (enabled) ctx.resume().catch(() => {});
  }
  doc.addEventListener('visibilitychange', onVisibility);

  return {
    hasMusic,
    isMusicReady: () => musicReady,
    /** Call from a user gesture (click, tap, key): builds and starts the audio. */
    unlock() {
      if (!AudioCtx) return false;
      if (!ctx) {
        build();
        // iOS also wants each media element started once inside a gesture.
        music?.play().then(() => mode !== 'fall' && music.pause()).catch(() => {});
        apply(UNLOCK_FADE);
      }
      if (enabled && ctx.state !== 'running') ctx.resume().catch(() => {});
      return true;
    },
    /** Settings → Sound. */
    setEnabled(on) {
      if (on === enabled) return;
      enabled = on;
      if (!ctx) return;
      clearTimeout(suspendTimer);
      if (on) ctx.resume().catch(() => {});
      apply(TOGGLE_FADE);
      // Off: fade, then stop the audio thread (saves battery on phones).
      if (!on) suspendTimer = setTimeout(() => ctx.suspend().catch(() => {}), TOGGLE_FADE * 1000 + 50);
    },
    /** 'fall' during the intro fall, 'ambient' otherwise. */
    setMode(next) {
      if (next === mode) return;
      mode = next;
      if (!ctx) return;
      clearTimeout(stopTimer);
      if (music && mode === 'fall') {
        music.currentTime = 0;
        music.play().catch(() => {});
      } else if (music) {
        stopTimer = setTimeout(() => music.pause(), MUSIC_FADE_OUT * 1000 + 100);
      }
      apply(mode === 'fall' ? MUSIC_FADE_IN : MUSIC_FADE_OUT);
    },
    isRunning: () => ctx?.state === 'running',
    dispose() {
      doc.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(stopTimer);
      clearTimeout(suspendTimer);
      music?.pause();
      ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}
