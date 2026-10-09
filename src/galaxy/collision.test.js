import { describe, it, expect } from 'vitest';
import {
  G_SIM,
  SOFTENING,
  galaxyMass,
  circularSpeed,
  addPlummerAccel,
  spinAxis,
  gasFade,
  indirectAccel,
  packState,
  unpackState,
  accretionSlow,
  STATE,
  bodyPhysics,
  designOrbit,
  createCentres,
  separation,
  warpFactor,
  stepCentres,
  HOLE_MASS,
  localStarPosition,
  initialStarState,
  stepStar,
  starSubsteps,
  simTextureSize,
  collisionBroken,
  MAX_STAR_SUBSTEPS,
} from './collision.js';
import { starPosition } from './densityModel.js';
import { generateGalaxy, KIND } from './generateGalaxy.js';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('collision physics', () => {
  it('scales mass with area and gives a Plummer circular speed', () => {
    expect(galaxyMass(6)).toBeCloseTo(1);
    expect(galaxyMass(12)).toBeCloseTo(4);
    const gm = 2;
    const eps2 = 0.5;
    const a = addPlummerAccel([0, 0, 0], [3, 0, 0], [0, 0, 0], gm, eps2);
    // Centripetal: v²/r equals the pull at r.
    expect(circularSpeed(3, gm, eps2) ** 2 / 3).toBeCloseTo(-a[0]);
    expect(a[1]).toBe(0);
  });

  it('turns about −y for a positive speed (θ from +x toward +z)', () => {
    expect(spinAxis([0, 1, 0], 0.3)).toEqual([-0, -1, -0]);
    expect(spinAxis([0, 1, 0], -0.3)).toEqual([0, 1, 0]);
    expect(spinAxis([0, 1, 0], 0)).toEqual([-0, -1, -0]);
  });

  it('packs the star state with the arm crest', () => {
    for (const state of Object.values(STATE)) {
      for (const c of [0, 0.25, 1]) expect(unpackState(packState(state, c))).toEqual({ state, crest: c });
    }
  });

  it('the indirect term cancels the victim pull on the winner', () => {
    const a = indirectAccel([0, 0, 0], [0, 0, 0], [5, 0, 0], 2, 0.5);
    const pull = addPlummerAccel([0, 0, 0], [0, 0, 0], [5, 0, 0], 2, 0.5);
    for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(-pull[k]);
    // A star at the winner's centre then feels no net pull from the victim.
    const field = { pos: [[0, 0, 0], [5, 0, 0]], gm: [0, 2], eps2: [0.1, 0.5], indirect: a };
    const star = { pos: [0, 0, 0], vel: [0, 0, 0], state: STATE.FREE, spin: 1 };
    stepStar(star, field, 0.1);
    for (let k = 0; k < 3; k++) expect(star.vel[k]).toBeCloseTo(0, 9);
  });

  it('drag pulls free matter in around a black-hole winner, then it accretes and is gone', () => {
    const gm = 200;
    const field = {
      pos: [[0, 0, 0], [1e6, 0, 0]], gm: [gm, 0], eps2: [0.01, 1], drag: 0.3,
      hole: true, normal: [0, 1, 0], accRadius: 2, capture: 0.2, accRate: 0.3, spinMax: 12, settle: 2, timeLeft: 20,
    };
    const r0 = 5;
    const v0 = Math.sqrt(gm / r0);
    // Circular orbit about +y (counter-clockwise seen from +y: L along +y).
    const star = { pos: [r0, 0.3, 0], vel: [0, 0, -v0], state: STATE.FREE, spin: 1 };
    let last = r0;
    let accreted = false;
    for (let i = 0; i < 60 * 40 && star.state !== STATE.GONE; i++) {
      stepStar(star, field, 1 / 60);
      const r = Math.hypot(star.pos[0], star.pos[2]);
      if (star.state === STATE.ACCRETE) {
        if (!accreted) expect(star.spin).toBe(1);
        accreted = true;
        // The accretion spiral never moves out, and settles onto the disc.
        expect(r).toBeLessThanOrEqual(last + 1e-9);
      }
      last = r;
    }
    expect(accreted).toBe(true);
    expect(star.state).toBe(STATE.GONE);
    expect(Math.abs(star.pos[1])).toBeLessThan(0.3);
  });

  it('the accretion deadline: matter reaches the capture radius by timeLeft', () => {
    const field = { pos: [[0, 0, 0], [1e6, 0, 0]], gm: [100, 0], eps2: [0.01, 1], hole: true, normal: [0, 1, 0], accRadius: 3, capture: 0.2, accRate: 0.05, spinMax: 12, settle: 2, timeLeft: 2 };
    const star = { pos: [2.5, 0, 0], vel: [0, 0, 0], state: STATE.ACCRETE, spin: -1 };
    let t = 0;
    while (star.state !== STATE.GONE && t < 30) {
      stepStar(star, field, 1 / 60);
      field.timeLeft = Math.max(0, field.timeLeft - 1 / 60);
      t += 1 / 60;
    }
    // Slower near the horizon, but gone soon after the deadline.
    expect(t).toBeLessThan(6);
    expect(accretionSlow(0.2, 0.2)).toBe(0.15);
    expect(accretionSlow(10, 0.2)).toBe(1);
  });

  it('mirrors the shader star position (disc stars match densityModel)', () => {
    const m = { phase: 3.7, differential: 0.6, patternSpeed: 0.3, arms: 2, winding: 0.55, eccentricity: 0.25, bar: 0 };
    const orbit = new Float32Array([0.6, 1.1, 0.01, KIND.DISC]);
    const out = localStarPosition(orbit, new Float32Array(3), 0, m, [0, 0, 0, 0]);
    const ref = starPosition(0.6, Math.fround(1.1), { arms: 2, winding: 0.55, eMax: 0.25, patternSpeed: 0.3, differential: 0.6 }, 3.7);
    expect(out[0]).toBeCloseTo(ref.r * Math.cos(ref.theta), 5);
    expect(out[2]).toBeCloseTo(ref.r * Math.sin(ref.theta), 5);
    expect(out[1]).toBeCloseTo(0.01);
    expect(out[3]).toBeGreaterThanOrEqual(0);
    expect(out[3]).toBeLessThanOrEqual(1);
    // A cluster star adds its offset.
    const cl = localStarPosition(new Float32Array([0.5, 0, 0.2, KIND.CLUSTER]), new Float32Array([0.01, 0.02, 0.03]), 0, { ...m, phase: 0 }, [0, 0, 0, 0]);
    expect(cl[0]).toBeCloseTo(0.51);
    expect(cl[1]).toBeCloseTo(0.22);
    expect(cl[2]).toBeCloseTo(0.03);
  });

  it('starts stars on stable circular orbits around their galaxy', () => {
    const radius = 6;
    const data = generateGalaxy({ count: 2000 }, 7);
    const m = { phase: 0, differential: 0.6, patternSpeed: 0.3, arms: 2, winding: 0.55, eccentricity: 0.25, bar: 0 };
    // Unit space → world: scale by the radius, centre at (10, 0, 0).
    const matrix = [radius, 0, 0, 0, 0, radius, 0, 0, 0, 0, radius, 0, 10, 0, 0, 1];
    const centre = [10, 0, 0];
    const { position, velocity } = initialStarState({
      orbit: data.orbit, offset: data.positions, count: data.count, size: 2048, motion: m,
      matrix, radius, spin: [0, -1, 0], centre, centreVel: [0, 0, 0],
    });
    expect(position.length).toBe(2048 * 4);
    const gm = G_SIM * galaxyMass(radius);
    const eps2 = (SOFTENING * radius) ** 2;
    const single = { pos: [centre, [1e9, 0, 0]], gm: [gm, 0], eps2: [eps2, 0] };
    const star = { pos: null, vel: null, state: STATE.FREE, spin: 1 };
    let checked = 0;
    for (let i = 0; i < data.count && checked < 50; i++) {
      if (data.orbit[i * 4 + 3] !== KIND.DISC) continue;
      const p = [position[i * 4], position[i * 4 + 1], position[i * 4 + 2]];
      const v = [velocity[i * 4], velocity[i * 4 + 1], velocity[i * 4 + 2]];
      const r0 = Math.hypot(p[0] - 10, p[1], p[2]);
      if (r0 < 0.5) continue;
      // Disc stars turn about −y: (r × v)_y < 0.
      const ly = p[2] * v[0] - (p[0] - 10) * v[2];
      expect(ly).toBeLessThan(1e-6);
      star.pos = p;
      star.vel = v;
      for (let s = 0; s < 600; s++) stepStar(star, single, 1 / 60);
      const r1 = Math.hypot(p[0] - 10, p[1], p[2]);
      expect(Math.abs(r1 - r0) / r0).toBeLessThan(0.08);
      checked++;
    }
    expect(checked).toBe(50);
  });

  it('starts at the analytic position (identity matrix) with the centre velocity added', () => {
    const orbit = new Float32Array([0.5, 0, 0, KIND.DISC]);
    const m = { phase: 0, differential: 0.6, patternSpeed: 0.3, arms: 0, winding: 0.55, eccentricity: 0.25, bar: 0 };
    const { position, velocity } = initialStarState({
      orbit, offset: new Float32Array(3), count: 1, size: 1, motion: m,
      matrix: IDENTITY, radius: 1, spin: [0, -1, 0], centre: [0, 0, 0], centreVel: [1, 2, 3],
    });
    expect(position[0]).toBeCloseTo(0.5);
    expect(unpackState(position[3])).toEqual({ state: STATE.FREE, crest: 0.5 }); // no arms: crest 0.5
    const vc = circularSpeed(0.5, G_SIM * galaxyMass(1), SOFTENING ** 2);
    expect(velocity[0]).toBeCloseTo(1);
    expect(velocity[1]).toBeCloseTo(2);
    expect(velocity[2]).toBeCloseTo(3 + vc); // −y × +x = +z
  });

  it('sizes substeps and textures', () => {
    expect(starSubsteps(0)).toBe(0);
    expect(starSubsteps(1 / 60)).toBe(1);
    expect(starSubsteps(0.1)).toBe(3);
    expect(starSubsteps(10)).toBe(MAX_STAR_SUBSTEPS);
    const { width, height } = simTextureSize(200_000);
    expect(width * height).toBeGreaterThanOrEqual(200_000);
    expect(width * (height - 1)).toBeLessThan(200_000);
  });

  it('breaks on removal or a locked edit, not on colours', () => {
    const a = { id: 'a', seed: 1, shape: {}, structure: {}, motion: {}, look: { radius: 6, tiltX: 0, tiltZ: 0, position: [0, 0, 0], colorInner: '#fff' } };
    const b = { ...a, id: 'b' };
    const prev = [a, b];
    expect(collisionBroken(prev, [a, b], ['a', 'b'])).toBe(false);
    expect(collisionBroken(prev, [a], ['a', 'b'])).toBe(true);
    expect(collisionBroken(prev, [{ ...a, look: { ...a.look, colorInner: '#f00', brightness: 2 } }, b], ['a', 'b'])).toBe(false);
    expect(collisionBroken(prev, [{ ...a, name: 'x' }, b], ['a', 'b'])).toBe(false);
    expect(collisionBroken(prev, [{ ...a, look: { ...a.look, position: [1, 0, 0] } }, b], ['a', 'b'])).toBe(true);
    expect(collisionBroken(prev, [{ ...a, shape: { count: 2 } }, b], ['a', 'b'])).toBe(true);
    expect(collisionBroken(prev, [a, b, { id: 'c' }], ['a', 'b'])).toBe(false);
    // Black holes: a resize breaks it, a new colour or brightness does not.
    const h = { ...a, id: 'h', kind: 'blackhole', hole: { size: 0.03, discSize: 18, brightness: 1, colorHot: '#fff' } };
    expect(collisionBroken([h, b], [{ ...h, hole: { ...h.hole, brightness: 2, colorHot: '#f00' } }, b], ['h', 'b'])).toBe(false);
    expect(collisionBroken([h, b], [{ ...h, hole: { ...h.hole, size: 0.04 } }, b], ['h', 'b'])).toBe(true);
    expect(collisionBroken([h, b], [{ ...h, hole: { ...h.hole, discSize: 20 } }, b], ['h', 'b'])).toBe(true);
  });
});

describe('opening pass (free physics)', () => {
  const body = (radius) => bodyPhysics({ hole: false, radius });
  function run(input, seconds) {
    const orbit = designOrbit(input);
    const s = createCentres({ ...input, ...orbit });
    let minSep = Infinity;
    for (let t = 0; t < seconds; t += 1 / 60) {
      stepCentres(s, (1 / 60) * warpFactor(s));
      minSep = Math.min(minSep, separation(s));
    }
    return { s, minSep };
  }

  it('gives black holes a mass by Rs (a default hole = 4 default galaxies) and a disc-sized softening', () => {
    expect(body(6).mass).toBeCloseTo(1);
    const h = bodyPhysics({ hole: true, radius: 4, rs: 0.12, discOuter: 2.16 });
    expect(h.mass).toBeCloseTo(HOLE_MASS);
    expect(h.eps2).toBeCloseTo(1.08 ** 2);
    expect(bodyPhysics({ hole: true, radius: 4, rs: 0.06, discOuter: 1.08 }).mass).toBeCloseTo(HOLE_MASS / 2);
  });

  it('designs an orbit with zero total momentum, prograde for A', () => {
    const input = { posA: [0, 0, 0], posB: [40, 0, 0], a: body(6), b: body(6), spinA: [0, -1, 0], pass: 1, speed: 1 };
    const { velA, velB } = designOrbit(input);
    for (let k = 0; k < 3; k++) expect(velA[k] + velB[k]).toBeCloseTo(0, 10);
    const rel = [0, 1, 2].map((k) => velB[k] - velA[k]);
    expect(-40 * rel[2]).toBeLessThan(0); // L along −y
    expect(rel[0]).toBeLessThan(0); // approaching
  });

  it('keeps the barycentre, captures a slow close pass and lets a fast wide one fly by', () => {
    const base = { posA: [0, 0, 0], posB: [30, 0, 0], a: body(6), b: body(6), spinA: [0, -1, 0] };
    const slow = run({ ...base, pass: 0.8, speed: 0.9 }, 60);
    expect(separation(slow.s)).toBeLessThan(1.5);
    for (let k = 0; k < 3; k++) expect(slow.s.pos[0][k] + slow.s.pos[1][k]).toBeCloseTo(30 * (k === 0 ? 1 : 0), 4);
    const fast = run({ ...base, pass: 1.5, speed: 2 }, 60);
    expect(separation(fast.s)).toBeGreaterThan(60);
  });

  it('fast-forwards the approach only while far apart', () => {
    const far = createCentres({ posA: [0, 0, 0], posB: [80, 0, 0], velA: [0, 0, 0], velB: [0, 0, 0], a: body(6), b: body(6) });
    expect(warpFactor(far)).toBeGreaterThan(5);
    const near = createCentres({ posA: [0, 0, 0], posB: [15, 0, 0], velA: [0, 0, 0], velB: [0, 0, 0], a: body(6), b: body(6) });
    stepCentres(near, 0.01);
    expect(near.interacting).toBe(true);
    expect(warpFactor(near)).toBe(1);
    expect(near.disruption[0]).toBeGreaterThan(0);
  });

  it('a slowing winner takes its stars along (indirect term with its own acceleration)', () => {
    const winnerAcc = [-0.5, 0, 0];
    const ind = indirectAccel([0, 0, 0], [0, 0, 0], [1e6, 0, 0], 0, 1, winnerAcc);
    expect(ind).toEqual([-0.5, 0, 0]);
    // The drag works relative to the winner's velocity: a star moving with it feels none.
    const field = { pos: [[0, 0, 0], [1e6, 0, 0]], gm: [0, 0], eps2: [1, 1], drag: 1, winnerVel: [2, 0, 0] };
    const star = { pos: [5, 0, 0], vel: [2, 0, 0], state: STATE.FREE, spin: 1 };
    stepStar(star, field, 0.1);
    expect(star.vel[0]).toBeCloseTo(2, 9);
  });
});

describe('opening pass without friction', () => {
  it('passes at about the asked distance and moves apart again', () => {
    const a = bodyPhysics({ hole: false, radius: 6 });
    const input = { posA: [0, 0, 0], posB: [30, 0, 0], a, b: a, spinA: [0, -1, 0], pass: 1.2, speed: 1 };
    const s = createCentres({ ...input, ...designOrbit(input), friction: false });
    let min = Infinity;
    for (let t = 0; t < 120; t += 1 / 60) {
      stepCentres(s, (1 / 60) * warpFactor(s));
      min = Math.min(min, separation(s));
    }
    expect(min).toBeGreaterThan(0.6 * 1.2 * 6);
    expect(separation(s)).toBeGreaterThan(2 * min);
  });
});

describe('infall pull', () => {
  it('turns a star flying away from a hole winner back toward it', () => {
    const field = { pos: [[0, 0, 0], [1e6, 0, 0]], gm: [0, 0], eps2: [1, 1], hole: true, normal: [0, 1, 0], accRadius: 1, capture: 0.1, accRate: 0.2, spinMax: 12, settle: 2, timeLeft: 100, infall: 1 };
    const star = { pos: [50, 0, 0], vel: [5, 0, 0], state: STATE.FREE, spin: 1 };
    let maxR = 0;
    for (let i = 0; i < 60 * 30; i++) {
      stepStar(star, field, 1 / 60);
      maxR = Math.max(maxR, star.pos[0]);
    }
    expect(maxR).toBeLessThan(70);
    expect(star.vel[0] < 0 || star.state !== STATE.FREE).toBe(true);
  });
});
