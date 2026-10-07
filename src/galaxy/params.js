/**
 * Galaxy parameter schema: defaults, limits and clamping. UI slider ranges
 * read from LIMITS so the panel and validation never disagree.
 *
 * A galaxy entry has four groups:
 * - shape:     star populations; changes the generated geometry (rebuild)
 * - structure: density-wave arms, dust and volume; shader uniforms (cheap)
 * - look:      size, colour, tilt, position; uniforms and transforms (cheap)
 * - motion:    rotation; uniforms (cheap)
 *
 * A standalone black hole (kind 'blackhole') is an entry of the same form:
 * the four groups describe its sparse star cloud, and a fifth group, `hole`,
 * describes the hole and its accretion disc (uniforms only).
 *
 * Arms are a density wave computed in the shaders (see densityModel.js), so
 * arm count, winding and eccentricity are live uniforms, not geometry.
 */

export const MAX_PARTICLES_PER_GALAXY = 200_000;
export const MAX_GALAXIES = 10;
export const MAX_TOTAL_PARTICLES = 1_000_000;

export const LIMITS = {
  shape: {
    count: { min: 1000, max: MAX_PARTICLES_PER_GALAXY, step: 1000, int: true },
    bulgeFraction: { min: 0, max: 1, step: 0.01 },
    bulgeSize: { min: 0.02, max: 0.6, step: 0.01 },
    bulgeFlatten: { min: 0.1, max: 1, step: 0.01 },
    barLength: { min: 0, max: 0.6, step: 0.01 },
    discScale: { min: 0.12, max: 0.7, step: 0.01 },
    discThickness: { min: 0.004, max: 0.15, step: 0.001 },
    youngFraction: { min: 0, max: 0.5, step: 0.01 },
    clumps: { min: 0, max: 8, step: 1, int: true },
    haloFraction: { min: 0, max: 0.2, step: 0.005 },
    hiiAmount: { min: 0, max: 0.06, step: 0.002 },
  },
  structure: {
    arms: { min: 0, max: 6, step: 1, int: true },
    armWinding: { min: -1.5, max: 1.5, step: 0.01 },
    eccentricity: { min: 0, max: 0.35, step: 0.005 },
    armContrast: { min: 0, max: 1, step: 0.01 },
    flocculence: { min: 0, max: 1, step: 0.01 },
    dustStrength: { min: 0, max: 3, step: 0.05 },
    glow: { min: 0, max: 3, step: 0.05 },
    bulgeSersic: { min: 1, max: 6, step: 0.1 },
  },
  look: {
    radius: { min: 1, max: 30, step: 0.1 },
    starSize: { min: 0.2, max: 4, step: 0.05 },
    brightness: { min: 0.1, max: 3, step: 0.05 },
    physicalColor: { min: 0, max: 1, step: 0.01 },
    tiltX: { min: -90, max: 90, step: 1 },
    tiltZ: { min: -90, max: 90, step: 1 },
  },
  motion: {
    speed: { min: -3, max: 3, step: 0.01 },
    differential: { min: 0, max: 1, step: 0.01 },
    patternSpeed: { min: 0, max: 1, step: 0.01 },
  },
  // Standalone black hole (core/BlackHolePass.js draws it).
  hole: {
    size: { min: 0.005, max: 0.08, step: 0.001 }, // Rs as a fraction of the object radius
    discSize: { min: 8, max: 30, step: 0.5 }, // disc outer radius, in Rs
    brightness: { min: 0, max: 3, step: 0.05 },
    glow: { min: 0, max: 3, step: 0.05 }, // halo + haze
  },
};

/** Keys whose change requires regenerating the geometry. */
export const SHAPE_KEYS = Object.keys(LIMITS.shape);

export const DEFAULT_SHAPE = {
  count: 80_000,
  bulgeFraction: 0.16,
  bulgeSize: 0.09,
  bulgeFlatten: 0.7,
  barLength: 0,
  discScale: 0.3,
  discThickness: 0.022,
  youngFraction: 0.18,
  clumps: 0,
  haloFraction: 0.02,
  hiiAmount: 0.02,
};

export const DEFAULT_STRUCTURE = {
  arms: 2,
  armWinding: 0.55,
  eccentricity: 0.25,
  armContrast: 0.7,
  flocculence: 0.45,
  dustStrength: 1,
  glow: 1,
  bulgeSersic: 2.5,
};

export const DEFAULT_LOOK = {
  radius: 6,
  starSize: 1,
  brightness: 1,
  colorInner: '#ffd9a8',
  colorOuter: '#8fb0ff',
  physicalColor: 0.75,
  tiltX: 0,
  tiltZ: 0,
  position: [0, 0, 0],
};

export const DEFAULT_MOTION = {
  speed: 0.3,
  differential: 0.6,
  patternSpeed: 0.3,
};

export const DEFAULT_HOLE = {
  size: 0.03,
  discSize: 18,
  brightness: 1,
  glow: 1,
  colorHot: '#ffeac4', // inner edge (bands.js visible agnHot, as sRGB)
  colorCool: '#ffa645', // outer edge (bands.js visible agnCool)
  jets: false,
  streak: true, // horizontal lens streak
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

/** @param {Partial<typeof DEFAULT_STRUCTURE>} [structure] */
export function clampStructure(structure) {
  return clampGroup(structure, LIMITS.structure, DEFAULT_STRUCTURE);
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

/** @param {Partial<typeof DEFAULT_HOLE>} [hole] */
export function clampHole(hole) {
  const out = clampGroup(hole, LIMITS.hole, DEFAULT_HOLE);
  const src = hole && typeof hole === 'object' ? hole : {};
  out.colorHot = HEX_COLOR.test(src.colorHot) ? src.colorHot : DEFAULT_HOLE.colorHot;
  out.colorCool = HEX_COLOR.test(src.colorCool) ? src.colorCool : DEFAULT_HOLE.colorCool;
  out.jets = typeof src.jets === 'boolean' ? src.jets : DEFAULT_HOLE.jets;
  out.streak = typeof src.streak === 'boolean' ? src.streak : DEFAULT_HOLE.streak;
  return out;
}

/** Brightness multipliers for selection emphasis (replaces a highlight ring). */
export const EMPHASIS_SELECTED = 1.15;
export const EMPHASIS_OTHERS = 0.75;
