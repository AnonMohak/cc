// One star step of a galaxy collision (GPUComputationRenderer; one texel
// per star). MIRROR of collision.js stepStar: semi-implicit Euler in the
// pull of two Plummer spheres. Both passes recompute the same new velocity,
// so position and velocity stay in step. WRITE_POSITION picks the output.

uniform float uDt;
uniform vec3 uCentre0;
uniform vec3 uCentre1;
uniform vec2 uGm; // G·M of each galaxy
uniform vec2 uEps2; // softening² of each galaxy

vec3 plummer(vec3 p, vec3 c, float gm, float eps2) {
  vec3 d = p - c;
  float r2 = dot(d, d) + eps2;
  return -gm * d / (r2 * sqrt(r2));
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 pos = texture2D(texturePosition, uv);
  vec4 vel = texture2D(textureVelocity, uv);
  vec3 a = plummer(pos.xyz, uCentre0, uGm.x, uEps2.x) + plummer(pos.xyz, uCentre1, uGm.y, uEps2.y);
  vec3 v = vel.xyz + a * uDt;
#ifdef WRITE_POSITION
  gl_FragColor = vec4(pos.xyz + v * uDt, pos.w);
#else
  gl_FragColor = vec4(v, vel.w);
#endif
}
