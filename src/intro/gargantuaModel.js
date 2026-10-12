/**
 * The intro black hole's disc (Gargantua, Interstellar), as plain numbers and
 * functions. The shader (gargantuaShader.js) builds its constants from these
 * and mirrors the functions; tests pin both. Units: Rs, the hole at the
 * origin, the disc in the y = 0 plane, turning toward +azimuth.
 *
 * Film facts (James et al. 2015, arXiv:1502.03808): a volume disc with
 * procedural texture for the close shots, one temperature (4500 K), no
 * Doppler colour shift, spin a/M = 0.6.
 */

/** The disc's inner edge (Rs): the ISCO of a/M = 0.6 is ≈ 1.9 Rs; the film disc starts a little out. */
export const DISC_INNER = 2.2;
/** The disc fades out toward here (Rs): huge next to the shadow, as in the film. */
export const DISC_OUTER = 60;
/** Gaussian half-thickness H(r) = H0 + H1 · r (Rs): thin inside, flared outside. */
export const H0 = 0.05;
export const H1 = 0.03;
/** Vertical extent of the gas, in half-thicknesses (the slab the march visits). */
export const SLAB_K = 3;
/** Shadow radius (Rs) in flat space; the lensing milestone replaces it. */
export const SHADOW_FLAT = 2.598;

/** Half-thickness (Rs) at radius r. */
export function halfThickness(r) {
  return H0 + H1 * r;
}

/** The slab the march visits: |y| below this (Rs) at radius r. */
export function slabHeight(r) {
  return SLAB_K * halfThickness(r);
}

/**
 * Radial window: in from the inner edge, soft out to DISC_OUTER.
 * @param {number} r
 */
export function radialWindow(r) {
  const smooth = (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  return smooth(DISC_INNER, DISC_INNER * 1.25, r) * (1 - smooth(DISC_OUTER * 0.35, DISC_OUTER, r));
}

/**
 * Brightness of the hot midplane at radius r, 1 at the inner edge. Steeper
 * than the light alone would need: the outer disc reads as grey-blue smoke
 * with the white-hot light near the hole (reference shots 4 and 5).
 */
export const GLOW_POWER = 1.8;
/** @param {number} r */
export function glow(r) {
  return Math.pow(DISC_INNER / Math.max(r, DISC_INNER), GLOW_POWER);
}

/** Keplerian angular speed (rad per second of film time) at r. */
export const SPIN = 0.35;
export function angularSpeed(r) {
  return SPIN * Math.pow(DISC_INNER / Math.max(r, DISC_INNER), 1.5);
}

/**
 * Ray-march step (Rs) at radius r: a fraction of the local thickness, so
 * thin inner gas is never skipped, capped for the thick outer disc.
 */
export const STEP_K = 0.2;
export const STEP_MIN = 0.01;
export const STEP_MAX = 0.8;
export function marchStep(r) {
  return Math.min(STEP_MAX, Math.max(STEP_MIN, STEP_K * halfThickness(r)));
}
