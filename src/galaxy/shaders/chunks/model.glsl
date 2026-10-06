// Galaxy model shared by the star, H II and volume shaders.
// MIRROR of src/galaxy/densityModel.js — change both together.

#ifndef GALAXY_MODEL
#define GALAXY_MODEL

#define TAU 6.28318530718

float gm_smoothstep(float e0, float e1, float x) {
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// Angular speed factor: damped flat-rotation-curve law (inner orbits faster).
float gm_omega(float a, float differential) {
  return (1.0 - differential) + differential / (a + 0.25);
}

// Orbit orientation φ(a): log spiral, `winding` turns from the centre to a = 1,
// plus rigid pattern rotation. ln(1 + 1/0.25) = ln 5.
float gm_orbitAngle(float a, float winding, float phase, float patternSpeed) {
  return TAU * winding * log(1.0 + max(a, 0.0) / 0.25) / 1.6094379124 + phase * patternSpeed;
}

float gm_eccentricity(float a, float eMax) {
  return eMax * gm_smoothstep(0.04, 0.3, a) * (1.0 - 0.5 * gm_smoothstep(0.6, 1.2, a));
}

float gm_armPhase(float theta, float a, float arms, float winding, float phase, float patternSpeed) {
  return arms * (theta - gm_orbitAngle(a, winding, phase, patternSpeed));
}

// 1 on an arm crest, 0 midway between arms.
float gm_crest(float psi, float winding) {
  float s = winding < 0.0 ? -1.0 : 1.0;
  return 0.5 * (1.0 - s * sin(psi));
}

// Exponential dust slab column toward the camera side, in units of zd·density:
// 0 clear on the camera side, 1 at the midplane, 2 through the whole slab.
float gm_dustColumn(float z, float side, float zd) {
  float u = (side >= 0.0 ? z : -z) / zd;
  return u >= 0.0 ? exp(-u) : 2.0 - exp(u);
}

// Tanner Helland black-body fit → sRGB in [0, 1].
vec3 gm_blackbodySRGB(float kelvin) {
  float t = kelvin / 100.0;
  vec3 c;
  if (t <= 66.0) {
    c.r = 255.0;
    c.g = 99.4708025861 * log(t) - 161.1195681661;
    c.b = t <= 19.0 ? 0.0 : 138.5177312231 * log(t - 10.0) - 305.0447927307;
  } else {
    c.r = 329.698727446 * pow(t - 60.0, -0.1332047592);
    c.g = 288.1221695283 * pow(t - 60.0, -0.0755148492);
    c.b = 255.0;
  }
  return clamp(c / 255.0, 0.0, 1.0);
}

// Linear-light version for shading (three's working space is linear sRGB).
vec3 gm_blackbody(float kelvin) {
  return pow(gm_blackbodySRGB(kelvin), vec3(2.2));
}

float gm_sersic(float r, float re, float n) {
  float b = 2.0 * n - 1.0 / 3.0;
  return exp(-b * pow(max(r, 0.0) / re, 1.0 / n));
}

// Bar turns with the pattern and points at the arm crests at its ends.
float gm_barAngle(float barLength, float arms, float winding, float phase, float patternSpeed) {
  float m = max(arms, 1.0);
  float s = winding < 0.0 ? -1.0 : 1.0;
  return gm_orbitAngle(barLength, winding, phase, patternSpeed) - s * 1.5707963268 / m;
}

#endif
