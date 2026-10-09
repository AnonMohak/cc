/**
 * PURE: the auto camera of a collision (app.js camera mode 'consume'). It
 * flies in close on the pair and keeps them filling most of the view: in
 * the opening pass it frames both (around their common centre); after the
 * handover it frames the victim's orbit around the winner and moves in as
 * the victim spirals in, down to the winner's end view (a hole's disc, the
 * remnant galaxy). It keeps the current side and raises the view to at
 * least MIN_ELEVATION_DEG above the winner's disc, so the streams and the
 * disc read. Frame-rate independent eases.
 */

/** How much of the half view the framed radius fills (close: most of it). */
export const FILL = 0.85;
// Share of an object's radius kept in view around its centre.
const BODY_SHARE = 0.6;

export const MIN_ELEVATION_DEG = 15;
/** Ease rates (1/s): the target, the distance and the direction. */
export const TARGET_RATE = 3;
export const DISTANCE_RATE = 1.2;
export const DIRECTION_RATE = 1;

/**
 * The radius to keep in view (world units) for a collision status
 * (CollisionSim.status): the pair in the opening pass; the victim's orbit
 * after the handover, shrinking to the winner's end size (a hole's disc ×
 * 1.2, or the winning galaxy × 0.9) as the victim is eaten.
 */
export function frameRadius(st) {
  const end = st.winnerHole ? 1.2 * st.winnerDisc : 0.9 * st.winnerRadius;
  if (st.stage === 'pass') return Math.max(0.5 * st.distance + BODY_SHARE * Math.max(st.winnerRadius, st.victimRadius), end);
  const victim = BODY_SHARE * st.victimRadius * (1 - st.progress);
  return Math.max(st.distance + victim, end);
}

/** Camera distance that shows `radius` filling FILL of the half view (tanHalf: the smaller of tan(fov/2) across and up). */
export function framingDistance(radius, tanHalf, fill = FILL) {
  return radius / (tanHalf * fill);
}

/**
 * The half-view tangent that fits a flat orbit of radius R seen from
 * `sinElevation` above its plane: across, R fills the width (tanY × aspect);
 * up and down it is only R × sin(elevation) high (a floor for the bodies'
 * own thickness). The smaller fit wins, so the pair fills the screen.
 */
export function orbitViewTan(tanY, aspect, sinElevation) {
  return Math.min(tanY * aspect, tanY / Math.max(Math.abs(sinElevation), MIN_FLAT_SIN));
}
// The flattest an orbit may look (also covers the bodies' own height).
const MIN_FLAT_SIN = 0.35;

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
