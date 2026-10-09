import { describe, it, expect } from 'vitest';
import { consumeDistance, raiseDirection, easeValue, MIN_ELEVATION_DEG } from './consumeCamera.js';

describe('consumeCamera', () => {
  it('moves from the pair view to the end view as the victim closes in', () => {
    expect(consumeDistance(100, 20, 50, 50)).toBe(100);
    expect(consumeDistance(100, 20, 0, 50)).toBe(20);
    const mid = consumeDistance(100, 20, 25, 50);
    expect(mid).toBeLessThan(100);
    expect(mid).toBeGreaterThan(20);
    // Farther than the start (the approach) keeps the start view.
    expect(consumeDistance(100, 20, 80, 50)).toBe(100);
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
