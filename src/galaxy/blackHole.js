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
