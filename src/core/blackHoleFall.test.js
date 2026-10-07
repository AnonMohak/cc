import { describe, it, expect } from 'vitest';
import { createFall, fallPose, fallDistance, fallAngle, ORBIT_TURN, PLUNGE_ANGLE, PLUNGE_START_U } from './blackHoleFall.js';

describe('createFall', () => {
  it('waits, then falls, then holds fallen', () => {
    const fall = createFall({ idleSeconds: 5, fallSeconds: 60 });
    expect(fall.tick(4, true)).toEqual({ phase: 'waiting', u: 0, tau: 4 });
    let r = fall.tick(1, true);
    expect(r.phase).toBe('falling');
    expect(r.u).toBe(0);
    r = fall.tick(30, true);
    expect(r.u).toBeCloseTo(0.5, 6);
    r = fall.tick(30, true);
    expect(r).toEqual({ phase: 'fallen', u: 1, tau: 65 });
    expect(fall.tick(100, true)).toEqual({ phase: 'fallen', u: 1, tau: 65 });
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

  it('takes the same time from any start distance', () => {
    // Progress is time-based; the distance only maps through fallDistance.
    for (const r0 of [4, 18]) {
      const fall = createFall({ idleSeconds: 5, fallSeconds: 60 });
      fall.tick(5, true);
      expect(fall.tick(59.9, true).phase).toBe('falling');
      expect(fall.tick(0.1, true).phase).toBe('fallen');
      expect(fallDistance(r0, 0.15, fallPose(1).distanceT)).toBeCloseTo(0.15, 9);
      expect(fallDistance(r0, 0.15, fallPose(0).distanceT)).toBeCloseTo(r0, 9);
    }
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
    expect(start).toEqual({ distanceT: 0, spin: 1, fovAdd: 0, warp: 0, vignette: 0, black: 0 });
    const end = fallPose(1);
    expect(end.distanceT).toBe(1);
    expect(end.black).toBe(1);
    expect(end.vignette).toBe(1);
    expect(end.warp).toBe(1);
    expect(fallPose(0.5).warp).toBe(0);
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

describe('fallAngle', () => {
  const tPlunge = 5 + PLUNGE_START_U * 60;
  const rate = (t, h = 1e-4) => (fallAngle(t + h) - fallAngle(t - h)) / (2 * h);

  it('starts at rest in the wait, one turn by the plunge, at most a quarter turn more', () => {
    expect(fallAngle(0)).toBe(0);
    expect(rate(1e-3)).toBeLessThan(0.01);
    expect(fallAngle(5)).toBeGreaterThan(0.1); // it already circles in the wait
    expect(fallAngle(tPlunge)).toBeCloseTo(ORBIT_TURN, 9);
    expect(fallAngle(65)).toBeCloseTo(ORBIT_TURN + PLUNGE_ANGLE, 9);
    expect(PLUNGE_ANGLE).toBeLessThanOrEqual(Math.PI / 2);
    expect(fallAngle(999)).toBeCloseTo(fallAngle(65), 9);
  });

  it('always moves forward, with a continuous speed', () => {
    let prev = -1;
    for (let t = 0; t <= 65; t += 0.25) {
      const a = fallAngle(t);
      expect(a).toBeGreaterThan(prev);
      prev = a;
    }
    expect(rate(tPlunge - 1e-3)).toBeCloseTo(rate(tPlunge + 1e-3), 3);
    expect(rate(5 - 1e-3)).toBeCloseTo(rate(5 + 1e-3), 3);
  });
});
