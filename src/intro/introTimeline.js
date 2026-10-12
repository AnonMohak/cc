/**
 * The intro cinematic's clock: the camera path (shots 1–5 of the reference,
 * a turn around the disc, the plunge), the darkness and the sound modes, all
 * as pure functions of the seconds since the start-box click. Units: the
 * hole sits at the origin, 1 = one Schwarzschild radius (Rs), the disc lies
 * in the y = 0 plane and turns toward +azimuth (x → z).
 */

/** Seconds from the click to full black (the music trim lands its peak here). */
export const BLACK_FULL = 65;
/** The fade to black starts here. */
export const BLACK_START = 60.8;
/** The vignette closes in from here to BLACK_FULL. */
export const VIGNETTE_START = 38;
/** Black is held this long before the scene loads. */
export const BLACK_HOLD = 1;
/** The whole cinematic, click to scene. */
export const INTRO_SECONDS = BLACK_FULL + BLACK_HOLD;
/** The music rises over these first seconds (soundscape mode 'wait'). */
export const MUSIC_RISE_SECONDS = 5;

/**
 * Camera keys: t (s), r (Rs), elevation above the disc (deg), azimuth (deg),
 * look (the point aimed at, Rs), roll (deg, into the turn) and fov (deg).
 * First values; the camera milestone tunes them against the reference.
 */
export const CAMERA_KEYS = [
  // Shots 1–3: in the disc plane, close; the camera backs out as the rings brighten.
  { t: 0, r: 3.2, el: 0.5, az: 0, look: [0, 0, 0], roll: 0, fov: 60 },
  { t: 6, r: 3.6, el: 0.4, az: 6, look: [0, 0, 0], roll: 0, fov: 60 },
  { t: 12, r: 5.5, el: 0.3, az: 12, look: [0, 0, 0], roll: 0, fov: 58 },
  // Shots 4–5: rises just over the cloud top; the shadow becomes a dome.
  { t: 18, r: 7, el: 3, az: 20, look: [0, 0.6, 0], roll: 0, fov: 56 },
  { t: 24, r: 9, el: 5, az: 30, look: [0, 0.8, 0], roll: 0, fov: 55 },
  // The turn around the disc (reference 6–10): above the clouds, past the
  // shadow with a lead and a bank, then through the disc fog.
  { t: 30, r: 12, el: 10, az: 48, look: [0, 0, 0], roll: 4, fov: 55 },
  { t: 37, r: 10, el: 5, az: 85, look: [-2, 0, 2], roll: 10, fov: 55 },
  { t: 44, r: 8, el: 2, az: 130, look: [-2, 0, 1], roll: 12, fov: 56 },
  { t: 50, r: 6.5, el: 0.4, az: 170, look: [0, 0, 0], roll: 6, fov: 58 },
  // The fall: turn to the shadow and plunge.
  { t: 56, r: 4, el: 8, az: 200, look: [0, 0, 0], roll: 2, fov: 62 },
  { t: 62, r: 1.8, el: 10, az: 222, look: [0, 0, 0], roll: 0, fov: 78 },
  { t: BLACK_FULL, r: 1.2, el: 10, az: 230, look: [0, 0, 0], roll: 0, fov: 85 },
];

const DEG = Math.PI / 180;

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Camera position (Rs) of a key. */
export function keyPosition(key, out = [0, 0, 0]) {
  const ring = key.r * Math.cos(key.el * DEG);
  out[0] = ring * Math.cos(key.az * DEG);
  out[1] = key.r * Math.sin(key.el * DEG);
  out[2] = ring * Math.sin(key.az * DEG);
  return out;
}

// Uniform Catmull–Rom between p1 and p2 at s (0–1).
function catmullRom(p0, p1, p2, p3, s) {
  const s2 = s * s;
  const s3 = s2 * s;
  return 0.5 * (2 * p1 + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 + (-p0 + 3 * p1 - 3 * p2 + p3) * s3);
}

/**
 * The camera at t seconds: a smooth path through the keys (spherical keys
 * are interpolated in their own coordinates, so the path circles the hole
 * instead of cutting through it).
 * @param {number} t
 * @param {{ position: number[], target: number[], roll: number, fov: number }} out roll in radians
 */
export function introCamera(t, out, keys = CAMERA_KEYS) {
  const last = keys.length - 1;
  const time = Math.min(Math.max(t, keys[0].t), keys[last].t);
  let i = 0;
  while (i < last - 1 && time > keys[i + 1].t) i++;
  const k0 = keys[Math.max(i - 1, 0)];
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const k3 = keys[Math.min(i + 2, last)];
  const s = (time - k1.t) / (k2.t - k1.t);
  const r = catmullRom(k0.r, k1.r, k2.r, k3.r, s);
  const el = catmullRom(k0.el, k1.el, k2.el, k3.el, s);
  const az = catmullRom(k0.az, k1.az, k2.az, k3.az, s);
  keyPosition({ r, el, az }, out.position);
  for (let c = 0; c < 3; c++) out.target[c] = catmullRom(k0.look[c], k1.look[c], k2.look[c], k3.look[c], s);
  out.roll = catmullRom(k0.roll, k1.roll, k2.roll, k3.roll, s) * DEG;
  out.fov = catmullRom(k0.fov, k1.fov, k2.fov, k3.fov, s);
  return out;
}

/**
 * Darkness and sound at t seconds. sound: soundscape mode ('wait' while the
 * music rises, 'fall' with the music, 'end' once black); done: the scene
 * loads now.
 * @param {number} t
 */
export function introPhase(t) {
  return {
    vignette: smoothstep(VIGNETTE_START, BLACK_FULL, t),
    black: smoothstep(BLACK_START, BLACK_FULL, t),
    sound: t < MUSIC_RISE_SECONDS ? 'wait' : t < BLACK_FULL ? 'fall' : 'end',
    done: t >= INTRO_SECONDS,
  };
}
