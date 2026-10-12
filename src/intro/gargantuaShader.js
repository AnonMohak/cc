import { DISC_INNER, DISC_OUTER, H0, H1, SLAB_K, SHADOW_FLAT, SPIN, GLOW_POWER, STEP_K, STEP_MIN, STEP_MAX } from './gargantuaModel.js';

const f = (x) => x.toFixed(4);

export const QUAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** Max steps per ray (uSteps ≤ this). */
export const MAX_STEPS = 320;

// Disc look (tuned against the reference stills).
const LOOK = /* glsl */ `
  // Optical depth across the full thickness of dense gas: marginally thick.
  const float TAU = 2.2;
  // Light of the hot midplane, and the share of the smoke lit by it.
  const float EMIT = 14.0;
  const float ALBEDO = 0.6;
  // Noise frequencies: many streaks across the radius, few long arcs around.
  const float RAD_FREQ = 4.0;
  const float ANG_TILES = 7.0; // per turn: an integer, so the angle wraps without a seam
  const float VERT_FREQ = 0.3;
  // Domain warp (texture units): breaks the even rings into clumps.
  const float WARP = 0.55;
  // Colours (linear): 4500 K gas, white-hot near the inner edge; the smoke is
  // lit warm from below and a little cool by the sky.
  const vec3 GAS_WARM = vec3(1.0, 0.5, 0.2);
  const vec3 GAS_HOT = vec3(1.0, 0.86, 0.66);
  const vec3 SMOKE_COOL = vec3(0.16, 0.19, 0.24);
`;

/**
 * The disc ray march, at a reduced resolution: rgb = light reaching the
 * camera from the gas, a = transmittance (0 where a ray ends in the shadow).
 * Flat space for now (the lensing milestone bends the rays).
 */
export const marchShader = /* glsl */ `
  precision highp sampler3D;
  uniform vec3 uCamPos;
  uniform mat3 uCamBasis; // camera to world: right, up, back
  uniform vec2 uTanHalfFov;
  uniform sampler3D uNoise;
  uniform float uTime;
  uniform int uSteps;
  varying vec2 vUv;

  #define MAX_STEPS ${MAX_STEPS}
  const float PI = 3.14159265;
  const float DISC_INNER = ${f(DISC_INNER)};
  const float DISC_OUTER = ${f(DISC_OUTER)};
  const float H0 = ${f(H0)};
  const float H1 = ${f(H1)};
  const float SLAB_K = ${f(SLAB_K)};
  const float SHADOW = ${f(SHADOW_FLAT)};
  const float SPIN = ${f(SPIN)};
  const float GLOW_POWER = ${f(GLOW_POWER)};
  const float STEP_K = ${f(STEP_K)};
  const float STEP_MIN = ${f(STEP_MIN)};
  const float STEP_MAX = ${f(STEP_MAX)};
${LOOK}

  // Mirrors of gargantuaModel.js.
  float halfThickness(float r) { return H0 + H1 * r; }
  float radialWindow(float r) {
    return smoothstep(DISC_INNER, DISC_INNER * 1.25, r) * (1.0 - smoothstep(DISC_OUTER * 0.35, DISC_OUTER, r));
  }
  float glowAt(float r) { return pow(DISC_INNER / max(r, DISC_INNER), GLOW_POWER); }
  float angularSpeed(float r) { return SPIN * pow(DISC_INNER / max(r, DISC_INNER), 1.5); }
  float marchStep(float r) { return clamp(STEP_K * halfThickness(r), STEP_MIN, STEP_MAX); }

  float hash12(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  // The gas at p: x = extinction (per Rs), y = hot-core light, z = dust 0–1.
  vec3 gas(vec3 p) {
    float r = length(p.xz);
    float h = halfThickness(r);
    float zn = p.y / h;
    float win = radialWindow(r);
    if (win <= 0.0 || abs(zn) > SLAB_K) return vec3(0.0);
    // Polar coordinates that turn with the gas (inner gas laps the outer, so
    // the clouds shear into streaks along the orbit).
    float ang = atan(p.z, p.x) - angularSpeed(r) * uTime;
    vec3 q = vec3(log(r) * RAD_FREQ, ang * (ANG_TILES / (2.0 * PI)), zn * VERT_FREQ);
    // Warp by the low-frequency channel (around the turn only by whole tiles: no seam).
    vec2 wq = texture(uNoise, q * vec3(0.5, 1.0, 0.5) + vec3(0.13, 0.0, 0.29)).rg - 0.5;
    q += vec3(wq.x, wq.y, 0.5 * wq.x) * WARP;
    vec2 n = texture(uNoise, q).rg;
    float fine = texture(uNoise, q * vec3(3.1, 3.0, 2.7) + vec3(0.37, 0.0, 0.61)).r;
    float cloud = 0.6 * n.r + 0.4 * fine;
    // Cloud tops: the gas thins with height, with a noisy, smoky surface.
    float body = exp(-0.6 * zn * zn);
    float dens = win * body * smoothstep(0.32, 0.62, cloud + 0.35 * (body - 0.6));
    // Large dark dust clumps (the black patches).
    float dust = smoothstep(0.5, 0.66, n.g + 0.25 * (fine - 0.5));
    float hot = exp(-2.2 * zn * zn) * glowAt(r);
    return vec3(dens * TAU / (2.0 * h), hot, dust);
  }

  void main() {
    vec3 rd = normalize(uCamBasis * vec3((vUv * 2.0 - 1.0) * uTanHalfFov, -1.0));
    vec3 ro = uCamPos;
    // The slab the gas lives in (|y| < top) and the cylinder r < DISC_OUTER.
    float top = SLAB_K * halfThickness(DISC_OUTER);
    float t0 = 0.0;
    float t1 = 1e4;
    if (abs(rd.y) > 1e-5) {
      float ta = (top - ro.y) / rd.y;
      float tb = (-top - ro.y) / rd.y;
      t0 = max(t0, min(ta, tb));
      t1 = min(t1, max(ta, tb));
    } else if (abs(ro.y) > top) {
      t1 = -1.0;
    }
    float a = dot(rd.xz, rd.xz);
    float b = dot(ro.xz, rd.xz);
    float c = dot(ro.xz, ro.xz) - DISC_OUTER * DISC_OUTER;
    float disc = b * b - a * c;
    if (disc < 0.0 || a < 1e-8) {
      if (c > 0.0) t1 = -1.0;
    } else {
      float s = sqrt(disc);
      t0 = max(t0, (-b - s) / a);
      t1 = min(t1, (-b + s) / a);
    }
    // The shadow (flat-space stand-in): the ray ends at the sphere.
    float tc = -dot(ro, rd);
    float b2 = dot(ro, ro) - tc * tc;
    float tShadow = 1e9;
    if (tc > 0.0 && b2 < SHADOW * SHADOW) tShadow = tc - sqrt(SHADOW * SHADOW - b2);
    t1 = min(t1, tShadow);

    vec3 light = vec3(0.0);
    float T = 1.0;
    if (t1 > t0) {
      // A fixed per-pixel offset of the first step (no shimmer from frame to frame).
      float t = t0 + marchStep(length((ro + rd * t0).xz)) * hash12(gl_FragCoord.xy);
      for (int i = 0; i < MAX_STEPS; i++) {
        if (i >= uSteps || t >= t1 || T < 0.01) break;
        vec3 p = ro + rd * t;
        float r = length(p.xz);
        float dt = marchStep(r);
        // Above the local slab: jump down to it.
        float above = abs(p.y) - SLAB_K * halfThickness(r);
        if (above > 0.0 && abs(rd.y) > 1e-4) dt = max(dt, 0.8 * above / abs(rd.y));
        vec3 g = gas(p);
        if (g.x > 0.0) {
          float sigma = g.x * (1.0 + 2.0 * g.z);
          float w = T * (1.0 - exp(-sigma * dt));
          vec3 hotCol = mix(GAS_WARM, GAS_HOT, smoothstep(0.25, 0.9, g.y));
          vec3 emit = hotCol * g.y * EMIT * (1.0 - 0.9 * g.z);
          vec3 lit = (GAS_WARM * glowAt(r) * 0.6 + SMOKE_COOL) * ALBEDO * (1.0 - 0.8 * g.z);
          light += w * (emit + lit);
          T *= exp(-sigma * dt);
        }
        t += dt;
      }
    }
    if (tShadow < 1e8 && T >= 0.01 && t1 >= tShadow - 1e-3) T = 0.0;
    gl_FragColor = vec4(light, T);
  }
`;

/**
 * Full resolution: the march (bilinear) over the sky, then exposure, tone
 * mapping and a film grade.
 */
export const compositeShader = /* glsl */ `
  uniform sampler2D tMarch;
  uniform vec3 uCamPos;
  uniform mat3 uCamBasis;
  uniform vec2 uTanHalfFov;
  uniform vec2 uResolution;
  uniform float uExposure;
  varying vec2 vUv;

  float hash12(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  // Sparse, faint stars (the film's sky is nearly empty near Gargantua).
  vec3 stars(vec3 d) {
    vec3 a = abs(d);
    vec2 uv;
    float face;
    if (a.x >= a.y && a.x >= a.z) { uv = d.yz / a.x; face = d.x > 0.0 ? 0.0 : 1.0; }
    else if (a.y >= a.z) { uv = d.xz / a.y; face = d.y > 0.0 ? 2.0 : 3.0; }
    else { uv = d.xy / a.z; face = d.z > 0.0 ? 4.0 : 5.0; }
    vec2 g = (uv * 0.5 + 0.5) * 140.0;
    vec2 cell = floor(g);
    vec2 key = cell + face * 157.0;
    if (hash12(key) > 0.08) return vec3(0.0);
    vec2 centre = cell + 0.2 + 0.6 * vec2(hash12(key + 17.0), hash12(key + 53.0));
    float k = max(1.0 - length(g - centre) / 0.12, 0.0);
    return vec3(0.9, 0.92, 1.0) * k * k * (0.2 + 0.8 * pow(hash12(key + 91.0), 6.0));
  }

  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }

  void main() {
    vec4 m = texture2D(tMarch, vUv);
    vec3 rd = normalize(uCamBasis * vec3((vUv * 2.0 - 1.0) * uTanHalfFov, -1.0));
    vec3 col = m.rgb + m.a * stars(rd);
    col = aces(col * uExposure);
    // Film grade: blacks lifted a little and warm, highlights kept.
    col = col * 0.985 + vec3(0.010, 0.008, 0.007);
    gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
  }
`;
