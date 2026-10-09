// One star step of a consumption (GPUComputationRenderer; one texel per
// star). MIRROR of collision.js stepStar for FREE and ACCRETE; BOUND stars
// come free here (galaxy stars by orbit radius, stream matter by birth
// time). Both passes compute the same new state, so position and velocity
// stay in step. WRITE_POSITION picks the output.
// position.w = state · 2 + crest (BOUND 0, FREE 1, ACCRETE 2, GONE 3);
// velocity.w = the sense of the accretion spiral (±1).
// Galaxy stars need model.glsl, stars.glsl and chunks/simInit.glsl first;
// STREAM (the gold stream off a victim black hole) needs nothing.

uniform float uDt;
uniform vec3 uCentre0; // winner (fixed)
uniform vec3 uCentre1; // victim (on its scripted path)
uniform vec2 uGm; // G·M of the winner and the victim
uniform vec2 uEps2; // softening² of each
uniform vec3 uIndirect; // winner frame: its own acceleration minus the victim's pull on it (0 in the opening pass)
uniform vec3 uWinnerVel; // the drag works relative to the winner (it may still be slowing down)
uniform float uDrag; // 1/s, toward a black-hole winner
uniform float uInfall; // a hole winner's extra inward pull on free matter (consumption.js infallPull)
uniform float uHole; // 1: the winner is a black hole (accretion on)
uniform vec3 uHoleNormal;
uniform float uAccRadius;
uniform float uCapture;
uniform float uAccRate;
uniform float uSpinMax;
uniform float uSettle;
uniform float uTimeLeft;
#ifdef STREAM
uniform sampler2D uSeed; // x: birth progress, y: side (+1 toward the winner), z: angle jitter, w: radius share
uniform float uProgress; // victim mass lost so far, 0–1
uniform vec3 uVictimNormal;
uniform float uSpawnRadius; // the victim's (shrinking) disc outer radius, world
uniform float uVictimGm; // the victim's own pull at birth
uniform vec3 uVictimVel;
#else
uniform float uRelease; // bound stars with an orbit radius at or above this come free
#endif

vec3 plummer(vec3 p, vec3 c, float gm, float eps2) {
  vec3 d = p - c;
  float r2 = dot(d, d) + eps2;
  return -gm * d / (r2 * sqrt(r2));
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 pos = texture2D(texturePosition, uv);
  vec4 vel = texture2D(textureVelocity, uv);
  float state = floor(pos.w * 0.5);
  float crestV = pos.w - state * 2.0;
  vec3 p = pos.xyz;
  vec3 v = vel.xyz;
  float spin = vel.w;

  if (state < 0.5) {
#ifdef STREAM
    vec4 seed = texture2D(uSeed, uv);
    if (uProgress >= seed.x) {
      // Born at the victim's disc edge on the line to the winner (L1, or L2
      // on the far side), in the victim's disc plane, on a Kepler orbit
      // around it with a small push outward: tides pull it into a stream.
      vec3 dir = (uCentre0 - uCentre1) * seed.y;
      dir -= uVictimNormal * dot(dir, uVictimNormal);
      dir = length(dir) > 1e-6 ? normalize(dir) : normalize(cross(uVictimNormal, vec3(0.0, 0.0, 1.0)));
      dir = dir * cos(seed.z) + cross(uVictimNormal, dir) * sin(seed.z);
      float r = max(uSpawnRadius * mix(0.7, 1.0, seed.w), 1e-4);
      float vk = sqrt(uVictimGm / r);
      p = uCentre1 + dir * r;
      v = uVictimVel + cross(uVictimNormal, dir) * vk + dir * (0.2 * vk);
      state = 1.0;
      crestV = seed.w;
    }
#else
    if (texture2D(uOrbit, uv).x >= uRelease) {
      sim_initStar(uv, p, v, crestV);
      state = 1.0;
    }
#endif
  } else if (state < 1.5) {
    vec3 a = plummer(p, uCentre0, uGm.x, uEps2.x) + plummer(p, uCentre1, uGm.y, uEps2.y) + uIndirect - uDrag * (v - uWinnerVel);
    vec3 toHole = uCentre0 - p;
    float dHole = length(toHole);
    if (uHole > 0.5 && dHole > 1e-6) a += toHole * (uInfall / dHole);
    v += a * uDt;
    p += v * uDt;
    vec3 rel = p - uCentre0;
    if (uHole > 0.5 && length(rel) < uAccRadius) {
      state = 2.0;
      spin = dot(uHoleNormal, cross(rel, v)) < 0.0 ? -1.0 : 1.0;
    }
  } else if (state < 2.5) {
    // The accretion spiral in the hole's disc plane (analytic: stable at any
    // step). Kepler speed, capped; slower near the horizon; the infall meets
    // the deadline; the height settles onto the disc.
    vec3 rel = p - uCentre0;
    float z = dot(rel, uHoleNormal);
    vec3 q = rel - uHoleNormal * z;
    float rc = max(length(q), 1e-4);
    float slow = clamp((rc - uCapture) / (2.0 * uCapture), 0.15, 1.0);
    float w = min(sqrt(uGm.x / (rc * rc * rc)), uSpinMax) * slow * spin;
    float rate = max(uAccRate * slow, log(max(rc / (0.9 * uCapture), 1.0)) / max(uTimeLeft, 0.3));
    float rcNew = rc * exp(-rate * uDt);
    vec3 qh = q / rc;
    vec3 t = cross(uHoleNormal, qh);
    float ang = w * uDt;
    vec3 pn = uCentre0 + (qh * cos(ang) + t * sin(ang)) * rcNew + uHoleNormal * (z * exp(-uSettle * uDt));
    if (uDt > 0.0) v = (pn - p) / uDt;
    p = pn;
    if (rcNew < uCapture * 1.02) state = 3.0;
  }

#ifdef WRITE_POSITION
  gl_FragColor = vec4(p, state * 2.0 + crestV);
#else
  gl_FragColor = vec4(v, spin);
#endif
}
