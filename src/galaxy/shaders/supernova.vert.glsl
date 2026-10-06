uniform float uPixelRatio;
uniform float uBrightness;
uniform float uEmphasis;
uniform float uSnTime;

attribute vec4 aOrbit; // the exploding star's orbit: the flash moves with it
attribute float aBirth; // galaxy simulation time of the explosion

varying vec3 vColor;

// Must match supernovae.js (RISE, DECAY, LIFETIME).
const float RISE = 0.25;
const float DECAY = 1.1;
const float LIFETIME = 5.0;
// Peak brightness: well above the bloom threshold, so it flares.
const float PEAK = 9.0;

float light(float age) {
  if (age < 0.0 || age >= LIFETIME) return 0.0;
  if (age < RISE) {
    float t = age / RISE;
    return t * t * (3.0 - 2.0 * t);
  }
  float end = exp(-(LIFETIME - RISE) / DECAY);
  return (exp(-(age - RISE) / DECAY) - end) / (1.0 - end);
}

void main() {
  float crestV;
  vec3 p = gs_position(aOrbit, crestV);
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  float l = light(uSnTime - aBirth);
  // A point source: its glow grows with brightness, not with closeness.
  gl_PointSize = l > 0.0 ? mix(4.0, 26.0, l) * uPixelRatio : 0.0;
  // Hot blue-white, dimmed and reddened by the galaxy's own dust.
  vColor = vec3(0.75, 0.85, 1.0) * l * PEAK * uBrightness * uEmphasis * gs_extinction(gs_dustTau(p));
}
