import { mixLevels, mixFades, MUSIC_MIN } from './soundMix.js';
import { FALL_MUSIC_URL, FALL_MUSIC_START } from './tracks.js';

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
 * A tiny silent WAV (blob URL): played once inside the unlock gesture, so iOS
 * lets the media element play later, before the real track has arrived.
 */
function silentClipUrl(win) {
  const samples = 800; // 0.1 s, 8 kHz, 8-bit mono
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(128, 44); // 8-bit silence
  return win.URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

/**
 * Background sound: the generated drone everywhere, and the fall track (if
 * one is set in tracks.js) for the intro fall, with crossfades. The track
 * starts at the start-box click (mode 'wait'), early by the wait's length so
 * it reaches FALL_MUSIC_START as the fall starts, rises to full by then, and
 * fades out over ~5 s once fallen in (mode 'end').
 *
 * Browsers start audio only after a user gesture, so nothing is built until
 * unlock() is called from one (the start-box click). A silent no-op where
 * Web Audio is missing.
 *
 * @param {{ fallMusicUrl?: string, fallMusicStart?: number, win?: Window, doc?: Document }} [options]
 */
export function createSoundscape({ fallMusicUrl = FALL_MUSIC_URL, fallMusicStart = FALL_MUSIC_START, win = window, doc = document } = {}) {
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
  let trackUrl = null; // blob URL of the downloaded track
  let enabled = true;
  let mode = 'ambient';
  let waitEndsAt = 0; // performance.now() ms when the wait ends (fall starts)
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
        // Only the real track counts, not the silent unlock clip.
        if (musicReady || !trackUrl || music.src !== trackUrl) return;
        musicReady = true;
        if (musicMode()) enter();
        else apply(TOGGLE_FADE);
      });
      const fail = () => {
        musicReady = false;
        apply(TOGGLE_FADE);
      };
      music.addEventListener('error', () => {
        if (trackUrl && music.src === trackUrl) fail();
      });
      music.src = silentClipUrl(win);
      // Download the whole track, then play it from memory. A streamed file
      // can only seek to fallMusicStart if the server answers HTTP Range
      // requests, and Cloudflare Pages does not (it sends the full file).
      win
        .fetch(fallMusicUrl)
        .then((r) => {
          if (!r.ok) throw new Error(`fall music: HTTP ${r.status}`);
          return r.blob();
        })
        .then((blob) => {
          if (!music) return;
          trackUrl = win.URL.createObjectURL(blob);
          music.src = trackUrl;
        })
        .catch(fail);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0;
      ctx.createMediaElementSource(music).connect(musicGain).connect(master);
    }
  }

  const musicMode = () => mode === 'wait' || mode === 'fall';
  const waitLeft = () => Math.max(0, (waitEndsAt - win.performance.now()) / 1000);

  /**
   * Ramp a gain from its current value (no clicks), after `delay` seconds.
   * `rise`: exponential from at least MUSIC_MIN (an even rise to the ear).
   */
  function ramp(node, value, seconds, delay = 0, rise = false) {
    const g = node.gain;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    if (delay > 0) g.setValueAtTime(g.value, t + delay);
    if (rise && value > 0) {
      g.setValueAtTime(Math.max(g.value, MUSIC_MIN), t);
      g.exponentialRampToValueAtTime(value, t + delay + seconds);
    } else {
      g.linearRampToValueAtTime(value, t + delay + seconds);
    }
  }

  /** Ramp to the mode's levels: `fades` from mixFades, or one time for all. */
  function apply(fades) {
    const f = typeof fades === 'number' ? { music: fades, ambient: fades, ambientDelay: 0, rise: false } : fades;
    const levels = mixLevels({ enabled, mode, hasMusic: musicReady });
    ramp(ambientGain, levels.ambient, f.ambient, f.ambientDelay);
    if (musicGain) ramp(musicGain, levels.music, f.music, 0, f.rise);
  }

  /** Start or stop the track for the current mode, then fade to its levels. */
  function enter() {
    clearTimeout(stopTimer);
    const fades = mixFades(mode, waitLeft());
    if (music && musicReady && musicMode()) {
      // In the wait, start early by the time left, so the fall starts at
      // fallMusicStart; in the fall (also when the track arrives late), at
      // the place it would have reached by now. Seek only if it drifted or
      // never played.
      const intoFall = waitEndsAt > 0 ? Math.max(0, (win.performance.now() - waitEndsAt) / 1000) : 0;
      const at = mode === 'wait' ? Math.max(0, fallMusicStart - waitLeft()) : fallMusicStart + intoFall;
      const seek = () => (music.currentTime = at);
      if (mode === 'wait' || music.paused || Math.abs(music.currentTime - at) > 1) {
        // A seek before the metadata arrives is dropped: retry once it has.
        if (music.readyState >= 1) seek();
        else music.addEventListener('loadedmetadata', seek, { once: true });
      }
      music.play().catch(() => {});
    } else if (music && !music.paused) {
      stopTimer = setTimeout(() => music.pause(), fades.music * 1000 + 100);
    }
    apply(fades);
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
    /** Play position of the fall track (s), or null without one. */
    musicTime: () => music?.currentTime ?? null,
    /** Call from a user gesture (click, tap, key): builds and starts the audio. */
    unlock() {
      if (!AudioCtx) return false;
      if (!ctx) {
        build();
        // iOS also wants each media element started once inside a gesture.
        music?.play().then(() => !musicMode() && music.pause()).catch(() => {});
        if (musicMode()) enter();
        else apply(UNLOCK_FADE);
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
    /**
     * 'wait' in the intro's idle wait (`waitSeconds` until the fall), 'fall'
     * during the fall, 'end' once fallen in, 'ambient' otherwise.
     * @param {'ambient' | 'wait' | 'fall' | 'end'} next
     * @param {number} [waitSeconds]
     */
    setMode(next, waitSeconds = 0) {
      if (next === mode) return;
      mode = next;
      if (mode === 'wait') waitEndsAt = win.performance.now() + waitSeconds * 1000;
      if (ctx) enter();
    },
    isRunning: () => ctx?.state === 'running',
    dispose() {
      doc.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(stopTimer);
      clearTimeout(suspendTimer);
      music?.pause();
      if (trackUrl) win.URL.revokeObjectURL(trackUrl);
      ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}
