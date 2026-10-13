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
/** The hole's mass (M = Rs / 2) and spin a = 0.6 M (Rs), as in the film. */
export const KERR_M = 0.5;
export const KERR_A = 0.3;

/**
 * Radius (Rs) of the innermost photon orbit (the prograde equatorial one):
 * a ray inside it moving inward is captured. 1.5 Rs for a = 0, 1.09 Rs for
 * a = 0.6 M.
 */
export function captureRadius(a = KERR_A) {
  return 2 * KERR_M * (1 + Math.cos((2 / 3) * Math.acos(-a / KERR_M)));
}
/**
 * The shadow's edges seen from far out in the disc plane, as impact
 * parameters (Rs) from the axis through the hole: on the prograde side (light
 * that turns with the spin: closer, the flat side of the D), the retrograde
 * side, and over the poles (light with L = 0). Exact (the circular and the
 * L = 0 spherical photon orbits); 2.598 each for a = 0.
 * @returns {{ prograde: number, retrograde: number, polar: number }}
 */
export function kerrShadow(a = KERR_A) {
  const M = KERR_M;
  const prograde = 6 * M * Math.cos(Math.acos(-a / M) / 3) - a;
  const retrograde = 6 * M * Math.cos(Math.acos(a / M) / 3) + a;
  // The L = 0 photon orbit: r³ − 3Mr² + a²r + a²M = 0 (bisection, M < r < 3M);
  // then η = r³(4a²M − r(r − 3M)²) / (a²(r − M)²) and the edge is √η.
  let polar = 3 * Math.sqrt(3) * M;
  if (Math.abs(a) > 1e-9) {
    let lo = M;
    let hi = 3 * M;
    for (let i = 0; i < 80; i++) {
      const r = (lo + hi) / 2;
      if (r ** 3 - 3 * M * r * r + a * a * r + a * a * M < 0) lo = r;
      else hi = r;
    }
    const r = (lo + hi) / 2;
    polar = Math.sqrt((r ** 3 * (4 * a * a * M - r * (r - 3 * M) ** 2)) / (a * a * (r - M) ** 2));
  }
  return { prograde, retrograde, polar };
}

/** The event horizon (Rs): M + √(M² − a²), 0.9 Rs for a = 0.6 M. */
export const HORIZON_R = KERR_M + Math.sqrt(KERR_M * KERR_M - KERR_A * KERR_A);

/**
 * Aberration: a look direction in the moving camera's frame → the same ray's
 * look direction in the frame of the observer at rest (the one bendRay starts
 * from). The camera moves at `boost` (velocity / c, |boost| < 1) in that
 * frame. Light's velocity adds relativistically, so the view crowds toward
 * the motion: a look square to it (camera) is 90° + asin β behind (rest).
 * No Doppler shift of colour or brightness (the film left those out too).
 * @param {number[]} look unit
 * @param {number[]} boost
 */
export function aberrate(look, boost) {
  const b2 = boost[0] ** 2 + boost[1] ** 2 + boost[2] ** 2;
  if (b2 < 1e-12) return [...look];
  const g = 1 / Math.sqrt(1 - b2);
  // The photon travels against the look direction.
  const k = look.map((x) => -x);
  const bk = boost[0] * k[0] + boost[1] * k[1] + boost[2] * k[2];
  const u = k.map((x, i) => (x / g + boost[i] + (g / (g + 1)) * bk * boost[i]) / (1 + bk));
  const len = Math.hypot(...u);
  return u.map((x) => -x / len);
}

/** Rays inside this radius (Rs) and moving inward are captured: the shadow. */
export const CAPTURE_R = captureRadius();
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
export const SPIN = 0.7;
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
export const CURVE_K = 0.04;
export const CURVE_MIN = 0.008;
export const CURVE_MAX = 3;
export function curveStep(r) {
  return Math.min(CURVE_MAX, Math.max(CURVE_MIN, CURVE_K * r));
}

/**
 * One light path around the spinning hole (Kerr, spin axis +y, the disc
 * turning with the spin; units of Rs), as the shader runs it. Boyer–Lindquist
 * r, θ, φ shown as x = r sinθ (cos φ, ·, sin φ), y = r cos θ, integrated in
 * Mino time τ (dλ = Σ dτ), where r and θ each obey their own smooth equation:
 * r'' = R'(r)/2, θ'' = Θ'(θ)/2, φ' = a(r² + a² − aL)/Δ − a + L/sin²θ, with
 * E = 1 (velocity Verlet). The constants come from the ray's coordinate
 * direction n in the frame of an observer at rest with zero angular
 * momentum; with a = 0 that is a static observer's view, b = r sin α /
 * √(1 − 1/r) (shotSolve.js shadowAngle). Each step covers
 * curveStep(r) of coordinate path length.
 * @param {number[]} origin
 * @param {number[]} dir
 * @returns {{ captured: boolean, escaped: boolean, dir: number[], steps: number }}
 */
export function bendRay(origin, dir, maxSteps = 4000, a = KERR_A) {
  const M = KERR_M;
  const a2 = a * a;
  const capture = captureRadius(a);
  const len = Math.hypot(...dir);
  const n = dir.map((x) => x / len);
  let r = Math.hypot(...origin);
  let th = Math.acos(Math.min(1, Math.max(-1, origin[1] / r)));
  const ring = Math.hypot(origin[0], origin[2]);
  let e = ring > 1e-9 ? [origin[0] / ring, origin[2] / ring] : [1, 0];
  const basis = (s, c) => [
    [s * e[0], c, s * e[1]],
    [c * e[0], -s, c * e[1]],
    [-e[1], 0, e[0]],
  ];
  const dot = (u, w) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  let s = Math.sin(th);
  let c = Math.cos(th);
  let [rh, thh, phh] = basis(s, c);
  const delta = (x) => x * x - 2 * M * x + a2;
  // The camera is a zero-angular-momentum observer and n its direction in
  // its own frame (James et al. 2015, appendix A), so the start is a real
  // light ray: R(r0) = (Δ p_r)². (Flat-space constants gave R(r0) < 0 for
  // rays square to the hole, which then fell the wrong way: a seam.)
  const sig = r * r + a2 * c * c;
  const big = (r * r + a2) ** 2 - a2 * delta(r) * s * s;
  const varpi = Math.sqrt(big / sig) * s;
  const alpha = Math.sqrt((sig * delta(r)) / big);
  const omega = (2 * M * a * r) / big;
  const eF = 1 / (alpha + omega * varpi * dot(n, phh));
  const L = eF * varpi * dot(n, phh);
  const pth = eF * Math.sqrt(sig) * dot(n, thh);
  const Q = pth * pth + c * c * ((L * L) / Math.max(s * s, 1e-12) - a2);
  const K = (L - a) ** 2 + Q;
  const rd0 = delta(r) * eF * Math.sqrt(sig / delta(r)) * dot(n, rh);
  const radialPotential = (x) => (x * x + a2 - a * L) ** 2 - delta(x) * K;
  const accR = (x) => 2 * x * (x * x + a2 - a * L) - (x - M) * K;
  const safeSin = (x) => (x >= 0 ? Math.max(x, 1e-6) : Math.min(x, -1e-6));
  const accTh = (si, co) => -a2 * co * si + (L * L * co) / (safeSin(si) ** 3);
  const phiRate = (x, si) => (a * (x * x + a2 - a * L)) / delta(x) - a + L / Math.max(si * si, 1e-12);
  let rd = rd0;
  let thd = pth;
  let ar = accR(r);
  let at = accTh(s, c);
  let pd = phiRate(r, s);
  let v = n;
  for (let step = 0; step < maxSteps; step++) {
    [rh, thh, phh] = basis(s, c);
    const vel = [0, 1, 2].map((i) => rd * rh[i] + r * thd * thh[i] + r * s * pd * phh[i]);
    const speed = Math.hypot(...vel);
    v = vel.map((x) => x / speed);
    if (r < capture && rd < 0) return { captured: true, escaped: false, dir: v, steps: step };
    if (r > ESCAPE_R && rd > 0) return { captured: false, escaped: true, dir: v, steps: step };
    const dtau = curveStep(r) / speed;
    r += rd * dtau + 0.5 * ar * dtau * dtau;
    th += thd * dtau + 0.5 * at * dtau * dtau;
    s = Math.sin(th);
    c = Math.cos(th);
    const ar1 = accR(r);
    const at1 = accTh(s, c);
    const pd1 = phiRate(r, s);
    rd += 0.5 * (ar + ar1) * dtau;
    thd += 0.5 * (at + at1) * dtau;
    // Keep the radial speed on its potential (rd² = R): the step follows the
    // speed, so a drift would feed itself. Past a turning point (R < 0 by a
    // step's overshoot) Verlet carries on (set to 0 there, the ray stalls). Not θ: Θ cancels in float near the plane
    // and the poles (the shader showed gaps and a seam).
    const R = radialPotential(r);
    if (R > 0) rd = Math.sign(rd) * Math.sqrt(R);
    const dphi = 0.5 * (pd + pd1) * dtau;
    e = [e[0] * Math.cos(dphi) - e[1] * Math.sin(dphi), e[1] * Math.cos(dphi) + e[0] * Math.sin(dphi)];
    ar = ar1;
    at = at1;
    pd = pd1;
  }
  return { captured: false, escaped: false, dir: v, steps: maxSteps };
}
