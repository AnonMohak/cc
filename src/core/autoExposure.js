/**
 * Auto exposure. PURE: decode the meter (core/ExposureMeterPass.js), choose a
 * target factor and ease toward it. The app multiplies the user's Exposure
 * slider by the factor.
 *
 * It only darkens: normal views (black space, a galaxy) keep factor 1, and
 * when bright light fills the centre of the screen (zoomed into a core) the
 * factor drops so the detail survives tone mapping. Like an eye, it closes
 * fast and opens slowly.
 */

/** Meter target size (texels per side). */
export const METER_SIZE = 64;
/** log2 luminance range packed into the meter's 8-bit red channel. */
export const LOG_MIN = -12;
export const LOG_MAX = 4;
/** HDR level (before tone mapping) the bright centre is brought down to. */
export const KEY = 0.5;
/** Lowest factor: 5 stops darker. */
export const MIN_FACTOR = 1 / 32;
/** Bright coverage where darkening starts and is complete. */
const COVERAGE_START = 0.1;
const COVERAGE_FULL = 0.4;
/** ~95% of a change in this many seconds (3 time constants). */
export const DARKEN_SECONDS = 0.5;
export const BRIGHTEN_SECONDS = 2;
/** Closer than this (in stops) counts as settled. */
const SETTLED_STOPS = 0.01;

/**
 * Read the meter bytes (RGBA8, METER_SIZE²): r = packed log2 luminance,
 * g = bright mask × centre weight, b = centre weight.
 * @param {Uint8Array} bytes
 * @returns {{ coverage: number, meanLog2: number }} coverage: centre-weighted
 *   bright fraction (0–1); meanLog2: mean log2 luminance of the bright part
 */
export function meterFrame(bytes) {
  let bright = 0;
  let weight = 0;
  let logSum = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    const g = bytes[i + 1] / 255;
    bright += g;
    weight += bytes[i + 2] / 255;
    logSum += g * (LOG_MIN + (bytes[i] / 255) * (LOG_MAX - LOG_MIN));
  }
  return {
    coverage: weight > 0 ? bright / weight : 0,
    meanLog2: bright > 0 ? logSum / bright : LOG_MIN,
  };
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Factor (≤ 1) that brings the bright centre to KEY at the user's exposure.
 * @param {{ coverage: number, meanLog2: number }} meter
 * @param {number} bias the Exposure slider
 */
export function targetFactor({ coverage, meanLog2 }, bias = 1) {
  const full = Math.log2(KEY) - (meanLog2 + Math.log2(Math.max(bias, 1e-6)));
  const stops = Math.min(0, Math.max(Math.log2(MIN_FACTOR), full));
  return 2 ** (stops * smoothstep(COVERAGE_START, COVERAGE_FULL, coverage));
}

/**
 * Ease `current` toward `target` in log space, frame-rate independent:
 * fast when darkening, slow when brightening.
 * @param {number} current
 * @param {number} target
 * @param {number} dt seconds (real time: it adapts while paused too)
 */
export function adapt(current, target, dt) {
  const seconds = target < current ? DARKEN_SECONDS : BRIGHTEN_SECONDS;
  const k = 1 - Math.exp((-3 * Math.max(dt, 0)) / seconds);
  const next = Math.log2(current) + (Math.log2(target) - Math.log2(current)) * k;
  return isSettled(2 ** next, target) ? target : 2 ** next;
}

export function isSettled(current, target) {
  return Math.abs(Math.log2(current / target)) < SETTLED_STOPS;
}
