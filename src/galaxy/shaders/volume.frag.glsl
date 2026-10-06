// Raymarched galaxy body: the smooth light of unresolved stars plus dust
// absorption, integrated front to back. Needs model.glsl, noise.glsl and
// stars.glsl (uniforms) first.
//
// Performance: everything in the disc plane (arms, bar, dust lanes) is baked
// into uDiscMap in the pattern frame (see discMap.js), and noise comes from a
// shared tileable texture (noiseTexture.js). A step is two texture fetches
// plus a little arithmetic.

uniform vec3 uBoxHalf;
uniform float uSteps;
uniform float uVolumeDust; // 0 on the Minimal tier
uniform float uGlow;
uniform float uFlocculence;
uniform float uBulgeSersic;
uniform float uBulgeFlatten;
uniform float uBulgeFraction;
uniform float uBrightness;
uniform float uEmphasis;
uniform float uPhysical;
uniform vec3 uColorInner;
uniform vec3 uColorOuter;
uniform sampler2D uDiscMap;
uniform sampler2D uNoise;
// March bounds (densityModel.js marchBounds / marchInterval).
uniform float uDiscHalfHeight;
uniform float uDiscRadius;
uniform vec3 uBulgeRadii;
uniform float uStepLength;

varying vec3 vUnitPos;

#define MAX_STEPS 96

// Must match discMap.js / noiseTexture.js.
const float DISC_MAP_EXTENT = 1.45;
const float NOISE_TILE_UNITS = 2.0;
const float BULGE_I = 0.3;
// Dust absorption per unit of (surface density × slab density / zd).
const float DUST_K = 1.1;

// sech²(x) without cosh: 4e^{-2|x|} / (1 + e^{-2|x|})².
float sech2(float x) {
  float e = exp(-2.0 * abs(x));
  float d = 1.0 + e;
  return 4.0 * e / (d * d);
}

// Ray interval inside slab |y| ≤ h ∩ cylinder x²+z² ≤ r² (empty: x > y).
vec2 intersectDisc(vec3 ro, vec3 rd, float h, float r) {
  vec2 t = vec2(0.0, 1e9);
  if (abs(rd.y) < 1e-6) {
    if (abs(ro.y) > h) return vec2(1.0, 0.0);
  } else {
    float a = (-h - ro.y) / rd.y;
    float c = (h - ro.y) / rd.y;
    t = vec2(min(a, c), max(a, c));
  }
  float A = dot(rd.xz, rd.xz);
  float C = dot(ro.xz, ro.xz) - r * r;
  if (A > 1e-8) {
    float B = dot(ro.xz, rd.xz);
    float d = B * B - A * C;
    if (d < 0.0) return vec2(1.0, 0.0);
    float s = sqrt(d);
    t = vec2(max(t.x, (-B - s) / A), min(t.y, (-B + s) / A));
  } else if (C > 0.0) {
    return vec2(1.0, 0.0);
  }
  return vec2(max(t.x, 0.0), t.y);
}

// Ray interval inside an axis-aligned ellipsoid (empty: x > y).
vec2 intersectEllipsoid(vec3 ro, vec3 rd, vec3 radii) {
  vec3 o = ro / radii;
  vec3 d = rd / radii;
  float A = dot(d, d);
  float B = dot(o, d);
  float C = dot(o, o) - 1.0;
  float disc = B * B - A * C;
  if (disc < 0.0) return vec2(1.0, 0.0);
  float s = sqrt(disc);
  return vec2(max((-B - s) / A, 0.0), (-B + s) / A);
}

vec3 physicalTint(vec3 bb, float lumaBb, float R) {
  vec3 tint = mix(uColorInner, uColorOuter, gm_smoothstep(0.0, 0.85, R));
  return mix(tint * lumaBb * 1.3, bb, uPhysical);
}

void main() {
  vec3 ro = uCameraLocal;
  vec3 rd = normalize(vUnitPos - ro);

  // Ray / box intersection (slab method).
  vec3 inv = 1.0 / rd;
  vec3 t0 = (-uBoxHalf - ro) * inv;
  vec3 t1 = (uBoxHalf - ro) * inv;
  vec3 tLo = min(t0, t1);
  vec3 tHi = max(t0, t1);
  float tNear = max(max(max(tLo.x, tLo.y), tLo.z), 0.0);
  float tFar = min(min(tHi.x, tHi.y), tHi.z);
  if (tFar <= tNear) discard;

  // March only where there is matter: (disc ∪ bulge) ∩ box.
  vec2 dI = intersectDisc(ro, rd, uDiscHalfHeight, uDiscRadius);
  vec2 bI = intersectEllipsoid(ro, rd, uBulgeRadii);
  bool hasDisc = dI.y > dI.x;
  bool hasBulge = bI.y > bI.x;
  if (!hasDisc && !hasBulge) discard;
  float a = min(hasDisc ? dI.x : 1e9, hasBulge ? bI.x : 1e9);
  float b = max(hasDisc ? dI.y : -1e9, hasBulge ? bI.y : -1e9);
  tNear = max(tNear, a);
  tFar = min(tFar, b);
  if (tFar <= tNear) discard;

  // Step count from the chord: face-on rays through the thin disc take few.
  float steps = clamp(ceil((tFar - tNear) / uStepLength), 3.0, max(uSteps, 3.0));
  float dt = (tFar - tNear) / steps;
  float t = tNear + dt * gn_ign(gl_FragCoord.xy);

  // Loop invariants: rotations into the pattern and noise frames, colours.
  float pa = -uPhase * uPatternSpeed;
  mat2 toPattern = mat2(cos(pa), sin(pa), -sin(pa), cos(pa));
  float na = uPhase * gm_omega(0.6, uDifferential);
  mat2 toNoise = mat2(cos(na), sin(na), -sin(na), cos(na));
  vec3 bbBulge = gm_blackbody(4300.0);
  vec3 bbOld = gm_blackbody(5200.0);
  vec3 bbYoung = gm_blackbody(11000.0);
  vec3 lumaW = vec3(0.2126, 0.7152, 0.0722);
  vec3 bulgeColor = physicalTint(bbBulge, dot(bbBulge, lumaW), 0.0);
  float lumaOld = dot(bbOld, lumaW);
  float lumaYoung = dot(bbYoung, lumaW);
  float zd = uDiscThickness * DUST_HEIGHT_RATIO;
  float dustScale = DUST_K * uDustStrength * uVolumeDust / zd;

  vec3 L = vec3(0.0);
  vec3 T = vec3(1.0);

  for (int i = 0; i < MAX_STEPS; i++) {
    if (float(i) >= steps) break;
    vec3 p = ro + rd * t;
    float R = length(p.xz);

    // Baked in-plane fields (pattern frame).
    vec4 disc = texture2D(uDiscMap, (toPattern * p.xz) / (2.0 * DISC_MAP_EXTENT) + 0.5);
    vec2 noise = texture2D(uNoise, (toNoise * p.xz) / NOISE_TILE_UNITS).rg;

    // Vertical profile: sech², flaring outward.
    float z0 = uDiscThickness * (1.0 + 0.6 * R) * 1.4;
    float plane = disc.r * sech2(p.y / z0) / z0 * 0.05;
    plane *= mix(1.0, 0.25 + 1.5 * noise.r, uFlocculence);

    // Bulge: flattened Sérsic.
    float rb = length(vec3(p.x, p.y / uBulgeFlatten, p.z));
    float bulge = BULGE_I * uBulgeFraction * gm_sersicRe(rb, uBulgeSize, uBulgeSersic);
    // Fade out before the march ellipsoid so its surface never shows as an edge.
    bulge *= 1.0 - gm_smoothstep(0.65, 1.0, length(p / uBulgeRadii));

    // Colour: old warm light inside; arm crests bluer (young stars).
    float young = disc.g * 0.8;
    vec3 discColor = physicalTint(mix(bbOld, bbYoung, young), mix(lumaOld, lumaYoung, young), R);
    // Fade to zero at the box faces so a wide envelope never shows the box edge.
    vec3 q = abs(p) / uBoxHalf;
    float window = 1.0 - gm_smoothstep(0.7, 1.0, max(max(q.x, q.y), q.z));
    vec3 emission = (bulge * bulgeColor + plane * discColor) * window;

    // Dust: thin slab, filamentary.
    float dust = dustScale * disc.b * exp(-abs(p.y) / zd) * mix(1.0, gm_smoothstep(0.35, 0.75, noise.g) * 1.8, 0.75);

    // Euler step with reddening: blue is absorbed more than red.
    vec3 trans = exp(-dust * dt * vec3(0.75, 1.0, 1.3));
    L += T * emission * dt;
    T *= trans;

    if (max(T.r, max(T.g, T.b)) < 0.01) break;
    t += dt;
  }

  float alpha = dot(T, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(L * uGlow * uBrightness * uEmphasis, alpha);

  #include <colorspace_fragment>
}
