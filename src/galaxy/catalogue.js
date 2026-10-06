import { PRESETS } from './presets.js';
import { CAMERA_HOME } from '../core/createCamera.js';

/**
 * Real galaxies as starting points. Facts are rounded, widely cited values
 * (NASA / ESA public pages); distances and sizes vary between sources.
 *
 * `inclination` (degrees from face-on) is the angle between the disc normal
 * and the HOME view direction, so each galaxy looks right from the default
 * camera (and when focused, see catalogueViewDirection). Scene radius
 * follows the real diameter (see radiusForDiameter), so sizes are roughly
 * comparable; the smallest galaxies are enlarged to stay visible.
 */
export const CATALOGUE = {
  m31: {
    name: 'Andromeda (M31)',
    preset: 'spiral',
    type: 'SA(s)b spiral',
    distanceLy: 2.5e6,
    diameterLy: 152_000,
    constellation: 'Andromeda',
    inclination: 77,
    fact: 'The nearest large galaxy. It is approaching the Milky Way and the two are expected to merge in about 4–5 billion years.',
    shape: { count: 120_000, bulgeFraction: 0.24, bulgeSize: 0.11, discScale: 0.34, youngFraction: 0.12 },
    structure: { armWinding: 0.75, eccentricity: 0.18, armContrast: 0.55, flocculence: 0.6, dustStrength: 1.4 },
    look: { colorInner: '#ffd6a0', colorOuter: '#a9bfff' },
  },
  m51: {
    name: 'Whirlpool (M51)',
    preset: 'spiral',
    type: 'SA(s)bc grand-design spiral',
    distanceLy: 31e6,
    diameterLy: 76_000,
    constellation: 'Canes Venatici',
    inclination: 22,
    fact: 'A textbook grand-design spiral. Its tidal interaction with the small companion NGC 5195 is thought to sharpen its two arms.',
    shape: { bulgeFraction: 0.12, bulgeSize: 0.08, youngFraction: 0.24, hiiAmount: 0.035 },
    structure: { armWinding: 0.5, eccentricity: 0.28, armContrast: 0.85, flocculence: 0.35, dustStrength: 1.2 },
    look: {},
  },
  m101: {
    name: 'Pinwheel (M101)',
    preset: 'spiral',
    type: 'SAB(rs)cd spiral',
    distanceLy: 21e6,
    diameterLy: 170_000,
    constellation: 'Ursa Major',
    inclination: 18,
    fact: 'Seen almost face-on, it is lopsided and rich in giant star-forming H II regions — over 3,000 have been catalogued.',
    shape: { count: 110_000, bulgeFraction: 0.06, bulgeSize: 0.06, discScale: 0.42, youngFraction: 0.3, hiiAmount: 0.05, clumps: 3 },
    structure: { arms: 4, armWinding: 0.45, eccentricity: 0.2, armContrast: 0.6, flocculence: 0.7, dustStrength: 0.8 },
    look: { colorOuter: '#9cb8ff' },
  },
  m104: {
    name: 'Sombrero (M104)',
    preset: 'spiral',
    type: 'SA(s)a spiral',
    distanceLy: 28e6,
    diameterLy: 50_000,
    constellation: 'Virgo',
    inclination: 84,
    fact: 'Almost edge-on: a huge bright bulge cut by a thick, sharp dust lane that gives it the look of a hat.',
    shape: { bulgeFraction: 0.45, bulgeSize: 0.2, bulgeFlatten: 0.75, discScale: 0.45, discThickness: 0.03, youngFraction: 0.06, hiiAmount: 0.005 },
    structure: { armWinding: 0.9, eccentricity: 0.1, armContrast: 0.3, flocculence: 0.3, dustStrength: 2.4, glow: 1.2, bulgeSersic: 3.5 },
    look: { colorInner: '#ffd9a8', colorOuter: '#ffe2c0' },
  },
  m87: {
    name: 'Virgo A (M87)',
    preset: 'elliptical',
    type: 'E0–1 giant elliptical',
    distanceLy: 53e6,
    diameterLy: 120_000,
    constellation: 'Virgo',
    inclination: 0,
    fact: 'Home of the first black hole ever imaged (Event Horizon Telescope, 2019), which launches a jet thousands of light-years long.',
    shape: { bulgeFlatten: 0.9, bulgeSize: 0.3 },
    structure: { bulgeSersic: 4.5 },
    look: {},
  },
  lmc: {
    name: 'Large Magellanic Cloud',
    preset: 'irregular',
    type: 'SB(s)m Magellanic irregular',
    distanceLy: 160_000,
    diameterLy: 14_000,
    constellation: 'Dorado / Mensa',
    inclination: 35,
    fact: 'A satellite of the Milky Way. It hosts the Tarantula Nebula (30 Doradus), the most active star-forming region in the Local Group.',
    shape: { clumps: 4, hiiAmount: 0.05 },
    structure: {},
    look: {},
  },
};

export const CATALOGUE_IDS = Object.keys(CATALOGUE);

// Scene radius per light-year of real DIAMETER (M31 → ~8.4 units).
const LY_PER_UNIT = 18_000;
const MIN_RADIUS = 2.5;
const MAX_RADIUS = 12;

/**
 * Light-years per world unit, consistent with radiusForDiameter: a galaxy of
 * radius r units spans 2r units ≈ LY_PER_UNIT · r light-years.
 */
export const LY_PER_WORLD_UNIT = LY_PER_UNIT / 2;

/** Scene radius for a real diameter, clamped so small galaxies stay visible. */
export function radiusForDiameter(diameterLy) {
  return Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, diameterLy / LY_PER_UNIT));
}

/** Full galaxy params (shape, structure, look, motion) for a catalogue entry. */
export function catalogueParams(id) {
  const entry = CATALOGUE[id];
  if (!entry) return null;
  const base = PRESETS[entry.preset];
  return {
    preset: entry.preset,
    shape: { ...base.shape, ...entry.shape },
    structure: { ...base.structure, ...entry.structure },
    look: {
      ...base.look,
      ...entry.look,
      radius: radiusForDiameter(entry.diameterLy),
      tiltX: tiltForInclination(entry.inclination),
    },
    motion: { ...base.motion },
  };
}

/**
 * Elevation of the home view direction above the galactic plane, as a tiltX
 * angle (degrees): tilting a disc by this much makes it face the home camera.
 */
export const HOME_VIEW_TILT = (() => {
  const v = CAMERA_HOME.position.clone().sub(CAMERA_HOME.target).normalize();
  return (Math.atan2(v.z, v.y) * 180) / Math.PI;
})();

/** tiltX that shows a disc at `inclination` degrees from the home view. */
export function tiltForInclination(inclination) {
  return Math.round(HOME_VIEW_TILT - inclination);
}

/** Unit view direction (from galaxy toward camera) that shows the true inclination. */
export function catalogueViewDirection() {
  return CAMERA_HOME.position.clone().sub(CAMERA_HOME.target).normalize();
}

/** Human-readable distance, e.g. "2.5 million ly" or "160,000 ly". */
export function formatLightYears(ly) {
  if (ly >= 1e6) return `${Number((ly / 1e6).toPrecision(3))} million ly`;
  return `${Math.round(ly).toLocaleString('en-US')} ly`;
}
