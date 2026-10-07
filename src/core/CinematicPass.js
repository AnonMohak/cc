import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Lateral chromatic aberration at full strength, in UV units per unit of
// distance from the centre: ~10 px in the corners of a 1080p frame.
const MAX_ABERRATION = 0.012;
// Grain amplitude at full strength (display-space, 0–1 colour units).
const MAX_GRAIN = 0.09;

const CinematicShader = {
  name: 'CinematicShader',
  uniforms: {
    tDiffuse: { value: null },
    uAspect: { value: 1 },
    uVignette: { value: 0 },
    uGrain: { value: 0 },
    uAberration: { value: 0 },
    uSeed: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  // Runs after OutputPass, so it works in display (sRGB) space: grain and
  // vignette then look the same at any exposure.
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAspect;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    uniform float uSeed;
    varying vec2 vUv;

    // Integer hash: sin()-based hashes band on mobile half-precision GPUs.
    float hash(uvec3 v) {
      uint h = v.x * 1973u + v.y * 9277u + v.z * 26699u;
      h = (h ^ (h >> 16u)) * 0x7feb352du;
      h = (h ^ (h >> 15u)) * 0x846ca68bu;
      h ^= h >> 16u;
      return float(h) * (1.0 / 4294967295.0);
    }

    void main() {
      vec2 c = vUv - 0.5;
      vec3 col;
      if (uAberration > 0.0) {
        // Lateral CA grows with the distance from the optical axis, like a lens:
        // red bends less than blue, so the two fringes split outward/inward.
        vec2 shift = c * uAberration;
        col.r = texture2D(tDiffuse, vUv - shift).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv + shift).b;
      } else {
        col = texture2D(tDiffuse, vUv).rgb;
      }

      // Round vignette: 0 at the centre, 1 in the corners whatever the aspect.
      vec2 p = c * vec2(uAspect, 1.0);
      float r = length(p) / length(vec2(uAspect, 1.0) * 0.5);
      col *= 1.0 - uVignette * smoothstep(0.35, 1.05, r);

      if (uGrain > 0.0) {
        // Film grain is strongest in the mid-tones; keep a little in the black
        // sky so it reads as film, not as a dirty screen.
        float n = hash(uvec3(uvec2(gl_FragCoord.xy), uint(uSeed))) - 0.5;
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        col += n * uGrain * (0.3 + 0.7 * sqrt(clamp(lum, 0.0, 1.0)) * (1.0 - lum));
      }
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

/**
 * Vignette, film grain and chromatic aberration in one full-screen pass.
 * The composer skips it (enabled = false) when every effect is at 0 or the
 * quality tier is too cheap for an extra full-resolution pass.
 */
export class CinematicPass extends ShaderPass {
  constructor() {
    super(CinematicShader);
    this.frame = 0;
  }

  /** @param {{ vignette: number, grain: number, aberration: number }} amounts 0–1 each */
  setAmounts({ vignette, grain, aberration }) {
    this.uniforms.uVignette.value = vignette;
    this.uniforms.uGrain.value = grain * MAX_GRAIN;
    this.uniforms.uAberration.value = aberration * MAX_ABERRATION;
  }

  setSize(width, height) {
    this.uniforms.uAspect.value = width / Math.max(1, height);
  }

  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    // A new grain pattern each rendered frame (wraps long before uint overflow).
    this.frame = (this.frame + 1) % 65536;
    this.uniforms.uSeed.value = this.frame;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}

