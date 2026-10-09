import { omega, eccentricity, armPhase, crest, barAngle } from './densityModel.js';
import { createRandom } from './random.js';
import { KIND } from './generateGalaxy.js';

/**
 * Collision physics for consumption (galaxy/consumption.js has the timeline):
 * restricted N-body, "N-body-lite" (Toomre & Toomre 1972). Each body is a
 * softened point mass (a Plummer sphere; a black hole with a small
 * softening), and the stars are test particles that feel both bodies but not
 * each other. The winner stays fixed and the victim follows a scripted path,
 * so the stars live in the winner's frame: every star also gets the
 * opposite of the victim's pull on the winner (the indirect term).
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
// Largest star step on the GPU (simulation seconds), and the most substeps per frame.
export const STAR_STEP = 1 / 30;
export const MAX_STAR_SUBSTEPS = 8;

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
 * The indirect term: minus the victim's pull on the (fixed) winner. Every
 * star in the winner's frame gets it, else a fixed winner's disc slides
 * toward the victim. Writes into out.
 */
export function indirectAccel(out, winnerPos, victimPos, victimGm, eps2) {
  out[0] = out[1] = out[2] = 0;
  addPlummerAccel(out, winnerPos, victimPos, victimGm, eps2);
  out[0] = -out[0];
  out[1] = -out[1];
  out[2] = -out[2];
  return out;
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
 * @typedef {{ pos: number[][], gm: number[], eps2: number[], indirect?: number[], drag?: number,
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
    for (let k = 0; k < 3; k++) {
      vel[k] += (a[k] + (f.indirect?.[k] ?? 0) - drag * vel[k]) * dt;
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
