import { DISC_INNER, SPARSE_OUT, DISC_OUTER, H0, H1, SLAB_K, SPIN, GLOW_POWER, STEP_K, STEP_MIN, STEP_MAX, PHOTON_SPHERE, ESCAPE_R, CURVE_K, CURVE_MIN, CURVE_MAX } from './gargantuaModel.js';
import { MARCH_LOOK, COMPOSITE_LOOK, CURVE_KNOTS, lookDeclarations } from './introLook.js';

const f = (x) => x.toFixed(4);

export const QUAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** Max steps per ray (uSteps ≤ this). */
export const MAX_STEPS = 600;

// The look constants are uniforms (introLook.js), so the ?tune view changes them live.
const LOOK = lookDeclarations(MARCH_LOOK);

/**
 * The disc gas, shared by the march and the light pass: its uniforms, the
 * model constants and gas().
 */
const GAS_GLSL = /* glsl */ `
  precision highp sampler3D;
  uniform sampler3D uNoise;
  uniform float uTime;
  // How much the inner gas thins into sparse clumps (the camera key sparse).
  uniform float uSparse;

  const float PI = 3.14159265;
  const float DISC_INNER = ${f(DISC_INNER)};
  const float SPARSE_OUT = ${f(SPARSE_OUT)};
  const float DISC_OUTER = ${f(DISC_OUTER)};
  const float H0 = ${f(H0)};
  const float H1 = ${f(H1)};
  const float SLAB_K = ${f(SLAB_K)};
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
    // Flame tongues: ridged noise stretched far along the orbit (FLAME_ANG
    // whole tiles around the turn: no seam), for the tongues and black gaps
    // of shots 7–9.
    float fl = texture(uNoise, q * vec3(FLAME_RAD, FLAME_ANG, 2.0) + vec3(0.71, 0.0, 0.17)).r;
    float ridge = 1.0 - abs(2.0 * fl - 1.0);
    float cloud = mix(0.6 * n.r + 0.4 * fine, 0.45 * n.r + 0.55 * ridge * ridge, FLAME);
    // Cloud tops: the gas thins with height, with a noisy, smoky surface.
    float body = exp(-0.6 * zn * zn);
    // Near the inner edge the gas thins into sparse clumps.
    float sparse = uSparse * (1.0 - smoothstep(DISC_INNER, DISC_INNER * SPARSE_OUT, r));
    float dens = win * body * smoothstep(0.32, 0.62, cloud + 0.35 * (body - 0.6) - 0.22 * sparse);
    // Thin wisps above the cloud tops, along the ridges.
    float wisp = WISP * win * smoothstep(0.9, 1.5, abs(zn)) * (1.0 - smoothstep(2.2, 3.0, abs(zn))) * smoothstep(0.6, 0.9, ridge);
    dens = max(dens, wisp);
    // Large dark dust clumps (the black patches).
    float dust = smoothstep(0.5, 0.66, n.g + 0.25 * (fine - 0.5));
    // The gas's own light falls off faster than the light on the smoke: the
    // outer disc reads as dark smoke, the inner disc glows (shots 4–5 vs 7–9).
    float hot = exp(-2.2 * zn * zn) * pow(DISC_INNER / max(r, DISC_INNER), EMIT_POWER);
    // The upper layers are smoke: more extinction with height, so the glowing
    // core shows through gaps and the surface reads dark (reference shots 4–5).
    float smoke = 1.0 + SMOKE_K * smoothstep(0.4, 1.8, abs(zn));
    float sigmaCloud = dens * smoke * TAU / (2.0 * h);
    // A thin, dense, glowing sheet at the midplane, under the clouds and
    // not thinned by sparse: edge-on it is the thin bright line across shots
    // 1–3. Its light falls off slowly (r^-SHEET_POWER), so the line stays
    // bright across the frame. Mixed with the cloud by extinction.
    float sigmaSheet = win * SHEET_TAU / (1.7725 * SHEET_H) * exp(-(p.y * p.y) / (SHEET_H * SHEET_H));
    float hotSheet = SHEET_GLOW * pow(DISC_INNER / max(r, DISC_INNER), SHEET_POWER);
    float sigma = sigmaCloud + sigmaSheet;
    if (sigma <= 0.0) return vec3(0.0);
    return vec3(sigma, (sigmaCloud * hot + sigmaSheet * hotSheet) / sigma, dust * sigmaCloud / sigma);
  }

`;

/**
 * The disc ray march, at a reduced resolution, along bent light paths: rgb
 * = light reaching the camera (gas, then the stars where the ray leaves), a
 * = the depth (Rs along the path) where the gas turns half opaque. Each
 * result is mixed with the last one (accumulation). The
 * arches over the shadow, the photon ring and the Einstein ring come from
 * the bending itself.
 */
export const marchShader = /* glsl */ `
  uniform vec3 uCamPos;
  uniform mat3 uCamBasis; // camera to world: right, up, back
  uniform vec2 uTanHalfFov;
  uniform int uSteps;
  // Accumulation: the last result and its weight (a film shutter's motion
  // blur, and the per-frame jitter averages out), and a frame counter.
  uniform sampler2D tPrev;
  uniform float uHistory;
  uniform float uFrame;
  // Light reaching the smoke from the hot inner disc (the light pass).
  uniform sampler2D uLight;
  varying vec2 vUv;
${GAS_GLSL}
  #define MAX_STEPS ${MAX_STEPS}
  const float PHOTON_SPHERE = ${f(PHOTON_SPHERE)};
  const float ESCAPE_R = ${f(ESCAPE_R)};
  const float CURVE_K = ${f(CURVE_K)};
  const float CURVE_MIN = ${f(CURVE_MIN)};
  const float CURVE_MAX = ${f(CURVE_MAX)};
  const float FAR_DEPTH = 1000.0;

  float curveStep(float r) { return clamp(CURVE_K * r, CURVE_MIN, CURVE_MAX); }
  // Schwarzschild light path, units of Rs (gargantuaModel.js bendRay).
  vec3 accel(vec3 p, float h2) {
    float r2 = dot(p, p);
    return p * (-1.5 * h2 / (r2 * r2 * sqrt(r2)));
  }

  float hash12(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  // The light texture over the disc: u = angle (turns), v = log radius from
  // the inner to the outer edge.
  float lightAt(vec3 p, float rc) {
    float u = fract(atan(p.z, p.x) / (2.0 * PI));
    float v = log(max(rc, DISC_INNER) / DISC_INNER) / log(DISC_OUTER / DISC_INNER);
    return texture(uLight, vec2(u, v)).r;
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

  void main() {
    vec3 v = normalize(uCamBasis * vec3((vUv * 2.0 - 1.0) * uTanHalfFov, -1.0));
    vec3 p = uCamPos;
    vec3 cr = cross(p, v);
    float h2 = dot(cr, cr);
    vec3 acc = accel(p, h2);
    vec3 light = vec3(0.0);
    float T = 1.0;
    bool captured = false;
    // A new offset of the first step every frame; the accumulation averages it.
    float jitter = hash12(gl_FragCoord.xy + vec2(uFrame * 13.17, uFrame * 7.73));
    // Depth for the depth of field: the path length where the gas becomes
    // half opaque (far when it never does).
    float dist = 0.0;
    float depth = -1.0;
    for (int i = 0; i < MAX_STEPS; i++) {
      if (i >= uSteps || T < 0.01) break;
      float r = length(p);
      float radial = dot(p, v);
      if (r < PHOTON_SPHERE && radial < 0.0) { captured = true; break; }
      if (r > ESCAPE_R && radial > 0.0) break;
      // Step: fine near the hole (the path bends), finer in the gas, and
      // a jump down toward the gas slab from above it.
      float rc = length(p.xz);
      float dt = curveStep(r);
      float above = abs(p.y) - SLAB_K * halfThickness(rc);
      bool inSlab = above <= 0.0 && rc < DISC_OUTER;
      if (inSlab) dt = min(dt, marchStep(rc));
      else if (rc < DISC_OUTER && p.y * v.y < 0.0 && abs(v.y) > 1e-4) dt = min(dt, max(marchStep(rc), 0.8 * above / abs(v.y)));
      if (i == 0) dt *= jitter;
      if (inSlab) {
        vec3 g = gas(p);
        if (g.x > 0.0) {
          float sigma = g.x * (1.0 + 2.0 * g.z);
          float w = T * (1.0 - exp(-sigma * dt));
          vec3 hotCol = mix(GAS_WARM, GAS_HOT, smoothstep(0.25, 0.9, g.y));
          vec3 emit = hotCol * g.y * EMIT * (1.0 - 0.9 * g.z);
          // Lit by the inner disc through the gas between (self-shadowing).
          vec3 lit = (GAS_WARM * glowAt(rc) * LIGHT_GAIN * lightAt(p, rc) + SMOKE_COOL) * ALBEDO * (1.0 - 0.8 * g.z);
          light += w * (emit + lit);
          T *= exp(-sigma * dt);
          if (depth < 0.0 && T < 0.5) depth = dist;
        }
      }
      dist += dt;
      // Velocity Verlet: the light bends toward the hole.
      p += v * dt + 0.5 * acc * dt * dt;
      vec3 acc1 = accel(p, h2);
      v += 0.5 * (acc + acc1) * dt;
      acc = acc1;
    }
    // Rays that leave see the stars where they point; captured rays are the shadow.
    if (!captured) light += T * stars(normalize(v));
    if (depth < 0.0) depth = FAR_DEPTH;
    vec4 cur = vec4(light, depth);
    gl_FragColor = mix(cur, texture2D(tPrev, vUv), uHistory);
  }
`;

/** Light texture size (angle × log radius) and radial steps per texel. */
export const LIGHT_SIZE = [256, 96];
const LIGHT_STEPS = 48;

/**
 * The light pass (once per frame): for each angle and radius over the disc,
 * how much of the hot inner disc's light gets through the gas on the way
 * out. Near the midplane the disc is opaque, so the light that reaches the
 * smoke runs over the cloud tops (at LIGHT_HEIGHT half-thicknesses), and tall
 * clouds and dust clumps cast shadows behind them.
 */
export const lightShader = /* glsl */ `
  varying vec2 vUv;
${GAS_GLSL}
  void main() {
    float theta = vUv.x * 2.0 * PI;
    float lr0 = log(DISC_INNER);
    float lr1 = log(DISC_INNER) + vUv.y * log(DISC_OUTER / DISC_INNER);
    float tau = 0.0;
    float prev = DISC_INNER;
    for (int i = 1; i <= ${LIGHT_STEPS}; i++) {
      float r = exp(mix(lr0, lr1, float(i) / ${LIGHT_STEPS}.0));
      vec3 g = gas(vec3(cos(theta) * r, LIGHT_HEIGHT * halfThickness(r), sin(theta) * r));
      tau += g.x * (1.0 + 2.0 * g.z) * (r - prev);
      prev = r;
    }
    gl_FragColor = vec4(exp(-LIGHT_K * tau), 0.0, 0.0, 1.0);
  }
`;

/**
 * Full resolution: the march with depth of field, a veiling glow and bloom
 * (mip levels of the march), lens ghosts and a halo ring, then exposure,
 * ACES, a teal/orange film grade and grain.
 */
export const compositeShader = /* glsl */ `
  uniform sampler2D tMarch;
  uniform vec2 uResolution;
  uniform float uExposure;
  uniform float uFocus; // Rs: the depth in focus
  uniform float uTime;
  varying vec2 vUv;

  const float PI = 3.14159265;
${lookDeclarations(COMPOSITE_LOOK)}

  float hash12(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  // The colour fit's tone curve (introLook.js CURVE_n at CURVE_KNOTS), per channel.
  float curveChannel(float x, int c) {
${CURVE_KNOTS.slice(1)
  .map((k, i) => `    if (x <= ${k.toFixed(4)}) return mix(CURVE_${i}[c], CURVE_${i + 1}[c], (x - ${CURVE_KNOTS[i].toFixed(4)}) / ${(k - CURVE_KNOTS[i]).toFixed(4)});`)
  .join(String.fromCharCode(10))}
    return CURVE_${CURVE_KNOTS.length - 1}[c];
  }
  vec3 toneCurve(vec3 x) {
    return vec3(curveChannel(x.r, 0), curveChannel(x.g, 1), curveChannel(x.b, 2));
  }

  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }

  vec3 bright(vec2 uv, float lod) {
    return max(textureLod(tMarch, clamp(uv, 0.0, 1.0), lod).rgb - FLARE_THRESHOLD, 0.0);
  }

  void main() {
    vec4 c0 = textureLod(tMarch, vUv, 0.0);
    // Depth of field: a golden-angle gather by this pixel's blur radius.
    float coc = min(DOF_K * abs(1.0 - uFocus / max(c0.a, 1e-3)), DOF_MAX);
    vec3 col = c0.rgb;
    if (coc > 0.75) {
      vec2 px = coc / uResolution;
      vec3 sum = c0.rgb;
      float wsum = 1.0;
      for (int i = 0; i < 16; i++) {
        float fi = float(i) + 0.5;
        float rad = sqrt(fi / 16.0);
        float ang = fi * 2.39996;
        vec4 s = textureLod(tMarch, vUv + vec2(cos(ang), sin(ang)) * rad * px, 0.0);
        // A sharp, nearer neighbour does not smear over a blurred pixel.
        float sc = min(DOF_K * abs(1.0 - uFocus / max(s.a, 1e-3)), DOF_MAX);
        float w = smoothstep(rad * coc * 0.5, rad * coc, sc + 0.5);
        sum += s.rgb * w;
        wsum += w;
      }
      col = sum / wsum;
    }
    // Veiling glow and bloom: wide, soft, over everything (the shadow too).
    col += VEIL * textureLod(tMarch, vUv, 6.0).rgb;
    col += BLOOM * (0.5 * textureLod(tMarch, vUv, 3.0).rgb + 0.35 * textureLod(tMarch, vUv, 4.0).rgb + 0.15 * textureLod(tMarch, vUv, 5.0).rgb);
    // Ghosts along the line through the centre, and the halo ring.
    vec2 toCentre = vec2(0.5) - vUv;
    vec3 flare = vec3(0.0);
    for (int i = 1; i <= 3; i++) {
      vec2 g = vUv + toCentre * (float(i) * 0.55);
      float fade = 1.0 - smoothstep(0.2, 0.7, length(g - 0.5));
      flare += bright(g, 4.0) * fade * vec3(0.6, 0.7, 1.0);
    }
    vec2 dir = length(toCentre) > 1e-4 ? normalize(toCentre) : vec2(0.0);
    vec2 h = vUv + dir * HALO_RADIUS * vec2(uResolution.y / uResolution.x, 1.0);
    float hw = pow(1.0 - min(abs(length(h - 0.5) - HALO_RADIUS * 0.5) * 6.0, 1.0), 4.0);
    col += GHOSTS * flare + HALO * bright(h, 3.0) * hw * vec3(1.0, 0.6, 0.95);

    col = aces(col * uExposure);
    // Film grade: teal in the darks, the highlights kept warm.
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = max(mix(vec3(luma), col, SATURATION), 0.0);
    col += SHADOW_TINT * pow(1.0 - luma, 4.0);
    col = mix(col, col * vec3(1.03, 1.0, 0.94), smoothstep(0.4, 1.0, luma));
    col += (hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 311.0) - 0.5) * GRAIN;
    vec3 display = pow(max(col, 0.0), vec3(1.0 / 2.2));
    // The colour fit to the stills, then the manual grade (display space).
    display = toneCurve(clamp(display, 0.0, 1.0));
    display = pow(clamp(display * CDL_SLOPE + CDL_OFFSET, 1e-4, 1.0), CDL_POWER);
    gl_FragColor = vec4(display, 1.0);
  }
`;
