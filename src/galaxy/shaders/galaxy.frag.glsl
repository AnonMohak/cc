uniform vec3 uColorInner;
uniform vec3 uColorOuter;
uniform float uBrightness;

varying float vRadius;
varying float vJitter;
varying float vFade;

const vec3 WARM = vec3(1.0, 0.7, 0.45);
const vec3 COOL = vec3(0.7, 0.82, 1.0);
// Additive blending of tens of thousands of points saturates quickly;
// keep each star dim so the core glows instead of clipping to white.
const float STAR_INTENSITY = 0.32;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float strength = pow(1.0 - d, 2.6);

  vec3 base = mix(uColorInner, uColorOuter, smoothstep(0.0, 0.85, vRadius));
  // Negative jitter = old, warm stars; positive = young, blue-white stars.
  vec3 tint = vJitter < 0.0 ? mix(vec3(1.0), WARM, -vJitter) : mix(vec3(1.0), COOL, vJitter);

  gl_FragColor = vec4(base * tint * strength * uBrightness * vFade * STAR_INTENSITY, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
