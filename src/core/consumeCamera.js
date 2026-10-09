/**
 * PURE: the auto camera of a consumption (app.js camera mode 'consume'). It
 * keeps the winner as the target and moves in as the victim closes in: from
 * a view of both objects to the winner's end view (the film shot for a black
 * hole, a framing of the remnant for a galaxy). It keeps the current side
 * and raises the view to at least MIN_ELEVATION_DEG above the winner's disc,
 * so the streams and the disc read. Frame-rate independent eases.
 */

export const MIN_ELEVATION_DEG = 15;
/** Ease rates (1/s): the target, the distance and the direction. */
export const TARGET_RATE = 3;
export const DISTANCE_RATE = 1.2;
export const DIRECTION_RATE = 1;

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * Wanted camera distance: from `startDistance` (both objects in view) to
 * `endDistance` as the victim goes from `startSeparation` to the winner.
 */
export function consumeDistance(startDistance, endDistance, victimDistance, startSeparation) {
  const k = clamp01(1 - victimDistance / Math.max(startSeparation, 1e-6));
  const s = k * k * (3 - 2 * k);
  return startDistance + (endDistance - startDistance) * s;
}

/**
 * The view direction (unit, target → camera) raised to at least `minDeg`
 * above the disc plane on the side the camera is on. Writes into out.
 * @param {number[]} dir unit direction now
 * @param {number[]} normal unit disc normal
 */
export function raiseDirection(dir, normal, minDeg, out) {
  const d = dir[0] * normal[0] + dir[1] * normal[1] + dir[2] * normal[2];
  const side = d < 0 ? -1 : 1;
  const sinMin = Math.sin((minDeg * Math.PI) / 180);
  if (Math.abs(d) >= sinMin) {
    out[0] = dir[0];
    out[1] = dir[1];
    out[2] = dir[2];
    return out;
  }
  // In-plane part, then the normal part at exactly the minimum elevation.
  let px = dir[0] - normal[0] * d;
  let py = dir[1] - normal[1] * d;
  let pz = dir[2] - normal[2] * d;
  let pl = Math.hypot(px, py, pz);
  if (pl < 1e-9) {
    // Looking along the disc normal is already high enough; never reached.
    px = 1;
    py = pz = 0;
    pl = 1;
  }
  const c = Math.cos((minDeg * Math.PI) / 180);
  out[0] = (px / pl) * c + normal[0] * sinMin * side;
  out[1] = (py / pl) * c + normal[1] * sinMin * side;
  out[2] = (pz / pl) * c + normal[2] * sinMin * side;
  return out;
}

/** Exponential ease of a value toward a target (rate 1/s). */
export function easeValue(current, target, rate, dt) {
  return target + (current - target) * Math.exp(-rate * dt);
}
