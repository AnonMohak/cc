// Shared vertex-side code for the star and H II layers: density-wave star
// positions and the dust column toward the camera. Needs model.glsl first.

uniform float uPhase;
uniform float uDifferential;
uniform float uPatternSpeed;
uniform float uArms;
uniform float uWinding;
uniform float uEccentricity;
uniform float uArmContrast;
uniform float uDustStrength;
uniform float uBar;
uniform float uDiscScale;
uniform float uDiscThickness;
uniform float uBulgeSize;
uniform vec3 uCameraLocal;
// Collision (collision.js gasFade): 1 normally; 0 once tides have torn the
// gas apart (volume, H II and dust fade, the stars carry the tails).
uniform float uGasFade;
// Wavelength band (bands.js); visible = 1 / identity / 0 everywhere.
uniform float uBandDustPass;
uniform float uBandStarGain;
uniform float uBandStarKeep;
uniform mat3 uBandStarColor;
uniform float uBandHiiGain;
uniform float uBandSnGain;

// Kinds, see generateGalaxy.js KIND.
#define KIND_DISC 0.5
#define KIND_HALO 2.5
#define KIND_CLUSTER 3.5

// How strongly dust absorbs; tuned so a face-on lane dims stars by ~60%.
const float DUST_KAPPA = 1.1;
// Dust sits in a slab thinner than the stars.
const float DUST_HEIGHT_RATIO = 0.6;

// Current local position of a star. `crestOut`: 1 on an arm crest, 0 between.
vec3 gs_position(vec4 orbit, out float crestOut) {
  float a = orbit.x;
  float kind = orbit.w;
  crestOut = 0.5;

  if (kind < KIND_DISC) {
    float theta = orbit.y + uPhase * gm_omega(a, uDifferential);
    float hasArms = step(0.5, uArms);
    float e = hasArms * gm_eccentricity(a, uEccentricity);
    float psi = gm_armPhase(theta, a, uArms, uWinding, uPhase, uPatternSpeed);
    float r = a * (1.0 + e * cos(psi));
    crestOut = mix(0.5, gm_crest(psi, uWinding), hasArms);
    return vec3(r * cos(theta), orbit.z, r * sin(theta));
  }

  if (kind < KIND_HALO) {
    // Bulge and halo: hot, random orbits; slow net rotation.
    float theta = orbit.y + uPhase * gm_omega(a, uDifferential) * 0.6;
    return vec3(a * cos(theta), orbit.z, a * sin(theta));
  }

  if (kind > KIND_CLUSTER) {
    // Globular cluster centre: a slow halo orbit. The star's offset from the
    // centre is added by the star shader (position attribute).
    float theta = orbit.y + uPhase * gm_omega(a, uDifferential) * 0.6;
    return vec3(a * cos(theta), orbit.z, a * sin(theta));
  }

  // Bar: rigid, turning with the pattern; orbit = (along, lateral, z).
  float ang = gm_barAngle(uBar, uArms, uWinding, uPhase, uPatternSpeed);
  float c = cos(ang);
  float s = sin(ang);
  return vec3(orbit.x * c - orbit.y * s, orbit.z, orbit.x * s + orbit.y * c);
}

// Baked in-plane fields (discMap.js), pattern frame: b = dust surface density.
uniform sampler2D uDiscMap;
const float DISC_MAP_EXTENT = 1.45;

// Sample the disc map at a local point (rotated into the pattern frame).
vec4 gs_discMap(vec2 xz) {
  float pa = -uPhase * uPatternSpeed;
  float c = cos(pa);
  float s = sin(pa);
  vec2 q = vec2(c * xz.x - s * xz.y, s * xz.x + c * xz.y);
  return texture2D(uDiscMap, q / (2.0 * DISC_MAP_EXTENT) + 0.5);
}

// Optical depth from a point to the camera through the galaxy's dust slab.
float gs_dustTau(vec3 p) {
  if (uDustStrength * uBandDustPass * uGasFade <= 0.0) return 0.0;
  vec3 toCam = uCameraLocal - p;
  float side = toCam.y >= 0.0 ? 1.0 : -1.0;
  float col = gm_dustColumn(p.y, side, uDiscThickness * DUST_HEIGHT_RATIO);
  float cosI = abs(toCam.y) / max(length(toCam), 1e-4);
  return DUST_KAPPA * uDustStrength * uBandDustPass * uGasFade * gs_discMap(p.xz).b * col / max(cosI, 0.08);
}

// Dust reddens: blue light is absorbed more than red.
vec3 gs_extinction(float tau) {
  return exp(-tau * vec3(0.75, 1.0, 1.3));
}
