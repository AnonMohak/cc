import { describe, it, expect } from 'vitest';
import {
  KIND,
  pickWinner,
  consumeKind,
  turnsFor,
  orbitRadii,
  designPath,
  pathPose,
  createPose,
  orbitGm,
  timeLapse,
  victimHoleScale,
  winnerGrowth,
  releaseRadius,
  releasedShare,
  freeDrag,
  feedLevel,
  flashGain,
  rippleState,
  starburstLevel,
  consumeResult,
  GROWTH,
  INSPIRAL_SECONDS,
  APPROACH_MIN,
  APPROACH_MAX,
  MAX_TIME_LAPSE,
} from './consumption.js';
import { LIMITS, MAX_PARTICLES_PER_GALAXY } from './params.js';

const hole = (id, rs, radius = 4) => ({ id, hole: true, rs, radius });
const galaxy = (id, radius) => ({ id, hole: false, radius });

function makePath(kind = KIND.HOLE_HOLE, overrides = {}) {
  const turns = overrides.turns ?? 5;
  return designPath({
    kind,
    winnerPos: [0, 0, 0],
    victimPos: [20, 3, 0],
    normal: [0, 1, 0],
    spin: [0, -1, 0],
    r0: 4,
    rEnd: 0.24,
    turns,
    seconds: INSPIRAL_SECONDS[kind],
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

describe('turnsFor', () => {
  it('5 for two holes, 3 for two galaxies, 10–12 for a hole eating a galaxy', () => {
    expect(turnsFor(KIND.HOLE_HOLE, 4)).toBe(5);
    expect(turnsFor(KIND.GALAXY_GALAXY, 6)).toBe(3);
    expect(turnsFor(KIND.HOLE_GALAXY, 1)).toBe(10);
    expect(turnsFor(KIND.HOLE_GALAXY, 6)).toBe(11);
    expect(turnsFor(KIND.HOLE_GALAXY, 30)).toBe(12);
  });
});

describe('orbitRadii', () => {
  it('starts outside the winner and ends near its centre', () => {
    const w = { radius: 4, rs: 0.12, discOuter: 2.16 };
    const hh = orbitRadii(KIND.HOLE_HOLE, w, { radius: 4 });
    expect(hh.r0).toBeCloseTo(3.24);
    expect(hh.rEnd).toBeCloseTo(0.24);
    const hg = orbitRadii(KIND.HOLE_GALAXY, w, { radius: 6 });
    expect(hg.r0).toBeCloseTo(8.16);
    const gg = orbitRadii(KIND.GALAXY_GALAXY, { radius: 6 }, { radius: 6 });
    expect(gg.r0).toBeCloseTo(10.8);
    expect(gg.rEnd).toBeLessThan(gg.r0 * 0.05);
  });
});

describe('pathPose', () => {
  it('starts at rest at the victim and joins the inspiral smoothly', () => {
    const path = makePath();
    const pose = createPose();
    pathPose(path, 0, pose);
    expect(pose.pos).toEqual([20, 3, 0]);
    expect(Math.hypot(...pose.vel)).toBeCloseTo(0, 9);
    expect(path.approach).toBeGreaterThanOrEqual(APPROACH_MIN);
    expect(path.approach).toBeLessThanOrEqual(APPROACH_MAX);
    const before = pathPose(path, path.approach - 1e-6, createPose());
    const after = pathPose(path, path.approach + 1e-6, createPose());
    for (let k = 0; k < 3; k++) {
      expect(after.pos[k]).toBeCloseTo(before.pos[k], 4);
      expect(after.vel[k]).toBeCloseTo(before.vel[k], 3);
    }
    expect(after.stage).toBe('inspiral');
    expect(after.radius).toBeCloseTo(path.r0, 4);
  });

  it('enters in the winner disc plane and turns prograde', () => {
    const path = makePath();
    const pose = pathPose(path, path.approach + 0.1, createPose());
    // Disc plane y = 0 (no tilt for two holes); spin −y turns +x toward +z.
    expect(Math.abs(pose.pos[1])).toBeLessThan(1e-9);
    expect(pose.vel[2]).toBeGreaterThan(0);
  });

  it('makes exactly the given turns by the merge, each one smaller and faster', () => {
    for (const [kind, turns] of [[KIND.HOLE_HOLE, 5], [KIND.HOLE_GALAXY, 11], [KIND.GALAXY_GALAXY, 3]]) {
      const path = makePath(kind, { turns });
      const pose = createPose();
      pathPose(path, path.duration + 0.01, pose);
      expect(pose.stage).toBe('merged');
      expect(pose.turnsDone).toBeCloseTo(turns, 9);
      expect(pose.progress).toBe(1);
      expect(pose.radius).toBeCloseTo(path.rEnd, 6);
      // Turn durations shrink.
      const times = [];
      let last = 0;
      for (let t = path.approach; t <= path.duration; t += 0.001) {
        const turn = Math.floor(pathPose(path, t, pose).turnsDone);
        if (turn > last) {
          times.push(t);
          last = turn;
        }
      }
      const lengths = times.map((t, i) => t - (i === 0 ? path.approach : times[i - 1]));
      for (let i = 1; i < lengths.length; i++) expect(lengths[i]).toBeLessThan(lengths[i - 1]);
    }
  });

  it('two holes: 5 turns in about 8 s, the first ~2.4 s and the last under 1 s', () => {
    const path = makePath();
    const pose = createPose();
    let first = null;
    for (let t = path.approach; t < path.duration; t += 0.001) {
      if (pathPose(path, t, pose).turnsDone >= 1) {
        first = t - path.approach;
        break;
      }
    }
    expect(first).toBeGreaterThan(2.2);
    expect(first).toBeLessThan(2.6);
    let last = null;
    for (let t = path.duration; t > path.approach; t -= 0.001) {
      if (pathPose(path, t, pose).turnsDone <= 4) {
        last = path.duration - t;
        break;
      }
    }
    expect(last).toBeLessThan(1);
    expect(path.duration - path.approach).toBeCloseTo(8, 1);
  });

  it('is a Kepler orbit: v² r stays G·M along the inspiral', () => {
    const path = makePath();
    const gm = orbitGm(path);
    const pose = createPose();
    for (const tau of [0.05, 0.3, 0.6, 0.9]) {
      pathPose(path, path.approach + tau * path.seconds, pose);
      const v2 = pose.vel[0] ** 2 + pose.vel[1] ** 2 + pose.vel[2] ** 2;
      const vr = (pose.vel[0] * pose.pos[0] + pose.vel[1] * pose.pos[1] + pose.vel[2] * pose.pos[2]) / pose.radius;
      // Tangential part only (the radial drift is tiny).
      expect(((v2 - vr * vr) * pose.radius) / gm).toBeCloseTo(1, 2);
    }
  });

  it('is the same at any frame rate (closed form)', () => {
    const path = makePath();
    const a = pathPose(path, 5.123, createPose());
    const b = pathPose(path, 5.123, createPose());
    expect(a).toEqual(b);
  });
});

describe('timeLapse', () => {
  it('speeds two default galaxies up by about ×5 and stays within limits', () => {
    const path = makePath(KIND.GALAXY_GALAXY, { turns: 3, r0: 10.8, rEnd: 0.12 });
    const w = timeLapse(path.r0, path.omega0, 6, 6);
    expect(w).toBeGreaterThan(3.5);
    expect(w).toBeLessThan(7);
    expect(timeLapse(path.r0, path.omega0 * 100, 6, 6)).toBe(MAX_TIME_LAPSE);
    expect(timeLapse(path.r0, 1e-6, 6, 6)).toBe(1);
  });
});

describe('victim and winner sizes', () => {
  it('the victim hole loses 1/turns of its start size per turn and the winner grows to ×GROWTH', () => {
    expect(victimHoleScale(0, 5)).toBe(1);
    expect(victimHoleScale(1, 5)).toBeCloseTo(0.8);
    expect(victimHoleScale(3, 5)).toBeCloseTo(0.4);
    expect(victimHoleScale(5, 5)).toBe(0);
    expect(winnerGrowth(0)).toBe(1);
    expect(winnerGrowth(1)).toBeCloseTo(GROWTH);
  });
});

describe('release', () => {
  it('frees the outer stars first and every star by the end of the span', () => {
    expect(releaseRadius(KIND.HOLE_GALAXY, 0)).toBeGreaterThan(1.4);
    const r1 = releaseRadius(KIND.HOLE_GALAXY, 1);
    const r2 = releaseRadius(KIND.HOLE_GALAXY, 2);
    expect(r2).toBeLessThan(r1);
    expect(releaseRadius(KIND.HOLE_GALAXY, 4)).toBe(0);
    expect(releaseRadius(KIND.HOLE_HOLE, 3.5)).toBe(0);
    expect(releaseRadius(KIND.GALAXY_GALAXY, 0)).toBe(0);
    expect(releasedShare(KIND.HOLE_GALAXY, 0)).toBe(0);
    expect(releasedShare(KIND.HOLE_GALAXY, 4)).toBe(1);
  });

  it('the drag on free matter rises toward the merge', () => {
    const path = makePath(KIND.HOLE_GALAXY, { turns: 11 });
    const pose = createPose();
    const early = freeDrag(pathPose(path, path.approach + 1, pose), path.seconds);
    const late = freeDrag(pathPose(path, path.duration - 0.2, pose), path.seconds);
    expect(late).toBeGreaterThan(early);
    expect(freeDrag(pathPose(path, 0, pose), path.seconds)).toBe(0);
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
