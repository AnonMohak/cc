// Gold stream matter torn off a victim black hole (scene/CollisionSim.js):
// one point per simulation texel (gl_VertexID), drawn while FREE or
// ACCRETE. Needs chunks/consume.glsl first.
uniform sampler2D uStreamPos; // world position, w = state · 2 + crest (collision.js STATE)
uniform vec3 uHot; // the victim's disc colours (linear)
uniform vec3 uCool;
uniform float uGain;
uniform float uPixelRatio;
uniform float uMaxPointPx;

attribute vec4 aSeed; // x: birth, y: side, z: jitter, w: radius share (also the colour)

varying vec3 vColor;
varying float vFade;

const float STREAM_SIZE = 0.05; // world units: a small clump of gas

void main() {
  int w = textureSize(uStreamPos, 0).x;
  vec4 s = texelFetch(uStreamPos, ivec2(gl_VertexID % w, gl_VertexID / w), 0);
  float state = floor(s.w * 0.5);
  vec4 mvPosition = viewMatrix * vec4(s.xyz, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  bool gone = state < 0.5 || state > 2.5;
#ifdef AFTER_LENS
  if (!cs_afterLens(mvPosition.xyz)) gone = true;
#else
  if (cs_afterLens(mvPosition.xyz)) gone = true;
#endif
  float size = STREAM_SIZE * uPixelRatio * 900.0 / max(-mvPosition.z, 0.001);
  vFade = clamp(size, 0.0, 1.0);
  gl_PointSize = clamp(size, 1.0, uMaxPointPx * uPixelRatio);
  if (gone) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  // Hotter (whiter) gas from the inner disc, gold from the outer.
  vec3 color = mix(uHot, uCool, aSeed.w);
  vColor = cs_redshift(color, cs_infall(s.xyz)) * uGain;
}
