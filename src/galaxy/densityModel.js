/**
 * Pure JS mirror of the galaxy model used by the shaders
 * (`shaders/chunks/model.glsl`). Keep the two in step: tests run against
 * this file, and the stars and the volume must agree on where arms are.
 *
 * Units: galaxy unit space (disc radius ≈ 1, y up). `phase` is the galaxy's
 * accumulated rotation (Galaxy.phase).
 *
 * Spiral arms are density waves (Lindblad; see beltoforion.de): each star
 * moves on a slightly elongated orbit r = a·(1 + e·cos ψ), ψ = m(θ − φ(a)).
 * The orbit orientation φ(a) twists with radius, so neighbouring orbits crowd
 * together along a spiral. Stars flow through the arms; the pattern turns
 * slowly and rigidly, so it never winds up.
 */

const TAU = Math.PI * 2;
// Log-spiral softening: φ ∝ ln(1 + a/A0). Real arms are close to
// logarithmic spirals (constant pitch); a linear φ(a) closes into rings.
const SPIRAL_A0 = 0.25;
const SPIRAL_NORM = Math.log(1 + 1 / SPIRAL_A0);

/** Angular speed factor: damped flat-rotation-curve law (inner orbits faster). */
export function omega(a, differential) {
  return (1 - differential) + differential / (a + 0.25);
}

/**
 * Orbit orientation φ(a): a logarithmic spiral making `winding` turns from the
 * centre to a = 1, plus the pattern's rigid rotation.
 */
export function orbitAngle(a, winding, phase, patternSpeed) {
  return (TAU * winding * Math.log(1 + Math.max(a, 0) / SPIRAL_A0)) / SPIRAL_NORM + phase * patternSpeed;
}

/** Eccentricity profile: zero in the bulge, peaks in the inner disc, fades outward. */
export function eccentricity(a, eMax) {
  return eMax * smoothstep(0.04, 0.3, a) * (1 - 0.5 * smoothstep(0.6, 1.2, a));
}

/** Arm phase ψ for a point at angle θ on orbit/radius a. */
export function armPhase(theta, a, arms, winding, phase, patternSpeed) {
  return arms * (theta - orbitAngle(a, winding, phase, patternSpeed));
}

/**
 * Arm-crest proximity in [0, 1]: 1 on the crest, 0 midway between arms.
 * Orbits crowd where dr/da = 1 + e·cos ψ + a·e·m·φ′·sin ψ is smallest, i.e.
 * where sign(φ′)·sin ψ = −1.
 */
export function crest(psi, winding) {
  const s = winding < 0 ? -1 : 1;
  return 0.5 * (1 - s * Math.sin(psi));
}

/** Current polar position of a disc star (orbit a, start angle θ0). */
export function starPosition(a, theta0, params, phase) {
  const { arms, winding, eMax, patternSpeed, differential } = params;
  const theta = theta0 + phase * omega(a, differential);
  const e = arms > 0 ? eccentricity(a, eMax) : 0;
  const psi = armPhase(theta, a, arms, winding, phase, patternSpeed);
  return { r: a * (1 + e * Math.cos(psi)), theta, psi };
}

/**
 * Optical depth of an exponential dust slab ρ ∝ e^(−|z|/zd) between height z
 * and the outside, toward the camera side (`side` = +1 if the camera is above
 * z, −1 if below). Returns the column in units of zd·density: 0 well clear of
 * the slab on the camera side, 1 at the midplane, 2 through the whole slab.
 */
export function dustColumn(z, side, zd) {
  const u = (side >= 0 ? z : -z) / zd;
  return u >= 0 ? Math.exp(-u) : 2 - Math.exp(u);
}

/**
 * Approximate black-body colour (Tanner Helland fit), sRGB components in
 * [0, 1]. Valid for ~1000–40000 K.
 */
export function blackbody(kelvin) {
  const t = kelvin / 100;
  let r;
  let g;
  let b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (v) => Math.min(1, Math.max(0, v / 255));
  return [c(r), c(g), c(b)];
}

/** Sérsic-like bulge profile normalised to 1 at the centre. n≈4: de Vaucouleurs. */
export function sersic(r, re, n) {
  const b = 2 * n - 1 / 3;
  return Math.exp(-b * (Math.pow(Math.max(r, 0) / re, 1 / n)));
}

/** Peak of the r_e-normalised Sérsic profile; real n≈4 cusps are ~2000× brighter. */
export const SERSIC_CAP = 40;

/**
 * Sérsic profile normalised to 1 at the effective radius r_e (the standard
 * astronomical form), with the central cusp capped. Unlike `sersic()`, high-n
 * (elliptical) profiles keep a wide visible envelope.
 */
export function sersicRe(r, re, n) {
  const b = 2 * n - 1 / 3;
  return Math.min(SERSIC_CAP, Math.exp(-b * (Math.pow(Math.max(r, 0) / re, 1 / n) - 1)));
}

export function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Bar orientation: the bar turns rigidly with the pattern and points at the
 * arm crests at radius `barLength`, so arms start from the bar ends.
 * Crest: m(θ − φ) = −sign(k)·π/2  ⇒  θ = φ(barLength) − sign(k)·π/(2m).
 */
export function barAngle(barLength, arms, winding, phase, patternSpeed) {
  const m = Math.max(arms, 1);
  const s = winding < 0 ? -1 : 1;
  return orbitAngle(barLength, winding, phase, patternSpeed) - (s * Math.PI) / (2 * m);
}

/**
 * Half-extents of the box the volume shader marches through, fitted to where
 * the emission is above ~1e-4 of its peak. A tight box means fewer wasted
 * steps and fewer covered pixels.
 *
 * @returns {[number, number, number]} half-size in x, y, z (unit space)
 */
export function volumeBounds(shape, structure) {
  const n = structure.bulgeSersic;
  const b = 2 * n - 1 / 3;
  // Where sersicRe falls to 1% of its value at r_e.
  const bulgeR = shape.bulgeSize * Math.pow(1 + Math.log(100) / b, n);
  const discZ = 6 * shape.discThickness * 1.6 * 1.4; // sech² tail at the flared edge
  const xz = Math.min(1.45, Math.max(1.25, bulgeR));
  const y = Math.min(1.2, Math.max(0.05, discZ, bulgeR * shape.bulgeFlatten));
  return [xz, y, xz];
}

/** Disc radius beyond which the volume has no disc light or dust (see discMap). */
export const DISC_RADIUS = 1.3;

/**
 * Where the volume shader needs to march (mirrored in volume.frag.glsl):
 * the disc slab (|y| ≤ discHalfHeight, R ≤ DISC_RADIUS) and the bulge
 * ellipsoid. stepLength sets the step count from the chord length, so
 * face-on rays through the thin disc take few steps.
 */
export function marchBounds(shape, structure) {
  const n = structure.bulgeSersic;
  const b = 2 * n - 1 / 3;
  const bulgeR = Math.min(1.2, shape.bulgeSize * Math.pow(1 + Math.log(100) / b, n));
  const discHalfHeight = 6 * shape.discThickness * 1.6 * 1.4;
  return {
    discHalfHeight,
    discRadius: DISC_RADIUS,
    bulgeRadii: [bulgeR, bulgeR * shape.bulgeFlatten, bulgeR],
    stepLength: discHalfHeight / 4,
  };
}

/** Ray interval [t0, t1] inside an axis-aligned box of half-size h, or null. */
export function intersectBox(ro, rd, h) {
  let t0 = 0;
  let t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(rd[k]) < 1e-12) {
      if (Math.abs(ro[k]) > h[k]) return null;
      continue;
    }
    const a = (-h[k] - ro[k]) / rd[k];
    const c = (h[k] - ro[k]) / rd[k];
    t0 = Math.max(t0, Math.min(a, c));
    t1 = Math.min(t1, Math.max(a, c));
  }
  return t1 > t0 ? [t0, t1] : null;
}

/** Ray interval inside the slab |y| ≤ h ∩ cylinder x²+z² ≤ r², or null. */
export function intersectDisc(ro, rd, h, r) {
  let t0 = 0;
  let t1 = Infinity;
  if (Math.abs(rd[1]) < 1e-12) {
    if (Math.abs(ro[1]) > h) return null;
  } else {
    const a = (-h - ro[1]) / rd[1];
    const c = (h - ro[1]) / rd[1];
    t0 = Math.min(a, c);
    t1 = Math.max(a, c);
  }
  const A = rd[0] * rd[0] + rd[2] * rd[2];
  if (A > 1e-12) {
    const B = ro[0] * rd[0] + ro[2] * rd[2];
    const C = ro[0] * ro[0] + ro[2] * ro[2] - r * r;
    const disc = B * B - A * C;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    t0 = Math.max(t0, (-B - s) / A);
    t1 = Math.min(t1, (-B + s) / A);
  } else if (ro[0] * ro[0] + ro[2] * ro[2] > r * r) {
    return null;
  }
  t0 = Math.max(t0, 0);
  return t1 > t0 ? [t0, t1] : null;
}

/** Ray interval inside an axis-aligned ellipsoid with the given radii, or null. */
export function intersectEllipsoid(ro, rd, radii) {
  const o = ro.map((v, k) => v / radii[k]);
  const d = rd.map((v, k) => v / radii[k]);
  const A = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const B = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
  const C = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - 1;
  const disc = B * B - A * C;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t0 = Math.max((-B - s) / A, 0);
  const t1 = (-B + s) / A;
  return t1 > t0 ? [t0, t1] : null;
}

/**
 * The march interval and step count for one ray: (disc ∪ bulge) ∩ box.
 * @returns {{ t0: number, t1: number, steps: number } | null}
 */
export function marchInterval(ro, rd, boxHalf, bounds, maxSteps) {
  const box = intersectBox(ro, rd, boxHalf);
  if (!box) return null;
  const parts = [
    intersectDisc(ro, rd, bounds.discHalfHeight, bounds.discRadius),
    intersectEllipsoid(ro, rd, bounds.bulgeRadii),
  ].filter(Boolean);
  if (parts.length === 0) return null;
  const t0 = Math.max(box[0], Math.min(...parts.map((p) => p[0])));
  const t1 = Math.min(box[1], Math.max(...parts.map((p) => p[1])));
  if (t1 <= t0) return null;
  const steps = Math.min(maxSteps, Math.max(3, Math.ceil((t1 - t0) / bounds.stepLength)));
  return { t0, t1, steps };
}
