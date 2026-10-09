uniform float uSize;
uniform float uScale;
uniform float uPixelRatio;
uniform float uBrightness;
uniform float uEmphasis;
uniform float uLodGain;
uniform float uPhysical;
uniform float uMaxPointPx; // per quality tier
uniform vec3 uColorInner;
uniform vec3 uColorOuter;
// Collision star simulation (scene/CollisionSim.js): world position per
// star (one texel per vertex, w = state · 2 + arm crest; collision.js STATE).
// A BOUND star is still on its analytic orbit (in the moving group).
uniform float uSim;
uniform sampler2D uSimPos;
uniform mat4 uSimToLocal;
// Starburst after a galaxy merger (consumption.js starburstLevel): young stars brighter.
uniform float uStarburst;

attribute vec4 aOrbit;
attribute vec3 aStar; // (temperature K, size, youth)
attribute vec3 aColor; // linear black-body colour, baked by the generator

varying vec3 vColor;
varying float vFade;

// World-ish point size → pixels; tuned so typical stars are 1–3 px.
const float POINT_SCALE = 5.0;
const float STARBURST_GAIN = 2.0;

void main() {
  float crestV;
  vec3 p;
  bool gone = false;
  bool analytic = true;
  if (uSim > 0.5) {
    int w = textureSize(uSimPos, 0).x;
    vec4 s = texelFetch(uSimPos, ivec2(gl_VertexID % w, gl_VertexID / w), 0);
    float state = floor(s.w * 0.5);
    if (state > 0.5) {
      // Back to unit space, so the tint, dust and size below are unchanged.
      p = (uSimToLocal * vec4(s.xyz, 1.0)).xyz;
      crestV = s.w - state * 2.0;
      analytic = false;
      gone = state > 2.5;
    }
  }
  if (analytic) {
    p = gs_position(aOrbit, crestV);
    // Globular-cluster stars: offset from the cluster centre (generateGalaxy.js).
    p += position * step(KIND_CLUSTER, aOrbit.w);
  }
  vec4 world = modelMatrix * vec4(p, 1.0);
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;

  // Young O/B stars blaze while they cross an arm crest (triggered star
  // formation) and fade between arms, so blue stars always trace the arms.
  float youth = aStar.z;
  float lum = mix(1.0, mix(0.12, 1.6, smoothstep(0.25, 0.95, crestV)), youth);
  lum *= 1.0 + STARBURST_GAIN * uStarburst * youth;

  float R = length(p.xz);
  vec3 bb = aColor;
  vec3 tint = mix(uColorInner, uColorOuter, gm_smoothstep(0.0, 0.85, R));
  float luma = dot(bb, vec3(0.2126, 0.7152, 0.0722));
  vec3 color = uBandStarColor * mix(tint * luma * 1.3, bb, uPhysical);
  color *= gs_extinction(gs_dustTau(p));
  // Near a winning black hole: redder, dimmer (consume.glsl).
  color = cs_redshift(color, cs_infall(world.xyz));
  // X-ray: only a stable random few stars (compact binaries) stay; 1 = all.
  float keep = step(fract(abs(aOrbit.y) * 157.31 + aOrbit.x * 311.7), uBandStarKeep);
  // The lens split: the normal draw leaves the stars in front of a winning
  // hole to the after-lens draw (AFTER_LENS, layer JETS), and back.
#ifdef AFTER_LENS
  if (!cs_afterLens(mvPosition.xyz)) gone = true;
#else
  if (cs_afterLens(mvPosition.xyz)) gone = true;
#endif

  float size = aStar.y * uSize * uScale * uPixelRatio * POINT_SCALE / max(-mvPosition.z, 0.001);
  // Sub-pixel points flicker; draw them at 1 px and fade them instead.
  vFade = clamp(size, 0.0, 1.0);
  // Close stars must not become blobs (and big points cost fill rate).
  gl_PointSize = clamp(size, 1.0, uMaxPointPx * uPixelRatio);
  // Dropped stars go outside the clip volume: a 0 px point still draws 1 px
  // on some GPUs, and clipping costs no fill.
  if (keep < 0.5 || gone) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vColor = color * lum * uBrightness * uEmphasis * uLodGain * uBandStarGain;
}
