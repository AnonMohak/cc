varying vec3 vColor;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  if (r2 > 1.0) discard;
  // Bright core and a soft halo, so it still glows on tiers without bloom.
  float a = exp(-r2 * 14.0) + 0.18 * exp(-r2 * 3.0) * (1.0 - r2);
  gl_FragColor = vec4(vColor * a, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
