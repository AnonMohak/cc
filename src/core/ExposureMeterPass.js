import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { METER_SIZE, LOG_MIN, LOG_MAX } from './autoExposure.js';

const f = (x) => x.toFixed(4);

// One meter texel per screen block: 4 bilinear taps (each averages 2×2 source
// pixels) of the HDR image before tone mapping, so the reading does not
// depend on the exposure it controls (no feedback loop).
const fragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uBias; // Exposure slider: what counts as bright on screen
  varying vec2 vUv;

  const float LOG_MIN = ${f(LOG_MIN)};
  const float LOG_MAX = ${f(LOG_MAX)};
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
  // Centre weighting: Focus puts the galaxy in the middle.
  const float SIGMA = 0.25;

  void main() {
    vec2 o = vec2(0.25 / ${METER_SIZE}.0);
    float l = 0.25 * (
      dot(texture2D(tDiffuse, vUv + vec2(-o.x, -o.y)).rgb, LUMA) +
      dot(texture2D(tDiffuse, vUv + vec2(o.x, -o.y)).rgb, LUMA) +
      dot(texture2D(tDiffuse, vUv + vec2(-o.x, o.y)).rgb, LUMA) +
      dot(texture2D(tDiffuse, vUv + vec2(o.x, o.y)).rgb, LUMA));
    vec2 c = vUv - 0.5;
    float weight = exp(-dot(c, c) / (2.0 * SIGMA * SIGMA));
    // Black space is not "bright": a small galaxy never triggers darkening.
    float bright = smoothstep(0.15, 0.45, l * uBias);
    float packedLog = clamp((log2(max(l, 1e-6)) - LOG_MIN) / (LOG_MAX - LOG_MIN), 0.0, 1.0);
    gl_FragColor = vec4(packedLog, bright * weight, weight, 1.0);
  }
`;

/**
 * Measures the HDR frame for auto exposure (autoExposure.js) into a tiny
 * RGBA8 target and reads it back asynchronously (no GPU stall; one read in
 * flight). Leaves the image chain untouched. `onReading(bytes)` gets each
 * result a few frames late.
 */
export class ExposureMeterPass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    this.enabled = false;
    /** @type {((bytes: Uint8Array) => void) | null} */
    this.onReading = null;
    /** Set when the async readback is missing or failed: auto exposure is off. */
    this.failed = false;
    this.pending = false;
    this.bytes = new Uint8Array(METER_SIZE * METER_SIZE * 4);
    this.target = new THREE.WebGLRenderTarget(METER_SIZE, METER_SIZE, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
    });
    this.material = new THREE.ShaderMaterial({
      name: 'ExposureMeter',
      uniforms: { tDiffuse: { value: null }, uBias: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }

  setBias(bias) {
    this.material.uniforms.uBias.value = bias;
  }

  render(renderer, writeBuffer, readBuffer) {
    if (this.failed || this.pending) return; // one reading at a time
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.target);
    this.fsQuad.render(renderer);
    if (typeof renderer.readRenderTargetPixelsAsync !== 'function') {
      this.failed = true;
      return;
    }
    this.pending = true;
    renderer
      .readRenderTargetPixelsAsync(this.target, 0, 0, METER_SIZE, METER_SIZE, this.bytes)
      .then(() => this.onReading?.(this.bytes))
      .catch(() => {
        this.failed = true;
      })
      .finally(() => {
        this.pending = false;
      });
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
