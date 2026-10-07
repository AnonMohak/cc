uniform float uSnTime; // galaxy simulation time: knots stop while paused
uniform float uBrightness;
uniform float uEmphasis;
uniform float uBandJetGain;

varying vec2 vJet;
varying float vEnergy;

// Synchrotron blue-white; bright near the base so it blooms there.
const vec3 JET_COLOR = vec3(0.55, 0.72, 1.0);
const float JET_INTENSITY = 1.4;

void main() {
  float across = max(1.0 - vJet.x * vJet.x, 0.0);
  float along = smoothstep(0.0, 0.04, vJet.y) * (1.0 - smoothstep(0.55, 1.0, vJet.y)) * mix(1.0, 0.35, vJet.y);
  // Bright knots (internal shocks) travelling outward.
  float knots = 0.75 + 0.25 * sin(vJet.y * 14.0 - uSnTime * 2.5);
  float a = across * across * along * knots * vEnergy;
  gl_FragColor = vec4(JET_COLOR * a * JET_INTENSITY * uBandJetGain * uBrightness * uEmphasis, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
