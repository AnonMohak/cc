// Consumption, draw side (galaxy/consumption.js): stars and stream matter
// around a winning black hole. Shared by stars.vert.glsl and stream.vert.glsl.

uniform vec4 uHoleWorld; // xyz: the winning hole (world), w: capture radius (0: no hole)
uniform vec4 uSplit; // xyz: the hole (world), w: its lens reach (world; 0: no split)

// In front of the hole and inside its lens reach: drawn after the lens pass
// (layer JETS), so the lens neither bends it nor hides it in the shadow.
// Matter behind the hole stays in the normal draw and is lensed like the disc.
bool cs_afterLens(vec3 viewPos) {
  if (uSplit.w <= 0.0) return false;
  vec3 hv = (viewMatrix * vec4(uSplit.xyz, 1.0)).xyz;
  if (-viewPos.z >= -hv.z) return false;
  vec3 dir = normalize(viewPos);
  return length(hv - dir * dot(hv, dir)) < uSplit.w;
}

// 1 far from the hole, 0 at the capture radius: seen from far away, matter
// that falls in gets redder, dimmer and seems to freeze (time dilation).
float cs_infall(vec3 world) {
  if (uHoleWorld.w <= 0.0) return 1.0;
  return smoothstep(1.0, 3.0, distance(world, uHoleWorld.xyz) / uHoleWorld.w);
}

vec3 cs_redshift(vec3 c, float infall) {
  return mix(c * vec3(1.0, 0.4, 0.16) * 0.3, c, infall);
}
