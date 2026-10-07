import { DEFAULT_SHAPE, DEFAULT_STRUCTURE, DEFAULT_LOOK, DEFAULT_MOTION, DEFAULT_HOLE } from './params.js';

/**
 * Starting points for new galaxies. Each preset is complete, so a new galaxy
 * never depends on whatever defaults happen to be. Values are tuned by eye
 * against reference photos of the named galaxies.
 */
export const PRESETS = {
  // Grand-design two-arm spiral (M51 / M101 face-on look).
  spiral: {
    label: 'Spiral',
    shape: { ...DEFAULT_SHAPE },
    structure: { ...DEFAULT_STRUCTURE },
    look: { ...DEFAULT_LOOK },
    motion: { ...DEFAULT_MOTION },
  },
  // Strong bar with arms from its ends (NGC 1300).
  barred: {
    label: 'Barred spiral',
    shape: { ...DEFAULT_SHAPE, barLength: 0.3, bulgeFraction: 0.12, bulgeSize: 0.07, discScale: 0.34 },
    structure: { ...DEFAULT_STRUCTURE, armWinding: 0.42, eccentricity: 0.24, armContrast: 0.8, flocculence: 0.35 },
    look: { ...DEFAULT_LOOK, colorInner: '#ffdcb0', colorOuter: '#9ab8ff' },
    motion: { ...DEFAULT_MOTION, patternSpeed: 0.35 },
  },
  // Smooth, old, dust-free ellipsoid (M87).
  elliptical: {
    label: 'Elliptical',
    shape: {
      ...DEFAULT_SHAPE,
      count: 50_000,
      bulgeFraction: 0.94,
      bulgeSize: 0.28,
      bulgeFlatten: 0.7,
      youngFraction: 0,
      haloFraction: 0.05,
      hiiAmount: 0,
    },
    structure: { ...DEFAULT_STRUCTURE, arms: 0, eccentricity: 0, armContrast: 0, flocculence: 0.1, dustStrength: 0, glow: 1.2, bulgeSersic: 4 },
    look: { ...DEFAULT_LOOK, colorInner: '#ffe2b8', colorOuter: '#ffc28f', physicalColor: 0.85 },
    motion: { ...DEFAULT_MOTION, speed: 0.1, differential: 0.2 },
  },
  // Clumpy, gas-rich, no clear arms (Large Magellanic Cloud).
  irregular: {
    label: 'Irregular',
    shape: {
      ...DEFAULT_SHAPE,
      count: 50_000,
      bulgeFraction: 0.04,
      bulgeSize: 0.12,
      barLength: 0.18,
      discScale: 0.4,
      discThickness: 0.05,
      youngFraction: 0.3,
      clumps: 5,
      hiiAmount: 0.04,
    },
    structure: { ...DEFAULT_STRUCTURE, arms: 1, armWinding: 0.3, eccentricity: 0.12, armContrast: 0.35, flocculence: 0.9, dustStrength: 0.6, glow: 0.8 },
    look: { ...DEFAULT_LOOK, radius: 4, colorInner: '#fff0dc', colorOuter: '#a8c8ff' },
    motion: { ...DEFAULT_MOTION, speed: 0.2 },
  },
};

export const PRESET_NAMES = Object.keys(PRESETS);

/**
 * A standalone black hole: the hole and its disc, in a sparse, round cloud of
 * old stars (an elliptical's star population with no diffuse glow), so the
 * lens has something near it to bend. `preset` is the star population.
 */
export const BLACK_HOLE_TEMPLATE = {
  label: 'Black hole',
  preset: 'elliptical',
  shape: {
    ...PRESETS.elliptical.shape,
    count: 6000,
    bulgeFraction: 0.85,
    bulgeSize: 0.45,
    bulgeFlatten: 1,
    haloFraction: 0.15,
  },
  structure: { ...PRESETS.elliptical.structure, glow: 0, bulgeSersic: 1 },
  look: { ...PRESETS.elliptical.look, radius: 4 },
  motion: { ...PRESETS.elliptical.motion, speed: 0.05 },
  hole: { ...DEFAULT_HOLE },
};
