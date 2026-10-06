import { createRandom } from './random.js';
import { clampShape } from './params.js';
import { sersic } from './densityModel.js';

/**
 * Star populations. The kind is stored in aOrbit.w and selects how the
 * vertex shader moves the star (see shaders/chunks/stars.glsl).
 */
export const KIND = { DISC: 0, BULGE: 1, HALO: 2, BAR: 3 };

const DISC_MAX = 1.15;
const HALO_RADIUS = 1.4;
const BULGE_SERSIC_N = 2.5;
const BAR_WIDTH = 0.035;
const CLUMP_SHARE = 0.3;
const CLUMP_SD = 0.06;
const SECH2_CLAMP = 4;
const BULGE_CDF_STEPS = 256;

/**
 * Generate star data for one galaxy in UNIT space (disc radius ≈ 1, y up).
 *
 * Disc stars are not positions but orbital elements; the shader moves them
 * along density-wave orbits. Every star has:
 *   orbit = (a, θ0, z, kind)  — for BAR stars: (x along bar, lateral offset, z, kind)
 *   star  = (temperature K, size, youth 0|1)
 * `positions` is a rough initial layout, only used for bounds.
 *
 * Pure and deterministic: same (shape, seed) → identical arrays.
 *
 * @param {Partial<import('./params.js').DEFAULT_SHAPE>} shapeInput
 * @param {number} seed
 */
export function generateGalaxy(shapeInput, seed) {
  const shape = clampShape(shapeInput);
  const rng = createRandom(seed);
  const n = shape.count;

  const orbit = new Float32Array(n * 4);
  const star = new Float32Array(n * 3);
  const positions = new Float32Array(n * 3);
  const stats = { disc: 0, bulge: 0, halo: 0, bar: 0, young: 0, clump: 0 };

  const bulgeCdf = buildBulgeCdf(shape.bulgeSize);
  const clumps = Array.from({ length: shape.clumps }, () => ({
    a: rng.range(0.2, 0.75),
    theta: rng.range(0, Math.PI * 2),
  }));
  const barShare = shape.barLength > 0 ? Math.min(0.2, shape.barLength * 0.45) : 0;

  for (let i = 0; i < n; i++) {
    const pick = rng.next();
    let kind;
    let a;
    let theta0;
    let z;
    let temp;
    let size;
    let youth = 0;

    if (pick < shape.bulgeFraction) {
      kind = KIND.BULGE;
      const r = sampleCdf(bulgeCdf, rng.next());
      const dir = randomDirection(rng);
      const x = r * dir[0];
      const w = r * dir[2];
      a = Math.hypot(x, w);
      theta0 = Math.atan2(w, x);
      z = r * dir[1] * shape.bulgeFlatten;
      temp = 3000 + 2200 * Math.pow(rng.next(), 1.5); // old, cool
      size = 0.45 + 1.6 * Math.pow(rng.next(), 8);
      stats.bulge++;
    } else if (pick < shape.bulgeFraction + shape.haloFraction) {
      kind = KIND.HALO;
      const dir = randomDirection(rng);
      const r = HALO_RADIUS * Math.cbrt(rng.next());
      a = r * Math.hypot(dir[0], dir[2]);
      theta0 = Math.atan2(dir[2], dir[0]);
      z = r * dir[1] * 0.6;
      temp = 3000 + 2000 * rng.next();
      size = 0.4 + 0.9 * Math.pow(rng.next(), 6);
      stats.halo++;
    } else if (rng.next() < barShare) {
      kind = KIND.BAR;
      // Bar: dense along its axis, thinning toward the ends.
      a = shape.barLength * rng.sign() * Math.pow(rng.next(), 0.8);
      theta0 = rng.gaussian(0, BAR_WIDTH);
      z = rng.gaussian(0, shape.discThickness * 0.8);
      temp = 3200 + 2400 * rng.next();
      size = 0.45 + 1.5 * Math.pow(rng.next(), 8);
      stats.bar++;
    } else {
      kind = KIND.DISC;
      if (clumps.length > 0 && rng.next() < CLUMP_SHARE) {
        const c = clumps[Math.floor(rng.next() * clumps.length)];
        const x = c.a * Math.cos(c.theta) + rng.gaussian(0, CLUMP_SD);
        const w = c.a * Math.sin(c.theta) + rng.gaussian(0, CLUMP_SD);
        a = Math.min(DISC_MAX, Math.hypot(x, w));
        theta0 = Math.atan2(w, x);
        stats.clump++;
      } else {
        // Truncated exponential disc, starting near the bar ends.
        const t = truncatedExponential(rng.next(), shape.discScale, DISC_MAX);
        a = Math.min(DISC_MAX, shape.barLength * 0.8 + t);
        theta0 = rng.range(0, Math.PI * 2);
      }
      // sech² vertical profile, flaring slightly outward.
      const z0 = shape.discThickness * (1 + 0.6 * a);
      z = z0 * Math.atanh(Math.max(-0.9993, Math.min(0.9993, 2 * rng.next() - 1)));
      z = Math.max(-SECH2_CLAMP * z0, Math.min(SECH2_CLAMP * z0, z));

      if (rng.next() < shape.youngFraction) {
        youth = 1;
        temp = 9000 + 19000 * Math.pow(rng.next(), 2); // hot O/B stars
        size = 0.9 + 2.2 * Math.pow(rng.next(), 4);
        stats.young++;
      } else {
        temp = 3200 + 3800 * Math.pow(rng.next(), 2);
        size = 0.45 + 1.8 * Math.pow(rng.next(), 8);
      }
      stats.disc++;
    }

    const i4 = i * 4;
    orbit[i4] = a;
    orbit[i4 + 1] = theta0;
    orbit[i4 + 2] = z;
    orbit[i4 + 3] = kind;
    const i3 = i * 3;
    star[i3] = temp;
    star[i3 + 1] = size;
    star[i3 + 2] = youth;
    if (kind === KIND.BAR) {
      positions[i3] = a;
      positions[i3 + 1] = z;
      positions[i3 + 2] = theta0;
    } else {
      positions[i3] = a * Math.cos(theta0);
      positions[i3 + 1] = z;
      positions[i3 + 2] = a * Math.sin(theta0);
    }
  }

  const hii = generateHii(rng, shape);
  return { count: n, orbit, star, positions, stats, hii };
}

/**
 * H II regions: star-forming nebulae. Their visibility depends on arm-crest
 * proximity in the shader, so they light up only inside the arms.
 */
function generateHii(rng, shape) {
  const n = Math.round(shape.count * shape.hiiAmount);
  const orbit = new Float32Array(n * 4);
  const size = new Float32Array(n);
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = truncatedExponential(rng.next(), shape.discScale * 1.2, DISC_MAX);
    const a = Math.min(DISC_MAX, shape.barLength * 0.8 + t);
    const theta0 = rng.range(0, Math.PI * 2);
    const z = rng.gaussian(0, shape.discThickness * 0.5);
    orbit.set([a, theta0, z, KIND.DISC], i * 4);
    size[i] = 0.5 + Math.pow(rng.next(), 3);
    positions.set([a * Math.cos(theta0), z, a * Math.sin(theta0)], i * 3);
  }
  return { count: n, orbit, size, positions };
}

/** Inverse CDF of a truncated exponential with scale h on [0, max]. */
function truncatedExponential(u, h, max) {
  return -h * Math.log(1 - u * (1 - Math.exp(-max / h)));
}

/**
 * Tabulated CDF of a 3D Sérsic bulge: radial density ∝ r² · sersic(r).
 * Sampling the table keeps the generator exact and fast.
 */
function buildBulgeCdf(re) {
  const rMax = Math.min(1, re * 8);
  const cdf = new Float64Array(BULGE_CDF_STEPS + 1);
  for (let i = 1; i <= BULGE_CDF_STEPS; i++) {
    const r = (i / BULGE_CDF_STEPS) * rMax;
    cdf[i] = cdf[i - 1] + r * r * sersic(r, re, BULGE_SERSIC_N);
  }
  const total = cdf[BULGE_CDF_STEPS];
  for (let i = 0; i <= BULGE_CDF_STEPS; i++) cdf[i] /= total;
  return { cdf, rMax };
}

function sampleCdf({ cdf, rMax }, u) {
  let lo = 0;
  let hi = cdf.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] < u) lo = mid;
    else hi = mid;
  }
  const span = cdf[hi] - cdf[lo] || 1;
  const t = (u - cdf[lo]) / span;
  return ((lo + t) / (cdf.length - 1)) * rMax;
}

function randomDirection(rng) {
  const u = rng.range(-1, 1);
  const phi = rng.range(0, Math.PI * 2);
  const s = Math.sqrt(1 - u * u);
  return [s * Math.cos(phi), u, s * Math.sin(phi)];
}
