import { describe, it, expect } from 'vitest';
import {
  KIND,
  pickWinner,
  consumeKind,
  turnsFor,
  mergeRadius,
  createPassWatch,
  watchPass,
  designSpiral,
  spiralPose,
  createPose,
  blendFactor,
  victimPull,
  eatenShare,
  victimHoleScale,
  winnerGrowth,
  freeDrag,
  feedLevel,
  flashGain,
  rippleState,
  starburstLevel,
  consumeResult,
  GROWTH,
  INSPIRAL_SECONDS,
  BLEND_SECONDS,
  SETTLE_SECONDS,
  PASS_HOLD,
  MAX_TIME_LAPSE,
} from './consumption.js';
import { LIMITS, MAX_PARTICLES_PER_GALAXY } from './params.js';
import { G_SIM } from './collision.js';

const hole = (id, rs, radius = 4) => ({ id, hole: true, rs, radius });
const galaxy = (id, radius) => ({ id, hole: false, radius });

// Two default galaxies after a pass: the victim 9 away, moving off at an angle.
function makeSpiral(overrides = {}) {
  return designSpiral({
    kind: KIND.GALAXY_GALAXY,
    winnerPos: [0, 0, 0],
    winnerVel: [-0.3, 0, 0.1],
    victimPos: [9, 0, 0],
    victimVel: [0.3, 0, 1.2],
    spin: [0, -1, 0],
    gm: G_SIM * 2,
    eps2: 2 * 1.8 ** 2,
    rEnd: 0.12,
    turns: 3,
    seconds: INSPIRAL_SECONDS[KIND.GALAXY_GALAXY],
    ...overrides,
  });
}

describe('pickWinner', () => {
  it('a black hole always eats a galaxy', () => {
    expect(pickWinner(galaxy('g', 20), hole('h', 0.01)).winner.id).toBe('h');
    expect(pickWinner(hole('h', 0.01), galaxy('g', 20)).winner.id).toBe('h');
    expect(pickWinner(hole('h', 0.01), galaxy('g', 20)).kind).toBe(KIND.HOLE_GALAXY);
  });

  it('the bigger one wins; on a tie the starter', () => {
    expect(pickWinner(hole('a', 0.1), hole('b', 0.2)).winner.id).toBe('b');
    expect(pickWinner(hole('a', 0.2), hole('b', 0.1)).winner.id).toBe('a');
    expect(pickWinner(hole('a', 0.1), hole('b', 0.1)).winner.id).toBe('a');
    expect(pickWinner(galaxy('a', 6), galaxy('b', 8)).winner.id).toBe('b');
    expect(pickWinner(galaxy('a', 6), galaxy('b', 6)).winner.id).toBe('a');
    expect(consumeKind(galaxy('a', 6), galaxy('b', 6))).toBe(KIND.GALAXY_GALAXY);
  });
});

describe('turnsFor and mergeRadius', () => {
  it('5 for two holes, 3 for two galaxies, 10–12 for a hole eating a galaxy', () => {
    expect(turnsFor(KIND.HOLE_HOLE, 4)).toBe(5);
    expect(turnsFor(KIND.GALAXY_GALAXY, 6)).toBe(3);
    expect(turnsFor(KIND.HOLE_GALAXY, 1)).toBe(10);
    expect(turnsFor(KIND.HOLE_GALAXY, 6)).toBe(11);
    expect(turnsFor(KIND.HOLE_GALAXY, 30)).toBe(12);
  });

  it('ends near a hole horizon or a galaxy centre', () => {
    expect(mergeRadius({ hole: true, rs: 0.12, radius: 4 })).toBeCloseTo(0.24);
    expect(mergeRadius({ hole: false, radius: 6 })).toBeCloseTo(0.12);
  });

  it('is 3× slower than before', () => {
    expect(INSPIRAL_SECONDS).toEqual({ [KIND.HOLE_HOLE]: 24, [KIND.HOLE_GALAXY]: 75, [KIND.GALAXY_GALAXY]: 75 });
  });
});

describe('watchPass', () => {
  it('hands over after the closest approach, once the bodies move apart', () => {
    const w = createPassWatch();
    // Closing in, then moving apart.
    for (const d of [20, 15, 10, 8, 7.5]) expect(watchPass(w, d, 0.1, 0.1)).toBe(false);
    expect(watchPass(w, 9, 0.1, 0.1)).toBe(false);
    expect(watchPass(w, 11.3, 0.1, 0.1)).toBe(true); // ≥ 1.5 × 7.5
  });

  it('hands over PASS_HOLD s after the closest approach for a slow capture', () => {
    const w = createPassWatch();
    watchPass(w, 5, 0.1, 0.1);
    let t = 0;
    let done = false;
    while (!done && t < 20) {
      done = watchPass(w, 5.2, 0.1, 0.1);
      t += 0.1;
    }
    expect(t).toBeCloseTo(PASS_HOLD, 1);
  });

  it('hands over at once for a head-on merge', () => {
    const w = createPassWatch();
    expect(watchPass(w, 0.05, 0.1, 0.1)).toBe(true);
  });
});

describe('spiral', () => {
  it('starts at the handover positions and moves the victim the way it was going', () => {
    const sp = makeSpiral();
    const pose = spiralPose(sp, 0, createPose());
    for (let k = 0; k < 3; k++) expect(pose.pos[k]).toBeCloseTo([9, 0, 0][k], 9);
    // The relative motion was toward +z: the spiral turns that way.
    const later = spiralPose(sp, 1, createPose());
    expect(later.pos[2] - later.winnerPos[2]).toBeGreaterThan(0);
  });

  it('makes exactly the given turns by the merge, each one smaller and faster', () => {
    for (const [kind, turns, gm, eps2, rEnd] of [
      [KIND.HOLE_HOLE, 5, G_SIM * 8, 1.08 ** 2 * 2, 0.24],
      [KIND.HOLE_GALAXY, 11, G_SIM * 5, 1.08 ** 2 + 1.8 ** 2, 0.24],
      [KIND.GALAXY_GALAXY, 3, G_SIM * 2, 2 * 1.8 ** 2, 0.12],
    ]) {
      const sp = makeSpiral({ kind, turns, gm, eps2, rEnd, seconds: INSPIRAL_SECONDS[kind] });
      expect(sp.lapse).toBeLessThan(MAX_TIME_LAPSE);
      const pose = createPose();
      spiralPose(sp, sp.duration + 0.01, pose);
      expect(pose.stage).toBe('merged');
      expect(pose.turnsDone).toBeCloseTo(turns, 6);
      expect(pose.progress).toBe(1);
      // The angle reaches the turn count continuously.
      spiralPose(sp, sp.duration - 1e-6, pose);
      expect(pose.turnsDone).toBeCloseTo(turns, 2);
      const times = [];
      let last = 0;
      for (let t = 0; t <= sp.duration; t += 0.002) {
        const turn = Math.floor(spiralPose(sp, t, pose).turnsDone);
        if (turn > last) {
          times.push(t);
          last = turn;
        }
      }
      const lengths = times.map((t, i) => t - (i === 0 ? 0 : times[i - 1]));
      for (let i = 1; i < lengths.length; i++) expect(lengths[i]).toBeLessThan(lengths[i - 1]);
    }
  });

  it('moves like a circular orbit in the softened pull, in star time', () => {
    const sp = makeSpiral();
    const pose = createPose();
    for (const tau of [0.1, 0.5, 0.9]) {
      spiralPose(sp, tau * sp.seconds + 20, pose);
      const rel = pose.pos.map((x, k) => x - pose.winnerPos[k]);
      const v = pose.vel.map((x, k) => (x - pose.winnerVel[k]) / sp.lapse); // star time
      const r = Math.hypot(...rel);
      const vr = (v[0] * rel[0] + v[1] * rel[1] + v[2] * rel[2]) / r;
      const vt2 = v[0] ** 2 + v[1] ** 2 + v[2] ** 2 - vr * vr;
      // v²/r equals the softened pull at r.
      expect((vt2 / r) / ((sp.gm * r) / (r * r + sp.eps2) ** 1.5)).toBeCloseTo(1, 2);
    }
  });

  it('brings the winner to rest, smoothly', () => {
    const sp = makeSpiral();
    const pose = spiralPose(sp, 0, createPose());
    expect(pose.winnerVel).toEqual([-0.3, 0, 0.1]);
    spiralPose(sp, 10 * SETTLE_SECONDS, pose);
    expect(Math.hypot(...pose.winnerVel)).toBeLessThan(1e-4);
    expect(pose.winnerPos[0]).toBeCloseTo(-0.3 * SETTLE_SECONDS, 3);
    // a = dv/dt.
    const a = spiralPose(sp, 1, createPose());
    const b = spiralPose(sp, 1.001, createPose());
    expect((b.winnerVel[0] - a.winnerVel[0]) / 0.001).toBeCloseTo(a.winnerAcc[0], 3);
  });

  it('is the same at any frame rate (closed form)', () => {
    const sp = makeSpiral();
    expect(spiralPose(sp, 5.123, createPose())).toEqual(spiralPose(sp, 5.123, createPose()));
  });

  it('blends in over BLEND_SECONDS', () => {
    expect(blendFactor(0)).toBe(0);
    expect(blendFactor(BLEND_SECONDS / 2)).toBeCloseTo(0.5);
    expect(blendFactor(BLEND_SECONDS)).toBe(1);
  });
});

describe('victim and winner', () => {
  it('the victim hole loses 1/turns of its start size per turn and the winner grows to ×GROWTH', () => {
    expect(victimHoleScale(0, 5)).toBe(1);
    expect(victimHoleScale(1, 5)).toBeCloseTo(0.8);
    expect(victimHoleScale(5, 5)).toBe(0);
    expect(winnerGrowth(0)).toBe(1);
    expect(winnerGrowth(1)).toBeCloseTo(GROWTH);
  });

  it('the victim loses its pull as it is eaten (a merging galaxy keeps it)', () => {
    expect(victimPull(KIND.HOLE_HOLE, 2.5, 5)).toBeCloseTo(0.5);
    expect(victimPull(KIND.HOLE_GALAXY, 0, 11)).toBe(1);
    expect(victimPull(KIND.HOLE_GALAXY, 11, 11)).toBe(0);
    expect(victimPull(KIND.GALAXY_GALAXY, 3, 3)).toBe(1);
    expect(eatenShare(KIND.HOLE_GALAXY, 11, 11)).toBe(1);
    expect(eatenShare(KIND.GALAXY_GALAXY, 0, 3)).toBe(0);
    expect(eatenShare(KIND.GALAXY_GALAXY, 3, 3)).toBe(1);
  });

  it('the drag on free matter rises toward the merge', () => {
    const sp = makeSpiral({ kind: KIND.HOLE_GALAXY, turns: 11 });
    const pose = createPose();
    const early = freeDrag(spiralPose(sp, 1, pose), sp.seconds);
    const late = freeDrag(spiralPose(sp, sp.duration - 0.2, pose), sp.seconds);
    expect(late).toBeGreaterThan(early);
  });
});

describe('after-effects', () => {
  it('the feeding flare rises with the turns and decays after the merge', () => {
    expect(feedLevel(KIND.HOLE_GALAXY, 0, 11)).toBe(0);
    expect(feedLevel(KIND.HOLE_GALAXY, 11, 11)).toBe(1);
    expect(feedLevel(KIND.HOLE_HOLE, 5, 5, 4)).toBeCloseTo(Math.exp(-1));
    expect(feedLevel(KIND.GALAXY_GALAXY, 3, 3)).toBe(0);
  });

  it('the merger flash rises, then falls back to 1', () => {
    expect(flashGain(-1)).toBe(1);
    expect(flashGain(0.3)).toBeCloseTo(3);
    expect(flashGain(10)).toBeCloseTo(1, 4);
  });

  it('the ripple moves out and dies away', () => {
    const out = { radius: 0, amp: 0 };
    rippleState(0.5, out);
    const r1 = out.radius;
    const a1 = out.amp;
    rippleState(1.5, out);
    expect(out.radius).toBeGreaterThan(r1);
    expect(out.amp).toBeLessThan(a1);
    expect(rippleState(5, out).amp).toBe(0);
  });

  it('the starburst starts at 1 and ends at 0', () => {
    expect(starburstLevel(0)).toBe(1);
    expect(starburstLevel(10)).toBeLessThan(0.5);
    expect(starburstLevel(40)).toBe(0);
  });
});

describe('consumeResult', () => {
  const holeEntry = (size, radius = 4) => ({ kind: 'blackhole', hole: { size }, look: { radius }, shape: { count: 6000 } });
  const galaxyEntry = (radius, count) => ({ look: { radius }, shape: { count } });

  it('a winning hole grows Rs ×1.2 through hole.size, then through the radius', () => {
    expect(consumeResult(holeEntry(0.03), holeEntry(0.02)).hole.size).toBeCloseTo(0.036);
    const atMax = consumeResult(holeEntry(LIMITS.hole.size.max), galaxyEntry(6, 80000));
    expect(atMax.hole.size).toBe(LIMITS.hole.size.max);
    expect(atMax.look.radius).toBeCloseTo(4 * GROWTH);
  });

  it('a winning galaxy grows ×1.2 and takes the star counts, within the limits', () => {
    const r = consumeResult(galaxyEntry(6, 80000), galaxyEntry(5, 50000));
    expect(r.look.radius).toBeCloseTo(7.2);
    expect(r.shape.count).toBe(130000);
    const big = consumeResult(galaxyEntry(29, 150000), galaxyEntry(5, 150000));
    expect(big.look.radius).toBe(LIMITS.look.radius.max);
    expect(big.shape.count).toBe(MAX_PARTICLES_PER_GALAXY);
  });
});
