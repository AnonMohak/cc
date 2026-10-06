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

// Kinds, see generateGalaxy.js KIND.
#define KIND_DISC 0.5
#define KIND_HALO 2.5

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

  // Bar: rigid, turning with the pattern; orbit = (along, lateral, z).
  float ang = gm_barAngle(uBar, uArms, uWinding, uPhase, uPatternSpeed);
  float c = cos(ang);
  float s = sin(ang);
  return vec3(orbit.x * c - orbit.y * s, orbit.z, orbit.x * s + orbit.y * c);
}

// Dust surface density: exponential disc, empty bulge, concentrated on the
// inner (concave) edge of each arm.
float gs_dustSurface(float R, float theta) {
  float d = exp(-R / (uDiscScale * 1.3)) * gm_smoothstep(uBulgeSize * 0.5, uBulgeSize * 1.8, R);
  if (uArms > 0.5) {
    float sgn = uWinding < 0.0 ? -1.0 : 1.0;
    float psi = gm_armPhase(theta, R, uArms, uWinding, uPhase, uPatternSpeed);
    float lane = pow(gm_crest(psi - 0.6 * sgn, uWinding), 4.0);
    d *= mix(1.0, 0.15 + 2.2 * lane, uArmContrast);
  }
  return d;
}

// Optical depth from a point to the camera through the galaxy's dust slab.
float gs_dustTau(vec3 p) {
  if (uDustStrength <= 0.0) return 0.0;
  float R = length(p.xz);
  vec3 toCam = uCameraLocal - p;
  float side = toCam.y >= 0.0 ? 1.0 : -1.0;
  float col = gm_dustColumn(p.y, side, uDiscThickness * DUST_HEIGHT_RATIO);
  float cosI = abs(toCam.y) / max(length(toCam), 1e-4);
  return DUST_KAPPA * uDustStrength * gs_dustSurface(R, atan(p.z, p.x)) * col / max(cosI, 0.08);
}

// Dust reddens: blue light is absorbed more than red.
vec3 gs_extinction(float tau) {
  return exp(-tau * vec3(0.75, 1.0, 1.3));
}
