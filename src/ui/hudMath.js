/**
 * Pure layout math for the HUD (scale bar, labels, minimap). No DOM, no
 * three.js scene objects, so it is unit-testable.
 */

const NICE_STEPS = [1, 2, 5];

/**
 * A "nice" scale-bar length (1, 2 or 5 × 10^k light-years) close to
 * `targetPx` on screen.
 * @param {number} pxPerUnit screen pixels per world unit at the focus depth
 * @param {number} lyPerUnit light-years per world unit
 */
export function niceScaleBar(pxPerUnit, lyPerUnit, targetPx = 120) {
  if (!(pxPerUnit > 0)) return null;
  const lyPerPx = lyPerUnit / pxPerUnit;
  const raw = targetPx * lyPerPx;
  const exp = Math.floor(Math.log10(raw));
  let best = null;
  for (let e = exp - 1; e <= exp + 1; e++) {
    for (const s of NICE_STEPS) {
      const ly = s * 10 ** e;
      const px = ly / lyPerPx;
      if (!best || Math.abs(px - targetPx) < Math.abs(best.px - targetPx)) best = { ly, px };
    }
  }
  return best;
}

/** Pixels per world unit at `distance` for a perspective camera. */
export function pxPerUnitAt(distance, fovDeg, heightPx) {
  return heightPx / 2 / Math.tan((fovDeg * Math.PI) / 360) / Math.max(distance, 1e-6);
}

/**
 * Where to draw a galaxy's name: just below its disc on screen.
 * @param {{ x: number, y: number, z: number }} ndc projected centre (three's Vector3.project)
 * @param {number} radiusPx projected radius in pixels
 * @returns {{ visible: boolean, left: number, top: number, opacity: number }}
 */
export function labelPlacement(ndc, radiusPx, width, height) {
  const left = ((ndc.x + 1) / 2) * width;
  const centerY = ((1 - ndc.y) / 2) * height;
  const top = centerY + Math.min(radiusPx * 0.75, height * 0.3) + 6;
  const onScreen = ndc.z < 1 && left > -80 && left < width + 80 && top > -20 && top < height + 20;
  // Fade out galaxies that are tiny dots; their names would only clutter.
  const opacity = onScreen ? smoothstep(3, 12, radiusPx) : 0;
  return { visible: opacity > 0.01, left, top, opacity };
}

/**
 * Top-down (XZ) minimap layout that fits every galaxy and the camera.
 * @param {Array<{ id: string, x: number, z: number, r: number }>} items
 * @param {{ x: number, z: number, dirX: number, dirZ: number }} camera
 * @param {number} size canvas size in CSS px (square)
 */
export function minimapLayout(items, camera, size, pad = 12) {
  let minX = camera.x;
  let maxX = camera.x;
  let minZ = camera.z;
  let maxZ = camera.z;
  for (const it of items) {
    minX = Math.min(minX, it.x - it.r);
    maxX = Math.max(maxX, it.x + it.r);
    minZ = Math.min(minZ, it.z - it.r);
    maxZ = Math.max(maxZ, it.z + it.r);
  }
  const span = Math.max(maxX - minX, maxZ - minZ, 20) * 1.1;
  const scale = (size - 2 * pad) / span;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const toPx = (x, z) => [size / 2 + (x - cx) * scale, size / 2 + (z - cz) * scale];
  return {
    scale,
    toPx,
    dots: items.map((it) => {
      const [px, py] = toPx(it.x, it.z);
      return { ...it, px, py, pr: Math.max(2.5, it.r * scale) };
    }),
    camera: { ...camera, ...Object.fromEntries(['px', 'py'].map((k, i) => [k, toPx(camera.x, camera.z)[i]])), angle: Math.atan2(camera.dirZ, camera.dirX) },
  };
}

/** Galaxy id under a minimap click, or null. */
export function minimapHit(dots, px, py, slop = 4) {
  let best = null;
  let bestD = Infinity;
  for (const d of dots) {
    const dist = Math.hypot(d.px - px, d.py - py);
    if (dist <= d.pr + slop && dist < bestD) {
      best = d.id;
      bestD = dist;
    }
  }
  return best;
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
