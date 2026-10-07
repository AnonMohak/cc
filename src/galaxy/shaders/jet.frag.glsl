uniform float uSnTime; // galaxy simulation time: knots stop while paused
uniform float uBrightness;
uniform float uEmphasis;
uniform float uBandJetGain;
uniform float uJetDiscOuter; // Rs

varying vec2 vJet;
varying float vEnergy;
varying vec3 vViewPos;
varying vec3 vHoleView;
varying vec3 vHoleAxis;
varying float vRsWorld;

// Warm gold to match the Interstellar-style disc.
const vec3 JET_COLOR = vec3(1.0, 0.72, 0.38);
const float JET_INTENSITY = 1.4;
// Soft halo around the core, strongest at the base (bloom no longer adds it).
const float HALO_GAIN = 0.22;
// How much of a jet behind the accretion disc still shows through it.
const float DISC_OPACITY = 0.85;

void main() {
  float core = max(1.0 - 4.0 * vJet.x * vJet.x, 0.0);
  float halo = max(1.0 - vJet.x * vJet.x, 0.0);
  float across = core * core + HALO_GAIN * halo * halo * (1.0 - vJet.y);
  float along = smoothstep(0.0, 0.04, vJet.y) * (1.0 - smoothstep(0.55, 1.0, vJet.y)) * mix(1.0, 0.35, vJet.y);
  // Bright knots (internal shocks) travelling outward.
  float knots = 0.75 + 0.25 * sin(vJet.y * 14.0 - uSnTime * 2.5);
  float a = across * along * knots * vEnergy;
  // Hidden behind the hole: the view ray passes inside the shadow (impact
  // parameter < SHADOW_B Rs) and this point lies beyond its closest approach.
  vec3 rd = normalize(vViewPos);
  float tc = dot(vHoleView, rd);
  float b = length(vHoleView - rd * tc) / max(vRsWorld, 1e-6);
  float behind = step(tc, length(vViewPos));
  a *= 1.0 - behind * (1.0 - smoothstep(SHADOW_B * 0.92, SHADOW_B * 1.08, b));
  // Hidden behind the near side of the accretion disc: the view ray crosses
  // the disc plane before it reaches this point, inside the disc annulus.
  float dn = dot(rd, vHoleAxis);
  if (abs(dn) > 1e-4) {
    float t = dot(vHoleView, vHoleAxis) / dn;
    if (t > 0.0 && t < length(vViewPos)) {
      float r = length(rd * t - vHoleView) / max(vRsWorld, 1e-6);
      float disc = smoothstep(DISC_INNER, DISC_INNER * 1.1, r) * (1.0 - smoothstep(uJetDiscOuter * 0.45, uJetDiscOuter, r));
      a *= 1.0 - DISC_OPACITY * disc;
    }
  }
  gl_FragColor = vec4(JET_COLOR * a * JET_INTENSITY * uBandJetGain * uBrightness * uEmphasis, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
