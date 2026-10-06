import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Zoom range and clip planes are tuned together: maxDistance plus the
// largest galaxy must stay well inside `far`.
export const CAMERA_LIMITS = {
  near: 0.05,
  far: 2000,
  minDistance: 0.5,
  maxDistance: 500,
};

/**
 * @param {HTMLElement} domElement
 * @param {number} aspect
 */
export function createCamera(domElement, aspect) {
  const camera = new THREE.PerspectiveCamera(55, aspect, CAMERA_LIMITS.near, CAMERA_LIMITS.far);
  camera.position.set(0, 9, 16);

  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.zoomToCursor = true;
  controls.minDistance = CAMERA_LIMITS.minDistance;
  controls.maxDistance = CAMERA_LIMITS.maxDistance;
  controls.autoRotateSpeed = 0.4;

  function resize(width, height) {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  return { camera, controls, resize };
}
