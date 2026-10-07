/**
 * Standalone black holes (scene entries of kind 'blackhole'). PURE: light
 * bending and lens selection. Rendering: core/BlackHolePass.js (lensing +
 * accretion disc in a screen pass) and Galaxy.js (star cloud, jets).
 *
 * Lengths below are in Schwarzschild radii (Rs) unless they say otherwise.
 */

/** Critical impact parameter (√27 / 2): rays closer than this fall in (the shadow). */
export const SHADOW_B = 2.598;
/** Accretion disc: inner edge at the ISCO, outer edge (stylised: the film disc reaches far). */
export const DISC_INNER = 3;
export const DISC_OUTER = 18;
/** Rays farther than this from the hole are not bent (deflection fades to 0). */
export const LENS_REACH = 40;
/** Bending is capped below π: more would be a loop around the hole. */
export const MAX_DEFLECTION = 3;

/**
 * Bending angle (radians) of a light ray with impact parameter b (in Rs).
 * Weak field: 2/b + 15π/(16 b²) (second-order Schwarzschild). Near the photon
 * sphere: the strong-deflection limit −ln(b/b_c − 1) − 0.40, which diverges
 * at b_c. Capped at MAX_DEFLECTION. Mirrored in BlackHolePass.js.
 * @param {number} b
 */
export function deflection(b) {
  if (b <= SHADOW_B) return MAX_DEFLECTION;
  const weak = 2 / b + (15 * Math.PI) / (16 * b * b);
  const strong = -Math.log(b / SHADOW_B - 1) - 0.4;
  return Math.min(MAX_DEFLECTION, Math.max(weak, strong));
}

/**
 * Ray march (Accurate tier, core/BlackHolePass.js): the march sphere radius is
 * the disc outer radius times this, and the integrator step is
 * clamp(MARCH_STEP_K · r, MARCH_STEP_MIN, MARCH_STEP_MAX) (in Rs).
 */
export const MARCH_SPHERE_K = 1.25;
export const MARCH_STEP_K = 0.12;
export const MARCH_STEP_MIN = 0.03;
export const MARCH_STEP_MAX = 2;
/** Photon sphere radius: inside it, a ray moving inward always falls in. */
export const PHOTON_SPHERE = 1.5;

/**
 * Accurate-tier ray march only: the disc's inner edge sits at MARCH_INNER
 * (Rs) instead of the ISCO (DISC_INNER), like Gargantua's near-extremal spin
 * in the film. Otherwise a dark band shows between the photon ring and the
 * lensed inner edge up close. The disc look is evaluated at a remapped
 * radius (marchDiscRadius), so its profile and streaks are unchanged farther
 * out. Mirrored in BlackHolePass (march shader).
 */
export const MARCH_INNER = 1.7;
export const MARCH_BLEND = 7;

/** Radius (Rs) at which the march evaluates the disc look for a true radius r. */
export function marchDiscRadius(r) {
  const t = Math.min(1, Math.max(0, (r - MARCH_INNER) / (MARCH_BLEND - MARCH_INNER)));
  return r + (DISC_INNER - MARCH_INNER) * (1 - t * t * (3 - 2 * t));
}

/** Ray-march resolution range (fraction of the screen) and its step. */
export const MARCH_SCALE_MIN = 0.4;
export const MARCH_SCALE_MAX = 0.7;
const MARCH_SCALE_STEP = 0.1;

/**
 * Ray-march resolution for a hole whose march sphere covers `coverage` of
 * the screen (0–1). Cost follows the covered march pixels, so a hole that
 * covers less gets more resolution for the same cost: the budget is a
 * full-screen hole at MARCH_SCALE_MIN. Bucketed in 0.1 steps, so the render
 * target is rarely reallocated.
 * @param {number} coverage
 */
export function marchScaleFor(coverage) {
  const c = Math.min(1, Math.max(1e-3, coverage));
  const s = Math.min(MARCH_SCALE_MAX, Math.max(MARCH_SCALE_MIN, MARCH_SCALE_MIN / Math.sqrt(c)));
  return Math.round(Math.floor(s / MARCH_SCALE_STEP + 1e-6) * MARCH_SCALE_STEP * 10) / 10;
}

/**
 * Trace a light ray past a Schwarzschild black hole (units of Rs, hole at the
 * origin). Photon orbits obey d²p/dλ² = −1.5 h² p / |p|⁵ with h = |p × v|
 * constant: exact for the orbit shape, so it gives the shadow at √27/2 Rs,
 * the arches and the higher-order images (rays that loop the hole).
 * Velocity Verlet with an adaptive step. Mirrored in BlackHolePass.js
 * (holeMarch); the shader adds the disc volume and a slab step limit.
 *
 * @param {number[]} origin [x, y, z]
 * @param {number[]} dir [x, y, z] (normalised here)
 * @param {{ maxSteps?: number, escapeRadius?: number }} [options]
 * @returns {{ captured: boolean, escaped: boolean, dir: number[], steps: number }}
 */
export function traceRay(origin, dir, { maxSteps = 64, escapeRadius = 40 } = {}) {
  const p = [...origin];
  const len = Math.hypot(...dir);
  const v = dir.map((x) => x / len);
  const cross = [p[1] * v[2] - p[2] * v[1], p[2] * v[0] - p[0] * v[2], p[0] * v[1] - p[1] * v[0]];
  const h2 = cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2;
  const accel = (q) => {
    const r2 = q[0] ** 2 + q[1] ** 2 + q[2] ** 2;
    const k = (-1.5 * h2) / (r2 * r2 * Math.sqrt(r2));
    return q.map((x) => k * x);
  };
  let a = accel(p);
  for (let step = 0; step < maxSteps; step++) {
    const r = Math.hypot(...p);
    const outward = p[0] * v[0] + p[1] * v[1] + p[2] * v[2] > 0;
    if (r < PHOTON_SPHERE && !outward) return { captured: true, escaped: false, dir: v, steps: step };
    if (r > escapeRadius && outward) return { captured: false, escaped: true, dir: v, steps: step };
    const dt = Math.min(MARCH_STEP_MAX, Math.max(MARCH_STEP_MIN, MARCH_STEP_K * r));
    for (let i = 0; i < 3; i++) p[i] += v[i] * dt + 0.5 * a[i] * dt * dt;
    const a1 = accel(p);
    for (let i = 0; i < 3; i++) v[i] += 0.5 * (a[i] + a1[i]) * dt;
    a = a1;
  }
  return { captured: false, escaped: false, dir: v, steps: maxSteps };
}

/**
 * Intro-fall warp (fallPose.warp, 0–1): the lens bends more, reaches farther,
 * reads its screen light from deeper behind the hole, and twists the bent
 * rays around the hole (an exaggerated frame-drag swirl). Not physics: it
 * sells the last seconds of the fall. Mirrored in BlackHolePass.
 */
export const WARP_BEND = 1.5;
export const WARP_REACH = 2;
export const WARP_DEPTH = 3;
export const WARP_SWIRL = 0.8;
/** Exact lens: the warp shrinks the impact parameter by up to this share (more bend, a bigger shadow). */
export const WARP_SHRINK = 0.3;
/** Exact lens: its swirl (the ray's plane turned about the hole). Weaker than WARP_SWIRL: a strong twist folded the disc's arch. */
export const WARP_SWIRL_EXACT = 0.24;

/** Lens reach (Rs) for a warp amount: LENS_REACH at 0. */
export function warpedReach(warp) {
  return LENS_REACH * (1 + WARP_REACH * Math.min(1, Math.max(0, warp)));
}

/** Shadow radius on screen (px) for Rs and distance in world units. */
export function shadowPixels(rsWorld, distance, tanHalfFovY, viewportHeight) {
  if (!(distance > 0)) return 0;
  return ((SHADOW_B * rsWorld) / distance / tanHalfFovY) * (viewportHeight / 2);
}

/**
 * Lens fade-in by shadow size (2 → 4 px): no pop when a black hole first
 * resolves, and no dark dot in the core at normal viewing distances.
 */
export function lensFade(shadowPx) {
  const t = Math.min(1, Math.max(0, (shadowPx - 2) / 2));
  return t * t * (3 - 2 * t);
}

/**
 * The lenses worth drawing: visible ones, largest on screen first. Runs every
 * frame, so it allocates nothing: it fills `out` and returns the count.
 * @template {{ shadowPx: number, visible: boolean }} T
 * @param {T[]} candidates
 * @param {number} count how many of `candidates` are in use
 * @param {number} max
 * @param {T[]} out
 */
export function pickLenses(candidates, count, max, out) {
  let n = 0;
  for (let i = 0; i < count; i++) {
    const c = candidates[i];
    if (!c.visible || lensFade(c.shadowPx) <= 0) continue;
    // Insertion into the sorted top-`max` list.
    let j = Math.min(n, max - 1);
    if (n === max && out[j].shadowPx >= c.shadowPx) continue;
    while (j > 0 && out[j - 1].shadowPx < c.shadowPx) {
      out[j] = out[j - 1];
      j--;
    }
    out[j] = c;
    if (n < max) n++;
  }
  return n;
}
