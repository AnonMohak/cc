import * as THREE from 'three';
import { LAYERS } from '../core/layers.js';
import { bakeSkyMap, SKY_MAP_WIDTH, SKY_MAP_HEIGHT, SKY_MAP_SCALE } from './skyMap.js';

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Equirectangular lookup; must match bakeSkyMap's texel layout. No mipmaps,
// so the longitude wrap at ±π shows no seam.
const fragmentShader = /* glsl */ `
  uniform sampler2D uSky;
  uniform float uIntensity;
  uniform vec3 uBandTint;
  varying vec3 vDir;
  const float PI = 3.14159265;
  void main() {
    vec3 d = normalize(vDir);
    vec2 uv = vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, 0.5 - asin(clamp(d.y, -1.0, 1.0)) / PI);
    vec3 c = texture2D(uSky, uv).rgb * uIntensity * uBandTint;
    // Dither: the faint gradients would band in the 8-bit output.
    float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    gl_FragColor = vec4(c * (1.0 + (n - 0.5) * 0.12), 1.0);
  }
`;

// Linear radiance of the band peak on screen: faint, well under the bloom threshold.
const SKY_INTENSITY = 0.035;

/**
 * Milky Way background (see skyMap.js). The texture bakes in a worker; until
 * it arrives the sky is hidden. The sphere follows the camera, like the
 * starfield, so it has no parallax and never clips.
 *
 * @param {{ onReady?: () => void, radius?: number }} [options]
 */
export function createSky({ onReady, radius = 500 } = {}) {
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uSky: { value: null },
      uIntensity: { value: SKY_INTENSITY * SKY_MAP_SCALE },
      uBandTint: { value: new THREE.Color(1, 1, 1) },
    },
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const geometry = new THREE.SphereGeometry(radius, 32, 16);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2; // under the starfield
  mesh.layers.set(LAYERS.BACKGROUND);
  mesh.visible = false;

  let wanted = true;
  let texture = null;
  let worker = null;
  let disposed = false;

  function accept(pixels, width, height) {
    if (disposed) return;
    texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    material.uniforms.uSky.value = texture;
    mesh.visible = wanted;
    onReady?.();
  }

  function bakeOnMainThread() {
    // Smaller, so the one-time stall stays short.
    setTimeout(() => accept(bakeSkyMap(512, 256), 512, 256), 0);
  }

  if (typeof Worker === 'function') {
    try {
      worker = new Worker(new URL('./skyWorker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        accept(data.pixels, data.width, data.height);
        worker.terminate();
        worker = null;
      };
      worker.onerror = () => {
        worker?.terminate();
        worker = null;
        bakeOnMainThread();
      };
      worker.postMessage({ width: SKY_MAP_WIDTH, height: SKY_MAP_HEIGHT });
    } catch {
      bakeOnMainThread();
    }
  } else {
    bakeOnMainThread();
  }

  return {
    object: mesh,
    /** Shared read-only with core/BlackHolePass.js (uSky, uIntensity, uBandTint). */
    uniforms: material.uniforms,
    /** @param {THREE.Vector3} cameraPosition */
    update(cameraPosition) {
      mesh.position.copy(cameraPosition);
    },
    /** Tint for the wavelength band (bands.js skyTint). */
    setBandTint(r, g, b) {
      material.uniforms.uBandTint.value.setRGB(r, g, b);
    },
    setVisible(visible) {
      wanted = visible;
      mesh.visible = visible && texture !== null;
    },
    dispose() {
      disposed = true;
      worker?.terminate();
      geometry.dispose();
      material.dispose();
      texture?.dispose();
    },
  };
}
