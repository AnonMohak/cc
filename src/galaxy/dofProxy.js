import * as THREE from 'three';
import { LAYERS } from '../core/layers.js';

/**
 * Invisible stand-ins for depth of field (core/DepthOfFieldPass.js). Stars
 * and volumes write no depth, so each object draws a low-poly ellipsoid that
 * writes the object's CENTRE view distance (not the surface): the whole
 * object then has one focus distance, and the selected one stays sharp even
 * when the camera is inside it. Geometry and material are shared by all
 * objects and never disposed (like the shared noise texture).
 */

let geometry = null;
let material = null;

function shared() {
  if (geometry) return { geometry, material };
  geometry = new THREE.SphereGeometry(1, 16, 8);
  material = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying float vCenterDepth;
      void main() {
        vCenterDepth = -(modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vCenterDepth;
      void main() {
        gl_FragColor = vec4(vCenterDepth, 0.0, 0.0, 1.0);
      }`,
    // Both sides: the camera may be inside the proxy (inside a galaxy).
    side: THREE.DoubleSide,
  });
  return { geometry, material };
}

/**
 * A proxy mesh in the object's local (unit) space, on layer DOF.
 * @param {boolean} blackHole a standalone black hole (round star cloud) or a galaxy disc
 */
export function createDofProxy(blackHole) {
  const { geometry: g, material: m } = shared();
  const mesh = new THREE.Mesh(g, m);
  // Galaxies: a flattened disc ellipsoid. Black holes: a sphere that
  // Galaxy.setHole sizes to just past the accretion disc.
  if (blackHole) mesh.scale.setScalar(1);
  else mesh.scale.set(1.1, 0.3, 1.1);
  mesh.layers.set(LAYERS.DOF);
  return mesh;
}
