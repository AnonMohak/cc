import { omega, eccentricity, armPhase, crest, barAngle } from './densityModel.js';
import { createRandom } from './random.js';
import { KIND } from './generateGalaxy.js';

/**
 * Collision physics (galaxy/consumption.js has the timeline): restricted
 * N-body, "N-body-lite" (Toomre & Toomre 1972). Each body is a softened
 * point mass (a Plummer sphere; a black hole with a small softening), and
 * the stars are test particles that feel both bodies but not each other.
 *
 * Two phases. The opening pass is free physics: both centres move under
 * their mutual gravity (leapfrog, zero total momentum) with a drag while
 * they overlap, as in a real encounter. After the first close pass the
 * consumption takes over: the winner comes to rest and the victim follows a
 * scripted spiral, so the stars then live in the winner's frame and get the
 * opposite of the winner's own acceleration (the indirect term).
 *
 * Each simulated star has a state: BOUND (still drawn on its analytic orbit
 * in the moving victim), FREE (gravity, plus a drag toward a black-hole
 * winner), ACCRETE (an analytic spiral in the hole's disc plane: stable at
 * any step) and GONE (past the capture radius).
 *
 * Pure: no three.js scene objects. World units throughout (1 = 9,000 ly);
 * time is simulation time (scaled, zero while paused). The star start
 * state and step are mirrored on the GPU in shaders/chunks/simInit.glsl and
 * shaders/collisionStep.glsl (scene/CollisionSim.js runs them).
 */

// Gravitational constant of the simulation, calibrated so a default galaxy
// (radius 6, speed 0.3) turns at about its analytic rate at half its radius.
export const G_SIM = 5.5;
// Plummer softening, as a share of the galaxy radius.
export const SOFTENING = 0.3;
// A default-size galaxy (radius 6) has mass 1. Mass ∝ R² (same surface
// density), so a galaxy twice the size is four times heavier.
const MASS_RADIUS = 6;
// Star simulation starts when the centres are this close, in units of
// rA + rB; farther out, tides are weak and the stars stay analytic.
export const CONTACT = 1.6;
// Far apart, the centres fast-forward (warp grows as (sep / contact)^1.5,
// the free-fall time scaling, from 1 at contact), so the approach takes
// seconds, not minutes.
const WARP_GAIN = 6;
const MAX_WARP = 30;
// Drag between overlapping centres (1/s), and its reach in mean radii.
const FRICTION = 0.8;
const FRICTION_REACH = 1;
// Gas fade per second for an equal-mass partner one radius away.
const DISRUPT_RATE = 0.35;
// Largest centre step (simulation seconds).
const CENTRE_STEP = 0.02;
// Largest star step on the GPU (simulation seconds), and the most substeps per frame.
export const STAR_STEP = 1 / 30;
export const MAX_STAR_SUBSTEPS = 8;
// A black hole's mass ∝ Rs: a default hole (Rs 0.12 = 0.03 × 4) weighs four
// default galaxies, so it dominates a galaxy it meets.
export const HOLE_MASS = 4;
const HOLE_RS_REF = 0.12;
// A black hole's softening, as a share of its disc radius (accretion takes
// over inside the disc anyway).
const HOLE_SOFTENING = 0.5;

/** The opening pass (Selected → Collision sliders). */
export const COLLISION_LIMITS = {
  pass: { min: 0, max: 2, step: 0.05 }, // closest approach, in mean radii
  speed: { min: 0.5, max: 2, step: 0.05 }, // × escape speed at contact
};
export const DEFAULT_COLLISION = { pass: 1.2, speed: 1 };

/** Star states (packed with the arm crest into the position texture's w). */
export const STATE = { BOUND: 0, FREE: 1, ACCRETE: 2, GONE: 3 };

/** w = state · 2 + crest (crest 0–1). */
export function packState(state, crestValue) {
  return state * 2 + crestValue;
}

/** @returns {{ state: number, crest: number }} */
export function unpackState(w) {
  const state = Math.floor(w / 2);
  return { state, crest: w - state * 2 };
}

/** @param {number} radius galaxy radius (world units) */
export function galaxyMass(radius) {
  return (radius / MASS_RADIUS) ** 2;
}

/**
 * Mass, softening² and size of a body (consumption.js Body + discOuter).
 * @param {{ hole: boolean, radius: number, rs?: number, discOuter?: number }} body
 * @returns {{ mass: number, eps2: number, radius: number }}
 */
export function bodyPhysics(body) {
  if (body.hole) {
    return { mass: (HOLE_MASS * body.rs) / HOLE_RS_REF, eps2: (HOLE_SOFTENING * body.discOuter) ** 2, radius: body.radius };
  }
  return { mass: galaxyMass(body.radius), eps2: (SOFTENING * body.radius) ** 2, radius: body.radius };
}

/** Circular speed at distance r from a Plummer sphere (gm = G·M, eps2 = ε²). */
export function circularSpeed(r, gm, eps2) {
  return Math.sqrt((gm * r * r) / (r * r + eps2) ** 1.5);
}

/**
 * Acceleration toward a Plummer sphere at c, added into out (allocation-free).
 * a = −G·M·(p − c) / (|p − c|² + ε²)^1.5
 */
export function addPlummerAccel(out, p, c, gm, eps2) {
  const dx = p[0] - c[0];
  const dy = p[1] - c[1];
  const dz = p[2] - c[2];
  const k = -gm / (dx * dx + dy * dy + dz * dz + eps2) ** 1.5;
  out[0] += k * dx;
  out[1] += k * dy;
  out[2] += k * dz;
  return out;
}

/**
 * The spin axis of a galaxy in world space. Stars at local angle θ move
 * from +x toward +z as θ grows, which is a turn about −y; a negative
 * speed turns the other way (zero counts as positive).
 * @param {number[]} normal world disc normal (local +y)
 * @param {number} speed motion.speed
 */
export function spinAxis(normal, speed) {
  const s = speed < 0 ? 1 : -1;
  return [normal[0] * s, normal[1] * s, normal[2] * s];
}

/**
 * The indirect term for a scripted winner: its own acceleration (it comes to
 * rest after the opening pass; 0 once at rest) minus the victim's pull on
 * it. Every star gets it, so the winner's stars move with it: a winner
 * that is held still does not have its disc slide toward the victim, and
 * one that slows down takes its stars along. Writes into out.
 * @param {number[]} [winnerAcc] the winner's scripted acceleration (star time)
 */
export function indirectAccel(out, winnerPos, victimPos, victimGm, eps2, winnerAcc = null) {
  out[0] = out[1] = out[2] = 0;
  addPlummerAccel(out, winnerPos, victimPos, victimGm, eps2);
  for (let k = 0; k < 3; k++) out[k] = (winnerAcc ? winnerAcc[k] : 0) - out[k];
  return out;
}

/**
 * Starting velocities for the two centres (zero total momentum, so the
 * barycentre stays put). The relative orbit has energy set by `speed`
 * (× escape speed at contact: < 1 bound, > 1 a fast fly-by) and its
 * pericentre at `pass` mean radii (point-mass estimate). The orbit is
 * prograde for body A (strong tidal tails), in the plane closest to A's disc.
 *
 * @param {{ posA: number[], posB: number[], a: { mass: number, radius: number }, b: { mass: number, radius: number }, spinA: number[], pass?: number, speed?: number }} input
 * @returns {{ velA: number[], velB: number[] }}
 */
export function designOrbit({ posA, posB, a, b, spinA, pass = DEFAULT_COLLISION.pass, speed = DEFAULT_COLLISION.speed }) {
  const gm = G_SIM * (a.mass + b.mass);
  const d = sub(posB, posA);
  const r = Math.max(length(d), 1e-6);
  const rHat = scale(d, 1 / r);
  const contact = CONTACT * (a.radius + b.radius);

  const energy = (speed * speed - 1) * (gm / contact);
  const v = Math.sqrt(Math.max(0, 2 * (energy + gm / r)));
  // Point-mass angular momentum for pericentre q (with the energy actually
  // reached: a bound orbit released from rest has its own).
  const e = v > 0 ? energy : -gm / r;
  const q = Math.min(pass * 0.5 * (a.radius + b.radius), 0.95 * r);
  const L = q * Math.sqrt(Math.max(0, 2 * (e + gm / Math.max(q, 1e-6))));
  const vt = Math.min(L / r, v);
  const vr = -Math.sqrt(Math.max(0, v * v - vt * vt));

  // Tangential direction: spin × r̂ makes B orbit A in A's sense of rotation.
  let t = cross(spinA, rHat);
  if (length(t) < 0.1) t = cross(Math.abs(rHat[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], rHat);
  t = scale(t, 1 / length(t));

  const vRel = add(scale(rHat, vr), scale(t, vt));
  const M = a.mass + b.mass;
  return { velA: scale(vRel, -b.mass / M), velB: scale(vRel, a.mass / M) };
}

/**
 * The state of the two centres in the opening pass. Arrays are plain
 * numbers so the state can be stepped and tested in Node.
 * friction: the drag while they overlap (a slow pass merges). The
 * consumption turns it off: its first pass is a clean fly-by at the asked
 * distance, and the scripted spiral does the merging.
 * @param {{ posA: number[], posB: number[], velA: number[], velB: number[], a: { mass: number, eps2: number, radius: number }, b: { mass: number, eps2: number, radius: number }, friction?: boolean }} input
 */
export function createCentres({ posA, posB, velA, velB, a, b, friction = true }) {
  const mass = [a.mass, b.mass];
  return {
    pos: [[...posA], [...posB]],
    vel: [[...velA], [...velB]],
    radius: [a.radius, b.radius],
    mass,
    gm: mass.map((m) => G_SIM * m),
    eps2: [a.eps2, b.eps2],
    contact: CONTACT * (a.radius + b.radius),
    friction,
    // Gas disruption 0–1 per body (only grows).
    disruption: [0, 0],
    // Set once the centres first come within contact: the star sim runs from then on.
    interacting: false,
    time: 0,
  };
}

/** Centre separation. */
export function separation(state) {
  const p = state.pos;
  return Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]);
}

/** Fast-forward factor for the approach (1 once interacting or within contact). */
export function warpFactor(state) {
  if (state.interacting) return 1;
  const over = Math.max(0, separation(state) / state.contact - 1);
  return Math.min(MAX_WARP, 1 + WARP_GAIN * over ** 1.5);
}

const _acc = [[0, 0, 0], [0, 0, 0]];
const _d = [0, 0, 0];

/**
 * Advance the centres by dt simulation seconds (already warped by the
 * caller if needed). Kick-drift-kick leapfrog over small substeps; the
 * mutual pull uses the sum of both softenings (two extended bodies).
 */
export function stepCentres(state, dt) {
  if (dt <= 0) return state;
  const n = Math.ceil(dt / CENTRE_STEP);
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    centreAccel(state, _acc);
    kick(state, _acc, h / 2);
    for (let b = 0; b < 2; b++) for (let k = 0; k < 3; k++) state.pos[b][k] += state.vel[b][k] * h;
    centreAccel(state, _acc);
    kick(state, _acc, h / 2);
    disrupt(state, h);
    state.time += h;
  }
  if (!state.interacting && separation(state) <= state.contact) state.interacting = true;
  return state;
}

function kick(state, acc, h) {
  for (let b = 0; b < 2; b++) for (let k = 0; k < 3; k++) state.vel[b][k] += acc[b][k] * h;
}

function centreAccel(state, out) {
  const [pA, pB] = state.pos;
  const dx = pB[0] - pA[0];
  const dy = pB[1] - pA[1];
  const dz = pB[2] - pA[2];
  const r2 = dx * dx + dy * dy + dz * dz;
  const eps2 = state.eps2[0] + state.eps2[1];
  const inv = 1 / (r2 + eps2) ** 1.5;
  // Drag on the relative velocity while the bodies overlap; momentum is
  // kept. Like Chandrasekhar friction it fades for fast passes (∝ 1/v³), so
  // a slow pass is captured and a fast one escapes.
  const reach = FRICTION_REACH * 0.5 * (state.radius[0] + state.radius[1]);
  const M = state.mass[0] + state.mass[1];
  const vx = state.vel[1][0] - state.vel[0][0];
  const vy = state.vel[1][1] - state.vel[0][1];
  const vz = state.vel[1][2] - state.vel[0][2];
  const v0 = Math.sqrt((G_SIM * M) / reach);
  const vRatio = Math.sqrt(vx * vx + vy * vy + vz * vz) / v0;
  const drag = state.friction ? (FRICTION * Math.exp(-r2 / (reach * reach))) / (1 + vRatio * vRatio * vRatio) : 0;
  _d[0] = dx;
  _d[1] = dy;
  _d[2] = dz;
  for (let k = 0; k < 3; k++) {
    const d = _d[k];
    const vRel = state.vel[1][k] - state.vel[0][k];
    out[0][k] = state.gm[1] * d * inv + drag * (state.mass[1] / M) * vRel;
    out[1][k] = -state.gm[0] * d * inv - drag * (state.mass[0] / M) * vRel;
  }
}

/**
 * Tidal disruption: grows with the partner's tidal strength
 * (M_other / M_self) · (R_self / r)³, so a close heavy partner strips the
 * gas fast and a distant one barely at all.
 */
function disrupt(state, h) {
  const r = Math.sqrt(separation(state) ** 2 + state.eps2[0] + state.eps2[1]);
  for (let b = 0; b < 2; b++) {
    const o = 1 - b;
    const tide = (state.mass[o] / state.mass[b]) * (state.radius[b] / r) ** 3;
    state.disruption[b] = Math.min(1, state.disruption[b] + DISRUPT_RATE * tide * h);
  }
}

/** Gas (volume, H II, dust) brightness for a disruption 0–1. */
export function gasFade(disruption) {
  const t = Math.min(1, Math.max(0, disruption));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Local (unit-space) position of a star at `phase`: a JS mirror of
 * gs_position in shaders/chunks/stars.glsl, plus the cluster offset the
 * star shader adds. Writes into out = [x, y, z, crest].
 *
 * @param {Float32Array} orbit aOrbit (4 per star)
 * @param {Float32Array} offset position attribute (3 per star; cluster offsets)
 * @param {number} i star index
 * @param {{ phase: number, differential: number, patternSpeed: number, arms: number, winding: number, eccentricity: number, bar: number }} m
 * @param {number[]} out
 */
export function localStarPosition(orbit, offset, i, m, out) {
  const a = orbit[i * 4];
  const t0 = orbit[i * 4 + 1];
  const z = orbit[i * 4 + 2];
  const kind = orbit[i * 4 + 3];
  out[3] = 0.5;
  if (kind === KIND.DISC) {
    const theta = t0 + m.phase * omega(a, m.differential);
    const hasArms = m.arms >= 0.5;
    const e = hasArms ? eccentricity(a, m.eccentricity) : 0;
    const psi = armPhase(theta, a, m.arms, m.winding, m.phase, m.patternSpeed);
    const r = a * (1 + e * Math.cos(psi));
    if (hasArms) out[3] = crest(psi, m.winding);
    out[0] = r * Math.cos(theta);
    out[1] = z;
    out[2] = r * Math.sin(theta);
  } else if (kind === KIND.BAR) {
    const ang = barAngle(m.bar, m.arms, m.winding, m.phase, m.patternSpeed);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    out[0] = a * c - t0 * s;
    out[1] = z;
    out[2] = a * s + t0 * c;
  } else {
    // Bulge, halo and cluster centres: slow rotation (0.6 of the disc rate).
    const theta = t0 + m.phase * omega(a, m.differential) * 0.6;
    out[0] = a * Math.cos(theta);
    out[1] = z;
    out[2] = a * Math.sin(theta);
    if (kind === KIND.CLUSTER) {
      out[0] += offset[i * 3];
      out[1] += offset[i * 3 + 1];
      out[2] += offset[i * 3 + 2];
    }
  }
  return out;
}

/** Column-major 4×4 (THREE.Matrix4.elements) applied to a point, into out. */
function transformPoint(e, x, y, z, out) {
  out[0] = e[0] * x + e[4] * y + e[8] * z + e[12];
  out[1] = e[1] * x + e[5] * y + e[9] * z + e[13];
  out[2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  return out;
}

/**
 * Initial positions and velocities of a galaxy's stars for the GPU star
 * simulation (JS mirror of shaders/chunks/simInit.glsl; the random planes
 * differ, any isotropic choice will do) (RGBA float textures, one texel per
 * star): position = the analytic position now (world), w = FREE packed with
 * the arm crest (young stars keep their brightness); velocity = circular
 * speed in the galaxy's own Plummer potential plus the centre's velocity.
 * Disc and bar stars turn with the galaxy's spin; bulge, halo and cluster
 * stars on circles in random planes (a hot spheroid). A cluster's stars
 * share its centre's velocity, so the cluster stays together until tides
 * pull it apart.
 *
 * @param {{ orbit: Float32Array, offset: Float32Array, count: number, size: number, motion: object,
 *   matrix: ArrayLike<number>, radius: number, spin: number[], centre: number[], centreVel: number[], seed?: number }} input
 *   size = texels (≥ count); matrix = the galaxy group's matrixWorld elements
 * @returns {{ position: Float32Array, velocity: Float32Array }}
 */
export function initialStarState({ orbit, offset, count, size, motion, matrix, radius, spin, centre, centreVel, seed = 1 }) {
  const position = new Float32Array(size * 4);
  const velocity = new Float32Array(size * 4);
  const gm = G_SIM * galaxyMass(radius);
  const eps2 = (SOFTENING * radius) ** 2;
  const rng = createRandom(seed);
  // Scratch (up to 200k stars: no allocation in the loop).
  const local = [0, 0, 0, 0];
  const world = [0, 0, 0];
  const anchor = [0, 0, 0];
  const randomAxis = [0, 0, 0];
  const randomPlanes = new Map(); // cluster (orbit a) → shared random axis

  for (let i = 0; i < count; i++) {
    const i4 = i * 4;
    localStarPosition(orbit, offset, i, motion, local);
    transformPoint(matrix, local[0], local[1], local[2], world);
    position[i4] = world[0];
    position[i4 + 1] = world[1];
    position[i4 + 2] = world[2];
    position[i4 + 3] = packState(STATE.FREE, local[3]);

    const kind = orbit[i4 + 3];
    // Velocity from the star's place in the potential (a cluster: its centre).
    let p = world;
    let axis = spin;
    if (kind === KIND.CLUSTER) {
      clusterCentre(orbit, i, motion, local);
      p = transformPoint(matrix, local[0], local[1], local[2], anchor);
      let shared = randomPlanes.get(orbit[i4]);
      if (!shared) randomPlanes.set(orbit[i4], (shared = randomUnit(rng)));
      axis = shared;
    } else if (kind === KIND.BULGE || kind === KIND.HALO) {
      axis = randomUnitInto(rng, randomAxis);
    }
    const rx = p[0] - centre[0];
    const ry = p[1] - centre[1];
    const rz = p[2] - centre[2];
    const r = Math.sqrt(rx * rx + ry * ry + rz * rz);
    // t = axis × rel, scaled to the circular speed.
    let tx = axis[1] * rz - axis[2] * ry;
    let ty = axis[2] * rx - axis[0] * rz;
    let tz = axis[0] * ry - axis[1] * rx;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    const k = tl > 1e-9 && r > 1e-6 ? circularSpeed(r, gm, eps2) / tl : 0;
    tx *= k;
    ty *= k;
    tz *= k;
    velocity[i4] = tx + centreVel[0];
    velocity[i4 + 1] = ty + centreVel[1];
    velocity[i4 + 2] = tz + centreVel[2];
  }
  return { position, velocity };
}

/** Local position of a cluster star's centre (no offset). */
function clusterCentre(orbit, i, m, out) {
  const a = orbit[i * 4];
  const theta = orbit[i * 4 + 1] + m.phase * omega(a, m.differential) * 0.6;
  out[0] = a * Math.cos(theta);
  out[1] = orbit[i * 4 + 2];
  out[2] = a * Math.sin(theta);
  return out;
}

/**
 * The field the stars move in during one step (the GPU uniforms).
 * @typedef {{ pos: number[][], gm: number[], eps2: number[], indirect?: number[], drag?: number, winnerVel?: number[], infall?: number,
 *   hole?: boolean, normal?: number[], accRadius?: number, capture?: number, accRate?: number,
 *   spinMax?: number, settle?: number, timeLeft?: number }} StarField
 *   pos/gm/eps2: [winner, victim]; hole: the winner is a black hole (accretion on)
 */

/**
 * One star step, a JS mirror of shaders/collisionStep.glsl (after release).
 * FREE: semi-implicit Euler (kick, then drift with the new velocity;
 * symplectic, so circular orbits stay circular) in both pulls plus the
 * indirect term, with a drag toward a black-hole winner; inside accRadius
 * it changes to ACCRETE. ACCRETE: the analytic spiral in the hole's disc
 * plane: Kepler angular speed (capped, and slower near the horizon, like
 * infall seen from far away), an exponential infall that also meets the
 * deadline (timeLeft), the height settling onto the disc; GONE inside the
 * capture radius. Mutates star = { pos, vel, state, spin }.
 * @param {{ pos: number[], vel: number[], state: number, spin: number }} star
 * @param {StarField} f
 * @param {number} dt
 */
export function stepStar(star, f, dt) {
  const { pos, vel } = star;
  if (star.state === STATE.FREE) {
    const a = [0, 0, 0];
    for (let b = 0; b < 2; b++) addPlummerAccel(a, pos, f.pos[b], f.gm[b], f.eps2[b]);
    const drag = f.drag ?? 0;
    // A hole winner's extra inward pull (consumption.js infallPull): tails fall back.
    if (f.hole && f.infall) {
      const c = f.pos[0];
      const rx = pos[0] - c[0];
      const ry = pos[1] - c[1];
      const rz = pos[2] - c[2];
      const r = Math.hypot(rx, ry, rz);
      if (r > 1e-6) {
        a[0] -= (f.infall * rx) / r;
        a[1] -= (f.infall * ry) / r;
        a[2] -= (f.infall * rz) / r;
      }
    }
    // The drag works on the velocity relative to the winner (it may still be slowing down).
    for (let k = 0; k < 3; k++) {
      vel[k] += (a[k] + (f.indirect?.[k] ?? 0) - drag * (vel[k] - (f.winnerVel?.[k] ?? 0))) * dt;
      pos[k] += vel[k] * dt;
    }
    if (f.hole) {
      const c = f.pos[0];
      const rx = pos[0] - c[0];
      const ry = pos[1] - c[1];
      const rz = pos[2] - c[2];
      if (Math.hypot(rx, ry, rz) < f.accRadius) {
        star.state = STATE.ACCRETE;
        const n = f.normal;
        // Angular momentum about the disc axis: the sense of the spiral.
        const l = n[0] * (ry * vel[2] - rz * vel[1]) + n[1] * (rz * vel[0] - rx * vel[2]) + n[2] * (rx * vel[1] - ry * vel[0]);
        star.spin = l < 0 ? -1 : 1;
      }
    }
    return star;
  }
  if (star.state === STATE.ACCRETE) {
    const c = f.pos[0];
    const n = f.normal;
    const rx = pos[0] - c[0];
    const ry = pos[1] - c[1];
    const rz = pos[2] - c[2];
    const z = rx * n[0] + ry * n[1] + rz * n[2];
    const qx = rx - n[0] * z;
    const qy = ry - n[1] * z;
    const qz = rz - n[2] * z;
    const rc = Math.max(Math.hypot(qx, qy, qz), 1e-4);
    const slow = accretionSlow(rc, f.capture);
    const w = Math.min(Math.sqrt(f.gm[0] / rc ** 3), f.spinMax) * slow * star.spin;
    const rate = accretionRate(rc, f.capture, f.accRate * slow, f.timeLeft);
    const rcNew = rc * Math.exp(-rate * dt);
    const ang = w * dt;
    const qh = [qx / rc, qy / rc, qz / rc];
    const t = [n[1] * qh[2] - n[2] * qh[1], n[2] * qh[0] - n[0] * qh[2], n[0] * qh[1] - n[1] * qh[0]];
    const zNew = z * Math.exp(-f.settle * dt);
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    for (let k = 0; k < 3; k++) {
      const next = c[k] + (qh[k] * ca + t[k] * sa) * rcNew + n[k] * zNew;
      if (dt > 0) vel[k] = (next - pos[k]) / dt;
      pos[k] = next;
    }
    if (rcNew < f.capture * 1.02) star.state = STATE.GONE;
  }
  return star;
}

/** Near the horizon infall looks slow and red from far away (0.15 → 1 over 2 capture radii). */
export function accretionSlow(rc, capture) {
  return Math.min(1, Math.max(0.15, (rc - capture) / (2 * capture)));
}

/**
 * Infall rate (1/s): the base rate, or faster to reach the capture radius in
 * time (aiming a little inside it, so the last step does not crawl).
 */
export function accretionRate(rc, capture, base, timeLeft) {
  return Math.max(base, Math.log(Math.max(rc / (0.9 * capture), 1)) / Math.max(timeLeft, 0.3));
}

/** Star substeps for a frame of dt simulation seconds. */
export function starSubsteps(dt) {
  if (dt <= 0) return 0;
  return Math.min(MAX_STAR_SUBSTEPS, Math.ceil(dt / STAR_STEP));
}

/** Texture size (width, height) for `count` stars: near-square. */
export function simTextureSize(count) {
  const width = Math.max(1, Math.ceil(Math.sqrt(count)));
  return { width, height: Math.max(1, Math.ceil(count / width)) };
}

/**
 * Whether a store change ends a running collision: either object removed,
 * or anything changed except its name, the look keys that only recolour or
 * rescale the light (colours, brightness, star size, physical colour) and
 * the black-hole keys that only change its light (brightness, glow,
 * colours, jets, streak).
 * @param {object[]} prev entries before
 * @param {object[]} next entries after
 * @param {string[]} ids the objects in the collision
 */
export function collisionBroken(prev, next, ids) {
  for (const id of ids) {
    const a = prev.find((g) => g.id === id);
    const b = next.find((g) => g.id === id);
    if (!b) return true;
    if (!a || a === b) continue;
    if (a.seed !== b.seed || a.shape !== b.shape || a.structure !== b.structure || a.motion !== b.motion) return true;
    if (a.look !== b.look) {
      for (const key of LOCKED_LOOK_KEYS) {
        if (JSON.stringify(a.look[key]) !== JSON.stringify(b.look[key])) return true;
      }
    }
    if (a.hole !== b.hole) {
      for (const key of LOCKED_HOLE_KEYS) if (a.hole?.[key] !== b.hole?.[key]) return true;
    }
  }
  return false;
}

/** Look keys that move or reshape an object (locked during a collision). */
export const LOCKED_LOOK_KEYS = ['radius', 'tiltX', 'tiltZ', 'position'];
/** Black-hole keys that resize the hole (locked during a collision). */
export const LOCKED_HOLE_KEYS = ['size', 'discSize'];

function randomUnit(rng) {
  return randomUnitInto(rng, [0, 0, 0]);
}

function randomUnitInto(rng, out) {
  const u = rng.range(-1, 1);
  const phi = rng.range(0, Math.PI * 2);
  const s = Math.sqrt(1 - u * u);
  out[0] = s * Math.cos(phi);
  out[1] = u;
  out[2] = s * Math.sin(phi);
  return out;
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function scale(a, k) {
  return [a[0] * k, a[1] * k, a[2] * k];
}
function length(a) {
  return Math.hypot(a[0], a[1], a[2]);
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
