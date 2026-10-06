uniform float uSize;
uniform float uScale;
uniform float uPixelRatio;
uniform float uBrightness;
uniform float uEmphasis;
uniform float uPhysical;
uniform vec3 uColorInner;
uniform vec3 uColorOuter;

attribute vec4 aOrbit;
attribute vec3 aStar; // (temperature K, size, youth)

varying vec3 vColor;
varying float vFade;

// World-ish point size → pixels; tuned so typical stars are 1–3 px.
const float POINT_SCALE = 5.0;
// Close stars must not become blobs.
const float MAX_POINT_PX = 18.0;

void main() {
  float crestV;
  vec3 p = gs_position(aOrbit, crestV);
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // Young O/B stars blaze while they cross an arm crest (triggered star
  // formation) and fade between arms, so blue stars always trace the arms.
  float youth = aStar.z;
  float lum = mix(1.0, mix(0.12, 1.6, smoothstep(0.25, 0.95, crestV)), youth);

  float R = length(p.xz);
  vec3 bb = gm_blackbody(aStar.x);
  vec3 tint = mix(uColorInner, uColorOuter, gm_smoothstep(0.0, 0.85, R));
  float luma = dot(bb, vec3(0.2126, 0.7152, 0.0722));
  vec3 color = mix(tint * luma * 1.3, bb, uPhysical);
  color *= gs_extinction(gs_dustTau(p));

  float size = aStar.y * uSize * uScale * uPixelRatio * POINT_SCALE / max(-mvPosition.z, 0.001);
  // Sub-pixel points flicker; draw them at 1 px and fade them instead.
  vFade = clamp(size, 0.0, 1.0);
  gl_PointSize = clamp(size, 1.0, MAX_POINT_PX * uPixelRatio);
  vColor = color * lum * uBrightness * uEmphasis;
}
