import { describe, it, expect } from 'vitest';
import {
  G_SIM,
  SOFTENING,
  galaxyMass,
  circularSpeed,
  addPlummerAccel,
  spinAxis,
  designOrbit,
  createCentres,
  separation,
  warpFactor,
  stepCentres,
  gasFade,
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

function run(input, seconds) {
  const orbit = designOrbit(input);
  const s = createCentres({ ...input, ...orbit });
  const dt = 1 / 60;
  let minSep = Infinity;
  for (let t = 0; t < seconds; t += dt) {
    stepCentres(s, dt * warpFactor(s));
    minSep = Math.min(minSep, separation(s));
  }
  return { s, minSep };
}

function momentum(s) {
  return [0, 1, 2].map((k) => s.mass[0] * s.vel[0][k] + s.mass[1] * s.vel[1][k]);
}

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

  it('designs an orbit with zero total momentum and the asked pericentre', () => {
    const input = { posA: [0, 0, 0], posB: [60, 0, 10], radiusA: 6, radiusB: 4, spinA: [0, -1, 0], pass: 1.5, speed: 1.8 };
    const { velA, velB } = designOrbit(input);
    const mA = galaxyMass(6);
    const mB = galaxyMass(4);
    for (let k = 0; k < 3; k++) expect(mA * velA[k] + mB * velB[k]).toBeCloseTo(0, 10);
    // Fast and wide: little friction, so the closest approach is near the design.
    const { minSep } = run(input, 40);
    expect(minSep).toBeGreaterThan(0.8 * 1.5 * 5);
    expect(minSep).toBeLessThan(1.3 * 1.5 * 5);
  });

  it('orbits in the sense of galaxy A’s spin', () => {
    const input = { posA: [0, 0, 0], posB: [40, 0, 0], radiusA: 6, radiusB: 6, spinA: [0, -1, 0], pass: 1, speed: 1 };
    const { velA, velB } = designOrbit(input);
    const rel = [0, 1, 2].map((k) => velB[k] - velA[k]);
    // L = r × v points along the spin axis (−y): (r × v)_y = r_z v_x − r_x v_z.
    const Ly = 0 * rel[0] - 40 * rel[2];
    expect(Ly).toBeLessThan(0);
    expect(rel[0]).toBeLessThan(0); // approaching
  });

  it('keeps momentum, and the barycentre stays put', () => {
    const input = { posA: [0, 0, 0], posB: [30, 5, 0], radiusA: 8, radiusB: 5, spinA: [0, -1, 0], pass: 0.8, speed: 0.9 };
    const { s } = run(input, 30);
    for (const p of momentum(s)) expect(p).toBeCloseTo(0, 6);
    const M = s.mass[0] + s.mass[1];
    const bary = [0, 1, 2].map((k) => (s.mass[0] * s.pos[0][k] + s.mass[1] * s.pos[1][k]) / M);
    const start = [0, 1, 2].map((k) => (s.mass[0] * input.posA[k] + s.mass[1] * input.posB[k]) / M);
    for (let k = 0; k < 3; k++) expect(bary[k]).toBeCloseTo(start[k], 4);
  });

  it('merges a slow close pass and lets a fast wide pass fly by', () => {
    const base = { posA: [0, 0, 0], posB: [30, 0, 0], radiusA: 6, radiusB: 6, spinA: [0, -1, 0] };
    const slow = run({ ...base, pass: 0.8, speed: 0.9 }, 60).s;
    expect(separation(slow)).toBeLessThan(1.5);
    const fast = run({ ...base, pass: 1.5, speed: 2 }, 60).s;
    expect(separation(fast)).toBeGreaterThan(60);
  });

  it('fast-forwards the approach only while far apart', () => {
    const far = createCentres({ posA: [0, 0, 0], posB: [80, 0, 0], velA: [0, 0, 0], velB: [0, 0, 0], radiusA: 6, radiusB: 6 });
    expect(warpFactor(far)).toBeGreaterThan(5);
    const near = createCentres({ posA: [0, 0, 0], posB: [15, 0, 0], velA: [0, 0, 0], velB: [0, 0, 0], radiusA: 6, radiusB: 6 });
    expect(warpFactor(near)).toBe(1);
    stepCentres(near, 0.01);
    expect(near.interacting).toBe(true);
    // Once interacting, never warped again (the stars run in real time).
    near.pos[1][0] = 200;
    expect(warpFactor(near)).toBe(1);
  });

  it('disrupts gas only near the partner, monotonic and capped', () => {
    const s = createCentres({ posA: [0, 0, 0], posB: [100, 0, 0], velA: [0, 0, 0], velB: [0, 0, 0], radiusA: 6, radiusB: 6 });
    stepCentres(s, 1);
    expect(s.disruption[0]).toBeLessThan(0.001);
    const close = createCentres({ posA: [0, 0, 0], posB: [3, 0, 0], velA: [0, 0, 0], velB: [0, 0, 0], radiusA: 6, radiusB: 2 });
    stepCentres(close, 2);
    // The small galaxy suffers more.
    expect(close.disruption[1]).toBeGreaterThan(close.disruption[0]);
    stepCentres(close, 60);
    expect(close.disruption[1]).toBe(1);
    expect(gasFade(0)).toBe(1);
    expect(gasFade(1)).toBe(0);
    expect(gasFade(0.5)).toBeCloseTo(0.5);
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
      for (let s = 0; s < 600; s++) stepStar(p, v, single, 1 / 60);
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
    expect(position[3]).toBe(0.5); // no arms: crest 0.5
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
  });
});
