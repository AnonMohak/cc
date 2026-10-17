/**
 * The features measured in the film clip and, the same way, in our frames
 * (scripts/measure-clip.mjs, scripts/score-intro.mjs): which pixels count
 * (spacecraft left out), the thin ring's circle, the disc's edge-on line
 * and the dome's edge in the gap and the dome, the shadow's edge in the wall
 * and the skim, and the light and dark. Pure.
 */

import { luma, halve, shapeMask, quantiles, horizonLine, ridgePoints, ransacCircle, shadowRegion } from './frameMatch.js';

/** Measure every this many clip frames (four times a second). */
export const MEASURE_STEP = 6;
/** The size frames are measured at. */
export const MEASURE_W = 960;
export const MEASURE_H = 540;

/**
 * Where the large spacecraft do not cover the frame (they do not move in
 * these shots: the camera rides on one): polygons in shares (u, v from the
 * top-left), a little inside the ships' edges. Only these pixels count.
 */
export const SHIP_KEEP = {
  clouds: [
    [
      [0.26, 0.16],
      [0.31, 0.16],
      [0.4, 0.03],
      [0.78, 0.01],
      [0.83, 0.12],
      [1, 0.16],
      [1, 1],
      [0.745, 1],
      [0.735, 0.64],
      [0.67, 0.61],
      [0.655, 0.44],
      [0.63, 0.39],
      [0.53, 0.36],
      [0.26, 0.39],
    ],
  ],
  bright: [
    [
      [0.31, 0.03],
      [0.85, 0.03],
      [0.86, 0.12],
      [0.85, 0.27],
      [0.8, 0.32],
      [0.7, 0.28],
      [0.57, 0.28],
      [0.5, 0.33],
      [0.42, 0.53],
      [0.45, 0.63],
      [0.47, 0.8],
      [0.58, 0.96],
      [0.23, 0.96],
      [0.22, 0.9],
      [0.15, 0.9],
      [0.15, 0.53],
      [0.21, 0.36],
    ],
  ],
  'hole-far': [
    [
      [0.67, 0.02],
      [1, 0.02],
      [1, 1],
      [0.2, 1],
      [0.2, 0.82],
      [0.21, 0.62],
      [0.31, 0.58],
      [0.31, 0.45],
      [0.28, 0.36],
      [0.45, 0.31],
      [0.56, 0.26],
      [0.57, 0.18],
      [0.66, 0.14],
    ],
  ],
};

/** Small spacecraft inside the kept area (u, v, r: shares; r of the height). */
export const SHIP_CUT = {
  // The lander falling toward the shadow.
  'hole-far': [{ u: 0.494, v: 0.755, r: 0.03 }],
};

/**
 * The pixels that count in a frame of a shot: inside SHIP_KEEP, or all but
 * a circle around the small spacecraft ({ u, v, r }: r a share of the
 * height; cut at 1.5 r plus 6 lines of a 1080-line frame for its blur).
 */
export function measureMask(shotName, ship, w = MEASURE_W, h = MEASURE_H) {
  if (SHIP_KEEP[shotName]) return shapeMask(w, h, { keep: SHIP_KEEP[shotName], cut: SHIP_CUT[shotName] ?? [] });
  if (ship) return shapeMask(w, h, { cut: [{ u: ship.u, v: ship.v, r: 1.5 * ship.r + 6 / 1080 }] });
  return shapeMask(w, h);
}

/**
 * Whether the score counts the film's shadow and dome. The intro first kept
 * them black by choice (then they must not pull the fits); since 2026-10-17
 * it matches the film's grey-teal and blue-grey there too (1:1 visuals).
 */
export const SCORE_SHADOW = true;

/**
 * The pixels the score counts for a measured film frame (a FILM_MEASURES
 * entry): measureMask, and without SCORE_SHADOW (or `shadow: false`) also
 * without the film's shadow and dome (cut just inside their circles).
 */
export function scoreMask(m, w = MEASURE_W, h = MEASURE_H, { shadow = SCORE_SHADOW } = {}) {
  const mask = measureMask(m.shot, m.ship, w, h);
  if (shadow) return mask;
  for (const c of [m.shadow, m.dome]) {
    if (!c) continue;
    const cut = shapeMask(w, h, { cut: [{ u: c.cx / (w / h), v: c.cy, r: 0.97 * c.r }] });
    for (let i = 0; i < mask.length; i++) mask[i] &= cut[i];
  }
  return mask;
}

/**
 * The features of one frame of a shot (an image at the measure size).
 * @returns {{ tone: number[], horizon: object | null, ring: object | null, dome: object | null, shadow: object | null, spray: object | null }}
 */
export function measureFeatures(shotName, img, mask) {
  const { w, h } = img;
  const y = luma(img);
  const out = { tone: quantiles(y, mask, [0.1, 0.5, 0.9]), horizon: null, ring: null, dome: null, shadow: null, spray: null };
  if (shotName === 'gap-dome') {
    out.horizon = horizonLine(y, w, h, mask);
    // The ring's centre lies near the middle of the frame in these shots
    // (the camera looks at the hole); elsewhere a fit locks onto clouds.
    const accept = (c) => c.cx > 0.25 * w && c.cx < 0.75 * w && c.cy > 0.15 * h && c.cy < 0.6 * h;
    const ring = ransacCircle(ridgePoints(y, w, h, mask, { k: 0.05, min: 0.12 }), { tol: 2, rMin: 0.45 * h, rMax: 0.9 * h, iterations: 600, accept });
    if (ring && ring.inliers >= 80) out.ring = { cx: (ring.cx + 0.5) / h, cy: (ring.cy + 0.5) / h, r: ring.r / h, n: ring.inliers };
    // The dome: the shadow above the bright edge-on line, inside the arches
    // (it must stay above the line; in the gap it is not closed).
    if (out.horizon) {
      const small = halve(y, w, h, mask);
      const seed = [Math.round(small.w / 2), Math.round((out.horizon.v - 0.12) * small.h)];
      const s = seed[1] > 0 ? shadowRegion(small.data, small.w, small.h, seed, { level: 0.75, mask: small.mask, fitAbove: out.horizon.v - 0.03 }) : null;
      // Its centre lies near the line (the camera is just above the disc);
      // with the arches off the frame the fit drifts up: left out.
      if (s && s.area > 0.02 && s.area < 0.45 && s.rms < 0.2 && s.bottom < out.horizon.v + 0.03 && Math.abs(s.cy - out.horizon.v) < 0.1) out.dome = s;
    }
  }
  if (shotName === 'wall' || shotName === 'skim' || shotName === 'hole-far') {
    // At half size: the shadow from its darkest pixel in the upper left (in
    // the middle when seen from farther away).
    const small = halve(y, w, h, mask);
    const [u0, u1, v0, v1] = shotName === 'hole-far' ? [0.35, 0.75, 0.35, 0.85] : [0, 0.4, 0, 0.6];
    let seed = null;
    let darkest = Infinity;
    for (let yy = Math.floor(small.h * v0); yy < small.h * v1; yy++) {
      for (let xx = Math.floor(small.w * u0); xx < small.w * u1; xx++) {
        const i = yy * small.w + xx;
        if (small.mask[i] && small.data[i] < darkest) {
          darkest = small.data[i];
          seed = [xx, yy];
        }
      }
    }
    const s = seed && shadowRegion(small.data, small.w, small.h, seed, { level: 0.75, mask: small.mask });
    // A roundish edge only (the shadow is egg-shaped; the early skim frames
    // show no clear shadow and fit with a spread of ~0.4).
    // (From farther away the edge spreads a little more: 0.22.)
    const far = shotName === 'hole-far';
    if (s && s.area > 0.01 && s.edge > 30 && s.rms < (far ? 0.26 : 0.2) && (far || s.cx < 0.9)) out.shadow = s;
  }
  if (shotName === 'inside') out.spray = brightSpread(y, w, h, mask);
  return out;
}

/**
 * The bright spray inside the hole: the brightness-weighted centre (shares
 * of the height, from the top-left) and spread (RMS radius) of the light
 * above 0.2, and its share of the frame; null when there is none.
 */
export function brightSpread(y, w, h, mask = null, level = 0.2) {
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let yy = 0; yy < h; yy++) {
    for (let x = 0; x < w; x++) {
      const i = yy * w + x;
      if ((mask && !mask[i]) || y[i] < level) continue;
      const wgt = y[i] - level;
      sw += wgt;
      sx += wgt * x;
      sy += wgt * yy;
      n++;
    }
  }
  if (n < 20) return null;
  const cx = sx / sw;
  const cy = sy / sw;
  let sq = 0;
  for (let yy = 0; yy < h; yy++) {
    for (let x = 0; x < w; x++) {
      const i = yy * w + x;
      if ((mask && !mask[i]) || y[i] < level) continue;
      sq += (y[i] - level) * ((x - cx) ** 2 + (yy - cy) ** 2);
    }
  }
  return { cx: (cx + 0.5) / h, cy: (cy + 0.5) / h, spread: Math.sqrt(sq / sw) / h, share: n / (w * h) };
}
