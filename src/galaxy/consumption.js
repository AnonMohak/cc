import { G_SIM, SOFTENING, galaxyMass } from './collision.js';
import { LIMITS } from './params.js';
import { MARCH_INNER } from './blackHole.js';

/**
 * Consumption: one object eats another and only the winner remains. Three
 * kinds: a black hole eats a black hole (the bigger one wins), a black hole
 * eats a galaxy (the hole always wins), a galaxy merges into a galaxy (the
 * bigger one wins).
 *
 * The winner never moves; the victim follows a scripted path: a short
 * approach (cubic Hermite, from rest), then an inspiral with an exact number
 * of turns:
 *   r(τ) = r0 · (1 − τ)^¼,   θ(τ) ∝ 1 − (1 − τ)^⅝,   τ = t / T
 * This is Kepler's law with a constant mass G·M = ω0² r0³ (the law of a
 * real gravitational-wave inspiral): every turn is smaller and faster than
 * the one before it, and stars set free on the way move with the path.
 *
 * Pure: plain numbers and arrays, no three.js scene objects. World units
 * (1 = 9,000 ly); time is simulation time (scaled, zero while paused).
 * scene/CollisionSim.js runs it with the GPU star simulation.
 */

export const KIND = {
  HOLE_HOLE: 'hole-hole',
  HOLE_GALAXY: 'hole-galaxy',
  GALAXY_GALAXY: 'galaxy-galaxy',
};

/** Inspiral seconds (simulation time at time scale 1). */
export const INSPIRAL_SECONDS = { [KIND.HOLE_HOLE]: 8, [KIND.HOLE_GALAXY]: 25, [KIND.GALAXY_GALAXY]: 25 };
/** Approach seconds: the minimum, and the maximum for a far start. */
export const APPROACH_MIN = 2;
export const APPROACH_MAX = 3;
/** Black-hole winners: seconds after the merge for the last matter to fall in. */
export const DRAIN_SECONDS = 1.5;
/** Galaxy merger: seconds of the fade from the simulated stars to the remnant. */
export const MERGE_FADE_SECONDS = 2.5;
/** The winner's size after each object it eats (black hole: Rs; galaxy: radius). */
export const GROWTH = 1.2;
export const HOLE_TURNS = 5;
export const GALAXY_TURNS = 3;
/** A black hole eating a galaxy: turns for a small and a large galaxy. */
export const FEED_TURNS_MIN = 10;
export const FEED_TURNS_MAX = 12;
// Orbit plane tilt from the winner's disc plane (degrees).
const ORBIT_TILT = { [KIND.HOLE_HOLE]: 0, [KIND.HOLE_GALAXY]: 15, [KIND.GALAXY_GALAXY]: 25 };
// Galaxy merger time-lapse: the real masses are far too light for 3 turns in
// 25 s, so the whole merger runs faster (stars, spin and path alike).
export const MAX_TIME_LAPSE = 12;

// Black-hole winners: accretion. Free matter feels a drag that rises as the
// path closes in (so it spirals in with the victim and is gone by the end);
// inside ACC_RADIUS × the disc radius it moves on to an analytic spiral in
// the disc plane, and inside the capture radius (the disc's inner edge,
// MARCH_INNER Rs) it is gone.
export const FREE_DRAG = 0.07; // 1/s
export const MAX_FREE_DRAG = 1.5;
export const ACC_RADIUS = 1;
export const ACC_RATE = 0.3; // 1/s: e-fold time of the infall
export const ACC_SPIN_MAX = 12; // rad/s: no strobing of the fastest inner orbits
export const ACC_SETTLE = 2; // 1/s: the spiral flattens onto the disc plane
/** Capture radius in Rs (the disc's inner edge). */
export const CAPTURE_RS = MARCH_INNER;

// Bound stars of the victim come free from the outside in (unit-space orbit
// radius aOrbit.x above the release radius), over these turns.
const RELEASE_TURNS = { [KIND.HOLE_HOLE]: [0, 3.5], [KIND.HOLE_GALAXY]: [0.25, 4] };
const RELEASE_START = 1.6; // above every star's orbit radius (the halo reaches 1.4)

// After-effects (seconds after the merge).
export const FEED_DECAY = 4;
export const FLASH_RISE = 0.3;
export const FLASH_DECAY = 0.6;
export const FLASH_GAIN = 2;
export const RIPPLE_SPEED = 60; // Rs per second
export const RIPPLE_AMP = 0.06; // radians of extra bend at the crest
export const RIPPLE_WIDTH = 6; // Rs
export const RIPPLE_DECAY = 1.2;
export const RIPPLE_SECONDS = 3;
export const STARBURST_DECAY = 8;
export const STARBURST_SECONDS = 30;

const TAU = Math.PI * 2;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * @typedef {{ id: string, hole: boolean, radius: number, rs?: number }} Body
 *   radius: object radius (world); rs: a black hole's Schwarzschild radius (world)
 */

/** @param {Body} a @param {Body} b */
export function consumeKind(a, b) {
  if (a.hole && b.hole) return KIND.HOLE_HOLE;
  if (a.hole || b.hole) return KIND.HOLE_GALAXY;
  return KIND.GALAXY_GALAXY;
}

/**
 * Who eats whom. A black hole always eats a galaxy; otherwise the bigger one
 * (larger Rs for holes, larger radius for galaxies) wins, and on a tie the
 * starter (the object whose panel started it).
 * @param {Body} starter
 * @param {Body} partner
 * @returns {{ winner: Body, victim: Body, kind: string }}
 */
export function pickWinner(starter, partner) {
  const kind = consumeKind(starter, partner);
  let partnerWins;
  if (kind === KIND.HOLE_GALAXY) partnerWins = partner.hole;
  else if (kind === KIND.HOLE_HOLE) partnerWins = partner.rs > starter.rs;
  else partnerWins = partner.radius > starter.radius;
  return partnerWins ? { winner: partner, victim: starter, kind } : { winner: starter, victim: partner, kind };
}

/**
 * Turns of the inspiral: 5 for two holes, 3 for two galaxies, 10–12 for a
 * hole eating a galaxy (a bigger galaxy takes longer: log of its radius).
 */
export function turnsFor(kind, victimRadius) {
  if (kind === KIND.HOLE_HOLE) return HOLE_TURNS;
  if (kind === KIND.GALAXY_GALAXY) return GALAXY_TURNS;
  const t = clamp01(Math.log(victimRadius / 2) / Math.log(15 / 2));
  return Math.round(FEED_TURNS_MIN + (FEED_TURNS_MAX - FEED_TURNS_MIN) * t);
}

/**
 * Start radius of the inspiral and the radius where it ends (the merge).
 * @param {string} kind
 * @param {{ radius: number, rs?: number, discOuter?: number }} winner discOuter: disc outer radius (world)
 * @param {{ radius: number }} victim
 */
export function orbitRadii(kind, winner, victim) {
  if (kind === KIND.HOLE_HOLE) {
    const r0 = 1.5 * winner.discOuter;
    return { r0, rEnd: Math.max(2 * winner.rs, 0.01 * r0) };
  }
  if (kind === KIND.HOLE_GALAXY) {
    const r0 = victim.radius + winner.discOuter;
    return { r0, rEnd: Math.max(2 * winner.rs, 0.01 * r0) };
  }
  return { r0: 0.9 * (winner.radius + victim.radius), rEnd: 0.02 * winner.radius };
}

/** Angular speed at the start of the inspiral for `turns` turns in `seconds`. */
export function startOmega(turns, seconds, tauEnd = 1) {
  return (TAU * turns * 0.625) / seconds / angleNorm(tauEnd);
}

// θ(τ) is normalised so exactly `turns` turns are done at τEnd (the merge).
function angleNorm(tauEnd) {
  return 1 - (1 - tauEnd) ** 0.625;
}

/**
 * G·M of the winner that makes the scripted path a Kepler orbit.
 * @param {{ r0: number, omega0: number }} path
 */
export function orbitGm(path) {
  return path.omega0 * path.omega0 * path.r0 ** 3;
}

/**
 * Galaxy merger time-lapse: how much faster than the real masses (G_SIM,
 * mass ∝ R², softened) the path runs. 1 ≤ W ≤ MAX_TIME_LAPSE.
 */
export function timeLapse(r0, omega0, radiusA, radiusB) {
  const gm = G_SIM * (galaxyMass(radiusA) + galaxyMass(radiusB));
  const eps2 = (SOFTENING * radiusA) ** 2 + (SOFTENING * radiusB) ** 2;
  const omegaReal = Math.sqrt(gm / (r0 * r0 + eps2) ** 1.5);
  return Math.min(MAX_TIME_LAPSE, Math.max(1, omega0 / omegaReal));
}

/**
 * The victim's path around the fixed winner.
 * @param {{ kind: string, winnerPos: number[], victimPos: number[], normal: number[], spin: number[],
 *   r0: number, rEnd: number, turns: number, seconds: number }} input
 *   normal: winner's disc normal; spin: its spin axis (collision.js spinAxis), so the orbit is prograde
 */
export function designPath({ kind, winnerPos, victimPos, normal, spin, r0, rEnd, turns, seconds }) {
  const d = sub(victimPos, winnerPos);
  const dist = length(d);
  // In the winner's disc plane, toward the victim (any in-plane direction if
  // the victim sits on the axis).
  let e1 = sub(d, scale(normal, dot(normal, d)));
  if (length(e1) < 1e-6 * Math.max(dist, 1)) e1 = cross(normal, Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  e1 = normalize(e1);
  // Prograde: spin × e1 is the direction the winner's stars move at e1.
  let e2 = cross(spin, e1);
  if (length(e2) < 1e-6) e2 = cross(normal, e1);
  e2 = normalize(e2);
  const tilt = (ORBIT_TILT[kind] * Math.PI) / 180;
  if (tilt) e2 = normalize(add(scale(e2, Math.cos(tilt)), scale(cross(e1, e2), Math.sin(tilt))));

  const tauEnd = 1 - (Math.min(rEnd, r0 * 0.999) / r0) ** 4;
  const omega0 = startOmega(turns, seconds, tauEnd);
  const approach = Math.min(APPROACH_MAX, Math.max(APPROACH_MIN, APPROACH_MIN + (dist - r0) / (4 * r0)));
  const entry = add(winnerPos, scale(e1, r0));
  const entryVel = add(scale(e1, -r0 / (4 * seconds)), scale(e2, r0 * omega0));
  return {
    kind,
    winnerPos: [...winnerPos],
    start: [...victimPos],
    e1,
    e2,
    normal: [...normal],
    r0,
    rEnd,
    turns,
    seconds,
    tauEnd,
    omega0,
    approach,
    entry,
    entryVel,
    /** Total path time (approach + inspiral). */
    duration: approach + tauEnd * seconds,
  };
}

/** A pose scratch object for pathPose. */
export function createPose() {
  return { pos: [0, 0, 0], vel: [0, 0, 0], stage: 'approach', tau: 0, angle: 0, turnsDone: 0, progress: 0, timeLeft: 0, radius: 0 };
}

/**
 * The victim's centre at path time t (closed form: the same at any frame
 * rate). Writes into out; allocation-free.
 * stage: 'approach' | 'inspiral' | 'merged'; turnsDone 0 → turns;
 * progress 0 → 1 over the inspiral; timeLeft: seconds to the merge.
 */
export function pathPose(path, t, out) {
  const { e1, e2, winnerPos: w } = path;
  if (t < path.approach) {
    // Cubic Hermite from rest at the start to the entry point and velocity.
    const T = path.approach;
    const s = Math.max(0, t) / T;
    const s2 = s * s;
    const s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1;
    const h01 = -2 * s3 + 3 * s2;
    const h11 = s3 - s2;
    const d00 = (6 * s2 - 6 * s) / T;
    const d01 = (-6 * s2 + 6 * s) / T;
    const d11 = 3 * s2 - 2 * s;
    for (let k = 0; k < 3; k++) {
      out.pos[k] = h00 * path.start[k] + h01 * path.entry[k] + h11 * T * path.entryVel[k];
      out.vel[k] = d00 * path.start[k] + d01 * path.entry[k] + d11 * path.entryVel[k];
    }
    out.stage = 'approach';
    out.tau = 0;
    out.angle = 0;
    out.turnsDone = 0;
    out.progress = 0;
    out.timeLeft = path.duration - t;
    out.radius = Math.sqrt((out.pos[0] - w[0]) ** 2 + (out.pos[1] - w[1]) ** 2 + (out.pos[2] - w[2]) ** 2);
    return out;
  }
  const raw = (t - path.approach) / path.seconds;
  const tau = Math.min(raw, path.tauEnd);
  const left = 1 - tau;
  const norm = angleNorm(path.tauEnd);
  const r = path.r0 * left ** 0.25;
  const merged = raw >= path.tauEnd;
  const angle = merged ? TAU * path.turns : (TAU * path.turns * (1 - left ** 0.625)) / norm;
  const drdt = -path.r0 / (4 * path.seconds) * left ** -0.75;
  const dthdt = path.omega0 * left ** -0.375;
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  for (let k = 0; k < 3; k++) {
    const radial = c * e1[k] + sn * e2[k];
    const tangent = -sn * e1[k] + c * e2[k];
    out.pos[k] = w[k] + r * radial;
    out.vel[k] = drdt * radial + r * dthdt * tangent;
  }
  out.stage = merged ? 'merged' : 'inspiral';
  out.tau = tau;
  out.angle = angle;
  out.turnsDone = merged ? path.turns : angle / TAU;
  out.progress = Math.min(1, out.turnsDone / path.turns);
  out.timeLeft = Math.max(0, (path.tauEnd - tau) * path.seconds);
  out.radius = r;
  return out;
}

/** A victim black hole's size (Rs and disc) by turns done: −1/turns of the start per turn. */
export function victimHoleScale(turnsDone, turns) {
  return clamp01(1 - turnsDone / turns);
}

/** The winning hole's Rs growth during the event (×1 → ×GROWTH at the merge). */
export function winnerGrowth(progress) {
  return 1 + (GROWTH - 1) * clamp01(progress);
}

/**
 * Release radius (unit space of the victim): bound stars with an orbit
 * radius at or above it are set free. Infinity before the start; 0 = all.
 */
export function releaseRadius(kind, turnsDone) {
  const span = RELEASE_TURNS[kind];
  if (!span) return 0; // two galaxies: every star is free from the entry
  const u = clamp01((turnsDone - span[0]) / (span[1] - span[0]));
  return u >= 1 ? 0 : RELEASE_START * (1 - u) ** 1.5;
}

/** Share of the victim's stars released, 0–1 (gas fades with it). */
export function releasedShare(kind, turnsDone) {
  const r = releaseRadius(kind, turnsDone);
  return clamp01(1 - r / RELEASE_START);
}

/** Drag on free matter around a black-hole winner (1/s). */
export function freeDrag(pose, seconds) {
  if (pose.stage === 'approach') return 0;
  const chirp = 1 / (8 * seconds * Math.max(1 - pose.tau, 1e-3));
  return Math.min(MAX_FREE_DRAG, FREE_DRAG + chirp);
}

/** Feeding flare 0–1 of a black-hole winner (during and after the event). */
export function feedLevel(kind, turnsDone, turns, tAfter = 0) {
  if (kind === KIND.GALAXY_GALAXY) return 0;
  const during = kind === KIND.HOLE_GALAXY ? smoothstep(0.5, turns * 0.8, turnsDone) : smoothstep(0, turns, turnsDone);
  return during * Math.exp(-Math.max(0, tAfter) / FEED_DECAY);
}

/** Merger flash: disc gain multiplier after two black holes merge (1 = none). */
export function flashGain(tAfter) {
  if (tAfter < 0) return 1;
  const k = tAfter < FLASH_RISE ? tAfter / FLASH_RISE : Math.exp(-(tAfter - FLASH_RISE) / FLASH_DECAY);
  return 1 + FLASH_GAIN * k;
}

/**
 * Gravitational-wave ripple after a black-hole merger: a ring moving out
 * from the hole (radius in Rs) that bends the background (amplitude, rad).
 * Writes { radius, amp } into out; amp 0 when over.
 */
export function rippleState(tAfter, out) {
  if (tAfter < 0 || tAfter > RIPPLE_SECONDS) {
    out.radius = 0;
    out.amp = 0;
    return out;
  }
  out.radius = RIPPLE_SPEED * tAfter;
  out.amp = RIPPLE_AMP * smoothstep(0, 0.1, tAfter) * Math.exp(-tAfter / RIPPLE_DECAY) * (1 - smoothstep(RIPPLE_SECONDS * 0.7, RIPPLE_SECONDS, tAfter));
  return out;
}

/** Starburst after a galaxy merger, 1 → 0 (young stars and H II brighter). */
export function starburstLevel(tAfter) {
  if (tAfter < 0) return 0;
  if (tAfter > STARBURST_SECONDS) return 0;
  return Math.exp(-tAfter / STARBURST_DECAY) * (1 - smoothstep(STARBURST_SECONDS * 0.6, STARBURST_SECONDS, tAfter));
}

/** Seconds of after-effects once the result is in the store. */
export function afterSeconds(kind) {
  if (kind === KIND.GALAXY_GALAXY) return STARBURST_SECONDS;
  return FEED_DECAY * 4;
}

/**
 * The store patch for the winner: a black hole's Rs × GROWTH (through
 * hole.size; at its limit through look.radius, so Rs still grows); a
 * galaxy's radius × GROWTH and the star counts added (the per-galaxy limit
 * applies). The reducer clamps again.
 * @param {object} winner store entry
 * @param {object} victim store entry
 */
export function consumeResult(winner, victim) {
  if (winner.kind === 'blackhole') {
    const max = LIMITS.hole.size.max;
    const size = winner.hole.size * GROWTH;
    if (size <= max) return { hole: { size } };
    const radius = Math.min(LIMITS.look.radius.max, (winner.look.radius * size) / max);
    return { hole: { size: max }, look: { radius } };
  }
  return {
    look: { radius: Math.min(LIMITS.look.radius.max, winner.look.radius * GROWTH) },
    shape: { count: Math.min(LIMITS.shape.count.max, winner.shape.count + victim.shape.count) },
  };
}

/** The capture radius around a winning hole (world units). */
export function captureRadius(rsWorld) {
  return CAPTURE_RS * rsWorld;
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function length(a) {
  return Math.hypot(a[0], a[1], a[2]);
}
function normalize(a) {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
