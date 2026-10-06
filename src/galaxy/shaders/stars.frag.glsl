varying vec3 vColor;
varying float vFade;

// Additive blending of tens of thousands of stars saturates quickly; the
// volume layer carries the smooth light, so each star stays dim.
const float STAR_INTENSITY = 0.42;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  if (r2 > 1.0) discard;
  // Sharp core plus a faint halo reads as a point source, not a disc.
  float a = exp(-r2 * 9.0) + 0.12 * exp(-r2 * 2.5) * (1.0 - r2);
  gl_FragColor = vec4(vColor * a * vFade * STAR_INTENSITY, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
