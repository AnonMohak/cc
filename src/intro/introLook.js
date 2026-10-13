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
  TAU: 2.2,
  // Light of the hot midplane, and the share of the smoke lit by it.
  EMIT: 14,
  // How fast the gas's own light falls off with radius (r^-EMIT_POWER).
  EMIT_POWER: 3,
  ALBEDO: 0.6,
  // Noise frequencies: many streaks across the radius, few long arcs around.
  RAD_FREQ: 4,
  ANG_TILES: 7, // per turn: an integer, so the angle wraps without a seam
  VERT_FREQ: 0.3,
  // Shutter (s): the motion blur's length. Longer than a film camera's 1/48 s:
  // the film's ship moved much faster than this camera does. One random
  // moment per pixel per frame, so a long shutter turns grainy (1–2 s is
  // noisy at our frame rates); 0.25 s shows the blur with little grain.
  SHUTTER_S: 0.25,
  // Domain warp (texture units): breaks the even rings into clumps.
  WARP: 1.1,
  // Flame tongues: how much of the ridged, orbit-stretched layer goes into
  // the clouds, its radial frequency and its whole tiles around the turn
  // (× ANG_TILES); and thin wisps above the cloud tops.
  FLAME: 1,
  FLAME_RAD: 5,
  FLAME_ANG: 2,
  WISP: 0.25,
  // Close-up detail: the weight of a finer octave (faded with distance).
  // 0 skips it: at the half-resolution march it does not show (gargantuaShader.js).
  DETAIL: 0,
  // The thin bright midplane sheet (added where a ray crosses the plane):
  // optical depth across it, its glow (× EMIT) and how fast that falls off.
  SHEET_TAU: 1.5,
  SHEET_GLOW: 1.5,
  SHEET_POWER: 1.2,
  // Haze around the hole (lit by the disc, collected by every ray): its
  // light per Rs at the inner edge, scale height (Rs) and colour.
  HAZE: 0.06,
  HAZE_HEIGHT: 2,
  HAZE_COL: [0.42, 0.58, 0.95],
  // Self-shadowing: the height (half-thicknesses) the inner disc's light runs
  // out at, how strongly the gas on the way blocks it, and its strength.
  LIGHT_HEIGHT: 1.6,
  LIGHT_K: 0.1,
  LIGHT_GAIN: 2.5,
  // Extra extinction of the upper smoke layers (× at the cloud tops).
  SMOKE_K: 7,
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
  GHOST_R: 0.12,
  GHOST_W: 0.012,
  GHOST_POS: 1.6,
  HALATION: 0.06,
  // Grade.
  SHADOW_TINT: [0, 0, 0],
  SATURATION: 1.15,
  // Film grain (display space): strength at mid-grey, clump size (px) and
  // the share that differs between the colour layers.
  GRAIN: 0.05,
  GRAIN_SIZE: 1.2,
  GRAIN_CHROMA: 0.3,
  // Colour fit to the reference stills: a tone curve per channel (display
  // space), the output at each of CURVE_KNOTS, fitted to the mean colour of
  // matching brightness bands of our frames (with the film-stock gas colour) and shots 1–3 and 7–9 (shots 4–5
  // are cool from the haze over the dome, not from the grade). The film is
  // near neutral low down and turns orange in the highlights.
  CURVE_0: [0, 0, 0],
  CURVE_1: [0.054, 0.054, 0.035],
  CURVE_2: [0.162, 0.147, 0.112],
  CURVE_3: [0.315, 0.27, 0.214],
  CURVE_4: [0.494, 0.413, 0.331],
  CURVE_5: [0.674, 0.566, 0.461],
  CURVE_6: [0.827, 0.72, 0.604],
  CURVE_7: [0.931, 0.865, 0.757],
  CURVE_8: [1, 1, 0.91],
  // A manual grade on top (ASC CDL: out = (in · slope + offset)^power), at identity.
  CDL_SLOPE: [1, 1, 1],
  CDL_OFFSET: [0, 0, 0],
  CDL_POWER: [1, 1, 1],
};

/** Input levels of the CURVE_n points (display space). */
export const CURVE_KNOTS = [0, 0.05, 0.15, 0.27, 0.42, 0.6, 0.78, 0.92, 1];

/** Slider limits: [min, max, step]. */
export const LOOK_LIMITS = {
  TAU: [0.2, 8, 0.05],
  EMIT: [0, 60, 0.5],
  EMIT_POWER: [0.5, 6, 0.05],
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
  DETAIL: [0, 1, 0.01],
  SHEET_TAU: [0, 10, 0.05],
  SHEET_GLOW: [0, 6, 0.05],
  SHEET_POWER: [0, 4, 0.05],
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
  return name === 'ANG_TILES' || name === 'FLAME_ANG' ? Math.round(v) : v;
}
