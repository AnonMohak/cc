import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { CHUNKS, glsl } from '../galaxy/shaders/glsl.js';
import { getNoiseTexture, NOISE_SIZE } from '../galaxy/noiseTexture.js';
import { BANDS } from '../galaxy/bands.js';
import { SHADOW_B, DISC_INNER, DISC_OUTER, LENS_REACH, MAX_DEFLECTION, shadowPixels, lensFade, pickLenses } from '../galaxy/blackHole.js';
import { MAX_GALAXIES } from '../galaxy/params.js';

/** Lenses drawn per frame (the largest on screen). */
export const MAX_LENSES = 4;

const f = (x) => x.toFixed(4);

// Everything runs in view space in units of Rs, camera at the origin. A ray
// is bent once, at its closest approach to the hole, by the Schwarzschild
// deflection (galaxy/blackHole.js deflection). This "one bend" model gives the
// shadow, the lensed sky behind the hole and the far side of the accretion
// disc lifted over and under the shadow (the Interstellar arches) with no
// loop per pixel. Pixels far from every hole only copy the input.
//
// The look follows Gargantua (Interstellar), not the physics: no Doppler
// beaming (both sides equally bright), a gold palette per band, fine
// concentric streaks, a soft haze for thickness, a glow halo (bloom ran
// before this pass), thin photon rings and a horizontal lens streak.
const fragmentShader = glsl(
  CHUNKS.model,
  /* glsl */ `
  #define MAX_LENSES ${MAX_LENSES}
  uniform sampler2D tDiffuse;
  uniform sampler2D uNoise;
  uniform vec2 uTanHalfFov; // (x, y)
  uniform vec2 uResolution; // render target, device px
  uniform float uPixelAngle; // radians per device px at the screen centre
  uniform int uCount;
  uniform vec4 uLensCenter[MAX_LENSES]; // xyz: centre / Rs (view space), w: fade
  uniform vec4 uLensNormal[MAX_LENSES]; // xyz: disc normal (view space), w: time
  uniform vec4 uLensDisc[MAX_LENSES]; // x: disc outer radius (Rs), y: gain, z: glow, w: streak (0/1)
  uniform vec3 uLensHot[MAX_LENSES]; // disc colour at the inner edge (visible light)
  uniform vec3 uLensCool[MAX_LENSES]; // disc colour at the outer edge
  uniform float uDiscGain; // band brightness (bands.js agnGain)
  // Band tint: band colour / visible colour (bands.js agnHot, agnCool); 1 in visible.
  uniform vec3 uBandHot;
  uniform vec3 uBandCool;
  // Background for rays bent off the screen: the Milky Way map (shared with
  // scene/sky.js) and procedural field stars.
  uniform mat3 uViewToWorld;
  uniform sampler2D uSky;
  uniform float uSkyIntensity;
  uniform vec3 uSkyTint;
  uniform float uSkyOn;
  uniform float uStarGain;
  varying vec2 vUv;

  const float SHADOW_B = ${f(SHADOW_B)};
  const float DISC_INNER = ${f(DISC_INNER)};
  const float LENS_REACH = ${f(LENS_REACH)};
  const float MAX_DEFLECTION = ${f(MAX_DEFLECTION)};
  const float PI = 3.14159265;
  const float NOISE_TEXELS = ${f(NOISE_SIZE)};
  // Runs after bloom, so the disc must outshine a saturated core by itself.
  // Lower than the old 4.0: ACES turns brighter light white, and the film
  // disc is gold.
  const float DISC_GAIN = 2.0;
  const float RING_GAIN = 3.0;
  const float HAZE_GAIN = 0.9;
  const float HALO_GAIN = 0.1;
  const float HALO_SCALE = 6.0; // Rs
  const float STREAK_GAIN = 0.2;
  const float STREAK_LENGTH = 5.0; // × the disc radius on screen
  // The rendered scene around a hole is mostly the galaxy's own bulge, close
  // behind it, not at infinity: bent rays read it on a plane this far (Rs)
  // behind the closest approach. At infinity the bright bulge cusp became a
  // wide white Einstein ring that drowned the disc; this near the ring stays
  // small and the disc covers it. The sky and stars off the screen stay at
  // infinity.
  const float SOURCE_DEPTH = 40.0;
  // Scene light inside the lens is dimmed toward the hole (a cleared cavity),
  // so the HDR bulge cusp does not wash out the disc. Back to full at the
  // lens edge: no seam. Light read from right behind the shadow (which no
  // unlensed pixel shows) is removed too: that is where the cusp sits.
  const float CAVITY = 0.03;
  // Disc streak noise: tiles per Rs along the radius (one tile per turn around).
  const float STREAK_FREQ_R = 0.35;
  const float FINE_FREQ_R = 1.1;
  // Slow, calm spin (the film disc barely moves).
  const float SPIN = 0.5;
  // Procedural field stars: cells per cube-face side and the chance of a star
  // in a cell (~8 000 on the whole sky, like scene/starfield.js).
  const float STAR_CELLS = 96.0;
  const float STAR_CHANCE = 0.14;

  // Mirror of blackHole.js deflection().
  float deflection(float b) {
    if (b <= SHADOW_B) return MAX_DEFLECTION;
    float weak = 2.0 / b + (15.0 * PI) / (16.0 * b * b);
    float strong = -log(b / SHADOW_B - 1.0) - 0.4;
    return min(MAX_DEFLECTION, max(weak, strong));
  }

  // The lens being drawn (set at the top of each loop pass in main).
  vec3 lensHot;
  vec3 lensCool;
  float discOuter;
  float lensGain;

  float hash12(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  // Sparse point stars on a cube-map grid (world direction d).
  vec3 fieldStars(vec3 d) {
    vec3 a = abs(d);
    vec2 uv;
    float face;
    if (a.x >= a.y && a.x >= a.z) { uv = d.yz / a.x; face = d.x > 0.0 ? 0.0 : 1.0; }
    else if (a.y >= a.z) { uv = d.xz / a.y; face = d.y > 0.0 ? 2.0 : 3.0; }
    else { uv = d.xy / a.z; face = d.z > 0.0 ? 4.0 : 5.0; }
    vec2 g = (uv * 0.5 + 0.5) * STAR_CELLS;
    vec2 cell = floor(g);
    vec2 key = cell + face * 131.0;
    if (hash12(key) > STAR_CHANCE) return vec3(0.0);
    vec2 centre = cell + 0.2 + 0.6 * vec2(hash12(key + 17.0), hash12(key + 53.0));
    // ~1.2 px radius in cell units (one face spans ~2 rad).
    float radius = max(1.2 * uPixelAngle * STAR_CELLS * 0.5, 0.02);
    float k = max(1.0 - length(g - centre) / radius, 0.0);
    float brightness = 0.4 + 0.6 * pow(hash12(key + 91.0), 4.0);
    vec3 tint = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.85, 0.7), hash12(key + 7.0));
    return tint * brightness * pow(k, 1.6) * uSkyTint * uStarGain;
  }

  // What lies far behind along a view-space direction, off the screen.
  vec3 background(vec3 dView) {
    vec3 d = normalize(uViewToWorld * dView);
    vec3 c = fieldStars(d);
    if (uSkyOn > 0.5) {
      // Same equirect lookup as scene/sky.js.
      vec2 uv = vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, 0.5 - asin(clamp(d.y, -1.0, 1.0)) / PI);
      c += texture2D(uSky, uv).rgb * uSkyIntensity * uSkyTint;
    }
    return c;
  }

  // The rendered scene seen along view-space direction d; where d leaves the
  // screen, the sky and stars along dSky.
  vec3 sampleDir(vec3 d, vec3 dSky) {
    float w = 0.0;
    vec3 screen = vec3(0.0);
    if (d.z < -0.02) {
      vec2 uv = (d.xy / -d.z) / uTanHalfFov * 0.5 + 0.5;
      vec2 off = max(abs(uv - 0.5) - 0.5, 0.0);
      w = exp(-dot(off, off) * 400.0);
      screen = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
    }
    return w > 0.99 ? screen : screen * w + background(dSky) * (1.0 - w);
  }

  // Disc colour by the normalised flux q (1 at the inner peak): gold outside,
  // white-hot at the peak.
  vec3 discColour(float q) {
    vec3 c = mix(lensCool, lensHot, pow(q, 0.35));
    return c + (1.0 - c) * 0.25 * q * q * q;
  }

  // Shakura–Sunyaev flux ∝ r⁻³ (1 − √(r_in/r)), normalised to peak 1.
  float discFlux(float r) {
    float x = DISC_INNER / r;
    return x * x * x * (1.0 - sqrt(x)) * 17.6;
  }

  // Thin accretion disc at hit point h (relative to the hole), seen along rd
  // from distance dist (Rs). rgb: emitted light, a: opacity. The noise LOD is
  // explicit (pixel footprint): the atan seam and the branches around this
  // call would otherwise pick wrong mip levels.
  vec4 discLight(vec3 h, vec3 rd, vec3 n, float time, float dist) {
    float r = length(h);
    if (r < DISC_INNER || r > discOuter) return vec4(0.0);
    vec3 e1 = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    float phi = atan(dot(h, cross(n, e1)), dot(h, e1));
    // Keplerian shear: inner gas laps the outer, so the streaks wind up.
    float omega = pow(DISC_INNER / r, 1.5) * SPIN;
    float turn = (phi - omega * time) / (2.0 * PI);
    // Footprint of one pixel on the disc (Rs); grazing views stretch it.
    float foot = dist * uPixelAngle / sqrt(max(abs(dot(rd, n)), 0.02));
    float lod = log2(max(foot * STREAK_FREQ_R * NOISE_TEXELS, 1.0));
    // Concentric streaks: fast along the radius, slow around (whole turns per
    // tile, so no seam).
    float s1 = textureLod(uNoise, vec2(r * STREAK_FREQ_R, turn), lod).r;
    float s2 = textureLod(uNoise, vec2(r * FINE_FREQ_R + 0.37, turn * 2.0 + 0.5), lod + log2(FINE_FREQ_R / STREAK_FREQ_R)).g;
    float streak = gm_smoothstep(0.3, 0.7, 0.55 * s1 + 0.45 * s2);
    float q = discFlux(r);
    float edge = gm_smoothstep(DISC_INNER, DISC_INNER * 1.08, r) * (1.0 - gm_smoothstep(discOuter * 0.45, discOuter, r));
    vec3 col = discColour(q) * pow(q, 0.55) * (0.35 + 1.3 * streak);
    return vec4(col * edge * DISC_GAIN * lensGain, edge * mix(0.6, 1.0, pow(q, 0.3)));
  }

  // Soft, flared haze around the thin disc (fake thickness), sampled once at
  // the ray's closest approach p (relative to the hole). Edge-on it thickens
  // the band; face-on it is a soft glow over the disc.
  vec3 discHaze(vec3 p, vec3 n, float time, float dist) {
    float h = dot(p, n);
    vec3 inPlane = p - n * h;
    float r = length(inPlane);
    float thick = 0.35 + 0.12 * r;
    float profile = gm_smoothstep(DISC_INNER * 0.8, DISC_INNER * 1.6, r) * exp(-r / (discOuter * 0.39));
    float k = exp(-(h * h) / (thick * thick)) * profile;
    if (k < 1e-3) return vec3(0.0);
    vec3 e1 = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    float turn = (atan(dot(inPlane, cross(n, e1)), dot(inPlane, e1)) - time * SPIN * 0.3) / (2.0 * PI);
    float lod = log2(max(dist * uPixelAngle * 0.12 * NOISE_TEXELS, 1.0));
    float smoke = textureLod(uNoise, vec2(r * 0.12, turn + h * 0.05), lod).r;
    return discColour(discFlux(max(r, DISC_INNER * 1.36))) * k * (0.5 + smoke) * HAZE_GAIN * lensGain;
  }

  void main() {
    vec3 col = texture2D(tDiffuse, vUv).rgb;
    vec3 rd = normalize(vec3((vUv * 2.0 - 1.0) * uTanHalfFov, -1.0));
    vec3 streaks = vec3(0.0);
    for (int i = 0; i < MAX_LENSES; i++) {
      if (i >= uCount) break;
      vec3 c = uLensCenter[i].xyz;
      float fade = uLensCenter[i].w;
      vec4 disc = uLensDisc[i];
      discOuter = disc.x;
      lensGain = uDiscGain * disc.y;
      lensHot = uLensHot[i] * uBandHot;
      lensCool = uLensCool[i] * uBandCool;
      float tc = dot(c, rd);
      if (tc <= 0.0 || c.z >= 0.0) continue;
      vec3 p0 = rd * tc; // closest approach
      vec3 bv = p0 - c;
      float b = length(bv);

      // Horizontal lens streak through the hole; it reaches past the lens.
      // Faint over the shadow, so the shadow still reads black.
      vec2 dpx = (vUv - ((c.xy / -c.z) / uTanHalfFov * 0.5 + 0.5)) * uResolution;
      float discPx = discOuter * 0.5 / (-c.z * uPixelAngle);
      float thick = max(1.2, uResolution.y / 700.0);
      float streak = exp(-abs(dpx.y) / thick - abs(dpx.x) / max(discPx * STREAK_LENGTH, 1.0));
      streaks += mix(lensHot, vec3(1.0), 0.3) * streak * STREAK_GAIN * lensGain * disc.w * fade
        * mix(0.25, 1.0, gm_smoothstep(SHADOW_B * 0.6, SHADOW_B * 1.2, b));

      if (b >= LENS_REACH) continue;
      vec3 n = uLensNormal[i].xyz;
      float time = uLensNormal[i].w;
      bool captured = b < SHADOW_B;
      float reachFade = 1.0 - gm_smoothstep(0.45 * LENS_REACH, LENS_REACH, b);
      // Bend toward the hole; fade the bend out before LENS_REACH (no seam).
      float a = deflection(b) * reachFade;
      vec3 rd2 = normalize(rd * cos(a) - bv / max(b, 1e-4) * sin(a));
      vec3 src = normalize(p0 + rd2 * SOURCE_DEPTH);
      float open = gm_smoothstep(SHADOW_B * 2.0, LENS_REACH, b);
      vec3 L = captured ? vec3(0.0) : sampleDir(src, rd2)
        * mix(CAVITY, 1.0, open * open) * gm_smoothstep(SHADOW_B, SHADOW_B * 2.5, length(cross(src, c)));

      // Far image: the bent ray crosses the disc plane behind the hole (the
      // arches over and under the shadow).
      float dn2 = dot(rd2, n);
      if (!captured && abs(dn2) > 1e-4) {
        float t2 = dot(c - p0, n) / dn2;
        if (t2 > 0.0) {
          vec4 d = discLight(p0 + rd2 * t2 - c, rd2, n, time, tc + t2);
          L = d.rgb + L * (1.0 - d.a);
        }
      }
      // Photon rings: light that orbited the hole, piled up at the critical b.
      // At least ~1 px wide with the same energy, so a small hole does not flicker.
      float w = max(0.04, 0.6 * length(c) * uPixelAngle);
      float ring = (exp(-pow((b - SHADOW_B * 1.015) / w, 2.0))
        + 0.35 * exp(-pow((b - SHADOW_B * 1.09) / (1.6 * w), 2.0))) * (0.04 / w);
      L += lensHot * ring * RING_GAIN * lensGain;
      // Haze and glow halo (bloom ran before this pass); both stay out of the shadow.
      float outside = gm_smoothstep(SHADOW_B, SHADOW_B * 1.25, b);
      vec3 halo = lensCool * HALO_GAIN * lensGain * exp(-(b - SHADOW_B) / HALO_SCALE);
      L += (discHaze(bv, n, time, tc) + halo) * disc.z * outside * reachFade;
      // Near image: the straight ray meets the disc before its closest approach.
      float dn = dot(rd, n);
      if (abs(dn) > 1e-4) {
        float t1 = dot(c, n) / dn;
        if (t1 > 0.0 && t1 < tc) {
          vec4 d = discLight(rd * t1 - c, rd, n, time, t1);
          L = d.rgb + L * (1.0 - d.a);
        }
      }
      col = mix(col, L, fade);
    }
    gl_FragColor = vec4(col + streaks, 1.0);
  }
`,
);

const _view = new THREE.Vector3();

/**
 * Gravitational lensing, shadow and accretion disc of the central black
 * holes, as one screen pass after bloom, before tone mapping (HDR). It runs only
 * while a black hole is at least ~1 px on screen; then pixels outside the
 * lens reach just copy the input (plus the thin lens streak).
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
      // Disc look (Galaxy.blackHoleInfo): outer radius (Rs), gain, glow,
      // streak (0/1), inner and outer colours (linear, visible light).
      discOuter: DISC_OUTER,
      gain: 1,
      glow: 1,
      streak: 1,
      hot: new THREE.Color(),
      cool: new THREE.Color(),
    }));
    this.picked = new Array(MAX_LENSES);
    this.material = new THREE.ShaderMaterial({
      name: 'BlackHoleLens',
      uniforms: {
        tDiffuse: { value: null },
        uNoise: { value: getNoiseTexture() },
        uTanHalfFov: { value: new THREE.Vector2(1, 1) },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uPixelAngle: { value: 0.001 },
        uCount: { value: 0 },
        uLensCenter: { value: Array.from({ length: MAX_LENSES }, () => new THREE.Vector4()) },
        uLensNormal: { value: Array.from({ length: MAX_LENSES }, () => new THREE.Vector4()) },
        uLensDisc: { value: Array.from({ length: MAX_LENSES }, () => new THREE.Vector4()) },
        uLensHot: { value: Array.from({ length: MAX_LENSES }, () => new THREE.Color()) },
        uLensCool: { value: Array.from({ length: MAX_LENSES }, () => new THREE.Color()) },
        uDiscGain: { value: 1 },
        uBandHot: { value: new THREE.Color(1, 1, 1) },
        uBandCool: { value: new THREE.Color(1, 1, 1) },
        uViewToWorld: { value: new THREE.Matrix3() },
        // Replaced by the sky's own uniform objects in setSky (shared by reference).
        uSky: { value: null },
        uSkyIntensity: { value: 0 },
        uSkyTint: { value: new THREE.Color(1, 1, 1) },
        uSkyOn: { value: 0 },
        uStarGain: { value: 1 },
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
    this.material.uniforms.uResolution.value.set(width, height);
  }

  /**
   * Share the Milky Way sky's texture, intensity and band tint (scene/sky.js
   * uniforms), so rays bent off the screen see the same sky.
   */
  setSky(skyUniforms) {
    const u = this.material.uniforms;
    u.uSky = skyUniforms.uSky;
    u.uSkyIntensity = skyUniforms.uIntensity;
    u.uSkyTint = skyUniforms.uBandTint;
  }

  /** Settings → Milky Way sky (the field stars stay either way). */
  setSkyVisible(visible) {
    this.material.uniforms.uSkyOn.value = visible ? 1 : 0;
  }

  /**
   * Disc brightness, disc tint and field-star gain for the wavelength band
   * (bands.js). The tint is the band colour over the visible one, so a hole
   * with the default colours gets exactly the band colours.
   */
  setBand({ agnGain, agnHot, agnCool, fieldGain }) {
    const u = this.material.uniforms;
    const vis = BANDS.visible;
    u.uDiscGain.value = agnGain;
    u.uBandHot.value.setRGB(...agnHot.map((c, i) => c / vis.agnHot[i]));
    u.uBandCool.value.setRGB(...agnCool.map((c, i) => c / vis.agnCool[i]));
    u.uStarGain.value = fieldGain;
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
      u.uLensDisc.value[i].set(c.discOuter, c.gain, c.glow, c.streak);
      u.uLensHot.value[i].copy(c.hot);
      u.uLensCool.value[i].copy(c.cool);
    }
    u.uCount.value = n;
    u.uTanHalfFov.value.set(tanX, tanY);
    u.uPixelAngle.value = (2 * tanY) / this.height;
    u.uViewToWorld.value.setFromMatrix4(camera.matrixWorld);
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
