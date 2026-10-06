/**
 * Galaxy parameter schema: defaults, limits and clamping. UI slider ranges
 * read from LIMITS so the panel and validation never disagree.
 *
 * A galaxy entry has three groups:
 * - shape:  changes the generated geometry (rebuild)
 * - look:   uniforms and transforms only (cheap)
 * - motion: rotation uniforms (cheap)
 */

export const MAX_PARTICLES_PER_GALAXY = 200_000;
export const MAX_GALAXIES = 10;
export const MAX_TOTAL_PARTICLES = 1_000_000;

export const LIMITS = {
  shape: {
    count: { min: 1000, max: MAX_PARTICLES_PER_GALAXY, step: 1000, int: true },
    arms: { min: 0, max: 8, step: 1, int: true },
    spin: { min: -2, max: 2, step: 0.01 },
    armSpread: { min: 0, max: 1, step: 0.01 },
    randomnessPower: { min: 1, max: 6, step: 0.1 },
    armContrast: { min: 0, max: 1, step: 0.01 },
    bulgeFraction: { min: 0, max: 1, step: 0.01 },
    bulgeSize: { min: 0.02, max: 0.6, step: 0.01 },
    bulgeFlatten: { min: 0.1, max: 1, step: 0.01 },
    barLength: { min: 0, max: 0.6, step: 0.01 },
    thickness: { min: 0, max: 0.2, step: 0.005 },
    clumps: { min: 0, max: 8, step: 1, int: true },
    haloFraction: { min: 0, max: 0.2, step: 0.005 },
    dustAmount: { min: 0, max: 0.3, step: 0.01 },
  },
  look: {
    radius: { min: 1, max: 30, step: 0.1 },
    starSize: { min: 0.2, max: 4, step: 0.05 },
    brightness: { min: 0.1, max: 3, step: 0.05 },
    tiltX: { min: -90, max: 90, step: 1 },
    tiltZ: { min: -90, max: 90, step: 1 },
  },
  motion: {
    speed: { min: -3, max: 3, step: 0.01 },
    differential: { min: 0, max: 1, step: 0.01 },
  },
};

/** Keys whose change requires regenerating the geometry. */
export const SHAPE_KEYS = Object.keys(LIMITS.shape);

export const DEFAULT_SHAPE = {
  count: 80_000,
  arms: 2,
  spin: 1.15,
  armSpread: 0.22,
  randomnessPower: 2.8,
  armContrast: 0.8,
  bulgeFraction: 0.18,
  bulgeSize: 0.1,
  bulgeFlatten: 0.6,
  barLength: 0,
  thickness: 0.035,
  clumps: 0,
  haloFraction: 0.02,
  dustAmount: 0.12,
};

export const DEFAULT_LOOK = {
  radius: 6,
  starSize: 1,
  brightness: 1,
  colorInner: '#ffcf8a',
  colorOuter: '#4f7dff',
  tiltX: 0,
  tiltZ: 0,
  position: [0, 0, 0],
};

export const DEFAULT_MOTION = {
  speed: 0.3,
  differential: 0.25,
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function clampNumber(value, limit, fallback) {
  const n = Number(value);
  if (value === null || value === '' || !Number.isFinite(n)) return fallback;
  const clamped = Math.min(limit.max, Math.max(limit.min, n));
  return limit.int ? Math.round(clamped) : clamped;
}

function clampGroup(input, limits, defaults) {
  const out = { ...defaults };
  const src = input && typeof input === 'object' ? input : {};
  for (const key of Object.keys(limits)) {
    out[key] = clampNumber(src[key], limits[key], defaults[key]);
  }
  return out;
}

/** @param {Partial<typeof DEFAULT_SHAPE>} [shape] */
export function clampShape(shape) {
  return clampGroup(shape, LIMITS.shape, DEFAULT_SHAPE);
}

/** @param {Partial<typeof DEFAULT_LOOK>} [look] */
export function clampLook(look) {
  const out = clampGroup(look, LIMITS.look, DEFAULT_LOOK);
  const src = look && typeof look === 'object' ? look : {};
  out.colorInner = HEX_COLOR.test(src.colorInner) ? src.colorInner : DEFAULT_LOOK.colorInner;
  out.colorOuter = HEX_COLOR.test(src.colorOuter) ? src.colorOuter : DEFAULT_LOOK.colorOuter;
  const pos = Array.isArray(src.position) ? src.position : DEFAULT_LOOK.position;
  out.position = [0, 1, 2].map((i) => (Number.isFinite(Number(pos[i])) ? Number(pos[i]) : 0));
  return out;
}

/** @param {Partial<typeof DEFAULT_MOTION>} [motion] */
export function clampMotion(motion) {
  return clampGroup(motion, LIMITS.motion, DEFAULT_MOTION);
}

/** Brightness multipliers for selection emphasis (replaces a highlight ring). */
export const EMPHASIS_SELECTED = 1.15;
export const EMPHASIS_OTHERS = 0.75;
