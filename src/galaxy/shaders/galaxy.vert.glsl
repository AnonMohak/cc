uniform float uPhase;
uniform float uDifferential;
uniform float uSize;
uniform float uScale;
uniform float uPixelRatio;

attribute float aRadiusNorm;
attribute float aColorJitter;
attribute float aSize;

varying float vRadius;
varying float vJitter;
varying float vFade;

// Converts world-ish point size to pixels; tuned so default stars are ~2px
// when the whole galaxy fills the view.
const float POINT_SCALE = 6.0;

void main() {
  // Damped differential rotation: inner stars orbit faster, but not as
  // 1/r, which would wind the arms into a smear (the "winding problem").
  float r = length(position.xz);
  float omega = mix(1.0, 1.0 / (r + 0.25), uDifferential);
  float angle = uPhase * omega;
  float s = sin(angle);
  float c = cos(angle);
  vec3 p = vec3(position.x * c - position.z * s, position.y, position.x * s + position.z * c);

  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  float size = aSize * uSize * uScale * uPixelRatio * POINT_SCALE / max(-mvPosition.z, 0.001);
  // Sub-pixel points flicker; draw them at 1px and fade them instead.
  vFade = clamp(size, 0.0, 1.0);
  gl_PointSize = clamp(size, 1.0, 64.0 * uPixelRatio);

  vRadius = aRadiusNorm;
  vJitter = aColorJitter;
}
