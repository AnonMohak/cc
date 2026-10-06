const GAP = 1.5;
const RING_STEPS = 12;
const MAX_RINGS = 20;

/**
 * Find a spot in the XZ plane near `target` where a galaxy of `radius` does
 * not overlap any existing galaxy. Searches rings of growing size around the
 * target, so new galaxies appear close to where the user is looking.
 *
 * @param {Array<{ look: { position: number[], radius: number } }>} galaxies
 * @param {number[]} target [x, y, z]
 * @param {number} radius
 * @returns {number[]} [x, y, z]
 */
export function findFreePosition(galaxies, target, radius) {
  const fits = (x, z) =>
    galaxies.every((g) => {
      const [gx, , gz] = g.look.position;
      return Math.hypot(gx - x, gz - z) >= g.look.radius + radius + GAP;
    });

  const [tx, ty, tz] = target;
  if (fits(tx, tz)) return [tx, ty, tz];

  const step = radius + GAP;
  for (let ring = 1; ring <= MAX_RINGS; ring++) {
    const d = ring * step;
    for (let k = 0; k < RING_STEPS; k++) {
      const a = (k / RING_STEPS) * Math.PI * 2;
      const x = tx + d * Math.cos(a);
      const z = tz + d * Math.sin(a);
      if (fits(x, z)) return [round(x), ty, round(z)];
    }
  }
  return [tx + MAX_RINGS * step, ty, tz];
}

function round(v) {
  return Math.round(v * 100) / 100;
}
