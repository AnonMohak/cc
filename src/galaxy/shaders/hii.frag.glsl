varying float vGlow;
varying vec3 vExtinction;

// Hα red-pink with a little [O III] blue-white in the core (linear RGB).
const vec3 H_ALPHA = vec3(1.0, 0.16, 0.32);
const vec3 CORE = vec3(0.9, 0.75, 1.0);
const float HII_INTENSITY = 0.16;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  if (r2 > 1.0) discard;
  float a = exp(-r2 * 3.5) * (1.0 - r2);
  vec3 color = mix(H_ALPHA, CORE, exp(-r2 * 18.0) * 0.5);
  gl_FragColor = vec4(color * vExtinction * a * vGlow * HII_INTENSITY, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
