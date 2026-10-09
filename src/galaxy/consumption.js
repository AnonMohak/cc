import { LIMITS } from './params.js';
import { MARCH_INNER } from './blackHole.js';

/**
 * Consumption: one object eats another and only the winner remains. Three
 * kinds: a black hole eats a black hole (the bigger one wins), a black hole
 * eats a galaxy (the hole always wins), a galaxy merges into a galaxy (the
 * bigger one wins).
 *
 * It opens with free physics (collision.js: both centres move, one close
 * pass, the stars react with tails and bridges). After that pass
 * (watchPass) the consumption takes over: the winner comes to rest
 * (winner settle) and the victim's path blends from the physics path into a
 * scripted spiral with an exact number of turns:
 *   r(τ) = r0 · (1 − τ)^¼,   dθ/dt = W · ω(r),   τ = t / T
 * ω(r) is the circular speed of the real softened pull at every radius, so
 * stars set free on the way move with the path; one time factor W
 * (designSpiral) makes the turn count exact. Every turn is smaller and
 * faster than the one before it.
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

/** Inspiral seconds (simulation time at time scale 1): slow and calm. */
export const INSPIRAL_SECONDS = { [KIND.HOLE_HOLE]: 24, [KIND.HOLE_GALAXY]: 75, [KIND.GALAXY_GALAXY]: 75 };
/** The handover after the opening pass: the victim's path blends into the spiral over this time. */
export const BLEND_SECONDS = 3;
/** The winner comes to rest with this e-fold time after the handover (about 3 s). */
export const SETTLE_SECONDS = 1.2;
/** The opening pass ends once the distance is back to this × the closest one… */
export const PASS_RATIO = 1.5;
/** …or this many seconds after the closest approach… */
export const PASS_HOLD = 4;
/** …or after this much time in contact (a head-on or a capture that never turns back). */
export const PASS_MAX = 60;
/**
 * Black-hole winners: seconds after the merge for the last matter to fall
 * in, gradually (a galaxy's debris disc takes longer than a hole's stream).
 */
export const DRAIN_SECONDS = { [KIND.HOLE_HOLE]: 4, [KIND.HOLE_GALAXY]: 10 };
/**
 * Late in the spiral and in the drain the capture zone grows to this × its
 * size, slowly, so even matter flung far out spirals in over many seconds
 * rather than vanishing at the end.
 */
export const DRAIN_REACH = 40;
// Share of the growth done by the end of the spiral (from 40% of it); the rest in the drain.
const SPIRAL_REACH_SHARE = 0.6;
/** The victim's last light fades over this final share of the drain. */
export const DRAIN_FADE_SHARE = 0.3;
/** Galaxy merger: seconds of the fade from the simulated stars to the remnant. */
export const MERGE_FADE_SECONDS = 2.5;
/** The winner's size after each object it eats (black hole: Rs; galaxy: radius). */
export const GROWTH = 1.2;
export const HOLE_TURNS = 5;
export const GALAXY_TURNS = 3;
/** A black hole eating a galaxy: turns for a small and a large galaxy. */
export const FEED_TURNS_MIN = 10;
export const FEED_TURNS_MAX = 12;
// The spiral's time factor (physics time per path second): the turn count
// is exact within these limits.
export const MIN_TIME_LAPSE = 0.25;
export const MAX_TIME_LAPSE = 12;
// Samples of the spiral's angle table.
const SPIRAL_SAMPLES = 512;

// Black-hole winners: accretion. Free matter feels a drag that rises as the
// path closes in (so it spirals in with the victim and is gone by the end);
// inside ACC_RADIUS × the disc radius it moves on to an analytic spiral in
// the disc plane, and inside the capture radius (the disc's inner edge,
// MARCH_INNER Rs) it is gone.
export const FREE_DRAG = 0.03; // 1/s
// Low: a strong drag at the end of the spiral made the debris drop in at once.
export const MAX_FREE_DRAG = 0.25;
export const ACC_RADIUS = 1;
export const ACC_RATE = 0.25; // 1/s: e-fold time of the infall
export const ACC_SPIN_MAX = 12; // rad/s: no strobing of the fastest inner orbits
export const ACC_SETTLE = 2; // 1/s: the spiral flattens onto the disc plane
/** Capture radius in Rs (the disc's inner edge). */
export const CAPTURE_RS = MARCH_INNER;

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

/** A store entry as a Body (for who-eats-whom before anything runs). */
export function bodyFromEntry(entry) {
  const hole = entry.kind === 'blackhole';
  return { id: entry.id, hole, radius: entry.look.radius, rs: hole ? entry.hole.size * entry.look.radius : 0 };
}

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
 * Where the spiral ends (the merge): near a winning hole's horizon, near a
 * winning galaxy's centre.
 * @param {{ hole: boolean, radius: number, rs?: number }} winner
 */
export function mergeRadius(winner) {
  return winner.hole ? 2 * winner.rs : 0.02 * winner.radius;
}

/** A scratch watch for the opening pass (watchPass). */
export function createPassWatch() {
  return { min: Infinity, sinceMin: 0, time: 0 };
}

/**
 * The opening pass: true once the consumption should take over. The centres
 * have passed their closest approach and are moving apart again (the
 * distance is back to PASS_RATIO × the closest, or PASS_HOLD s have passed
 * since it), or they merged head-on (closer than `merged`), or the contact
 * lasted PASS_MAX s. Call it each step while in contact.
 */
export function watchPass(w, separation, dt, merged) {
  w.time += dt;
  if (separation < w.min) {
    w.min = separation;
    w.sinceMin = 0;
  } else {
    w.sinceMin += dt;
  }
  const passed = w.sinceMin > 0 && (separation >= PASS_RATIO * w.min || w.sinceMin >= PASS_HOLD);
  return passed || separation < merged || w.time >= PASS_MAX;
}

/** Circular angular speed at r in a softened pull (G·M, ε²). */
function circularOmega(r, gm, eps2) {
  return Math.sqrt(gm / (r * r + eps2) ** 1.5);
}

/**
 * The spiral from the handover: the bodies' positions and velocities then.
 * The orbit plane and sense come from the victim's motion around the
 * winner (from the winner's spin if it falls straight in).
 * @param {{ kind: string, winnerPos: number[], winnerVel: number[], victimPos: number[], victimVel: number[],
 *   spin: number[], gm: number, eps2: number, rEnd: number, turns: number, seconds: number }} input
 *   gm, eps2: the pair's G·(M1 + M2) and summed softening² (physics units)
 */
export function designSpiral({ kind, winnerPos, winnerVel, victimPos, victimVel, spin, gm, eps2, rEnd, turns, seconds }) {
  const rel = sub(victimPos, winnerPos);
  const r0 = Math.max(length(rel), 1e-6);
  const e1 = scale(rel, 1 / r0);
  const L = cross(rel, sub(victimVel, winnerVel));
  let e2 = cross(L, e1);
  if (length(e2) < 1e-9 * r0) e2 = cross(spin, e1);
  if (length(e2) < 1e-9) e2 = cross(Math.abs(e1[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], e1);
  e2 = normalize(e2);

  const tauEnd = 1 - (Math.min(rEnd, r0 * 0.999) / r0) ** 4;
  // Cumulative ∫ ω(r(τ)) dτ (trapezoid), so θ(τ) = W · T · C(τ).
  const table = new Float64Array(SPIRAL_SAMPLES);
  const step = tauEnd / (SPIRAL_SAMPLES - 1);
  let prev = circularOmega(r0, gm, eps2);
  for (let i = 1; i < SPIRAL_SAMPLES; i++) {
    const w = circularOmega(r0 * (1 - i * step) ** 0.25, gm, eps2);
    table[i] = table[i - 1] + 0.5 * (prev + w) * step;
    prev = w;
  }
  const total = table[SPIRAL_SAMPLES - 1];
  const lapse = Math.min(MAX_TIME_LAPSE, Math.max(MIN_TIME_LAPSE, (TAU * turns) / (seconds * total)));
  return {
    kind,
    winnerStart: [...winnerPos],
    winnerVel: [...winnerVel],
    e1,
    e2,
    r0,
    rEnd,
    gm,
    eps2,
    seconds,
    tauEnd,
    table,
    step,
    lapse,
    /** Turns actually made (= turns unless the time factor hit its limit). */
    turns: (lapse * seconds * total) / TAU,
    duration: tauEnd * seconds,
  };
}

/** A pose scratch object for spiralPose. */
export function createPose() {
  return {
    pos: [0, 0, 0],
    vel: [0, 0, 0],
    winnerPos: [0, 0, 0],
    winnerVel: [0, 0, 0],
    winnerAcc: [0, 0, 0],
    stage: 'spiral',
    tau: 0,
    angle: 0,
    turnsDone: 0,
    progress: 0,
    timeLeft: 0,
    radius: 0,
  };
}

/**
 * Winner and victim at path time t after the handover (closed form: the
 * same at any frame rate). Writes into out; allocation-free. Velocities and
 * the winner's acceleration are per path second (star time: divide by the
 * time factor, the acceleration by its square).
 * stage: 'spiral' | 'merged'; turnsDone 0 → turns; progress 0 → 1;
 * timeLeft: seconds to the merge.
 */
export function spiralPose(sp, t, out) {
  // The winner comes to rest: v = v0 e^(−t/S).
  const decay = Math.exp(-Math.max(0, t) / SETTLE_SECONDS);
  for (let k = 0; k < 3; k++) {
    out.winnerPos[k] = sp.winnerStart[k] + sp.winnerVel[k] * SETTLE_SECONDS * (1 - decay);
    out.winnerVel[k] = sp.winnerVel[k] * decay;
    out.winnerAcc[k] = (-sp.winnerVel[k] / SETTLE_SECONDS) * decay;
  }
  const raw = Math.max(0, t) / sp.seconds;
  const merged = raw >= sp.tauEnd;
  const tau = Math.min(raw, sp.tauEnd);
  const left = 1 - tau;
  const r = sp.r0 * left ** 0.25;
  const x = tau / sp.step;
  const i = Math.min(SPIRAL_SAMPLES - 2, Math.floor(x));
  const c = sp.table[i] + (sp.table[i + 1] - sp.table[i]) * (x - i);
  const angle = merged ? TAU * sp.turns : sp.lapse * sp.seconds * c;
  const drdt = (-sp.r0 / (4 * sp.seconds)) * left ** -0.75;
  const dthdt = sp.lapse * circularOmega(r, sp.gm, sp.eps2);
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  for (let k = 0; k < 3; k++) {
    const radial = ca * sp.e1[k] + sa * sp.e2[k];
    const tangent = -sa * sp.e1[k] + ca * sp.e2[k];
    out.pos[k] = out.winnerPos[k] + r * radial;
    out.vel[k] = out.winnerVel[k] + drdt * radial + r * dthdt * tangent;
  }
  out.stage = merged ? 'merged' : 'spiral';
  out.tau = tau;
  out.angle = angle;
  out.turnsDone = merged ? sp.turns : angle / TAU;
  out.progress = Math.min(1, out.turnsDone / sp.turns);
  out.timeLeft = Math.max(0, (sp.tauEnd - tau) * sp.seconds);
  out.radius = r;
  return out;
}

/** Drain seconds for a kind (0 for a galaxy merger: it fades instead). */
export function drainSeconds(kind) {
  return DRAIN_SECONDS[kind] ?? 0;
}

/**
 * The capture zone's growth: ×1 until 40% of the spiral, SPIRAL_REACH_SHARE
 * of the way by its end, then ×DRAIN_REACH by half the drain.
 * @param {number} progress spiral progress 0–1
 * @param {number} t seconds into the drain (0 before it)
 * @param {number} seconds drain length
 */
export function consumeReach(progress, t, seconds) {
  const u = SPIRAL_REACH_SHARE * smoothstep(0.4, 1, progress) + (1 - SPIRAL_REACH_SHARE) * smoothstep(0, 0.5 * seconds, t);
  return 1 + (DRAIN_REACH - 1) * u;
}

/**
 * A black-hole winner's extra inward pull on free matter (path units/s²):
 * the tidal tails of the opening pass would fly away for good; this turns
 * them around so they fall back and spiral in during the spiral.
 */
export const INFALL_ACC = 1.2;

/** The inward pull 0 → INFALL_ACC over 15–60% of the spiral. */
export function infallPull(progress) {
  return INFALL_ACC * smoothstep(0.15, 0.6, progress);
}

/** The accretion deadline in the drain: everything is in by DRAIN_DONE of it, before the last fade. */
export const DRAIN_DONE = 0.7;

/** The victim's light in the drain: full, then out over the last DRAIN_FADE_SHARE. */
export function drainFade(t, seconds) {
  return 1 - smoothstep((1 - DRAIN_FADE_SHARE) * seconds, seconds, t);
}

/** Handover blend 0 → 1 (the physics path → the spiral) over BLEND_SECONDS. */
export function blendFactor(t) {
  return smoothstep(0, BLEND_SECONDS, t);
}

/**
 * How much of the victim's own pull is left (it is torn up and eaten): a
 * black hole by its shrinking size, a galaxy eaten by a hole fades from
 * 25% to 85% of the spiral, a merging galaxy keeps its pull.
 */
export function victimPull(kind, turnsDone, turns) {
  const p = clamp01(turnsDone / turns);
  if (kind === KIND.HOLE_HOLE) return 1 - p;
  if (kind === KIND.HOLE_GALAXY) return 1 - smoothstep(0.25, 0.85, p);
  return 1;
}

/** A victim black hole's size (Rs and disc) by turns done: −1/turns of the start per turn. */
export function victimHoleScale(turnsDone, turns) {
  return clamp01(1 - turnsDone / turns);
}

/** The winning hole's Rs growth during the event (×1 → ×GROWTH at the merge). */
export function winnerGrowth(progress) {
  return 1 + (GROWTH - 1) * clamp01(progress);
}

/** Share of the victim eaten so far, 0–1 (its gas fades with it). */
export function eatenShare(kind, turnsDone, turns) {
  if (kind === KIND.GALAXY_GALAXY) return smoothstep(0, 0.8, turnsDone / turns);
  return 1 - victimPull(kind, turnsDone, turns);
}

/** Drag on free matter around a black-hole winner (1/s). */
export function freeDrag(pose, seconds) {
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
