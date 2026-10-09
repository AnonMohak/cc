// Start state of one star for the collision simulation (one texel per star,
// GPUComputationRenderer). Needs model.glsl and stars.glsl first (gs_position
// and its uniforms, shared with the galaxy by reference).
// MIRROR of collision.js initialStarState: the analytic position now
// (world); velocity = circular speed in the galaxy's own Plummer potential +
// the centre's velocity. Disc and bar stars turn with the galaxy's spin;
// bulge, halo and cluster stars on circles in random planes (a hot
// spheroid); a cluster's stars share their centre's orbit.

uniform sampler2D uOrbit; // aOrbit, one texel per star
uniform sampler2D uOffset; // position attribute (cluster offsets)
uniform mat4 uMatrix; // galaxy group matrixWorld (now)
uniform vec3 uCentre;
uniform vec3 uCentreVel;
uniform vec3 uSpin;
uniform float uGmSelf;
uniform float uEps2Self;

float sim_hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

vec3 sim_randomUnit(float seed) {
  float u = 2.0 * sim_hash(seed) - 1.0;
  float phi = TAU * sim_hash(seed + 17.13);
  float s = sqrt(1.0 - u * u);
  return vec3(s * cos(phi), u, s * sin(phi));
}

// The star at uv as it is now: world position, velocity and arm crest.
void sim_initStar(vec2 uv, out vec3 pos, out vec3 vel, out float crestV) {
  vec4 orbit = texture2D(uOrbit, uv);
  vec3 local = gs_position(orbit, crestV);
  // For a cluster star, local is the cluster centre: the anchor of its orbit.
  vec3 anchor = (uMatrix * vec4(local, 1.0)).xyz;
  vec3 offset = texture2D(uOffset, uv).xyz * step(KIND_CLUSTER, orbit.w);
  pos = (uMatrix * vec4(local + offset, 1.0)).xyz;
  vec3 axis = uSpin;
  if (orbit.w > KIND_CLUSTER) axis = sim_randomUnit(orbit.x * 1000.0);
  else if (orbit.w > KIND_DISC && orbit.w < KIND_HALO) axis = sim_randomUnit(dot(gl_FragCoord.xy, vec2(1.0, 4096.0)) * 0.001);
  vec3 rel = anchor - uCentre;
  float r2 = dot(rel, rel);
  vec3 t = cross(axis, rel);
  float tl = length(t);
  float vc = sqrt(uGmSelf * r2 / pow(r2 + uEps2Self, 1.5));
  vel = uCentreVel + (tl > 1e-9 ? t * (vc / tl) : vec3(0.0));
}
