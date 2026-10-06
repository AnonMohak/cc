/**
 * Level of detail for the raymarched volume. GPU cost ≈ covered pixels ×
 * steps, so the step count adapts to how big the galaxy is on screen:
 * - filling the screen (camera close or inside): fewer steps keep the frame
 *   rate up where the cost would otherwise explode;
 * - tiny and far away: detail is invisible, so fewer steps too.
 */

const MIN_STEPS = 6;

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

// Star LOD. A far galaxy covers few pixels, but it still drew every star:
// with ten galaxies, star vertices were ~95% of the frame. Stars beyond a few
// per pixel only add up into the same light, so draw about STARS_PER_PX2 per
// covered pixel and scale their brightness up to keep the total light.
const STARS_PER_PX2 = 4;
const MIN_LOD_STARS = 3000;
// Above this gain, single bright dots start to sparkle; accept a dimmer
// speck for the tiniest galaxies instead.
const MAX_STAR_GAIN = 8;
// Quantise the count so a slow zoom does not change the draw range each frame.
const STAR_STEP = 256;

/**
 * Stars to draw for a galaxy with `available` stars (after the tier cap), and
 * the brightness gain that keeps its total light.
 * @param {number} available
 * @param {{ radiusPx: number }} footprint
 */
export function starLod(available, { radiusPx }) {
  if (available <= MIN_LOD_STARS || !Number.isFinite(radiusPx)) return { count: available, gain: 1 };
  const wanted = STARS_PER_PX2 * Math.PI * radiusPx * radiusPx;
  if (wanted >= available) return { count: available, gain: 1 };
  const count = Math.max(MIN_LOD_STARS, Math.ceil(wanted / STAR_STEP) * STAR_STEP);
  if (count >= available) return { count: available, gain: 1 };
  return { count, gain: Math.min(MAX_STAR_GAIN, available / count) };
}
