import { DISC_INNER, SPARSE_OUT, DISC_OUTER, H0, H1, SLAB_K, SPIN, GLOW_POWER, STEP_K, STEP_MIN, STEP_MAX, CAPTURE_R, KERR_M, KERR_A, ESCAPE_R, CURVE_K, CURVE_MIN, CURVE_MAX } from './gargantuaModel.js';
import { MARCH_LOOK, COMPOSITE_LOOK, CURVE_KNOTS, lookDeclarations } from './introLook.js';

const f = (x) => x.toFixed(4);

export const QUAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** Max steps per ray (uSteps ≤ this). */
export const MAX_STEPS = 2000;

// The look constants are uniforms (introLook.js), so the ?tune view changes them live.
const LOOK = lookDeclarations(MARCH_LOOK);

/**
 * The disc gas, shared by the march and the light pass: its uniforms, the
 * model constants and gas().
 */
const GAS_GLSL = /* glsl */ `
  precision highp sampler3D;
  uniform sampler3D uNoise;
  uniform float uTime;
  // How much the inner gas thins into sparse clumps (the camera key sparse).
  uniform float uSparse;

  const float PI = 3.14159265;
  const float DISC_INNER = ${f(DISC_INNER)};
  const float SPARSE_OUT = ${f(SPARSE_OUT)};
  const float DISC_OUTER = ${f(DISC_OUTER)};
  const float H0 = ${f(H0)};
  const float H1 = ${f(H1)};
  const float SLAB_K = ${f(SLAB_K)};
  const float SPIN = ${f(SPIN)};
  const float GLOW_POWER = ${f(GLOW_POWER)};
  const float STEP_K = ${f(STEP_K)};
  const float STEP_MIN = ${f(STEP_MIN)};
  const float STEP_MAX = ${f(STEP_MAX)};
${LOOK}

  // Mirrors of gargantuaModel.js.
  // (Per shot the inner disc may puff up into a tall torus: PUFF Rs more
  // at the inner edge, fading over PUFF_W; its bent image is the film's
  // flame wall. The optical depth across stays TAU.)
  float halfThickness(float r) {
    float d = max(r - INNER, 0.0) / max(PUFF_W, 0.1);
    return H0 + H1 * r + PUFF * exp(-d * d);
  }
  float radialWindow(float r) {
    return smoothstep(INNER, INNER * 1.25, r) * (1.0 - smoothstep(DISC_OUTER * 0.35, DISC_OUTER, r));
  }
  // Light and speed are relative to DISC_INNER (4 Rs); per shot the gas may
  // start nearer the hole (INNER), hotter there.
  float glowAt(float r) { return pow(DISC_INNER / max(r, INNER), GLOW_POWER); }
  float angularSpeed(float r) { return SPIN * pow(DISC_INNER / max(r, DISC_INNER), 1.5); }
  float marchStep(float r) { return clamp(STEP_K * halfThickness(r), STEP_MIN, STEP_MAX); }
  // Seen from the gap (uSparse) the inner clumps may puff up to
  // CLUMP_HEIGHT half-thicknesses: the slab the march visits grows there.
  float clumpReach(float r) { return uSparse * (1.0 - smoothstep(DISC_INNER * SPARSE_OUT, DISC_INNER * SPARSE_OUT * 1.3, r)); }
  float slabZ(float r) { return SLAB_K * max(1.0, mix(1.0, CLUMP_HEIGHT, clumpReach(r))); }


  // Rs covered by one pixel at the point gas() is sampled (the march sets it;
  // 0 = full detail).
  float gFootprint = 0.0;
  // The gas's time (the march moves it back inside the shutter; the light
  // pass uses uTime).
  float gTime = 0.0;

  // The gas at p: x = extinction (per Rs), y = hot-core light, z = dust 0–1.
  vec3 gas(vec3 p) {
    float r = length(p.xz);
    float h = halfThickness(r);
    float zn = p.y / h;
    float win = radialWindow(r);
    if (win <= 0.0 || abs(zn) > slabZ(r)) return vec3(0.0);
    // Polar coordinates that turn with the gas (inner gas laps the outer, so
    // the clouds shear into streaks along the orbit).
    float ang = atan(p.z, p.x) - angularSpeed(r) * gTime;
    vec3 q = vec3(log(r) * RAD_FREQ, ang * (ANG_TILES / (2.0 * PI)), zn * VERT_FREQ);
    // Warp by the low-frequency channel (around the turn only by whole tiles: no seam).
    vec2 wq = texture(uNoise, q * vec3(0.5, 1.0, 0.5) + vec3(0.13, 0.0, 0.29)).rg - 0.5;
    q += vec3(wq.x, wq.y, 0.5 * wq.x) * WARP;
    vec2 n = texture(uNoise, q).rg;
    float fine = texture(uNoise, q * vec3(3.1, 3.0, 2.7) + vec3(0.37, 0.0, 0.61)).r;
    // Flame tongues: ridged noise stretched far along the orbit (FLAME_ANG
    // whole tiles around the turn: no seam), for the tongues and black gaps
    // of shots 7–9.
    float fl = texture(uNoise, q * vec3(FLAME_RAD, FLAME_ANG, 2.0) + vec3(0.71, 0.0, 0.17)).r;
    float ridge = 1.0 - abs(2.0 * fl - 1.0);
    float cloud = mix(0.6 * n.r + 0.4 * fine, 0.45 * n.r + 0.55 * ridge * ridge, FLAME);
    // Close-up detail (the film added procedural detail for its close shots):
    // a finer octave, faded out where one pixel covers more than its cells
    // (gFootprint: Rs per pixel at p, set by the caller). Off by default: at
    // the half-resolution march it does not show and costs ~25% (a 128³
    // noise texture cost ~50%: 3D-texture cache misses on integrated GPUs).
    float cell = 0.008 * r;
    float detailFade = 1.0 - smoothstep(0.5, 2.0, gFootprint / cell);
    if (DETAIL > 0.0 && detailFade > 0.0) {
      float detail = texture(uNoise, q * vec3(7.3, 6.0, 5.1) + vec3(0.13, 0.0, 0.47)).r - 0.5;
      cloud += DETAIL * detailFade * detail;
    }
    // Cloud tops: the gas thins with height, with a noisy, smoky surface.
    float body = exp(-0.6 * zn * zn);
    // Near the inner edge the gas thins into sparse clumps.
    float sparse = uSparse * (1.0 - smoothstep(DISC_INNER, DISC_INNER * SPARSE_OUT, r));
    float dens = win * body * smoothstep(0.32, 0.62, cloud + 0.35 * (body - 0.6));
    // There it breaks into compact clumps with clear space between (the
    // film's shots 1–4: a few hot clumps, a thin line, deep black): a high
    // threshold on the cloud field, low over the midplane.
    // Compact: their own noise, much finer along the orbit than the clouds
    // (whole tiles around the turn: no seam).
    float clump = 0.0;
    if (uSparse > 0.0) {
      float cn = texture(uNoise, vec3(log(r) * CLUMP_RAD, ang * (CLUMP_TILES / (2.0 * PI)), zn * 0.6) + vec3(0.41, 0.0, 0.83)).r;
      // Their own height: CLUMP_HEIGHT half-thicknesses (taller clumps throw
      // their bent images far above and below the edge-on line: the film's
      // streaks in the corners of shots 1–3).
      float zc = zn / max(CLUMP_HEIGHT, 0.1);
      clump = smoothstep(CLUMP_LO, CLUMP_LO + 0.1, cn) * exp(-1.5 * zc * zc) * (1.0 - smoothstep(DISC_INNER * SPARSE_OUT, DISC_INNER * SPARSE_OUT * 1.3, r));
      dens = mix(dens, win * clump, sparse);
    }
    // Thin wisps above the cloud tops, along the ridges.
    float wisp = WISP * win * smoothstep(0.9, 1.5, abs(zn)) * (1.0 - smoothstep(2.2, 3.0, abs(zn))) * smoothstep(0.6, 0.9, ridge);
    dens = max(dens, wisp * (1.0 - uSparse));
    // Large dark dust clumps (the black patches).
    float dust = smoothstep(0.5, 0.66, n.g + 0.25 * (fine - 0.5));
    // Seen from the clear gap (camera key sparse) the rest of the disc is a
    // dark silhouette: only the clumps glow (shots 1–4).
    // Dark gaps between the flame tongues (the film's streaky orange flames
    // with black between): the low parts of the ridged flame noise.
    dust = max(dust, FLAME_DARK * (1.0 - smoothstep(0.25, 0.65, ridge)));
    dust = mix(dust, 1.0, uSparse * (1.0 - clump));
    // The gas's own light falls off faster than the light on the smoke: the
    // outer disc reads as dark smoke, the inner disc glows (shots 4–5 vs 7–9).
    float hot = exp(-EMIT_DEPTH * zn * zn) * pow(DISC_INNER / max(r, INNER), EMIT_POWER);
    // (From the gap, only the clumps glow; the rest is the dark silhouette.)
    hot *= 1.0 - uSparse * (1.0 - clump);
    // The upper layers are smoke: more extinction with height, so the glowing
    // core shows through gaps and the surface reads dark (reference shots 4–5).
    float smoke = 1.0 + SMOKE_K * smoothstep(0.4, 1.8, abs(zn));
    // (The thin midplane sheet is added where a ray crosses the plane:
    // sheetCrossing, in the march.)
    return vec3(dens * smoke * TAU / (2.0 * h), hot, dust);
  }

`;

/**
 * The disc ray march, at a reduced resolution, along bent light paths: rgb
 * = light reaching the camera (gas, then the stars where the ray leaves), a
 * = the depth (Rs along the path) where the gas turns half opaque. Each
 * result is mixed with the last one (accumulation). The
 * arches over the shadow, the photon ring and the Einstein ring come from
 * the bending itself.
 */
export const marchShader = /* glsl */ `
  uniform vec3 uCamPos;
  uniform mat3 uCamBasis; // camera to world: right, up, back
  uniform vec2 uTanHalfFov;
  // The camera at the start of the shutter (SHUTTER_S earlier).
  uniform vec3 uCamPos1;
  uniform mat3 uCamBasis1;
  uniform vec2 uTanHalfFov1;
  uniform int uSteps;
  // Radians per march pixel (for the detail fade).
  uniform float uPixelAngle;
  // The camera key's haze share (per shot).
  uniform float uHaze;
  // The camera's velocity (share of c) relative to an observer at rest there
  // (the fall: introTimeline.js fallBoost).
  uniform vec3 uBoost;
  // A frame counter; the march's full size (px) and this frame's parity:
  // each frame traces every other pixel of each row (resolveShader).
  uniform float uFrame;
  uniform vec2 uFullSize;
  uniform float uParity;
  // 1: interleaved (live); 0: every pixel (offline, IntroCinematic.renderStill).
  uniform float uInterleave;
  // Offline: this sample's index and the sample count; the shutter is split
  // into that many strata (count 0: one random moment per pixel, live).
  uniform vec2 uShutterSample;
  // Light reaching the smoke from the hot inner disc (the light pass).
  uniform sampler2D uLight;
  // The shadow on screen (uv of its centre, radius as a share of the frame
  // height) at the frame's moment and at the shutter's start: the film
  // layers' arch is drawn round it.
  uniform vec2 uShadowUV;
  uniform vec2 uShadowUV1;
  uniform float uShadowR;
  uniform float uShadowR1;
  varying vec2 vUv;
${GAS_GLSL}
  #define MAX_STEPS ${MAX_STEPS}
  const float CAPTURE_R = ${f(CAPTURE_R)};
  const float KERR_M = ${f(KERR_M)};
  const float KERR_A = ${f(KERR_A)};
  const float A2 = KERR_A * KERR_A;
  const float ESCAPE_R = ${f(ESCAPE_R)};
  const float CURVE_K = ${f(CURVE_K)};
  const float CURVE_MIN = ${f(CURVE_MIN)};
  const float CURVE_MAX = ${f(CURVE_MAX)};
  const float FAR_DEPTH = 1000.0;

  float curveStep(float r) { return clamp(CURVE_K * r, CURVE_MIN, CURVE_MAX); }
  // Kerr light path in Mino time (gargantuaModel.js bendRay): the ray's
  // constants L and K = (L − a)² + Q, E = 1. R(r), Θ(θ) are the radial and
  // polar potentials (speed² in Mino time), kerrAccR/Th half their slopes.
  float gL = 0.0;
  float gQ = 0.0;
  float gK = 0.0;
  float kerrDelta(float r) { return r * r - 2.0 * KERR_M * r + A2; }
  float kerrR(float r) { float w = r * r + A2 - KERR_A * gL; return w * w - kerrDelta(r) * gK; }
  float kerrAccR(float r) { return 2.0 * r * (r * r + A2 - KERR_A * gL) - (r - KERR_M) * gK; }
  float kerrAccTh(float s, float c) {
    float ss = s >= 0.0 ? max(s, 1e-3) : min(s, -1e-3);
    return -A2 * c * s + gL * gL * c / (ss * ss * ss);
  }
  float kerrPhi(float r, float s) {
    return KERR_A * (r * r + A2 - KERR_A * gL) / kerrDelta(r) - KERR_A + gL / max(s * s, 1e-8);
  }

  float hash12(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  // Film layers (per shot, art-directed, as the film made its close shots
  // with extra layers): the arch, bright gas round the shadow on screen in
  // rings centred on it (the bent image of the far disc: the flame wall,
  // the skim's waterfall, the thick ring seen from farther away); and the
  // deck, a cloud surface at the disc's height met by the straight ray
  // near the camera. Both off when their gain is 0.

  // The arch at screen point uv: rgb light, a = cover (0-1).
  vec4 archLayer(vec2 uv, float sh) {
    vec2 S = mix(uShadowUV, uShadowUV1, sh);
    float R = max(mix(uShadowR, uShadowR1, sh), 1e-3);
    vec2 d = (uv - S) * vec2(uFullSize.x / uFullSize.y, 1.0);
    float rho = length(d) / R;
    float phi = degrees(atan(d.y, d.x));
    // Angular window: from ARCH_A0 over ARCH_SPAN degrees (counterclockwise,
    // 0 = right, 90 = up), soft by ARCH_SOFT degrees.
    float a = mod(phi - ARCH_A0 + 720.0, 360.0);
    float win = ARCH_SPAN >= 359.0 ? 1.0 : smoothstep(0.0, ARCH_SOFT, a) * (1.0 - smoothstep(ARCH_SPAN - ARCH_SOFT, ARCH_SPAN, a));
    float r0 = 1.0 + ARCH_GAP;
    float inside = smoothstep(r0 - 0.02, r0 + 0.02, rho);
    // Flames: ridged noise stretched along the rings (the orbit), streaming
    // round with time; a ragged outer edge.
    float lr = log(max(rho, 1e-3));
    // (ARCH_TWIST turns the streaks from rings into a spiral, log r =
    // -ARCH_TWIST · angle, as the film's tongues sweep outward; it leaves a
    // seam at phi = ±180°, so keep that side out of the window.)
    vec3 q = vec3((lr + ARCH_TWIST * radians(phi)) * ARCH_FREQ, (phi / 360.0 + ARCH_PHASE) * ARCH_FREQ / max(ARCH_STREAK, 0.02) + ARCH_FLOW * gTime, 0.37);
    // Warped by a coarse noise, two octaves: tongues, not even stripes.
    vec2 w = texture(uNoise, q * vec3(0.4, 0.4, 1.0) + vec3(0.21, 0.0, 0.53)).rg - 0.5;
    q.xy += w * ARCH_WARP;
    float n = 0.65 * texture(uNoise, q).r + 0.35 * texture(uNoise, q * vec3(2.3, 2.1, 1.0) + vec3(0.5, 0.0, 0.31)).r;
    // (The baked noise spans only about 0.33-0.66: stretched to 0-1 first.)
    n = clamp(0.5 + (n - 0.5) * 3.0, 0.0, 1.0);
    float edgeN = texture(uNoise, vec3(phi / 360.0 * 3.0 + 0.11, 0.53, 0.29)).r;
    // The reach leans toward ARCH_LEAN_A (the flame wall is wider on one side).
    float rOut = ARCH_OUT * (1.0 + ARCH_EDGE * (edgeN - 0.5)) * max(1.0 + ARCH_LEAN * cos(radians(phi - ARCH_LEAN_A)), 0.05);
    float reach = 1.0 - smoothstep(rOut * 0.8, rOut, rho);
    // Broad tongues where the noise is high, narrow dark gaps between.
    // (The flames start ARCH_FLAME_IN shadow radii out from the hot band.)
    float flame = mix(1.0, smoothstep(ARCH_LO, ARCH_LO + 0.3, n), ARCH_DARK) * reach * smoothstep(r0 + 0.5 * ARCH_FLAME_IN, r0 + ARCH_FLAME_IN, rho);
    // Bright lobes round the ring (ARCH_LOBE_N of them from ARCH_LOBE_A: the
    // gap's few big clumps at the lensing cusps).
    flame *= mix(1.0, pow(0.5 + 0.5 * cos(ARCH_LOBE_N * radians(phi - ARCH_LOBE_A)), 4.0), ARCH_LOBES);
    // The hot band at the shadow's edge, then the flames' own light falling outward.
    float hot = ARCH_HOT * exp(-max(rho - r0, 0.0) / max(ARCH_HOT_W, 0.01));
    float glowF = flame * pow(r0 / max(rho, r0), ARCH_POWER);
    // The flames take their own tint (the film's orange tongues beside the
    // cream hot band).
    vec3 lightA = win * inside * (vec3(hot) + glowF * ARCH_TINT);
    float cover = win * inside * clamp(ARCH_OPAC * max(reach, hot), 0.0, 1.0);
    return vec4(GAS_WARM * EMIT * ARCH_GAIN * lightA, cover * step(1e-6, ARCH_GAIN));
  }

  // The deck on the straight ray from p0 along v0: rgb light, a = cover,
  // and the distance to it (for the depth of field).
  vec4 deckLayer(vec3 p0, vec3 v0, out float dist) {
    dist = 0.0;
    if (v0.y >= -1e-4 || p0.y <= DECK_Y) return vec4(0.0);
    float t = (DECK_Y - p0.y) / v0.y;
    vec3 x = p0 + v0 * t;
    // (Everywhere below the camera: an art-directed cloud deck, also under
    // the hole.)
    float r = max(length(x.xz), 0.5);
    dist = t;
    // Clouds that turn with the gas (the disc's own shear).
    float ang = atan(x.z, x.x) - DECK_SPIN * angularSpeed(r) * gTime;
    vec3 q = vec3(log(r) * DECK_FREQ, ang * (DECK_TILES / (2.0 * PI)), 0.21);
    // Warped (billows, not rings round the hole).
    vec2 w = texture(uNoise, q * vec3(0.5, 0.5, 1.0) + vec3(0.33, 0.0, 0.71)).rg - 0.5;
    q.xy += w * DECK_WARP;
    float n = texture(uNoise, q).r;
    float fine = texture(uNoise, q * vec3(3.1, 3.0, 1.0) + vec3(0.41, 0.0, 0.13)).r;
    float c = clamp(0.5 + (0.7 * n + 0.3 * fine - 0.5) * 3.0, 0.0, 1.0);
    // Relief: lit on the side toward the hole, dark on the far side.
    float toward = texture(uNoise, q - vec3(0.06 * DECK_FREQ, 0.0, 0.0)).r;
    float relief = clamp(0.5 + 3.0 * DECK_RELIEF * (n - toward), 0.0, 1.0);
    float dens = smoothstep(DECK_COVER, DECK_COVER + 0.18, c);
    // Lit from the hot inner disc; near the camera the clouds are dark
    // silhouettes against the light beyond.
    float lit = DECK_LIGHT * pow(DISC_INNER / max(r, INNER), DECK_POWER) * (0.25 + relief);
    float nearW = 1.0 - smoothstep(0.0, DECK_NEAR, t);
    float near = 1.0 - DECK_DARK * nearW;
    // Far off, toward the horizon, the deck glows: the bright band under
    // the flame wall.
    float far = DECK_GLOW * smoothstep(DECK_FAR * 0.15, DECK_FAR * 0.7, t);
    vec3 col = (GAS_WARM * (lit + far) * EMIT + DECK_COOL) * near;
    // Near the camera, the gaps between the dark clouds show the glowing
    // deck beyond (the film's silhouettes against the light).
    col = mix(col, GAS_WARM * DECK_GLOW * EMIT, DECK_SIL * nearW * (1.0 - dens));
    float cover = DECK_GAIN > 0.0 ? clamp(DECK_GAIN, 0.0, 1.0) * mix(0.55, 1.0, dens) * (1.0 - smoothstep(DECK_FAR * 0.6, DECK_FAR, t)) : 0.0;
    return vec4(col * cover, cover);
  }

  // The light texture over the disc: u = angle (turns), v = log radius from
  // the inner to the outer edge.
  float lightAt(vec3 p, float rc) {
    float u = fract(atan(p.z, p.x) / (2.0 * PI));
    float v = log(max(rc, INNER) / INNER) / log(DISC_OUTER / INNER);
    return texture(uLight, vec2(u, v)).r;
  }

  // Sparse, faint stars (the film's sky is nearly empty near Gargantua).
  vec3 stars(vec3 d) {
    vec3 a = abs(d);
    vec2 uv;
    float face;
    if (a.x >= a.y && a.x >= a.z) { uv = d.yz / a.x; face = d.x > 0.0 ? 0.0 : 1.0; }
    else if (a.y >= a.z) { uv = d.xz / a.y; face = d.y > 0.0 ? 2.0 : 3.0; }
    else { uv = d.xy / a.z; face = d.z > 0.0 ? 4.0 : 5.0; }
    vec2 g = (uv * 0.5 + 0.5) * 140.0;
    vec2 cell = floor(g);
    vec2 key = cell + face * 157.0;
    if (hash12(key) > 0.08) return vec3(0.0);
    vec2 centre = cell + 0.2 + 0.6 * vec2(hash12(key + 17.0), hash12(key + 53.0));
    float k = max(1.0 - length(g - centre) / 0.12, 0.0);
    return vec3(0.9, 0.92, 1.0) * k * k * (0.2 + 0.8 * pow(hash12(key + 91.0), 6.0));
  }

  void main() {
    // Interleaved: this frame traces the pixels of parity uParity (a
    // checkerboard), packed two to a texel column in a half-width target;
    // the resolve pass puts them in place. (Skipping pixels inside one pass
    // saves nothing: GPU lanes run the loop together.)
    vec2 cell = floor(gl_FragCoord.xy);
    vec2 fc = uInterleave > 0.5 ? vec2(2.0 * cell.x + mod(cell.y + uParity, 2.0), cell.y) + 0.5 : gl_FragCoord.xy;
    vec2 uv = fc / uFullSize;
    // Shutter motion blur: each pixel takes its own moment inside the
    // shutter every frame (the accumulation averages them), with the camera
    // and the disc's time at that moment. Its length is SHUTTER_S, not the
    // frame rate.
    float sh = hash12(fc * 1.37 + vec2(uFrame * 3.71, uFrame * 9.13));
    if (uShutterSample.y > 0.0) sh = (uShutterSample.x + sh) / uShutterSample.y;
    mat3 basis = mat3(
      normalize(mix(uCamBasis[0], uCamBasis1[0], sh)),
      normalize(mix(uCamBasis[1], uCamBasis1[1], sh)),
      normalize(mix(uCamBasis[2], uCamBasis1[2], sh)));
    vec3 v = normalize(basis * vec3((uv * 2.0 - 1.0) * mix(uTanHalfFov, uTanHalfFov1, sh), -1.0));
    vec3 p = mix(uCamPos, uCamPos1, sh);
    gTime = uTime - sh * SHUTTER_S;
    // Aberration (gargantuaModel.js aberrate): the moving camera's view
    // crowds toward its motion; the ray starts from the observer at rest.
    float b2 = dot(uBoost, uBoost);
    if (b2 > 1e-8) {
      float gam = inversesqrt(1.0 - b2);
      float bk = dot(uBoost, -v);
      v = normalize((-v / gam + uBoost + (gam / (gam + 1.0)) * bk * uBoost) / (1.0 + bk)) * -1.0;
    }
    // The straight ray (for the deck layer, in flat space near the camera).
    vec3 p0 = p;
    vec3 v0 = v;
    // Boyer–Lindquist r, θ and the azimuth as a unit vector e (x, z); the
    // constants from the camera's view (without spin: a static observer's,
    // b = r sin α / √(1 − 1/r)).
    float r = length(p);
    float th = acos(clamp(p.y / r, -1.0, 1.0));
    vec2 e = length(p.xz) > 1e-6 ? normalize(p.xz) : vec2(1.0, 0.0);
    float sT = sin(th);
    float cT = cos(th);
    vec3 rHat = vec3(sT * e.x, cT, sT * e.y);
    vec3 tHat = vec3(cT * e.x, -sT, cT * e.y);
    vec3 pHat = vec3(-e.y, 0.0, e.x);
    // The camera is a zero-angular-momentum observer, v its direction in its
    // own frame (James et al. 2015, appendix A): a real light ray, R(r0) =
    // rd² (flat-space constants gave R < 0 for rays square to the hole: a seam).
    float del = kerrDelta(r);
    float sig = r * r + A2 * cT * cT;
    float big = (r * r + A2) * (r * r + A2) - A2 * del * sT * sT;
    float varpi = sqrt(big / sig) * sT;
    float eF = 1.0 / (sqrt(sig * del / big) + 2.0 * KERR_M * KERR_A * r / big * varpi * dot(v, pHat));
    gL = eF * varpi * dot(v, pHat);
    float thd = eF * sqrt(sig) * dot(v, tHat);
    gQ = thd * thd + cT * cT * (gL * gL / max(sT * sT, 1e-8) - A2);
    gK = (gL - KERR_A) * (gL - KERR_A) + gQ;
    float rd = eF * sqrt(sig * del) * dot(v, rHat);
    float accR = kerrAccR(r);
    float accTh = kerrAccTh(sT, cT);
    float phd = kerrPhi(r, sT);
    vec3 light = vec3(0.0);
    float T = 1.0;
    bool captured = false;
    // A new offset of the first step every frame; the accumulation averages it.
    float jitter = hash12(fc + vec2(uFrame * 13.17, uFrame * 7.73));
    // Depth for the depth of field: the path length where the gas becomes
    // half opaque (far when it never does).
    float dist = 0.0;
    float depth = -1.0;
    for (int i = 0; i < MAX_STEPS; i++) {
      if (i >= uSteps || T < 0.01) break;
      // The direction (coordinate space) and speed in Mino time.
      vec3 vel = rd * rHat + r * thd * tHat + r * sT * phd * pHat;
      float speed = length(vel);
      v = vel / speed;
      if (r < CAPTURE_R && rd < 0.0) { captured = true; break; }
      if (r > ESCAPE_R && rd > 0.0) break;
      // Step: fine near the hole (the path bends), finer in the gas, and
      // a jump down toward the gas slab from above it.
      float rc = length(p.xz);
      float dt = curveStep(r);
      // Near the spin axis the azimuth swings fast: no step longer than the
      // distance to the axis (rays over the pole drew a seam).
      dt = min(dt, max(0.2 * r * abs(sT), 0.002));
      float above = abs(p.y) - slabZ(rc) * halfThickness(rc);
      // The clear gap inside the inner edge has no gas: no slab steps there
      // (rays along the plane spent every step in it), only no jump past
      // the inner edge.
      bool inSlab = above <= 0.0 && rc < DISC_OUTER && rc > INNER * 0.98;
      if (inSlab) dt = min(dt, marchStep(rc));
      else if (above <= 0.0 && rc <= INNER * 0.98) dt = min(dt, max(INNER - rc, marchStep(rc)));
      else if (rc < DISC_OUTER && p.y * v.y < 0.0 && abs(v.y) > 1e-4) dt = min(dt, max(marchStep(rc), 0.8 * above / abs(v.y)));
      if (i == 0) dt *= jitter;
      // Haze: a thin glowing medium around the hole, lit by the disc, that
      // every ray collects on its way (also the rays that end in the
      // shadow): it lifts the dome from black to the film's blue-grey
      // (shots 4–5), lighter near the arches.
      // None inside the inner edge: the gap is clear, so the shadow keeps
      // its dark core. uHaze: the camera key's share (per shot).
      float rr = max(r, DISC_INNER);
      float hazeIn = smoothstep(DISC_INNER * 0.8, DISC_INNER * 1.2, r);
      light += T * HAZE * uHaze * hazeIn * HAZE_COL * exp(-abs(p.y) / HAZE_HEIGHT) * (DISC_INNER * DISC_INNER) / (rr * rr) * dt;
      if (inSlab) {
        gFootprint = max(dist, 1e-3) * uPixelAngle;
        vec3 g = gas(p);
        if (g.x > 0.0) {
          float sigma = g.x * (1.0 + 2.0 * g.z);
          float w = T * (1.0 - exp(-sigma * dt));
          vec3 hotCol = mix(GAS_WARM, GAS_HOT, smoothstep(0.25, 0.9, g.y));
          vec3 emit = hotCol * g.y * EMIT * (1.0 - 0.9 * g.z);
          // Lit by the inner disc through the gas between (self-shadowing).
          vec3 lit = (GAS_WARM * glowAt(rc) * LIGHT_GAIN * lightAt(p, rc) + SMOKE_COOL) * ALBEDO * (1.0 - mix(0.8, 1.0, uSparse) * g.z);
          light += w * (emit + lit);
          T *= exp(-sigma * dt);
          if (depth < 0.0 && T < 0.5) depth = dist;
        }
      }
      dist += dt;
      // Velocity Verlet in Mino time over dt of coordinate path. The radial
      // speed is put back on its potential (the step follows the speed, so a
      // drift would feed itself). Past a turning point (R < 0 by a step's
      // overshoot) Verlet carries on: set to 0 there, the ray stalled.
      // Not the polar one: near the plane and the poles Θ cancels in float
      // and lost the small swings (gaps in the plane line, a seam).
      vec3 pPrev = p;
      float dtau = dt / speed;
      r += rd * dtau + 0.5 * accR * dtau * dtau;
      th += thd * dtau + 0.5 * accTh * dtau * dtau;
      sT = sin(th);
      cT = cos(th);
      float accR1 = kerrAccR(r);
      float accTh1 = kerrAccTh(sT, cT);
      float phd1 = kerrPhi(r, sT);
      rd += 0.5 * (accR + accR1) * dtau;
      float Rr = kerrR(r);
      if (Rr > 0.0) rd = sign(rd) * sqrt(Rr);
      thd += 0.5 * (accTh + accTh1) * dtau;
      float dphi = 0.5 * (phd + phd1) * dtau;
      e = normalize(e * cos(dphi) + vec2(-e.y, e.x) * sin(dphi));
      accR = accR1;
      accTh = accTh1;
      phd = phd1;
      rHat = vec3(sT * e.x, cT, sT * e.y);
      tHat = vec3(cT * e.x, -sT, cT * e.y);
      pHat = vec3(-e.y, 0.0, e.x);
      p = r * rHat;
      // The thin bright midplane sheet, exactly where the path crosses the
      // plane (thinner than a step: sampled as volume it broke the lensed
      // rings and the edge-on line into beads). Edge-on it is the thin
      // bright line across shots 1–3; its light falls off slowly
      // (r^-SHEET_POWER), so the line stays bright across the frame.
      if (pPrev.y * p.y < 0.0) {
        vec3 x = mix(pPrev, p, pPrev.y / (pPrev.y - p.y));
        float rx = length(x.xz);
        float win = radialWindow(rx);
        if (win > 0.0) {
          float cosA = max(abs(v.y) / length(v), 1e-3);
          float alpha = win * (1.0 - exp(-SHEET_TAU / cosA));
          float hotSheet = SHEET_GLOW * pow(DISC_INNER / max(rx, INNER), SHEET_POWER);
          // Seen from the clear gap only a band of it glows, just outside the
          // inner edge, broken into a few clumps along the orbit (RIM_CLUMPS
          // whole noise tiles per turn: no seam), each of thin parallel
          // filaments (RIM_STRIPES across the band): the film's streaked
          // clumps, lensed into the corners, with the thin ring lit only
          // where a clump's light goes round.
          float band = smoothstep(SHEET_RIM - SHEET_RIM_W, SHEET_RIM, rx) * (1.0 - smoothstep(SHEET_RIM + RIM_BAND - SHEET_RIM_W, SHEET_RIM + RIM_BAND, rx));
          float stripes = pow(0.5 + 0.5 * cos(2.0 * PI * RIM_STRIPES * (rx - SHEET_RIM) / max(RIM_BAND, 1e-3)), 3.0);
          float rimAng = atan(x.z, x.x) - angularSpeed(rx) * gTime;
          // (Stretched to 0-1 like the layers' noise: the baked noise spans
          // about 0.33-0.66, so the threshold never broke the rim apart.)
          float rimNoise = clamp(0.5 + (texture(uNoise, vec3(rimAng * (RIM_CLUMPS / (2.0 * PI)), 0.37, 0.71)).r - 0.5) * 3.0, 0.0, 1.0);
          float rim = band * (0.3 + 0.7 * stripes) * smoothstep(RIM_CLUMP_LO, RIM_CLUMP_LO + 0.12, rimNoise);
          // (RIM_FLOOR: a faint glow over the whole sheet, the film's dim
          // edge-on line and thin ring between the clumps.)
          hotSheet *= mix(1.0, max(rim, RIM_FLOOR), uSparse);
          light += T * alpha * mix(GAS_WARM, GAS_HOT, smoothstep(0.25, 0.9, hotSheet)) * hotSheet * EMIT;
          T *= 1.0 - alpha;
          if (depth < 0.0 && T < 0.5) depth = dist;
        }
      }
    }
    // Rays that leave see the stars where they point; captured rays are the shadow.
    if (!captured) light += T * stars(normalize(v));
    // The shadow is at the hole (in focus with it), the empty sky far.
    if (depth < 0.0) depth = captured ? length(p0) : FAR_DEPTH;
    // Film layers over the bent-light picture: the arch behind the deck.
    if (ARCH_GAIN > 0.0) {
      vec4 arch = archLayer(uv, sh);
      light = arch.rgb + (1.0 - arch.a) * light;
      // The arch is the bent image of gas near the hole: in focus there.
      if (arch.a > 0.5) depth = length(p0);
    }
    if (DECK_GAIN > 0.0) {
      float deckDist;
      vec4 deck = deckLayer(p0, v0, deckDist);
      light = deck.rgb + (1.0 - deck.a) * light;
      if (deck.a > 0.5) depth = deckDist;
    }
    vec4 cur = vec4(light, depth);
    gl_FragColor = cur;
  }
`;

/**
 * The resolve (full march resolution): this frame's traced pixels (packed,
 * half width) into place, each mixed with its last value (accumulation: a
 * film shutter's blur, and the per-frame jitter averages out); the other
 * half keep theirs. On a fresh start they borrow their traced neighbour.
 */
export const resolveShader = /* glsl */ `
  uniform sampler2D tTraced;
  uniform sampler2D tPrev;
  uniform float uHistory;
  uniform float uParity;
  uniform float uInterleave;
  void main() {
    ivec2 c = ivec2(gl_FragCoord.xy);
    bool split = uInterleave > 0.5;
    vec4 traced = texelFetch(tTraced, split ? ivec2(c.x / 2, c.y) : c, 0);
    bool mine = !split || (c.x - 2 * (c.x / 2)) == int(mod(float(c.y) + uParity, 2.0));
    if (uHistory <= 0.0) gl_FragColor = traced;
    else {
      vec4 prev = texelFetch(tPrev, c, 0);
      gl_FragColor = mine ? mix(traced, prev, uHistory) : prev;
    }
  }
`;

/** Light texture size (angle × log radius) and radial steps per texel. */
export const LIGHT_SIZE = [256, 96];
const LIGHT_STEPS = 32;

/**
 * The light pass (once per frame): for each angle and radius over the disc,
 * how much of the hot inner disc's light gets through the gas on the way
 * out. Near the midplane the disc is opaque, so the light that reaches the
 * smoke runs over the cloud tops (at LIGHT_HEIGHT half-thicknesses), and tall
 * clouds and dust clumps cast shadows behind them.
 */
export const lightShader = /* glsl */ `
  varying vec2 vUv;
${GAS_GLSL}
  void main() {
    // The light texture is coarse: no close-up detail here (it is costly).
    gFootprint = 1e3;
    gTime = uTime;
    float theta = vUv.x * 2.0 * PI;
    float lr0 = log(INNER);
    float lr1 = log(INNER) + vUv.y * log(DISC_OUTER / INNER);
    float tau = 0.0;
    float prev = INNER;
    for (int i = 1; i <= ${LIGHT_STEPS}; i++) {
      float r = exp(mix(lr0, lr1, float(i) / ${LIGHT_STEPS}.0));
      vec3 g = gas(vec3(cos(theta) * r, LIGHT_HEIGHT * halfThickness(r), sin(theta) * r));
      tau += g.x * (1.0 + 2.0 * g.z) * (r - prev);
      prev = r;
    }
    gl_FragColor = vec4(exp(-LIGHT_K * tau), 0.0, 0.0, 1.0);
  }
`;

/** The march mip the flare source reads (~1/32 of the march resolution). */
const FLARE_MIP = 5;

/**
 * The flare source (one texel, once per frame): the brightness-weighted
 * centre (uv) of the light above FLARE_THRESHOLD in a low mip of the march,
 * and its mean strength. The composite draws one ghost ring from it.
 */
export const flareSourceShader = /* glsl */ `
  uniform sampler2D tMarch;
${lookDeclarations({ FLARE_THRESHOLD: COMPOSITE_LOOK.FLARE_THRESHOLD })}
  void main() {
    ivec2 size = textureSize(tMarch, ${FLARE_MIP});
    vec2 sum = vec2(0.0);
    float weight = 0.0;
    for (int y = 0; y < 64; y++) {
      if (y >= size.y) break;
      for (int x = 0; x < 64; x++) {
        if (x >= size.x) break;
        vec3 c = texelFetch(tMarch, ivec2(x, y), ${FLARE_MIP}).rgb;
        float b = max(dot(c, vec3(0.2126, 0.7152, 0.0722)) - FLARE_THRESHOLD, 0.0);
        sum += b * (vec2(x, y) + 0.5) / vec2(size);
        weight += b;
      }
    }
    vec2 centre = weight > 0.0 ? sum / weight : vec2(0.5);
    gl_FragColor = vec4(centre, weight / float(size.x * size.y), 1.0);
  }
`;

/**
 * Full resolution: the march with depth of field, a veiling glow and bloom
 * (mip levels of the march), lens ghosts and a halo ring, then exposure,
 * ACES, a teal/orange film grade and grain.
 */
export const compositeShader = /* glsl */ `
  uniform sampler2D tMarch;
  uniform vec2 uResolution;
  uniform float uExposure;
  // The camera key's saturation (× SATURATION: the film graded each scene).
  uniform float uSat;
  // The camera key's lens-ghost share (the film shows it in shots 7–9 only).
  uniform float uGhost;
  uniform float uFocus; // Rs: the depth in focus
  uniform float uTime;
  // The flare source (flareSourceShader): weighted centre (uv) and strength.
  uniform sampler2D tFlareSource;
  varying vec2 vUv;

  const float PI = 3.14159265;
${lookDeclarations(COMPOSITE_LOOK)}

  float hash12(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  // The colour fit's tone curve (introLook.js CURVE_n at CURVE_KNOTS), per channel.
  float curveChannel(float x, int c) {
${CURVE_KNOTS.slice(1)
  .map((k, i) => `    if (x <= ${k.toFixed(4)}) return mix(CURVE_${i}[c], CURVE_${i + 1}[c], (x - ${CURVE_KNOTS[i].toFixed(4)}) / ${(k - CURVE_KNOTS[i]).toFixed(4)});`)
  .join(String.fromCharCode(10))}
    return CURVE_${CURVE_KNOTS.length - 1}[c];
  }
  vec3 toneCurve(vec3 x) {
    return vec3(curveChannel(x.r, 0), curveChannel(x.g, 1), curveChannel(x.b, 2));
  }

  // Value noise on a GRAIN_SIZE px lattice (bilinear between hashed corners),
  // a new pattern each frame: the grain clumps, not one-pixel static.
  float grainNoise(vec2 px, float seed) {
    vec2 q = px / GRAIN_SIZE + seed;
    vec2 i = floor(q);
    vec2 f = q - i;
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
               mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y) - 0.5;
  }

  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }

  // A mip level read with a cubic B-spline (four bilinear taps): plain
  // bilinear reads of the coarse levels show as tiles after the tone curve.
  vec3 smoothMip(vec2 uv, float lod) {
    vec2 size = vec2(textureSize(tMarch, int(lod)));
    vec2 p = uv * size - 0.5;
    vec2 i = floor(p);
    vec2 f = p - i;
    vec2 f2 = f * f;
    vec2 f3 = f2 * f;
    vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
    vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
    vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
    vec2 w3 = f3 / 6.0;
    vec2 g0 = w0 + w1;
    vec2 g1 = w2 + w3;
    vec2 h0 = (i - 0.5 + w1 / g0) / size;
    vec2 h1 = (i + 1.5 + w3 / g1) / size;
    return g0.x * g0.y * textureLod(tMarch, h0, lod).rgb + g1.x * g0.y * textureLod(tMarch, vec2(h1.x, h0.y), lod).rgb
      + g0.x * g1.y * textureLod(tMarch, vec2(h0.x, h1.y), lod).rgb + g1.x * g1.y * textureLod(tMarch, h1, lod).rgb;
  }

  vec3 bright(vec2 uv, float lod) {
    return max(textureLod(tMarch, clamp(uv, 0.0, 1.0), lod).rgb - FLARE_THRESHOLD, 0.0);
  }

  void main() {
    vec4 c0 = textureLod(tMarch, vUv, 0.0);
    // Depth of field: a golden-angle gather by this pixel's blur radius.
    // Blur radii are px of a 720-line frame, scaled to this one.
    float pxScale = uResolution.y / 720.0;
    float coc = min(DOF_K * abs(1.0 - uFocus / max(c0.a, 1e-3)), DOF_MAX) * pxScale;
    vec3 col = c0.rgb;
    if (coc > 0.75) {
      vec2 px = coc / uResolution;
      vec3 sum = c0.rgb;
      float wsum = 1.0;
      for (int i = 0; i < 16; i++) {
        float fi = float(i) + 0.5;
        float rad = sqrt(fi / 16.0);
        float ang = fi * 2.39996;
        vec4 s = textureLod(tMarch, vUv + vec2(cos(ang), sin(ang)) * rad * px, 0.0);
        // A sharp, nearer neighbour does not smear over a blurred pixel.
        float sc = min(DOF_K * abs(1.0 - uFocus / max(s.a, 1e-3)), DOF_MAX) * pxScale;
        float w = smoothstep(rad * coc * 0.5, rad * coc, sc + 0.5);
        sum += s.rgb * w;
        wsum += w;
      }
      col = sum / wsum;
    }
    // Veiling glow (the film's IMAX lens glow, from a measured lens PSF): a
    // long-tailed point-spread r^-VEIL_BETA as a sum of the march's mips
    // (mip k blurs ~2^k px; weights 2^{k(2 - β)}). VEIL is the share of the
    // light it spreads, over everything (the shadow too: the dome turns from
    // black to haze); VEIL_TINT can cool it toward the film's blue-grey dome.
    vec3 veil = vec3(0.0);
    float veilSum = 0.0;
    for (int k = 1; k <= 8; k++) {
      float w = pow(2.0, float(k) * (2.0 - VEIL_BETA));
      veil += w * (k >= 3 ? smoothMip(vUv, float(k)) : textureLod(tMarch, vUv, float(k)).rgb);
      veilSum += w;
    }
    col = col * (1.0 - VEIL) + VEIL * VEIL_TINT * veil / veilSum;
    // Bloom: tight, around the brightest light.
    col += BLOOM * (0.5 * smoothMip(vUv, 3.0) + 0.35 * smoothMip(vUv, 4.0) + 0.15 * smoothMip(vUv, 5.0));
    // One ghost ring from the brightest light (the flare-source pass: its
    // weighted centre and strength), mirrored through the screen centre by
    // GHOST_POS, like the pink ring at the frame edge in shots 8–9. Each
    // channel has a slightly different radius: a pink rim, violet inside.
    vec4 src = texelFetch(tFlareSource, ivec2(0, 0), 0);
    if (src.z > 0.0) {
      vec2 g = vec2(0.5) + (vec2(0.5) - src.xy) * GHOST_POS;
      vec2 d = (vUv - g) * vec2(uResolution.x / uResolution.y, 1.0);
      float dist = length(d);
      vec3 radius = GHOST_R * vec3(1.0, 0.97, 0.94);
      vec3 ring = exp(-pow((vec3(dist) - radius) / GHOST_W, vec3(2.0)));
      vec3 inside = vec3(0.35, 0.2, 0.55) * (1.0 - smoothstep(GHOST_R * 0.5, GHOST_R, dist));
      // A lens ghost needs the light off the axis: none for light around the
      // centre (shot 3's symmetric lobes), full past ~0.3 of the frame out.
      float offAxis = smoothstep(0.12, 0.3, length((src.xy - 0.5) * vec2(uResolution.x / uResolution.y, 1.0)));
      col += GHOST_RING * uGhost * offAxis * min(src.z, 4.0) * (ring * vec3(1.0, 0.55, 0.85) + 0.25 * inside);
    }
    // Halation: film's red glow around bright edges (light scattered back
    // through the emulsion from the film base).
    col += HALATION * bright(vUv, 3.0) * vec3(1.0, 0.32, 0.12);

    col = aces(col * uExposure);
    // Film grade: teal in the darks, the highlights kept warm.
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = max(mix(vec3(luma), col, SATURATION * uSat), 0.0);
    col += SHADOW_TINT * pow(1.0 - luma, 4.0);
    col = mix(col, col * vec3(1.03, 1.0, 0.94), smoothstep(0.4, 1.0, luma));
    vec3 display = pow(max(col, 0.0), vec3(1.0 / 2.2));
    // The colour fit to the stills, then the manual grade (display space).
    display = toneCurve(clamp(display, 0.0, 1.0));
    // Film grain (fine, like a 65 mm negative): in display space, strongest in
    // the mid-tones (4d(1 - d)) and faint in the blacks and the clipped
    // highlights, so the shadow stays clean. Mostly one pattern for all three
    // dye layers, with a little colour of its own (GRAIN_CHROMA).
    float seed = fract(uTime * 7.31) * 311.0;
    float gl = grainNoise(gl_FragCoord.xy, seed);
    vec3 gc = vec3(grainNoise(gl_FragCoord.xy, seed + 17.3), grainNoise(gl_FragCoord.xy, seed + 41.9), grainNoise(gl_FragCoord.xy, seed + 73.1));
    vec3 tone = 0.08 + 0.92 * 4.0 * display * (1.0 - display);
    display += GRAIN * tone * mix(vec3(gl), gc, GRAIN_CHROMA);
    display = pow(clamp(display * CDL_SLOPE + CDL_OFFSET, 1e-4, 1.0), CDL_POWER);
    gl_FragColor = vec4(display, 1.0);
  }
`;
