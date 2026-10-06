import * as THREE from 'three';

// Edge-on discs have almost no area to click; the core sphere covers that.
const CORE_PICK_FRACTION = 0.2;

const _toCenter = new THREE.Vector3();
const _hit = new THREE.Vector3();

/**
 * Pick the nearest galaxy hit by a ray. Uses each galaxy's disc plane plus a
 * small core sphere, instead of raycasting every star.
 *
 * @param {THREE.Ray} ray
 * @param {Array<{ id: string, center: THREE.Vector3, normal: THREE.Vector3, radius: number }>} targets
 * @returns {string | null}
 */
export function pickGalaxy(ray, targets) {
  let bestId = null;
  let bestT = Infinity;

  for (const target of targets) {
    const t = Math.min(discHit(ray, target), coreHit(ray, target));
    if (t < bestT) {
      bestT = t;
      bestId = target.id;
    }
  }
  return bestId;
}

function discHit(ray, { center, normal, radius }) {
  const denom = normal.dot(ray.direction);
  if (Math.abs(denom) < 1e-6) return Infinity;
  const t = _toCenter.subVectors(center, ray.origin).dot(normal) / denom;
  if (t <= 0) return Infinity;
  ray.at(t, _hit);
  return _hit.distanceTo(center) <= radius ? t : Infinity;
}

function coreHit(ray, { center, radius }) {
  const r = radius * CORE_PICK_FRACTION;
  _toCenter.subVectors(center, ray.origin);
  const tc = _toCenter.dot(ray.direction);
  if (tc <= 0) return Infinity;
  const d2 = _toCenter.lengthSq() - tc * tc;
  if (d2 > r * r) return Infinity;
  return tc - Math.sqrt(r * r - d2);
}
