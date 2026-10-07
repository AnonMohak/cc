import * as THREE from 'three';
import { createRandom } from '../galaxy/random.js';
import { LAYERS } from '../core/layers.js';
import { starDensity } from './skyMap.js';
import spikesChunk from '../galaxy/shaders/chunks/spikes.glsl?raw';

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
  uniform vec3 uBandTint;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float a = pow(1.0 - d, 1.6);
    gl_FragColor = vec4(vColor * uBandTint * a, 1.0);
  }
`;

// Diffraction spikes on the brightest field stars: a second, larger sprite
// that draws only the spikes (the star itself stays in the main points).
const spikeVertexShader = /* glsl */ `
  uniform float uPixelRatio;
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vSizePx;
  void main() {
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vSizePx = aSize * uPixelRatio;
    gl_PointSize = vSizePx;
  }
`;

const spikeFragmentShader = /* glsl */ `
  uniform float uSpikeStyle;
  uniform vec3 uBandTint;
  varying vec3 vColor;
  varying float vSizePx;
  ${spikesChunk}
  void main() {
    float a = gk_spikes(gl_PointCoord, vSizePx, uSpikeStyle);
    if (a <= 0.003) discard;
    gl_FragColor = vec4(vColor * uBandTint * a * 0.55, 1.0);
  }
`;

/** How many of the brightest field stars get spikes. */
export const SPIKE_STARS = 30;

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
    // Direction on a sphere, denser along the Milky Way band (rejection sampling).
    let u, theta, s;
    do {
      u = rng.range(-1, 1);
      theta = rng.range(0, Math.PI * 2);
      s = Math.sqrt(1 - u * u);
    } while (rng.next() > starDensity(s * Math.cos(theta), u, s * Math.sin(theta)));
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
    uniforms: { uPixelRatio: { value: pixelRatio }, uBandTint: { value: new THREE.Color(1, 1, 1) } },
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  // The brightest stars (colour × sprite area) get spike sprites.
  const order = Array.from({ length: count }, (_, i) => i);
  const score = (i) => (colors[i * 3] + colors[i * 3 + 1] + colors[i * 3 + 2]) * sizes[i] * sizes[i];
  order.sort((a, b) => score(b) - score(a));
  const top = order.slice(0, Math.min(SPIKE_STARS, count));
  const best = top.length ? score(top[0]) : 1;
  const spikePositions = new Float32Array(top.length * 3);
  const spikeColors = new Float32Array(top.length * 3);
  const spikeSizes = new Float32Array(top.length);
  top.forEach((i, k) => {
    for (let c = 0; c < 3; c++) {
      spikePositions[k * 3 + c] = positions[i * 3 + c];
      spikeColors[k * 3 + c] = colors[i * 3 + c];
    }
    spikeSizes[k] = 24 + 56 * (score(i) / best);
  });
  const spikeGeometry = new THREE.BufferGeometry();
  spikeGeometry.setAttribute('position', new THREE.BufferAttribute(spikePositions, 3));
  spikeGeometry.setAttribute('aColor', new THREE.BufferAttribute(spikeColors, 3));
  spikeGeometry.setAttribute('aSize', new THREE.BufferAttribute(spikeSizes, 1));
  const spikeMaterial = new THREE.ShaderMaterial({
    vertexShader: spikeVertexShader,
    fragmentShader: spikeFragmentShader,
    uniforms: { uPixelRatio: material.uniforms.uPixelRatio, uSpikeStyle: { value: 0 }, uBandTint: material.uniforms.uBandTint },
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const spikes = new THREE.Points(spikeGeometry, spikeMaterial);
  spikes.frustumCulled = false;
  spikes.layers.set(LAYERS.BACKGROUND);
  spikes.visible = false;

  const points = new THREE.Points(geometry, material);
  points.add(spikes); // follows the camera with the field
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
    /** 0 off, 1 Hubble, 2 JWST (see spikes.glsl). */
    setSpikeStyle(style) {
      spikeMaterial.uniforms.uSpikeStyle.value = style;
      spikes.visible = style > 0;
    },
    /** Field-star colour × gain for the wavelength band (bands.js skyTint × fieldGain). */
    setBandTint(r, g, b) {
      material.uniforms.uBandTint.value.setRGB(r, g, b);
    },
    spikes,
    dispose() {
      geometry.dispose();
      material.dispose();
      spikeGeometry.dispose();
      spikeMaterial.dispose();
    },
  };
}
