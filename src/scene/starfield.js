import * as THREE from 'three';
import { createRandom } from '../galaxy/random.js';
import { LAYERS } from '../core/layers.js';

const vertexShader = /* glsl */ `
  uniform float uPixelRatio;
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float a = pow(1.0 - d, 1.6);
    gl_FragColor = vec4(vColor * a, 1.0);
  }
`;

// Rough stellar colors from cool to hot; most field stars look white.
const STAR_TINTS = [
  [1.0, 0.82, 0.68],
  [1.0, 0.93, 0.85],
  [1.0, 1.0, 1.0],
  [0.85, 0.9, 1.0],
  [0.7, 0.8, 1.0],
];

/**
 * Distant background stars on a sphere shell. The shell follows the camera
 * (see `update`) so it never clips and has no parallax, like real far stars.
 */
export function createStarfield({ count = 8000, radius = 900, seed = 1337, pixelRatio = 1 } = {}) {
  const rng = createRandom(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Uniform direction on a sphere.
    const u = rng.range(-1, 1);
    const theta = rng.range(0, Math.PI * 2);
    const s = Math.sqrt(1 - u * u);
    const r = radius * rng.range(0.9, 1);
    positions[i * 3] = r * s * Math.cos(theta);
    positions[i * 3 + 1] = r * u;
    positions[i * 3 + 2] = r * s * Math.sin(theta);

    // Most stars are faint; a few are bright.
    const brightness = 0.4 + 0.6 * Math.pow(rng.next(), 4);
    const tint = STAR_TINTS[Math.floor(rng.next() * STAR_TINTS.length)];
    colors[i * 3] = tint[0] * brightness;
    colors[i * 3 + 1] = tint[1] * brightness;
    colors[i * 3 + 2] = tint[2] * brightness;
    sizes[i] = 1 + 2.5 * Math.pow(rng.next(), 6);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uPixelRatio: { value: pixelRatio } },
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -1;
  points.layers.set(LAYERS.BACKGROUND);

  return {
    object: points,
    /** @param {THREE.Vector3} cameraPosition */
    update(cameraPosition) {
      points.position.copy(cameraPosition);
    },
    setPixelRatio(value) {
      material.uniforms.uPixelRatio.value = value;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
