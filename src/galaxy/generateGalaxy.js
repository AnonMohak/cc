import { createRandom } from './random.js';
import { clampShape } from './params.js';

// Exponential disc scale length (fraction of the radius). Real discs fall
// off roughly as e^(-r/h); 0.45 keeps enough stars in the outer arms.
const DISC_SCALE = 0.45;
const EXP_TRUNC = 1 - Math.exp(-1 / DISC_SCALE);
const CLUMP_SHARE = 0.3;
const CLUMP_SD = 0.07;
const BAR_WIDTH_SD = 0.035;
const HALO_RADIUS = 1.4;

export const COMPONENT = { BULGE: 0, DISC: 1, HALO: 2, BAR: 3, CLUMP: 4 };

/**
 * Generate star data for one galaxy in a UNIT disc (radius 1, y up).
 * The renderer scales the result by the galaxy radius.
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

  const positions = new Float32Array(n * 3);
  const radiusNorm = new Float32Array(n);
  const colorJitter = new Float32Array(n);
  const sizes = new Float32Array(n);
  const components = new Uint8Array(n);
  const stats = { bulge: 0, disc: 0, halo: 0, bar: 0, clump: 0 };

  const clumpCenters = [];
  for (let c = 0; c < shape.clumps; c++) {
    const r = rng.range(0.2, 0.8);
    const a = rng.range(0, Math.PI * 2);
    clumpCenters.push([r * Math.cos(a), r * Math.sin(a)]);
  }

  const barShare = shape.barLength > 0 ? Math.min(0.25, shape.barLength * 0.5) : 0;
  const armStart = shape.barLength;
  const p = [0, 0, 0];

  for (let i = 0; i < n; i++) {
    const pick = rng.next();
    let component;
    let jitter = rng.range(-0.3, 0.3);
    let size = 0.6 + 2.4 * Math.pow(rng.next(), 6);

    if (pick < shape.bulgeFraction) {
      component = COMPONENT.BULGE;
      sampleBulge(rng, shape, p);
      jitter -= 0.4; // old, red population
    } else if (pick < shape.bulgeFraction + shape.haloFraction) {
      component = COMPONENT.HALO;
      sampleHalo(rng, p);
      jitter -= 0.2;
      size *= 0.8;
    } else {
      const sub = rng.next();
      if (sub < barShare) {
        component = COMPONENT.BAR;
        sampleBar(rng, shape, p);
        jitter -= 0.25;
      } else if (clumpCenters.length > 0 && sub < barShare + CLUMP_SHARE) {
        component = COMPONENT.CLUMP;
        sampleClump(rng, shape, clumpCenters, p);
        jitter += 0.5; // star-forming regions are young and blue
        size *= 1.3;
      } else {
        component = COMPONENT.DISC;
        jitter += sampleDisc(rng, shape, armStart, p);
      }
    }

    const i3 = i * 3;
    positions[i3] = p[0];
    positions[i3 + 1] = p[1];
    positions[i3 + 2] = p[2];
    radiusNorm[i] = Math.min(1, Math.hypot(p[0], p[1], p[2]));
    colorJitter[i] = Math.max(-1, Math.min(1, jitter));
    sizes[i] = size;
    components[i] = component;
    stats[COMPONENT_NAMES[component]]++;
  }

  return { count: n, positions, radiusNorm, colorJitter, sizes, components, stats };
}

const COMPONENT_NAMES = ['bulge', 'disc', 'halo', 'bar', 'clump'];

function sampleBulge(rng, shape, out) {
  const s = shape.bulgeSize;
  out[0] = rng.gaussian(0, s);
  out[1] = rng.gaussian(0, s * shape.bulgeFlatten);
  out[2] = rng.gaussian(0, s);
  limitLength(rng, out, 1);
}

function sampleHalo(rng, out) {
  // Uniform direction, radius biased outward.
  const u = rng.range(-1, 1);
  const theta = rng.range(0, Math.PI * 2);
  const s = Math.sqrt(1 - u * u);
  const r = HALO_RADIUS * Math.cbrt(rng.next());
  out[0] = r * s * Math.cos(theta);
  out[1] = r * u * 0.6;
  out[2] = r * s * Math.sin(theta);
}

function sampleBar(rng, shape, out) {
  out[0] = rng.range(-shape.barLength, shape.barLength);
  out[1] = rng.gaussian(0, shape.thickness * 0.8);
  out[2] = rng.gaussian(0, BAR_WIDTH_SD);
}

function sampleClump(rng, shape, centers, out) {
  const c = centers[Math.floor(rng.next() * centers.length)];
  out[0] = c[0] + rng.gaussian(0, CLUMP_SD);
  out[1] = rng.gaussian(0, shape.thickness);
  out[2] = c[1] + rng.gaussian(0, CLUMP_SD);
  limitPlanar(rng, out, 1);
}

/**
 * Disc star, either on an arm or in the inter-arm field.
 * @returns {number} color jitter bias (arm centre lines are young and blue)
 */
function sampleDisc(rng, shape, armStart, out) {
  // Truncated exponential radius in [0, 1], then mapped outside the bar.
  const t = -DISC_SCALE * Math.log(1 - rng.next() * EXP_TRUNC);
  const r = armStart + (1 - armStart) * t;
  const onArm = shape.arms > 0 && rng.next() < shape.armContrast;

  let angle;
  let bias = 0;
  if (onArm) {
    const branch = (Math.floor(rng.next() * shape.arms) / shape.arms) * Math.PI * 2;
    angle = branch + shape.spin * Math.PI * 2 * (r - armStart);
  } else {
    angle = rng.range(0, Math.PI * 2);
  }

  out[0] = r * Math.cos(angle);
  out[2] = r * Math.sin(angle);
  out[1] = rng.gaussian(0, shape.thickness * (1 - 0.6 * r));

  if (onArm) {
    // pow(u, power) packs most stars close to the arm centre line.
    const spread = shape.armSpread * (0.45 + 0.55 * r);
    const dx = Math.pow(rng.next(), shape.randomnessPower) * rng.sign() * spread;
    const dz = Math.pow(rng.next(), shape.randomnessPower) * rng.sign() * spread;
    out[0] += dx;
    out[2] += dz;
    const offCentre = shape.armSpread > 0 ? Math.hypot(dx, dz) / (spread * Math.SQRT2 + 1e-6) : 0;
    bias = 0.4 * (1 - offCentre);
  }
  limitPlanar(rng, out, 1 + shape.armSpread);
  return bias;
}

// Pull rare far outliers back inside the limit instead of dropping them,
// so the star count stays exact.
function limitLength(rng, out, max) {
  const len = Math.hypot(out[0], out[1], out[2]);
  if (len > max) {
    const k = (max * rng.next()) / len;
    out[0] *= k;
    out[1] *= k;
    out[2] *= k;
  }
}

function limitPlanar(rng, out, max) {
  const len = Math.hypot(out[0], out[2]);
  if (len > max) {
    const k = (max * (0.9 + 0.1 * rng.next())) / len;
    out[0] *= k;
    out[2] *= k;
  }
}
