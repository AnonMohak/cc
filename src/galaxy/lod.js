/**
 * Level of detail for the raymarched volume. GPU cost ≈ covered pixels ×
 * steps, so the step count adapts to how big the galaxy is on screen:
 * - filling the screen (camera close or inside): fewer steps keep the frame
 *   rate up where the cost would otherwise explode;
 * - tiny and far away: detail is invisible, so fewer steps too.
 */

const MIN_STEPS = 12;

/**
 * Projected radius in pixels and fraction of the screen the disc covers.
 * @param {number} radius world radius of the galaxy
 * @param {number} distance camera distance to the galaxy centre
 * @param {number} fovDeg vertical field of view
 * @param {number} width viewport width in px
 * @param {number} height viewport height in px
 */
export function screenFootprint(radius, distance, fovDeg, width, height) {
  if (distance <= radius) return { radiusPx: Infinity, coverage: 1 };
  const focalPx = height / 2 / Math.tan(((fovDeg * Math.PI) / 180) / 2);
  const radiusPx = (radius / Math.sqrt(distance * distance - radius * radius)) * focalPx;
  const coverage = Math.min(1, (Math.PI * radiusPx * radiusPx) / (width * height));
  return { radiusPx, coverage };
}

/** Steps to use this frame for a galaxy with the given footprint. */
export function adaptiveSteps(baseSteps, { radiusPx, coverage }) {
  let s = baseSteps;
  if (coverage > 0.35) s *= 1 - 0.45 * smoothstep(0.35, 1, coverage);
  if (radiusPx < 80) s *= 0.35 + 0.65 * (radiusPx / 80);
  return Math.max(MIN_STEPS, Math.round(s));
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
