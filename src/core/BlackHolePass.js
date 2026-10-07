import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { CHUNKS, glsl } from '../galaxy/shaders/glsl.js';
import { getNoiseTexture } from '../galaxy/noiseTexture.js';
import { SHADOW_B, DISC_INNER, DISC_OUTER, LENS_REACH, MAX_DEFLECTION, shadowPixels, lensFade, pickLenses } from '../galaxy/blackHole.js';
import { MAX_GALAXIES } from '../galaxy/params.js';

/** Lenses drawn per frame (the largest on screen). */
export const MAX_LENSES = 4;

const f = (x) => x.toFixed(4);

// Everything runs in view space in units of Rs, camera at the origin. A ray
// is bent once, at its closest approach to the hole, by the Schwarzschild
// deflection (galaxy/blackHole.js deflection). This "one bend" model gives the
// shadow, the lensed sky behind the hole and the far side of the accretion
// disc lifted over the shadow (the Interstellar arch) with no loop per pixel.
// Pixels far from every hole only copy the input.
const fragmentShader = glsl(
  CHUNKS.model,
  /* glsl */ `
  #define MAX_LENSES ${MAX_LENSES}
  uniform sampler2D tDiffuse;
  uniform sampler2D uNoise;
  uniform vec2 uTanHalfFov; // (x, y)
  uniform int uCount;
  uniform vec4 uLensCenter[MAX_LENSES]; // xyz: centre / Rs (view space), w: fade
  uniform vec4 uLensNormal[MAX_LENSES]; // xyz: disc normal (view space), w: time
  uniform float uDiscGain;
  varying vec2 vUv;

  const float SHADOW_B = ${f(SHADOW_B)};
  const float DISC_INNER = ${f(DISC_INNER)};
  const float DISC_OUTER = ${f(DISC_OUTER)};
  const float LENS_REACH = ${f(LENS_REACH)};
  const float MAX_DEFLECTION = ${f(MAX_DEFLECTION)};
  const float PI = 3.14159265;
  // Peak disc temperature (K); flux peaks just outside the ISCO.
  const float T_PEAK = 11000.0;
  // Runs after bloom, so the disc must outshine a saturated core by itself.
  const float DISC_GAIN = 4.0;
  const float RING_GAIN = 1.5;

  // Mirror of blackHole.js deflection().
  float deflection(float b) {
    if (b <= SHADOW_B) return MAX_DEFLECTION;
    float weak = 2.0 / b + (15.0 * PI) / (16.0 * b * b);
    float strong = -log(b / SHADOW_B - 1.0) - 0.4;
    return min(MAX_DEFLECTION, max(weak, strong));
  }

  // The rendered scene seen along a view-space direction (it is all treated as
  // far behind the hole). Rays bent off screen fade to black.
  vec3 sampleDir(vec3 d) {
    if (d.z > -0.02) return vec3(0.0);
    vec2 uv = (d.xy / -d.z) / uTanHalfFov * 0.5 + 0.5;
    vec2 off = max(abs(uv - 0.5) - 0.5, 0.0);
    return texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb * exp(-dot(off, off) * 400.0);
  }

  // Thin accretion disc at hit point h (relative to the hole), seen along rd.
  // rgb: emitted light, a: opacity.
  vec4 discLight(vec3 h, vec3 rd, vec3 n, float time) {
    float r = length(h);
    if (r < DISC_INNER || r > DISC_OUTER) return vec4(0.0);
    vec3 e1 = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    float phi = atan(dot(h, cross(n, e1)), dot(h, e1));
    // Keplerian shear: inner gas laps the outer, so the streaks wind up.
    float omega = pow(DISC_INNER / r, 1.5) * 1.5;
    float streak = texture2D(uNoise, vec2(log(r) * 0.9, (phi - omega * time) / (2.0 * PI) * 3.0)).r;
    // Shakura–Sunyaev flux ∝ r⁻³ (1 − √(r_in/r)), normalised to peak 1; T ∝ flux^¼.
    float x = DISC_INNER / r;
    float flux = x * x * x * (1.0 - sqrt(x)) * 17.6;
    // Relativistic Doppler factor of the orbiting gas (prograde about n), plus
    // gravitational redshift. Beaming ∝ g⁴: the approaching side blazes.
    vec3 v = normalize(cross(n, h));
    float beta = sqrt(0.5 / r);
    float D = sqrt(1.0 - beta * beta) / (1.0 - beta * dot(v, -rd));
    float g = D * sqrt(1.0 - 1.0 / r);
    float temp = max(T_PEAK * pow(flux, 0.25) * g, 1000.0);
    float g2 = g * g;
    float edge = gm_smoothstep(DISC_INNER, DISC_INNER * 1.12, r) * (1.0 - gm_smoothstep(DISC_OUTER * 0.55, DISC_OUTER, r));
    vec3 col = gm_blackbody(temp) * flux * g2 * g2 * (0.45 + 1.1 * streak);
    return vec4(col * edge * DISC_GAIN * uDiscGain, 0.92 * edge);
  }

  void main() {
    vec3 col = texture2D(tDiffuse, vUv).rgb;
    vec3 rd = normalize(vec3((vUv * 2.0 - 1.0) * uTanHalfFov, -1.0));
    for (int i = 0; i < MAX_LENSES; i++) {
      if (i >= uCount) break;
      vec3 c = uLensCenter[i].xyz;
      float tc = dot(c, rd);
      if (tc <= 0.0) continue;
      vec3 p0 = rd * tc; // closest approach
      vec3 bv = p0 - c;
      float b = length(bv);
      if (b >= LENS_REACH) continue;

      vec3 n = uLensNormal[i].xyz;
      float time = uLensNormal[i].w;
      bool captured = b < SHADOW_B;
      // Bend toward the hole; fade the bend out before LENS_REACH (no seam).
      float a = deflection(b) * (1.0 - gm_smoothstep(0.45 * LENS_REACH, LENS_REACH, b));
      vec3 rd2 = normalize(rd * cos(a) - bv / max(b, 1e-4) * sin(a));
      vec3 L = captured ? vec3(0.0) : sampleDir(rd2);

      // Far image: the bent ray crosses the disc plane behind the hole.
      float dn2 = dot(rd2, n);
      if (!captured && abs(dn2) > 1e-4) {
        float t2 = dot(c - p0, n) / dn2;
        if (t2 > 0.0) {
          vec4 d = discLight(p0 + rd2 * t2 - c, rd2, n, time);
          L = d.rgb + L * (1.0 - d.a);
        }
      }
      // Photon ring: light that orbited the hole, piled up at the critical b.
      float ring = exp(-pow((b - SHADOW_B * 1.03) / 0.09, 2.0));
      L += gm_blackbody(6500.0) * ring * RING_GAIN * uDiscGain;
      // Near image: the straight ray meets the disc before its closest approach.
      float dn = dot(rd, n);
      if (abs(dn) > 1e-4) {
        float t1 = dot(c, n) / dn;
        if (t1 > 0.0 && t1 < tc) {
          vec4 d = discLight(rd * t1 - c, rd, n, time);
          L = d.rgb + L * (1.0 - d.a);
        }
      }
      col = mix(col, L, uLensCenter[i].w);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`,
);

const _view = new THREE.Vector3();

/**
 * Gravitational lensing, shadow and accretion disc of the central black
 * holes, as one screen pass after bloom, before tone mapping (HDR). It runs only
 * while a black hole is at least ~1 px on screen; then pixels outside the
 * lens reach just copy the input.
 */
export class BlackHolePass extends Pass {
  /** @param {THREE.PerspectiveCamera} camera */
  constructor(camera) {
    super();
    this.camera = camera;
    this.enabled = false;
    /** Fills candidate slots ({ center, normal, rsWorld, time }) and returns the count. */
    this.source = null;
    /** Off by setting or quality tier. */
    this.allowed = true;
    this.height = 1;
    this.candidates = Array.from({ length: MAX_GALAXIES }, () => ({
      center: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      rsWorld: 0,
      time: 0,
      shadowPx: 0,
      visible: false,
    }));
    this.picked = new Array(MAX_LENSES);
    this.material = new THREE.ShaderMaterial({
      name: 'BlackHoleLens',
      uniforms: {
        tDiffuse: { value: null },
        uNoise: { value: getNoiseTexture() },
        uTanHalfFov: { value: new THREE.Vector2(1, 1) },
        uCount: { value: 0 },
        uLensCenter: { value: Array.from({ length: MAX_LENSES }, () => new THREE.Vector4()) },
        uLensNormal: { value: Array.from({ length: MAX_LENSES }, () => new THREE.Vector4()) },
        uDiscGain: { value: 1 },
      },
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

  setSize(width, height) {
    this.height = height;
  }

  /** Disc brightness for the wavelength band (bands.js agnGain). */
  setDiscGain(gain) {
    this.material.uniforms.uDiscGain.value = gain;
  }

  /** Pick this frame's lenses; disables the pass when none is resolved. */
  update() {
    const count = this.allowed && this.source ? this.source(this.candidates) : 0;
    if (count === 0) {
      this.enabled = false;
      return;
    }
    const { camera } = this;
    camera.updateMatrixWorld();
    const view = camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const tanY = 1 / camera.projectionMatrix.elements[5];
    const tanX = 1 / camera.projectionMatrix.elements[0];
    for (let i = 0; i < count; i++) {
      const c = this.candidates[i];
      _view.copy(c.center).applyMatrix4(view);
      const depth = -_view.z;
      c.shadowPx = shadowPixels(c.rsWorld, depth, tanY, this.height);
      // In front of the camera and the lens reach overlaps the screen.
      const reach = (LENS_REACH * c.rsWorld) / Math.max(depth, 1e-6);
      c.visible = depth > 0 && Math.abs(_view.x / depth) < tanX + reach && Math.abs(_view.y / depth) < tanY + reach;
    }
    const n = pickLenses(this.candidates, count, MAX_LENSES, this.picked);
    const u = this.material.uniforms;
    for (let i = 0; i < n; i++) {
      const c = this.picked[i];
      _view.copy(c.center).applyMatrix4(view).divideScalar(c.rsWorld);
      u.uLensCenter.value[i].set(_view.x, _view.y, _view.z, lensFade(c.shadowPx));
      _view.copy(c.normal).transformDirection(view);
      u.uLensNormal.value[i].set(_view.x, _view.y, _view.z, c.time);
    }
    u.uCount.value = n;
    u.uTanHalfFov.value.set(tanX, tanY);
    this.enabled = n > 0;
  }

  render(renderer, writeBuffer, readBuffer) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
