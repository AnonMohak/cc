uniform float uSize;
uniform float uScale;
uniform float uPixelRatio;
uniform float uBrightness;
uniform float uEmphasis;
uniform float uLodGain;
uniform float uMaxPointPx; // per quality tier; nebulae may be 3× larger

attribute vec4 aOrbit;
attribute float aSize;

varying float vGlow;
varying vec3 vExtinction;

const float POINT_SCALE = 26.0;

void main() {
  float crestV;
  vec3 p = gs_position(aOrbit, crestV);
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // H II regions exist only where the density wave compresses gas: they
  // swell on the crest and vanish between arms (beltoforion's trick).
  float onArm = uArms > 0.5 ? pow(gm_smoothstep(0.5, 1.0, crestV), 2.0) : 0.6;

  float size = aSize * onArm * uSize * uScale * uPixelRatio * POINT_SCALE / max(-mvPosition.z, 0.001);
  gl_PointSize = clamp(size, 0.0, 3.0 * uMaxPointPx * uPixelRatio);
  vGlow = onArm * uBrightness * uEmphasis * uLodGain * clamp(size, 0.0, 1.0);
  vExtinction = gs_extinction(gs_dustTau(p));
}
