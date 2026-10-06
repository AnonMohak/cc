uniform float uOpacity;

varying float vFade;

// Dark reddish-brown: dust absorbs blue light more than red.
const vec3 DUST_COLOR = vec3(0.045, 0.028, 0.018);
// Many dust sprites overlap along a lane; keep each one faint.
const float DUST_ALPHA = 0.32;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = pow(1.0 - d, 1.5) * uOpacity * vFade * DUST_ALPHA;
  gl_FragColor = vec4(DUST_COLOR, a);

  #include <colorspace_fragment>
}
