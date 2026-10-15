/**
 * The intro's look constants, in one place, as live uniforms (the ?tune view
 * changes them while the cinematic plays). Keys are the GLSL names. Numbers
 * have slider limits; arrays are linear RGB colours. Pure.
 */

import { filmColour, DISC_K } from './filmColour.js';

const DISC_COLOUR = filmColour(DISC_K).map((v) => Math.round(v * 1000) / 1000);

/** The disc ray march (gargantuaShader.js marchShader). */
export const MARCH_LOOK = {
  // Optical depth across the full thickness of dense gas: marginally thick.
  TAU: 5,
  // Light of the hot midplane, and the share of the smoke lit by it.
  EMIT: 14,
  // How fast the gas's own light falls off with radius (r^-EMIT_POWER).
  EMIT_POWER: 2.2,
  // How fast the gas's own light fades with height (× (z / H)²): lower, the
  // cloud tops glow too (the film's flames).
  EMIT_DEPTH: 0.4,
  ALBEDO: 0.6,
  // Noise frequencies: many streaks across the radius, few long arcs around.
  RAD_FREQ: 10,
  ANG_TILES: 7, // per turn: an integer, so the angle wraps without a seam
  VERT_FREQ: 0.3,
  // Shutter (s): the motion blur's length. Longer than a film camera's 1/48 s:
  // the film's ship moved much faster than this camera does. One random
  // moment per pixel per frame, so a long shutter turns grainy (1–2 s is
  // noisy at our frame rates); 0.25 s shows the blur with little grain.
  SHUTTER_S: 0.25,
  // Domain warp (texture units): breaks the even rings into clumps.
  WARP: 1.6,
  // Flame tongues: how much of the ridged, orbit-stretched layer goes into
  // the clouds, its radial frequency and its whole tiles around the turn
  // (× ANG_TILES); and thin wisps above the cloud tops.
  FLAME: 1,
  FLAME_RAD: 16,
  FLAME_ANG: 2,
  WISP: 0.25,
  // Near the hole (camera key sparse) the gas keeps only clumps where the
  // cloud field passes this level (higher: fewer, smaller clumps).
  // Dark gaps between the flame tongues (0: none).
  FLAME_DARK: 1,
  CLUMP_LO: 0.6,
  // Their size: noise cells per log radius and whole tiles per turn (few
  // and large: the lensed images squeeze a whole ring of the disc into a
  // thin band, where many small clumps would average into a smooth glow).
  CLUMP_RAD: 3,
  CLUMP_TILES: 5,
  // Their height in half-thicknesses (1: as thin as the disc).
  CLUMP_HEIGHT: 1,
  // Close-up detail: the weight of a finer octave (faded with distance).
  // 0 skips it: at the half-resolution march it does not show (gargantuaShader.js).
  DETAIL: 0,
  // The thin bright midplane sheet (added where a ray crosses the plane):
  // optical depth across it, its glow (× EMIT) and how fast that falls off.
  SHEET_TAU: 1.5,
  SHEET_GLOW: 1.5,
  SHEET_POWER: 1.2,
  // In the gap views (camera key sparse) only a band of the sheet glows:
  // where it starts (Rs), its soft edge (Rs) and width (Rs), broken into
  // clumps along the orbit (whole noise tiles per turn; the share of the
  // noise above RIM_CLUMP_LO glows) of thin parallel filaments.
  SHEET_RIM: 4.6,
  SHEET_RIM_W: 0.1,
  RIM_BAND: 0.6,
  RIM_STRIPES: 4,
  RIM_CLUMPS: 6,
  RIM_CLUMP_LO: 0.55,
  // Haze around the hole (lit by the disc, collected by every ray): its
  // light per Rs at the inner edge, scale height (Rs) and colour.
  HAZE: 0,
  HAZE_HEIGHT: 2,
  HAZE_COL: [0.42, 0.58, 0.95],
  // Self-shadowing: the height (half-thicknesses) the inner disc's light runs
  // out at, how strongly the gas on the way blocks it, and its strength.
  LIGHT_HEIGHT: 1.6,
  LIGHT_K: 0.1,
  LIGHT_GAIN: 2.5,
  // Extra extinction of the upper smoke layers (× at the cloud tops).
  SMOKE_K: 1,
  // The gas colour: 4500 K black body through the camera film, as the film
  // did it (filmColour.js); one temperature, so the outer gas and the hot
  // inner gas share it (the inner disc looks white-hot from exposure alone).
  // The smoke is lit by the same light from below and a little cool by the sky.
  GAS_WARM: DISC_COLOUR,
  GAS_HOT: DISC_COLOUR,
  SMOKE_COOL: [0.06, 0.07, 0.09],
};

/** The full-resolution composite (gargantuaShader.js compositeShader). */
export const COMPOSITE_LOOK = {
  // Depth of field: blur radius (px) per unit of |1 − focus/depth|, and its cap.
  DOF_K: 9,
  DOF_MAX: 10,
  // Veiling glow (the film's IMAX lens glow: a long-tailed PSF from the
  // mips; share, tail exponent, tint) and bloom.
  VEIL: 0.2,
  VEIL_BETA: 2.5,
  VEIL_TINT: [1, 1, 1],
  BLOOM: 0.22,
  // The flare reads light above this threshold only.
  FLARE_THRESHOLD: 0.5,
  // One ghost ring from the brightest light: strength, radius and rim
  // width (share of the frame height), and its place (× the source's offset
  // from the centre, mirrored). And halation: film's red glow around
  // bright edges.
  GHOST_RING: 0.6,
  GHOST_R: 0.14,
  GHOST_W: 0.012,
  GHOST_POS: 2.4,
  HALATION: 0.06,
  // Grade.
  SHADOW_TINT: [0, 0, 0],
  SATURATION: 1.15,
  // Film grain (display space): strength at mid-grey, clump size (px) and
  // the share that differs between the colour layers.
  GRAIN: 0.015,
  GRAIN_SIZE: 1.2,
  GRAIN_CHROMA: 0.3,
  // Colour fit to the reference stills: a tone curve per channel (display
  // space), the output at each of CURVE_KNOTS, fitted to the mean colour of
  // matching brightness bands of our frames (with the film-stock gas colour) and shots 1–3 and 7–9 (shots 4–5
  // are cool from the haze over the dome, not from the grade). The film is
  // near neutral low down and turns orange in the highlights.
  CURVE_0: [0, 0, 0],
  CURVE_1: [0.067, 0.075, 0.056],
  CURVE_2: [0.14, 0.134, 0.113],
  CURVE_3: [0.278, 0.237, 0.185],
  CURVE_4: [0.421, 0.38, 0.327],
  CURVE_5: [0.594, 0.553, 0.444],
  CURVE_6: [0.771, 0.687, 0.583],
  CURVE_7: [0.912, 0.864, 0.796],
  CURVE_8: [1, 1, 0.998],
  // A manual grade on top (ASC CDL: out = (in · slope + offset)^power), at identity.
  CDL_SLOPE: [0.85, 0.85, 0.85],
  CDL_OFFSET: [0, 0, 0],
  CDL_POWER: [1.2, 1.2, 1.2],
};

/**
 * The spray inside the hole (introSpray.js): a cloud of bright specks ahead
 * of the camera, its near edge SPRAY_DIST (Rs) ahead at the shot's start and
 * coming at SPRAY_SPEED (Rs/s), SPRAY_DEPTH deep; its direction ahead
 * (SPRAY_U, SPRAY_V: x, y per unit of depth in the camera's frame), its
 * lateral size (Rs), brightness and soft point size (px at 1080 lines).
 */
export const SPRAY_LOOK = {
  SPRAY_GAIN: 1,
  SPRAY_DIST: 12,
  SPRAY_SPEED: 2,
  SPRAY_DEPTH: 8,
  SPRAY_U: -0.012,
  SPRAY_V: 0.011,
  SPRAY_SPREAD: 0.6,
  SPRAY_SIZE: 3,
};

/** Input levels of the CURVE_n points (display space). */
export const CURVE_KNOTS = [0, 0.05, 0.15, 0.27, 0.42, 0.6, 0.78, 0.92, 1];

/** Slider limits: [min, max, step]. */
export const LOOK_LIMITS = {
  TAU: [0.2, 8, 0.05],
  EMIT: [0, 60, 0.5],
  EMIT_POWER: [0.5, 6, 0.05],
  EMIT_DEPTH: [0, 4, 0.05],
  ALBEDO: [0, 2, 0.01],
  RAD_FREQ: [0.5, 12, 0.1],
  ANG_TILES: [1, 24, 1],
  VERT_FREQ: [0.05, 1.5, 0.01],
  SHUTTER_S: [0, 3, 0.01],
  WARP: [0, 2, 0.01],
  FLAME: [0, 1, 0.01],
  FLAME_RAD: [0.5, 16, 0.1],
  FLAME_ANG: [1, 8, 1],
  WISP: [0, 1, 0.01],
  FLAME_DARK: [0, 1, 0.01],
  CLUMP_LO: [0.3, 0.9, 0.005],
  CLUMP_RAD: [1, 40, 0.5],
  CLUMP_TILES: [4, 120, 1],
  CLUMP_HEIGHT: [0.3, 30, 0.1],
  DETAIL: [0, 1, 0.01],
  SHEET_TAU: [0, 10, 0.05],
  SHEET_GLOW: [0, 6, 0.05],
  SHEET_POWER: [0, 4, 0.05],
  SHEET_RIM: [3, 10, 0.05],
  SHEET_RIM_W: [0.02, 3, 0.01],
  RIM_BAND: [0.05, 4, 0.01],
  RIM_STRIPES: [0, 12, 0.1],
  RIM_CLUMPS: [1, 24, 1],
  RIM_CLUMP_LO: [0, 0.95, 0.005],
  HAZE: [0, 1, 0.005],
  HAZE_HEIGHT: [0.1, 10, 0.05],
  LIGHT_HEIGHT: [0, 3, 0.05],
  LIGHT_K: [0, 2, 0.01],
  LIGHT_GAIN: [0, 4, 0.05],
  SMOKE_K: [0, 12, 0.1],
  DOF_K: [0, 30, 0.5],
  DOF_MAX: [0, 30, 0.5],
  VEIL: [0, 0.9, 0.005],
  VEIL_BETA: [1.2, 4, 0.05],
  BLOOM: [0, 1, 0.01],
  FLARE_THRESHOLD: [0, 6, 0.05],
  GHOST_RING: [0, 2, 0.01],
  GHOST_R: [0.02, 0.5, 0.005],
  GHOST_W: [0.002, 0.1, 0.001],
  GHOST_POS: [-2, 3, 0.05],
  HALATION: [0, 1, 0.005],
  SATURATION: [0, 2, 0.01],
  GRAIN: [0, 0.2, 0.001],
  GRAIN_SIZE: [0.5, 4, 0.05],
  GRAIN_CHROMA: [0, 1, 0.01],
  SPRAY_GAIN: [0, 20, 0.01],
  SPRAY_DIST: [0, 60, 0.1],
  SPRAY_SPEED: [0, 20, 0.05],
  SPRAY_DEPTH: [0.5, 60, 0.1],
  SPRAY_U: [-1, 1, 0.001],
  SPRAY_V: [-1, 1, 0.001],
  SPRAY_SPREAD: [0.01, 6, 0.01],
  SPRAY_SIZE: [0, 30, 0.1],
};

/** GLSL uniform declarations for a look (float or vec3 by value). */
export function lookDeclarations(look) {
  return Object.entries(look)
    .map(([name, value]) => `  uniform ${Array.isArray(value) ? 'vec3' : 'float'} ${name};`)
    .join('\n');
}

/** Clamp a number to its slider limits (unknown keys pass through). */
export function clampLook(name, value) {
  const limit = LOOK_LIMITS[name];
  if (!limit || !Number.isFinite(value)) return value;
  const v = Math.min(limit[1], Math.max(limit[0], value));
  return name === 'ANG_TILES' || name === 'FLAME_ANG' || name === 'CLUMP_TILES' || name === 'RIM_CLUMPS' ? Math.round(v) : v;
}
