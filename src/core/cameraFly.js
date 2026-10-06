import * as THREE from 'three';

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Eased camera + orbit-target move, driven by the loop with real time (so it
 * still works while the simulation is paused). No tween library.
 *
 * @param {THREE.Camera} camera
 * @param {{ target: THREE.Vector3 }} controls
 */
export function createCameraFly(camera, controls) {
  const fromPos = new THREE.Vector3();
  const toPos = new THREE.Vector3();
  const fromTarget = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  let t = 1;
  let duration = 1;

  return {
    /**
     * @param {THREE.Vector3} target point to orbit after the move
     * @param {THREE.Vector3} position camera position after the move
     */
    flyTo(target, position, seconds = 1.2) {
      fromPos.copy(camera.position);
      fromTarget.copy(controls.target);
      toTarget.copy(target);
      toPos.copy(position);
      duration = Math.max(seconds, 0.001);
      t = 0;
    },
    /** @param {number} realDt seconds */
    update(realDt) {
      if (t >= 1) return;
      t += realDt / duration;
      // Snap so float drift (0.1 * 10 = 0.9999999) does not need an extra frame.
      if (t > 1 - 1e-6) t = 1;
      const k = easeInOutCubic(t);
      camera.position.lerpVectors(fromPos, toPos, k);
      controls.target.lerpVectors(fromTarget, toTarget, k);
    },
    cancel() {
      t = 1;
    },
    isFlying: () => t < 1,
  };
}

const _dir = new THREE.Vector3();

/**
 * Where to put the camera to frame a galaxy: an oblique view from the side
 * the camera is already on, so the move feels short.
 *
 * @param {THREE.Vector3} cameraPosition
 * @param {THREE.Vector3} center
 * @param {THREE.Vector3} normal unit disc normal
 * @param {number} radius
 * @param {{ min: number, max: number }} distanceLimits
 * @param {THREE.Vector3} [viewDir] fixed unit direction from the galaxy to the
 *   camera (keeps a real galaxy's inclination); default: mostly face-on
 */
export function framingPosition(cameraPosition, center, normal, radius, distanceLimits, viewDir) {
  if (viewDir) {
    _dir.copy(viewDir).normalize();
  } else {
    _dir.subVectors(cameraPosition, center);
    if (_dir.lengthSq() < 1e-8) _dir.copy(normal);
    _dir.normalize();
    // View from the disc's visible side, tilted toward face-on.
    const side = Math.sign(_dir.dot(normal)) || 1;
    _dir.multiplyScalar(0.45).addScaledVector(normal, 0.9 * side).normalize();
  }
  const distance = THREE.MathUtils.clamp(radius * 2.6, distanceLimits.min, distanceLimits.max);
  return center.clone().addScaledVector(_dir, distance);
}
