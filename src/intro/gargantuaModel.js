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

/**
 * The disc's inner edge (Rs). Out past the ISCO (≈ 1.9 Rs for a/M = 0.6), as
 * in the film: a dark gap shows between the shadow and the arches, and near
 * the hole the camera sits in a clear gap with the disc only a thin line and
 * sparse clumps (reference shots 1–3).
 */
export const DISC_INNER = 4;
/**
 * Inside this many × DISC_INNER the gas can thin into sparse clumps: how much
 * is a per-shot value (camera key `sparse`; 1 in shots 1–3, 0 where the camera
 * looks over a dense surface, shots 4–5).
 */
export const SPARSE_OUT = 2.2;
/** The disc fades out toward here (Rs): huge next to the shadow, as in the film. */
export const DISC_OUTER = 60;
/**
 * Gaussian half-thickness H(r) = H0 + H1 · r (Rs): thin, as in the film (a
 * camera ~0.6 Rs over the plane near the hole is above the gas: shots 7–9).
 */
export const H0 = 0.05;
export const H1 = 0.015;
/** Vertical extent of the gas, in half-thicknesses (the slab the march visits). */
export const SLAB_K = 3;
/** Rays inside this radius (Rs) and moving inward are captured: the shadow. */
export const PHOTON_SPHERE = 1.5;
/** Rays past this radius (Rs) and moving outward have left: they see the sky. */
export const ESCAPE_R = 90;

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

/**
 * Lensing step (Rs): the light path bends most near the hole, so the step
 * shrinks with r (the gas step is used where it is smaller).
 */
export const CURVE_K = 0.08;
export const CURVE_MIN = 0.008;
export const CURVE_MAX = 3;
export function curveStep(r) {
  return Math.min(CURVE_MAX, Math.max(CURVE_MIN, CURVE_K * r));
}

/**
 * One light path in Schwarzschild space (units of Rs): velocity Verlet on
 * d²x/dλ² = −1.5 h² x / r⁵ (h = |x × v|, conserved), with curveStep. The
 * shader runs the same integrator and samples the gas along the way.
 * @param {number[]} origin
 * @param {number[]} dir
 * @returns {{ captured: boolean, escaped: boolean, dir: number[], steps: number }}
 */
export function bendRay(origin, dir, maxSteps = 4000) {
  const p = [...origin];
  const len = Math.hypot(...dir);
  const v = dir.map((x) => x / len);
  const c = [p[1] * v[2] - p[2] * v[1], p[2] * v[0] - p[0] * v[2], p[0] * v[1] - p[1] * v[0]];
  const h2 = c[0] ** 2 + c[1] ** 2 + c[2] ** 2;
  const accel = (q) => {
    const r2 = q[0] ** 2 + q[1] ** 2 + q[2] ** 2;
    const k = (-1.5 * h2) / (r2 * r2 * Math.sqrt(r2));
    return q.map((x) => k * x);
  };
  let a = accel(p);
  for (let step = 0; step < maxSteps; step++) {
    const r = Math.hypot(...p);
    const radial = p[0] * v[0] + p[1] * v[1] + p[2] * v[2];
    if (r < PHOTON_SPHERE && radial < 0) return { captured: true, escaped: false, dir: v, steps: step };
    if (r > ESCAPE_R && radial > 0) return { captured: false, escaped: true, dir: v, steps: step };
    const dt = curveStep(r);
    for (let i = 0; i < 3; i++) p[i] += v[i] * dt + 0.5 * a[i] * dt * dt;
    const a1 = accel(p);
    for (let i = 0; i < 3; i++) v[i] += 0.5 * (a[i] + a1[i]) * dt;
    a = a1;
  }
  return { captured: false, escaped: false, dir: v, steps: maxSteps };
}
