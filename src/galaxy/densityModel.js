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
