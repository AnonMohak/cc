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
};

/**
 * The pixels that count in a frame of a shot: inside SHIP_KEEP, or all but
 * a circle around the small spacecraft ({ u, v, r }: r a share of the
 * height; cut at 1.5 r plus 6 lines of a 1080-line frame for its blur).
 */
export function measureMask(shotName, ship, w = MEASURE_W, h = MEASURE_H) {
  if (SHIP_KEEP[shotName]) return shapeMask(w, h, { keep: SHIP_KEEP[shotName] });
  if (ship) return shapeMask(w, h, { cut: [{ u: ship.u, v: ship.v, r: 1.5 * ship.r + 6 / 1080 }] });
  return shapeMask(w, h);
}

/**
 * The features of one frame of a shot (an image at the measure size).
 * @returns {{ tone: number[], horizon: object | null, ring: object | null, dome: object | null, shadow: object | null }}
 */
export function measureFeatures(shotName, img, mask) {
  const { w, h } = img;
  const y = luma(img);
  const out = { tone: quantiles(y, mask, [0.1, 0.5, 0.9]), horizon: null, ring: null, dome: null, shadow: null };
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
  if (shotName === 'wall' || shotName === 'skim') {
    // At half size: the shadow from its darkest pixel in the upper left.
    const small = halve(y, w, h, mask);
    let seed = null;
    let darkest = Infinity;
    for (let yy = 0; yy < small.h * 0.6; yy++) {
      for (let xx = 0; xx < small.w * 0.4; xx++) {
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
    if (s && s.area > 0.01 && s.edge > 30 && s.rms < 0.2 && s.cx < 0.9) out.shadow = s;
  }
  return out;
}
