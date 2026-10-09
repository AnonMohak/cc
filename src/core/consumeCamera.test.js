import { describe, it, expect } from 'vitest';
import { frameRadius, framingDistance, orbitViewTan, raiseDirection, easeValue, createSpring, springTo, MIN_ELEVATION_DEG, FILL } from './consumeCamera.js';

describe('consumeCamera', () => {
  it('frames the pair in the opening pass, then the shrinking orbit, down to the winner', () => {
    const base = { winnerRadius: 6, victimRadius: 5, winnerHole: false, winnerDisc: 0 };
    const pass = frameRadius({ ...base, stage: 'pass', distance: 30, progress: 0 });
    expect(pass).toBeCloseTo(15 + 0.6 * 6);
    const early = frameRadius({ ...base, stage: 'spiral', distance: 10, progress: 0.1 });
    const late = frameRadius({ ...base, stage: 'spiral', distance: 2, progress: 0.9 });
    expect(late).toBeLessThan(early);
    expect(frameRadius({ ...base, stage: 'fade', distance: 0.1, progress: 1 })).toBeCloseTo(0.9 * 6);
    const hole = frameRadius({ winnerRadius: 4, victimRadius: 4, winnerHole: true, winnerDisc: 2.16, stage: 'drain', distance: 0.2, progress: 1 });
    expect(hole).toBeCloseTo(1.2 * 2.16);
  });

  it('fits a flat orbit by the screen width, a face-on one by the height', () => {
    // Low view on a wide screen: the orbit is flat, the width limits.
    expect(orbitViewTan(0.5, 16 / 9, Math.sin(0.3))).toBeCloseTo(0.5 * 16 / 9);
    // Face-on: a round orbit, the height limits.
    expect(orbitViewTan(0.5, 16 / 9, 1)).toBeCloseTo(0.5);
    // A portrait phone: the width limits.
    expect(orbitViewTan(0.5, 0.5, 0.3)).toBeCloseTo(0.25);
  });

  it('fits the radius in the view', () => {
    expect(framingDistance(10, 0.5, 1)).toBe(20);
    expect(framingDistance(10, 0.5)).toBeCloseTo(20 / FILL);
  });

  it('raises a low view to the minimum elevation on the same side, and keeps a high one', () => {
    const n = [0, 1, 0];
    const low = raiseDirection([1, -0.01, 0].map((x) => x / Math.hypot(1, 0.01)), n, MIN_ELEVATION_DEG, [0, 0, 0]);
    expect(Math.hypot(...low)).toBeCloseTo(1);
    expect(low[1]).toBeCloseTo(-Math.sin((MIN_ELEVATION_DEG * Math.PI) / 180));
    expect(low[0]).toBeGreaterThan(0);
    const high = raiseDirection([0, 0.8, 0.6], n, MIN_ELEVATION_DEG, [0, 0, 0]);
    expect(high).toEqual([0, 0.8, 0.6]);
  });

  it('the spring starts from rest, speeds up gently, settles without overshoot, at any frame rate', () => {
    const a = createSpring(0);
    const speeds = [];
    for (let i = 0; i < 60 * 20; i++) {
      springTo(a, 10, 0.5, 1 / 60);
      speeds.push(a.v);
      expect(a.x).toBeLessThanOrEqual(10 + 1e-9);
    }
    // Soft start: the first frame barely moves, the speed then rises.
    expect(speeds[0]).toBeLessThan(speeds[60]);
    expect(a.x).toBeCloseTo(10, 2);
    const b = createSpring(0);
    for (let i = 0; i < 60 * 3; i++) springTo(b, 10, 0.5, 1 / 60);
    const c = createSpring(0);
    for (let i = 0; i < 30 * 3; i++) springTo(c, 10, 0.5, 1 / 30);
    expect(b.x).toBeCloseTo(c.x, 9);
    expect(b.v).toBeCloseTo(c.v, 9);
  });

  it('eases at any frame rate to the same place', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = easeValue(a, 10, 2, 1 / 60);
    let b = 0;
    for (let i = 0; i < 30; i++) b = easeValue(b, 10, 2, 1 / 30);
    expect(a).toBeCloseTo(b, 9);
  });
});
