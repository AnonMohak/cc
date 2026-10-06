// Raymarched galaxy body: the smooth light of unresolved stars plus dust
// absorption, integrated front to back. Needs model.glsl, noise.glsl and
// stars.glsl (uniforms, dust surface density) first.

uniform vec3 uBoxHalf;
uniform float uSteps;
uniform float uOctaves;
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

varying vec3 vUnitPos;

#define MAX_STEPS 96

// Emission scales, tuned so a face-on disc reads as a soft glow under the
// stars and an edge-on disc is a bright band (longer path).
const float DISC_I = 4.2;
const float BULGE_I = 9.0;
const float BAR_I = 2.0;
// Dust absorption per unit of (surface density × slab density / zd).
const float DUST_K = 1.1;

float sech2(float x) {
  float c = cosh(clamp(x, -10.0, 10.0));
  return 1.0 / (c * c);
}

vec3 physicalTint(vec3 bb, float R) {
  vec3 tint = mix(uColorInner, uColorOuter, gm_smoothstep(0.0, 0.85, R));
  float luma = dot(bb, vec3(0.2126, 0.7152, 0.0722));
  return mix(tint * luma * 1.3, bb, uPhysical);
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

  float steps = max(uSteps, 4.0);
  float dt = (tFar - tNear) / steps;
  float t = tNear + dt * gn_ign(gl_FragCoord.xy);
  int octaves = int(uOctaves);

  float hasArms = step(0.5, uArms) * clamp(uEccentricity / 0.08, 0.0, 1.0);
  float sgn = uWinding < 0.0 ? -1.0 : 1.0;
  float barAng = gm_barAngle(uBar, uArms, uWinding, uPhase, uPatternSpeed);
  vec2 barAxis = vec2(cos(barAng), sin(barAng));
  // Flocculent structure co-rotates rigidly at a mid-disc rate: it does not
  // shear into a smear over time.
  float noiseRot = uPhase * gm_omega(0.6, uDifferential);
  mat2 noiseM = mat2(cos(noiseRot), sin(noiseRot), -sin(noiseRot), cos(noiseRot));

  vec3 bulgeColor = physicalTint(gm_blackbody(4300.0), 0.0);
  float zd = uDiscThickness * DUST_HEIGHT_RATIO;

  vec3 L = vec3(0.0);
  vec3 T = vec3(1.0);

  for (int i = 0; i < MAX_STEPS; i++) {
    if (float(i) >= steps) break;
    vec3 p = ro + rd * t;
    float R = length(p.xz);
    float theta = atan(p.z, p.x);

    // Bulge: flattened Sérsic.
    float rb = length(vec3(p.x, p.y / uBulgeFlatten, p.z));
    float bulge = BULGE_I * uBulgeFraction * gm_sersic(rb, uBulgeSize, uBulgeSersic);

    // Disc: exponential × sech², flared, smoothly truncated.
    float z0 = uDiscThickness * (1.0 + 0.6 * R) * 1.4;
    float disc = exp(-R / uDiscScale) * sech2(p.y / z0) / z0 * 0.05;
    disc *= 1.0 - gm_smoothstep(0.95, 1.3, R);
    disc *= (1.0 - uBulgeFraction) * DISC_I;

    // Arms: density-wave crest (same model as the stars).
    float c = 0.5;
    if (hasArms > 0.0) {
      float psi = gm_armPhase(theta, R, uArms, uWinding, uPhase, uPatternSpeed);
      c = gm_crest(psi, uWinding);
      float armMask = gm_smoothstep(uBar * 0.7, uBar + 0.12, R);
      disc *= mix(1.0, 0.35 + 2.2 * pow(c, 2.5), uArmContrast * hasArms * armMask);
    }

    // Flocculence: feathers and fragments.
    vec3 pn = vec3(noiseM * p.xz, p.y * 2.0) * 7.0;
    float n = gn_fbm(pn, octaves);
    disc *= mix(1.0, 0.25 + 1.5 * n, uFlocculence);

    // Bar: elongated, rigid with the pattern.
    float bar = 0.0;
    if (uBar > 0.0) {
      float along = dot(p.xz, barAxis);
      float across = dot(p.xz, vec2(-barAxis.y, barAxis.x));
      bar = BAR_I * exp(-pow(abs(along) / uBar, 4.0)) * exp(-across * across / 0.004) * sech2(p.y / z0) / z0 * 0.05;
    }

    // Colour: old warm light inside; arm crests bluer (young stars).
    vec3 discColor = physicalTint(mix(gm_blackbody(5200.0), gm_blackbody(11000.0), c * hasArms * 0.8), R);
    vec3 emission = bulge * bulgeColor + (disc + bar) * discColor;

    // Dust: thin slab, on the inner arm edges, filamentary.
    float dust = 0.0;
    if (uDustStrength > 0.0) {
      float filaments = mix(1.0, gm_smoothstep(0.35, 0.75, gn_fbm(pn * 1.7 + 3.1, octaves)) * 1.8, 0.75);
      dust = DUST_K * uDustStrength * gs_dustSurface(R, theta) * exp(-abs(p.y) / zd) / zd * filaments;
    }

    // Exact integration of a constant segment: emission absorbed within it.
    vec3 tau = dust * dt * vec3(0.75, 1.0, 1.3);
    vec3 trans = exp(-tau);
    vec3 absorbed = mix(vec3(dt), (1.0 - trans) / max(tau / dt, vec3(1e-4)), step(1e-4, tau));
    L += T * emission * absorbed;
    T *= trans;

    if (max(T.r, max(T.g, T.b)) < 0.01) break;
    t += dt;
  }

  float alpha = dot(T, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(L * uGlow * uBrightness * uEmphasis, alpha);

  #include <colorspace_fragment>
}
