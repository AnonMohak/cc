import { HORIZON_R } from './gargantuaModel.js';
import { CAMERA_KEYS } from './introKeys.js';
import { FILM_SHOTS, CLIP_FPS, shotSeconds } from './filmShots.js';

export { CAMERA_KEYS };

/**
 * The intro cinematic's clock: the camera path (the film's shots at the
 * film's speed, smooth moves between them, the plunge), the darkness and
 * the sound modes, all as pure functions of the seconds since the start-box
 * click. Units: the hole sits at the origin, 1 = one Schwarzschild radius
 * (Rs), the disc lies in the y = 0 plane and turns toward +azimuth (x → z).
 */

/** Seconds from the click to full black (the music trim lands its peak here). */
export const BLACK_FULL = 65;
/** The fade to black starts here (the spray inside the hole shows until then). */
export const BLACK_START = 64.6;
/** The vignette closes in from here (the fall) to BLACK_FULL. */
export const VIGNETTE_START = 56;
/** Black is held this long before the scene loads. */
export const BLACK_HOLD = 1;
/** The whole cinematic, click to scene. */
export const INTRO_SECONDS = BLACK_FULL + BLACK_HOLD;
/** The music rises over these first seconds (soundscape mode 'wait'). */
export const MUSIC_RISE_SECONDS = 5;

/**
 * Where each film shot (filmShots.js) plays in the intro, at the film's
 * speed: the intro second its first clip frame shows. The moves between
 * them are the camera keys' own (introKeys.js). The last shot, the spray
 * inside the hole, ends at full black.
 */
const INSIDE = FILM_SHOTS.find((s) => s.name === 'inside');
export const FILM_SCHEDULE = [
  { shot: 'gap-dome', start: 0 },
  { shot: 'clouds', start: 13 },
  { shot: 'wall', start: 21.6 },
  { shot: 'skim', start: 37.1 },
  { shot: 'bright', start: 47.4 },
  { shot: 'hole-far', start: 52 },
  { shot: 'inside', start: BLACK_FULL - shotSeconds(INSIDE) },
];

/**
 * The intro second a clip frame shows at (film speed inside its shot), or
 * null for a clip frame outside the scheduled shots.
 * @param {number} frame
 */
export function clipFrameIntroTime(frame) {
  for (const { shot, start } of FILM_SCHEDULE) {
    const s = FILM_SHOTS.find((f) => f.name === shot);
    if (frame >= s.first && frame <= s.last) return start + (frame - s.first) / CLIP_FPS;
  }
  return null;
}

/**
 * The film shot and clip frame shown at intro second t (the nearest clip
 * frame), or null between the shots.
 * @param {number} t
 */
export function filmFrameAt(t) {
  for (const { shot, start } of FILM_SCHEDULE) {
    const s = FILM_SHOTS.find((f) => f.name === shot);
    const frame = s.first + Math.round((t - start) * CLIP_FPS);
    if (frame >= s.first && frame <= s.last) return { shot, frame };
  }
  return null;
}

/** The ?tune view's jump buttons: each film shot's start (s). */
export const REFERENCE_SHOTS = Object.fromEntries(FILM_SCHEDULE.map(({ shot, start }) => [shot, start]));

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
  out.sparse = Math.min(1, Math.max(0, catmullRom(k0.sparse, k1.sparse, k2.sparse, k3.sparse, s)));
  out.haze = Math.max(0, catmullRom(k0.haze, k1.haze, k2.haze, k3.haze, s));
  out.sat = Math.max(0, catmullRom(k0.sat ?? 1, k1.sat ?? 1, k2.sat ?? 1, k3.sat ?? 1, s));
  out.ghost = Math.min(1, Math.max(0, catmullRom(k0.ghost ?? 0, k1.ghost ?? 0, k2.ghost ?? 0, k3.ghost ?? 0, s)));
  return out;
}

/**
 * Per-shot look values at t: each key may carry `look` (introLook.js names
 * to values), eased (smoothstep) from the key before t to the key after it;
 * a key without a name it does not set takes `base` for it. Only names one
 * of the two keys sets are written to `out` (a Map, reused: no allocation
 * per frame once warm); others keep the base look.
 * @param {number} t
 * @param {object[]} keys
 * @param {Record<string, number | number[]>} base
 * @param {Map<string, number | number[]>} out
 */
export function keyLook(t, keys, base, out = new Map()) {
  out.clear();
  const last = keys.length - 1;
  const time = Math.min(Math.max(t, keys[0].t), keys[last].t);
  let i = 0;
  while (i < last - 1 && time > keys[i + 1].t) i++;
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const s = smoothstep(0, 1, (time - k1.t) / (k2.t - k1.t));
  for (const k of [k1, k2]) {
    if (!k.look) continue;
    for (const name of Object.keys(k.look)) {
      if (out.has(name) || !(name in base)) continue;
      const a = k1.look?.[name] ?? base[name];
      const b = k2.look?.[name] ?? base[name];
      if (Array.isArray(a)) {
        const v = _vectors.get(name) ?? [0, 0, 0];
        _vectors.set(name, v);
        for (let c = 0; c < 3; c++) v[c] = a[c] + (b[c] - a[c]) * s;
        out.set(name, v);
      } else out.set(name, a + (b - a) * s);
    }
  }
  return out;
}
const _vectors = new Map();

/** The fall speed ramps in over these seconds (after the hole-far shot). */
export const FALL_START = 56.3;
export const FALL_FULL = 58;
/** The fall speed's cap (share of c). */
export const FALL_BETA_MAX = 0.95;

const _a = { position: [0, 0, 0], target: [0, 0, 0] };
const _b = { position: [0, 0, 0], target: [0, 0, 0] };

/**
 * The camera's velocity (share of c) relative to an observer at rest there,
 * for the aberration of the fall: along the path's direction of motion, the
 * size of a free fall from far away (√(r₊ / r), capped), ramped in from
 * FALL_START. Zero before (the reference shots are solved for a camera at
 * rest).
 * @param {number} t
 * @param {number[]} out
 * @param {object[]} [keys] camera keys (the lab sets its own)
 */
export function fallBoost(t, out = [0, 0, 0], keys = CAMERA_KEYS) {
  const ramp = smoothstep(FALL_START, FALL_FULL, t);
  out[0] = out[1] = out[2] = 0;
  if (ramp <= 0) return out;
  const p0 = introCamera(t - 0.05, _a, keys).position;
  const p1 = introCamera(t + 0.05, _b, keys).position;
  // (No arrays: this runs every frame.)
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  if (len < 1e-9) return out;
  const r = Math.hypot(p0[0] + p1[0], p0[1] + p1[1], p0[2] + p1[2]) / 2;
  const k = (ramp * Math.min(FALL_BETA_MAX, Math.sqrt(HORIZON_R / r))) / len;
  for (let i = 0; i < 3; i++) out[i] = (p1[i] - p0[i]) * k;
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
