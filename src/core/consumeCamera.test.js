import { describe, it, expect } from 'vitest';
import { frameRadius, framingDistance, raiseDirection, easeValue, MIN_ELEVATION_DEG, FILL } from './consumeCamera.js';

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

  it('eases at any frame rate to the same place', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = easeValue(a, 10, 2, 1 / 60);
    let b = 0;
    for (let i = 0; i < 30; i++) b = easeValue(b, 10, 2, 1 / 30);
    expect(a).toBeCloseTo(b, 9);
  });
});
