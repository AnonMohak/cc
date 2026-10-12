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
 * Camera keys: t (s), r (Rs), elevation above the disc plane (deg), azimuth
 * (deg, the disc turns toward +azimuth), lead (deg: the view turns from the
 * hole toward the direction of motion; 0 aims at the hole), aimY (Rs: the
 * height of the aim point), roll (deg), fov (deg) and exposure.
 */
export const CAMERA_KEYS = [
  // Shots 1–3: in the disc plane inside the clear gap near the hole; the
  // shadow fills the view, the thin ring and sparse clumps around it. The
  // camera backs out and turns to the hole as the rings come into view.
  { t: 0, r: 2.4, el: 0, az: 0, lead: 21, aimY: 0.15, roll: 0, fov: 75, exp: 0.45 },
  { t: 6, r: 2.9, el: 0, az: 4, lead: 8, aimY: 0.1, roll: 0, fov: 75, exp: 0.6 },
  { t: 12, r: 3.5, el: 0, az: 8, lead: 0, aimY: 0.05, roll: 0, fov: 75, exp: 0.85 },
  // Rise out of the gap over the inner edge, then out over the cloud tops.
  { t: 15, r: 4.2, el: 13, az: 11, lead: 0, aimY: 0.6, roll: 0, fov: 70, exp: 1.05 },
  // Shots 4–5: just over the cloud tops; the shadow is a dome with the arches.
  { t: 19.5, r: 9, el: 6.5, az: 14, lead: 0, aimY: 1.3, roll: 0, fov: 62, exp: 1.15 },
  { t: 25, r: 12, el: 6.3, az: 19, lead: 0, aimY: 1.5, roll: 0, fov: 60, exp: 1.25 },
  // The turn around the disc (references 6–10): above the clouds, then low
  // beside the hole with it at the left (a negative lead: the view turns
  // against the motion) and the cloud arc overhead, then through the thin
  // inner fog.
  { t: 31, r: 14, el: 12, az: 40, lead: 0, aimY: 0, roll: 3, fov: 56, exp: 1.1 },
  { t: 37.5, r: 7.5, el: 8, az: 90, lead: -40, aimY: 0.5, roll: -10, fov: 58, exp: 1 },
  { t: 44, r: 6, el: 6, az: 140, lead: -32, aimY: 0.5, roll: -12, fov: 60, exp: 1 },
  { t: 50, r: 5, el: 2.5, az: 182, lead: -15, aimY: 0.4, roll: -6, fov: 62, exp: 0.55 },
  // The fall: rise a little, turn to the shadow and plunge.
  { t: 55.5, r: 4, el: 12, az: 205, lead: 0, aimY: 0, roll: 2, fov: 64, exp: 1 },
  { t: 61.5, r: 1.9, el: 10, az: 222, lead: 0, aimY: 0, roll: 0, fov: 80, exp: 1 },
  { t: BLACK_FULL, r: 1.2, el: 10, az: 230, lead: 0, aimY: 0, roll: 0, fov: 85, exp: 1 },
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
 * The aim point of a camera pose: from the hole direction, turned by `lead`
 * toward the direction of motion (+azimuth), at the camera's horizontal
 * distance, at height aimY.
 */
export function keyTarget({ r, el, az, lead, aimY }, out = [0, 0, 0]) {
  const ring = r * Math.cos(el * DEG);
  const a = az * DEG;
  const l = lead * DEG;
  // toHole = -(cos a, sin a); tangent = (-sin a, cos a) (in x, z).
  const dx = -Math.cos(l) * Math.cos(a) - Math.sin(l) * Math.sin(a);
  const dz = -Math.cos(l) * Math.sin(a) + Math.sin(l) * Math.cos(a);
  out[0] = ring * Math.cos(a) + dx * ring;
  out[1] = aimY;
  out[2] = ring * Math.sin(a) + dz * ring;
  return out;
}

const _key = { r: 0, el: 0, az: 0, lead: 0, aimY: 0 };

/**
 * The camera at t seconds: a smooth path through the keys (interpolated in
 * the keys' own spherical coordinates, so the path circles the hole instead
 * of cutting through it).
 * @param {number} t
 * @param {{ position: number[], target: number[], roll: number, fov: number, exposure: number }} out roll in radians
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
  for (const name of ['r', 'el', 'az', 'lead', 'aimY']) _key[name] = catmullRom(k0[name], k1[name], k2[name], k3[name], s);
  keyPosition(_key, out.position);
  keyTarget(_key, out.target);
  out.roll = catmullRom(k0.roll, k1.roll, k2.roll, k3.roll, s) * DEG;
  out.fov = catmullRom(k0.fov, k1.fov, k2.fov, k3.fov, s);
  out.exposure = catmullRom(k0.exp, k1.exp, k2.exp, k3.exp, s);
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
