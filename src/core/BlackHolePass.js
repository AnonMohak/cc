import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { CHUNKS, glsl } from '../galaxy/shaders/glsl.js';
import { getNoiseTexture, NOISE_SIZE } from '../galaxy/noiseTexture.js';
import { BANDS } from '../galaxy/bands.js';
import {
  SHADOW_B,
  DISC_INNER,
  DISC_OUTER,
  LENS_REACH,
  MAX_DEFLECTION,
  MARCH_SPHERE_K,
  MARCH_STEP_K,
  MARCH_STEP_MIN,
  MARCH_STEP_MAX,
  PHOTON_SPHERE,
  MARCH_SCALE_MIN,
  WARP_BEND,
  WARP_REACH,
  WARP_DEPTH,
  WARP_SWIRL,
  warpedReach,
  marchScaleFor,
  shadowPixels,
  lensFade,
  pickLenses,
} from '../galaxy/blackHole.js';
import { MAX_GALAXIES } from '../galaxy/params.js';

/** Lenses drawn per frame (the largest on screen). */
export const MAX_LENSES = 4;

const f = (x) => x.toFixed(4);

/** Ray-march step cap (Accurate tier; QUALITY.*.holeSteps must stay at or below it). */
export const MAX_HOLE_STEPS = 64;

// Disc look shared by the one-bend shader and the ray march: colours, the
// Shakura–Sunyaev profile and the concentric streak noise. Both shaders set
// the lens globals (lensHot, lensCool, discOuter, lensGain) per lens.
const DISC_GLSL = /* glsl */ `
  const float DISC_INNER = ${f(DISC_INNER)};
  // Radius of the flux peak (discFlux = 1 there).
  const float DISC_PEAK = DISC_INNER * 1.36;
  const float PI = 3.14159265;
  const float NOISE_TEXELS = ${f(NOISE_SIZE)};
  // Runs after bloom, so the disc must outshine a saturated core by itself.
  // Lower than the old 4.0: ACES turns brighter light white, and the film
  // disc is gold.
  const float DISC_GAIN = 2.0;
  // Disc streak noise: tiles per Rs along the radius (one tile per turn around).
  const float STREAK_FREQ_R = 0.35;
  const float FINE_FREQ_R = 1.1;
  // Slow, calm spin (the film disc barely moves).
  const float SPIN = 0.5;

  vec3 lensHot;
  vec3 lensCool;
  float discOuter;
  float lensGain;

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

  // Disc turn coordinate at in-plane point h (relative to the hole, normal n):
  // the angle in turns, minus the Keplerian shear (inner gas laps the outer,
  // so the streaks wind up).
  float discTurn(vec3 h, vec3 n, float r, float time) {
    vec3 e1 = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    float phi = atan(dot(h, cross(n, e1)), dot(h, e1));
    float omega = pow(DISC_INNER / r, 1.5) * SPIN;
    return (phi - omega * time) / (2.0 * PI);
  }

  // Disc radial edges: in from the ISCO, soft fade out to discOuter.
  float discEdge(float r) {
    return gm_smoothstep(DISC_INNER, DISC_INNER * 1.08, r) * (1.0 - gm_smoothstep(discOuter * 0.45, discOuter, r));
  }
`;

// Ray march for the largest lens on the Accurate tier, at 0.4–0.7 of the screen
// resolution (blackHole.js marchScaleFor: more for a smaller hole).
// Each pixel traces its bent ray (velocity Verlet on the photon-orbit
// equation, mirrored from blackHole.js traceRay) through a thick, flared disc
// volume, and writes the disc light (rgb) and the transmittance (a). Captured
// rays end with transmittance 0. The main pass adds the lensed background
// times the transmittance, so the background stays at full resolution.
const marchShader = glsl(
  CHUNKS.model,
  /* glsl */ `
  #define MAX_LENSES ${MAX_LENSES}
  #define MAX_HOLE_STEPS ${MAX_HOLE_STEPS}
  uniform sampler2D uNoise;
  uniform vec2 uTanHalfFov;
  uniform float uPixelAngle;
  uniform vec4 uLensCenter[MAX_LENSES];
  uniform vec4 uLensNormal[MAX_LENSES];
  uniform vec4 uLensDisc[MAX_LENSES];
  uniform vec3 uLensHot[MAX_LENSES];
  uniform vec3 uLensCool[MAX_LENSES];
  uniform float uDiscGain;
  uniform vec3 uBandHot;
  uniform vec3 uBandCool;
  uniform int uSteps;
  varying vec2 vUv;
${DISC_GLSL}
  const float MARCH_SPHERE_K = ${f(MARCH_SPHERE_K)};
  const float STEP_K = ${f(MARCH_STEP_K)};
  const float STEP_MIN = ${f(MARCH_STEP_MIN)};
  const float STEP_MAX = ${f(MARCH_STEP_MAX)};
  const float PHOTON_SPHERE = ${f(PHOTON_SPHERE)};
  // Flared disc: Gaussian half-thickness H(R) = H0 + H1 · R (Rs).
  const float H0 = 0.07;
  const float H1 = 0.04;
  // Emission per unit column, and absorption: a face-on column is about as
  // bright and as opaque as the thin disc of the other tiers (alpha ~0.8).
  const float ABSORB = 1.6;

  vec3 accel(vec3 p, float h2) {
    float r2 = dot(p, p);
    return p * (-1.5 * h2 / (r2 * r2 * sqrt(r2)));
  }

  void main() {
    vec3 rd = normalize(vec3((vUv * 2.0 - 1.0) * uTanHalfFov, -1.0));
    vec3 c = uLensCenter[0].xyz;
    vec3 n = uLensNormal[0].xyz;
    float time = uLensNormal[0].w;
    vec4 disc = uLensDisc[0];
    discOuter = disc.x;
    lensGain = uDiscGain * disc.y;
    lensHot = uLensHot[0] * uBandHot;
    lensCool = uLensCool[0] * uBandCool;

    // March sphere: rays that miss it see no disc and are not bent here.
    float R = discOuter * MARCH_SPHERE_K;
    float tc = dot(c, rd);
    float b2 = dot(c, c) - tc * tc;
    float inside = step(dot(c, c), R * R);
    if (b2 > R * R || (inside < 0.5 && tc < 0.0)) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    // Start where the ray enters the sphere (or at the camera, inside it).
    float tEnter = inside > 0.5 ? 0.0 : tc - sqrt(R * R - b2);
    vec3 p = rd * tEnter - c;
    vec3 v = rd;
    vec3 cr = cross(p, v);
    float h2 = dot(cr, cr);
    vec3 a = accel(p, h2);
    float dist = tEnter;
    // Disc basis, once per pixel (e2 = n × e1: the spin direction).
    vec3 e1 = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 e2 = cross(n, e1);
    // Emission is summed as a scalar with a flux-weighted q; the colour is
    // applied once after the loop (no pow/mix per step).
    float Es = 0.0;
    float Qs = 0.0;
    float T = 1.0;
    // Offset of the first step in a 2×2 ordered pattern (fixed, so no
    // flicker): it turns the step pattern into a 2×2 texel grain, and each
    // composite tap (a bilinear 2×2 average) holds all four offsets, so the
    // grain cancels out there.
    vec2 cell = mod(floor(gl_FragCoord.xy), 2.0);
    float jitter = 0.25 + 0.5 * cell.x + 0.25 * cell.y;

    for (int i = 0; i < MAX_HOLE_STEPS; i++) {
      if (i >= uSteps) break;
      float r = length(p);
      float radial = dot(p, v);
      if (r < PHOTON_SPHERE && radial < 0.0) { T = 0.0; break; }
      if (r > R && radial > 0.0) break;
      float dt = clamp(STEP_K * r, STEP_MIN, STEP_MAX);

      // Disc slab: limit the step so it never jumps across the slab, and so
      // inside it the height changes by at most 0.9 thickness per step.
      float z = dot(p, n);
      float Rr = length(p - n * z);
      float H = H0 + H1 * Rr;
      float vz = max(abs(dot(v, n)), 1e-3);
      if (Rr > DISC_INNER * 0.85 && Rr < discOuter) {
        dt = min(dt, max(abs(z) - 2.0 * H, 0.9 * H) / vz);
        if (abs(z) < 3.0 * H) {
          float dens = exp(-z * z / (H * H)) / (1.77 * H) * discEdge(Rr);
          if (dens > 1e-4) {
            // Keplerian shear (inner gas laps the outer): x^1.5 as x·√x.
            float x = DISC_INNER / Rr;
            float turn = (atan(dot(p, e2), dot(p, e1)) - x * sqrt(x) * SPIN * time) / (2.0 * PI);
            // Filter the streaks by the pixel (a little by the step too).
            float foot = max(dist * uPixelAngle, dt * 0.15);
            float lod = log2(max(foot * STREAK_FREQ_R * NOISE_TEXELS, 1.0));
            float s1 = textureLod(uNoise, vec2(Rr * STREAK_FREQ_R, turn), lod).r;
            float s2 = textureLod(uNoise, vec2(Rr * FINE_FREQ_R + 0.37, turn * 2.0 + 0.5), lod + log2(FINE_FREQ_R / STREAK_FREQ_R)).g;
            float q = discFlux(Rr);
            float w = T * dens * dt * sqrt(q) * (0.3 + 1.4 * gm_smoothstep(0.32, 0.68, 0.55 * s1 + 0.45 * s2));
            Es += w;
            Qs += w * q;
            T *= exp(-ABSORB * dens * dt);
            if (T < 0.02) { T = 0.0; break; }
          }
        }
      }

      if (i == 0) dt *= jitter;
      p += v * dt + 0.5 * a * dt * dt;
      vec3 a1 = accel(p, h2);
      v += 0.5 * (a + a1) * dt;
      a = a1;
      dist += dt;
    }
    vec3 E = Es > 0.0 ? discColour(Qs / Es) * Es : vec3(0.0);
    gl_FragColor = vec4(E * DISC_GAIN * lensGain, T);
  }
`,
);

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
  uniform float uLensWarp[MAX_LENSES]; // intro-fall warp 0–1 (blackHole.js WARP_*)
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
  // Accurate tier: the largest lens (index 0) takes its disc from the ray march
  // (rgb: disc light, a: transmittance), at a reduced resolution.
  uniform sampler2D tMarch;
  uniform vec2 uMarchTexel;
  uniform float uMarch;
  // Lens rays per pixel (1, 2 or 4; quality.js holeSamples) and the finer
  // streak octave (on with supersampling).
  uniform int uSamples;
  uniform float uDetail;
  varying vec2 vUv;
${DISC_GLSL}
  const float SHADOW_B = ${f(SHADOW_B)};
  const float LENS_REACH = ${f(LENS_REACH)};
  const float MAX_DEFLECTION = ${f(MAX_DEFLECTION)};
  const float WARP_BEND = ${f(WARP_BEND)};
  const float WARP_REACH = ${f(WARP_REACH)};
  const float WARP_DEPTH = ${f(WARP_DEPTH)};
  const float WARP_SWIRL = ${f(WARP_SWIRL)};
  const float RING_GAIN = 3.0;
  const float RING_TAIL = 0.12;
  const float RING_TAIL_RS = 0.35;
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

  // Thin accretion disc at hit point h (relative to the hole), seen along rd
  // from distance dist (Rs). rgb: emitted light, a: opacity. The noise LOD is
  // explicit (pixel footprint): the atan seam and the branches around this
  // call would otherwise pick wrong mip levels.
  // fill: the far image. Its rays that cross the plane inside the inner edge
  // (just outside the shadow) show the inner edge's light instead of the
  // empty gap: else a dark band sits between the photon ring and the arches.
  vec4 discLight(vec3 h, vec3 rd, vec3 n, float time, float dist, bool fill) {
    float r = length(h);
    if (r > discOuter || (r < DISC_INNER && !fill)) return vec4(0.0);
    // Fill: inside the flux peak, mirror the radius back out (continuous at
    // the peak), so the streaks and the shear stay calm instead of winding
    // up toward r = 0.
    // Near r = 0 the angle is singular and the one-bend mapping folds:
    // flatten the streaks there (detail 0 → flat light).
    float detail = fill ? gm_smoothstep(0.2 * DISC_INNER, DISC_INNER, r) : 1.0;
    if (fill && r < DISC_PEAK) r = DISC_PEAK + 0.5 * (DISC_PEAK - r);
    float turn = discTurn(h, n, r, time);
    // Footprint of one pixel on the disc (Rs); grazing views stretch it.
    float foot = dist * uPixelAngle / sqrt(max(abs(dot(rd, n)), 0.02));
    float lod = log2(max(foot * STREAK_FREQ_R * NOISE_TEXELS, 1.0));
    // Concentric streaks: fast along the radius, slow around (whole turns per
    // tile, so no seam).
    float s1 = textureLod(uNoise, vec2(r * STREAK_FREQ_R, turn), lod).r;
    float s2 = textureLod(uNoise, vec2(r * FINE_FREQ_R + 0.37, turn * 2.0 + 0.5), lod + log2(FINE_FREQ_R / STREAK_FREQ_R)).g;
    float s = 0.55 * s1 + 0.45 * s2;
    if (uDetail > 0.5) {
      // Finer streaks for close views (resolved by the supersampling).
      float s3 = textureLod(uNoise, vec2(r * FINE_FREQ_R * 3.1 + 0.71, turn * 4.0 + 0.25), lod + log2(3.1 * FINE_FREQ_R / STREAK_FREQ_R)).r;
      s = 0.45 * s1 + 0.35 * s2 + 0.2 * s3;
    }
    float streak = gm_smoothstep(0.3, 0.7, mix(0.5, s, detail));
    float q = discFlux(r);
    float edge = discEdge(r);
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

  // The pass for one ray through screen point uv (one per pixel, or
  // uSamples sub-pixel rays inside the lenses; see main).
  vec3 shade(vec2 uv) {
    vec3 col = texture2D(tDiffuse, uv).rgb;
    vec3 rd = normalize(vec3((uv * 2.0 - 1.0) * uTanHalfFov, -1.0));
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
      vec2 dpx = (uv - ((c.xy / -c.z) / uTanHalfFov * 0.5 + 0.5)) * uResolution;
      float discPx = discOuter * 0.5 / (-c.z * uPixelAngle);
      float thick = max(1.2, uResolution.y / 700.0);
      float streak = exp(-abs(dpx.y) / thick - abs(dpx.x) / max(discPx * STREAK_LENGTH, 1.0));
      streaks += mix(lensHot, vec3(1.0), 0.3) * streak * STREAK_GAIN * lensGain * disc.w * fade
        * mix(0.25, 1.0, gm_smoothstep(SHADOW_B * 0.6, SHADOW_B * 1.2, b));

      // Intro-fall warp: more bend, a wider reach, deeper source light and a
      // swirl around the hole (blackHole.js WARP_*; all 0 normally).
      float warp = uLensWarp[i];
      float reach = LENS_REACH * (1.0 + WARP_REACH * warp);
      if (b >= reach) continue;
      vec3 n = uLensNormal[i].xyz;
      float time = uLensNormal[i].w;
      bool captured = b < SHADOW_B;
      float reachFade = 1.0 - gm_smoothstep(0.45 * reach, reach, b);
      // Bend toward the hole; fade the bend out before the reach (no seam).
      float a = deflection(b) * (1.0 + WARP_BEND * warp) * reachFade;
      vec3 rd2 = normalize(rd * cos(a) - bv / max(b, 1e-4) * sin(a));
      if (warp > 0.0) {
        // Rodrigues rotation about the hole direction: stronger near the shadow.
        vec3 axis = normalize(c);
        float sw = WARP_SWIRL * warp * reachFade * min(SHADOW_B / b, 1.0) * PI;
        rd2 = rd2 * cos(sw) + cross(axis, rd2) * sin(sw) + axis * dot(axis, rd2) * (1.0 - cos(sw));
      }
      vec3 src = normalize(p0 + rd2 * SOURCE_DEPTH * (1.0 + WARP_DEPTH * warp));
      float open = gm_smoothstep(SHADOW_B * 2.0, reach, b);
      vec3 L = captured ? vec3(0.0) : sampleDir(src, rd2)
        * mix(CAVITY, 1.0, open * open) * gm_smoothstep(SHADOW_B, SHADOW_B * 2.5, length(cross(src, c)));
      float outside = gm_smoothstep(SHADOW_B, SHADOW_B * 1.25, b);
      float w = max(0.04, 0.6 * length(c) * uPixelAngle);
      // One photon ring: a thin core (at least ~1 px, same energy) and a
      // soft outward tail in Rs that runs into the disc image. Two separate
      // thin rings left dark bands between them up close.
      float ringB = SHADOW_B * 1.015;
      float ring = exp(-pow((b - ringB) / w, 2.0)) * (0.04 / w)
        + RING_TAIL * exp(-max(b - ringB, 0.0) / RING_TAIL_RS) * gm_smoothstep(SHADOW_B, ringB, b);
      vec3 halo = lensCool * HALO_GAIN * lensGain * exp(-(b - SHADOW_B) / HALO_SCALE);

      if (i == 0 && uMarch > 0.5) {
        // Ray-marched thick disc: four bilinear taps half a march texel out.
        // Each tap averages a 2×2 texel block, which cancels the ordered step
        // jitter. It already holds the near disc, the arches and the
        // higher-order images, so no thin disc or haze here.
        vec2 o = uMarchTexel * 0.5;
        vec4 m = 0.25 * (texture2D(tMarch, uv + vec2(o.x, o.y)) + texture2D(tMarch, uv + vec2(-o.x, o.y))
          + texture2D(tMarch, uv + vec2(o.x, -o.y)) + texture2D(tMarch, uv + vec2(-o.x, -o.y)));
        L = L * m.a + m.rgb;
        L += lensHot * ring * RING_GAIN * lensGain * m.a;
        L += halo * disc.z * outside * reachFade * m.a;
        col = mix(col, L, fade);
        continue;
      }

      // Far image: the bent ray crosses the disc plane behind the hole (the
      // arches over and under the shadow).
      float dn2 = dot(rd2, n);
      if (!captured && abs(dn2) > 1e-4) {
        float t2 = dot(c - p0, n) / dn2;
        if (t2 > 0.0) {
          vec4 d = discLight(p0 + rd2 * t2 - c, rd2, n, time, tc + t2, true);
          L = d.rgb + L * (1.0 - d.a);
        }
      }
      // Photon rings: light that orbited the hole, piled up at the critical b
      // (w: at least ~1 px wide with the same energy, so a small hole does
      // not flicker), then haze and the glow halo (bloom ran before this
      // pass); both stay out of the shadow.
      L += lensHot * ring * RING_GAIN * lensGain;
      L += (discHaze(bv, n, time, tc) + halo) * disc.z * outside * reachFade;
      // Near image: the straight ray meets the disc before its closest approach.
      float dn = dot(rd, n);
      if (abs(dn) > 1e-4) {
        float t1 = dot(c, n) / dn;
        if (t1 > 0.0 && t1 < tc) {
          vec4 d = discLight(rd * t1 - c, rd, n, time, t1, false);
          L = d.rgb + L * (1.0 - d.a);
        }
      }
      col = mix(col, L, fade);
    }
    return col + streaks;
  }

  // Inside any lens reach: true when the extra rays can change the pixel.
  bool inLens(vec2 uv) {
    vec3 rd = normalize(vec3((uv * 2.0 - 1.0) * uTanHalfFov, -1.0));
    for (int i = 0; i < MAX_LENSES; i++) {
      if (i >= uCount) break;
      vec3 c = uLensCenter[i].xyz;
      float tc = dot(c, rd);
      if (tc <= 0.0 || c.z >= 0.0) continue;
      if (length(rd * tc - c) < LENS_REACH * (1.0 + WARP_REACH * uLensWarp[i])) return true;
    }
    return false;
  }

  void main() {
    if (uSamples < 2 || !inLens(vUv)) {
      gl_FragColor = vec4(shade(vUv), 1.0);
      return;
    }
    // Rotated-grid sub-pixel rays (2 or 4): smooth thin rings and fine
    // streaks close up. The lens streak and the copy outside are unchanged.
    vec2 px = 1.0 / uResolution;
    vec3 sum = shade(vUv + vec2(0.125, 0.375) * px) + shade(vUv + vec2(-0.125, -0.375) * px);
    if (uSamples > 2) sum += shade(vUv + vec2(-0.375, 0.125) * px) + shade(vUv + vec2(0.375, -0.125) * px);
    gl_FragColor = vec4(sum / float(uSamples), 1.0);
  }
`,
);

const _view = new THREE.Vector3();

/**
 * Gravitational lensing, shadow and accretion disc of the standalone black
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
      warp: 0, // intro-fall lens warp 0–1
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
        uLensWarp: { value: new Array(MAX_LENSES).fill(0) },
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
        tMarch: { value: null },
        uMarchTexel: { value: new THREE.Vector2(1, 1) },
        uMarch: { value: 0 },
        uSamples: { value: 1 },
        uDetail: { value: 0 },
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

    // Accurate tier ray march (setMarch): its own low-res target and material,
    // sharing the lens uniforms with the main material by reference.
    this.march = false;
    this.marchScale = MARCH_SCALE_MIN;
    this.width = 1;
    this.marchTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    const u = this.material.uniforms;
    this.marchMaterial = new THREE.ShaderMaterial({
      name: 'BlackHoleMarch',
      uniforms: {
        uNoise: u.uNoise,
        uTanHalfFov: u.uTanHalfFov,
        uPixelAngle: { value: 0.001 },
        uLensCenter: u.uLensCenter,
        uLensNormal: u.uLensNormal,
        uLensDisc: u.uLensDisc,
        uLensHot: u.uLensHot,
        uLensCool: u.uLensCool,
        uDiscGain: u.uDiscGain,
        uBandHot: u.uBandHot,
        uBandCool: u.uBandCool,
        uSteps: { value: 48 },
      },
      vertexShader: this.material.vertexShader,
      fragmentShader: marchShader,
      depthTest: false,
      depthWrite: false,
    });
    this.marchQuad = new FullScreenQuad(this.marchMaterial);
    u.tMarch.value = this.marchTarget.texture;
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.material.uniforms.uResolution.value.set(width, height);
    this.setMarchScale(this.marchScale);
  }

  /** March target at `scale` of the screen resolution (marchScaleFor buckets). */
  setMarchScale(scale) {
    this.marchScale = scale;
    const w = Math.max(1, Math.round(this.width * scale));
    const h = Math.max(1, Math.round(this.height * scale));
    this.marchTarget.setSize(w, h);
    this.material.uniforms.uMarchTexel.value.set(1 / w, 1 / h);
  }

  /**
   * Accurate tier: ray-march the largest lens through a thick disc (on), or use
   * the one-bend model for every lens (off). `steps` ≤ MAX_HOLE_STEPS.
   */
  setMarch(on, steps = 48) {
    this.march = on;
    this.marchMaterial.uniforms.uSteps.value = Math.min(steps, MAX_HOLE_STEPS);
  }

  /** Lens rays per pixel: 1, 2 or 4 (more adds the finer streak octave). */
  setSamples(n) {
    const samples = n >= 4 ? 4 : n >= 2 ? 2 : 1;
    this.material.uniforms.uSamples.value = samples;
    this.material.uniforms.uDetail.value = samples > 1 ? 1 : 0;
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
      const reach = (warpedReach(c.warp) * c.rsWorld) / Math.max(depth, 1e-6);
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
      u.uLensWarp.value[i] = c.warp;
      u.uLensHot.value[i].copy(c.hot);
      u.uLensCool.value[i].copy(c.cool);
    }
    u.uCount.value = n;
    u.uTanHalfFov.value.set(tanX, tanY);
    u.uPixelAngle.value = (2 * tanY) / this.height;
    if (this.march && n > 0) {
      // March resolution from the screen share of the largest lens's march
      // sphere (a smaller hole gets more resolution for the same cost).
      const c = this.picked[0];
      _view.copy(c.center).applyMatrix4(view);
      const radiusPx = ((c.discOuter * MARCH_SPHERE_K * c.rsWorld) / Math.max(-_view.z, 1e-6) / tanY) * (this.height / 2);
      const coverage = Math.min(1, (Math.PI * radiusPx * radiusPx) / (this.width * this.height));
      const scale = marchScaleFor(coverage);
      if (scale !== this.marchScale) this.setMarchScale(scale);
    }
    // March pixels are 1 / marchScale screen pixels wide.
    this.marchMaterial.uniforms.uPixelAngle.value = u.uPixelAngle.value / this.marchScale;
    u.uViewToWorld.value.setFromMatrix4(camera.matrixWorld);
    u.uMarch.value = this.march && n > 0 ? 1 : 0;
    this.enabled = n > 0;
  }

  render(renderer, writeBuffer, readBuffer) {
    if (this.material.uniforms.uMarch.value > 0.5) {
      renderer.setRenderTarget(this.marchTarget);
      this.marchQuad.render(renderer);
    }
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
    this.marchMaterial.dispose();
    this.marchQuad.dispose();
    this.marchTarget.dispose();
  }
}
