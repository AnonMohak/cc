// Start state of a galaxy's stars when a galaxy merger hands them to the
// simulation (every star FREE at once). Needs model.glsl, stars.glsl and
// chunks/simInit.glsl first. WRITE_POSITION picks the output.
// MIRROR of collision.js initialStarState (w = FREE · 2 + crest).

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec3 pos;
  vec3 vel;
  float crestV;
  sim_initStar(uv, pos, vel, crestV);
#ifdef WRITE_POSITION
  gl_FragColor = vec4(pos, 2.0 + crestV);
#else
  gl_FragColor = vec4(vel, 0.0);
#endif
}
