import { DEFAULT_SHAPE, DEFAULT_LOOK, DEFAULT_MOTION } from './params.js';

/**
 * Starting points for new galaxies. Each preset is complete, so a new galaxy
 * never depends on whatever defaults happen to be.
 */
export const PRESETS = {
  spiral: {
    label: 'Spiral',
    shape: { ...DEFAULT_SHAPE },
    look: { ...DEFAULT_LOOK, colorInner: '#ffcf8a', colorOuter: '#4f7dff' },
    motion: { ...DEFAULT_MOTION },
  },
  barred: {
    label: 'Barred spiral',
    shape: {
      ...DEFAULT_SHAPE,
      arms: 2,
      spin: 0.7,
      armSpread: 0.18,
      barLength: 0.3,
      bulgeFraction: 0.14,
      bulgeSize: 0.08,
    },
    look: { ...DEFAULT_LOOK, colorInner: '#ffd7a8', colorOuter: '#6aa0ff' },
    motion: { ...DEFAULT_MOTION },
  },
  elliptical: {
    label: 'Elliptical',
    shape: {
      ...DEFAULT_SHAPE,
      count: 60_000,
      arms: 0,
      spin: 0,
      armSpread: 0,
      armContrast: 0,
      bulgeFraction: 0.92,
      bulgeSize: 0.3,
      bulgeFlatten: 0.65,
      thickness: 0.06,
      haloFraction: 0.06,
    },
    look: { ...DEFAULT_LOOK, colorInner: '#ffe3b3', colorOuter: '#ff9f6b', starSize: 0.9 },
    motion: { ...DEFAULT_MOTION, speed: 0.12 },
  },
  irregular: {
    label: 'Irregular',
    shape: {
      ...DEFAULT_SHAPE,
      count: 50_000,
      arms: 2,
      spin: 0.4,
      armSpread: 0.8,
      randomnessPower: 1.6,
      armContrast: 0.25,
      bulgeFraction: 0.05,
      bulgeSize: 0.15,
      thickness: 0.08,
      clumps: 5,
    },
    look: { ...DEFAULT_LOOK, colorInner: '#fff1dd', colorOuter: '#7fb8ff', radius: 4 },
    motion: { ...DEFAULT_MOTION, speed: 0.2 },
  },
};

export const PRESET_NAMES = Object.keys(PRESETS);
