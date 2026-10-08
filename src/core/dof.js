/**
 * PURE: depth of field maths (core/DepthOfFieldPass.js mirrors
 * circleOfConfusion in GLSL).
 *
 * Stars and volumes write no depth, so each object writes its centre
 * distance through an invisible proxy (galaxy/dofProxy.js): the selected
 * object is sharp, the others blur by how far they are from the focus. The
 * background has no proxy and counts as far away.
 */

/** Blur radius (px) at full strength for a 1080 px tall frame; it scales with the height. */
export const DOF_MAX_COC_PX = 10;
/** Depth written where no object is (the background). */
export const DOF_FAR = 10000;
/** Focus pull speed: the focus moves this fraction of the way per second (exponential). */
export const FOCUS_RATE = 6;

/**
 * Blur radius in px for a point at view distance `depth` when the lens is
 * focused at `focus`: a thin-lens-like |d − f| / d, so it saturates for far
 * objects and grows for near ones, then capped. Mirrored in GLSL.
 * @param {number} depth
 * @param {number} focus
 * @param {number} amount 0–1 (Settings → Depth of field)
 * @param {number} maxPx DOF_MAX_COC_PX scaled to the frame height
 */
export function circleOfConfusion(depth, focus, amount, maxPx) {
  const d = Math.max(depth, 1e-3);
  return Math.min(maxPx, (amount * maxPx * Math.abs(d - focus)) / d);
}

/**
 * Ease the focus distance toward `target` (frame-rate independent, real time).
 * Snaps when within 0.1% so the render gate can go idle.
 */
export function easeFocus(current, target, dt) {
  if (!(current > 0)) return target;
  const next = target + (current - target) * Math.exp(-FOCUS_RATE * dt);
  return Math.abs(next - target) <= target * 1e-3 ? target : next;
}
