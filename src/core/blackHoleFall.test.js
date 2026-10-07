import { describe, it, expect } from 'vitest';
import { createFall, fallPose, fallDistance, orbitRate, ORBIT_MAX, ORBIT_START } from './blackHoleFall.js';

describe('createFall', () => {
  it('waits, then falls, then holds fallen', () => {
    const fall = createFall({ idleSeconds: 5, fallSeconds: 60 });
    expect(fall.tick(4, true)).toEqual({ phase: 'waiting', u: 0 });
    let r = fall.tick(1, true);
    expect(r.phase).toBe('falling');
    expect(r.u).toBe(0);
    r = fall.tick(30, true);
    expect(r.u).toBeCloseTo(0.5, 6);
    r = fall.tick(30, true);
    expect(r).toEqual({ phase: 'fallen', u: 1 });
    expect(fall.tick(100, true)).toEqual({ phase: 'fallen', u: 1 });
  });

  it('interact cancels a wait and escapes a fall, once', () => {
    const waiting = createFall();
    expect(waiting.interact()).toBe('cancel');
    expect(waiting.phase()).toBe('done');
    expect(waiting.interact()).toBe(null);
    expect(waiting.tick(100, true).phase).toBe('done');

    const falling = createFall({ idleSeconds: 1 });
    falling.tick(2, true);
    expect(falling.interact()).toBe('escape');

    const fallen = createFall({ idleSeconds: 1, fallSeconds: 1 });
    fallen.tick(1, true);
    fallen.tick(2, true);
    expect(fallen.phase()).toBe('fallen');
    expect(fallen.interact()).toBe('escape');
  });

  it('ends for good when the scene stops being eligible', () => {
    const fall = createFall();
    fall.tick(1, true);
    expect(fall.tick(1, false).phase).toBe('done');
    expect(fall.tick(10, true).phase).toBe('done');
  });
});

describe('fallPose', () => {
  it('starts at rest and ends black', () => {
    const start = fallPose(0);
    expect(start).toEqual({ distanceT: 0, spin: 1, fovAdd: 0, shake: 0, vignette: 0, black: 0 });
    const end = fallPose(1);
    expect(end.distanceT).toBe(1);
    expect(end.black).toBe(1);
    expect(end.vignette).toBe(1);
    expect(end.shake).toBe(1);
    expect(fallPose(0.5).black).toBe(0);
  });

  // Perceived speed is relative to the distance (how fast the hole grows on
  // screen), so the step that must grow is the step in log distance.
  it('moves in ever faster', () => {
    let prev = Infinity;
    let prevStep = 0;
    for (let i = 1; i <= 20; i++) {
      const r = fallDistance(40, 1.2, fallPose(i / 20).distanceT);
      expect(r).toBeLessThan(prev);
      if (prev !== Infinity) {
        const step = Math.log(prev / r);
        expect(step).toBeGreaterThan(prevStep);
        prevStep = step;
      }
      prev = r;
    }
    expect(fallDistance(40, 1.2, 1)).toBeCloseTo(1.2, 9);
  });
});

describe('orbitRate', () => {
  it('is Keplerian and capped', () => {
    expect(orbitRate(10, 10)).toBeCloseTo(ORBIT_START, 9);
    expect(orbitRate(2.5, 10)).toBeCloseTo(ORBIT_START * 8, 9);
    expect(orbitRate(0.001, 10)).toBe(ORBIT_MAX);
  });
});
