import { describe, it, expect } from 'vitest';
import { screenFootprint, adaptiveSteps } from './lod.js';

describe('screenFootprint', () => {
  it('shrinks with distance and covers the screen when the camera is inside', () => {
    const near = screenFootprint(6, 15, 55, 1280, 800);
    const far = screenFootprint(6, 150, 55, 1280, 800);
    expect(near.radiusPx).toBeGreaterThan(far.radiusPx * 5);
    expect(near.coverage).toBeGreaterThan(far.coverage);
    expect(screenFootprint(6, 3, 55, 1280, 800)).toEqual({ radiusPx: Infinity, coverage: 1 });
  });
});

describe('adaptiveSteps', () => {
  it('keeps the full budget for a normal view', () => {
    expect(adaptiveSteps(44, { radiusPx: 300, coverage: 0.3 })).toBe(44);
  });

  it('cuts steps when the galaxy fills the screen', () => {
    expect(adaptiveSteps(44, { radiusPx: Infinity, coverage: 1 })).toBeLessThan(30);
  });

  it('cuts steps for tiny distant galaxies, never below the minimum', () => {
    expect(adaptiveSteps(44, { radiusPx: 20, coverage: 0.001 })).toBeLessThan(25);
    expect(adaptiveSteps(10, { radiusPx: 1, coverage: 0 })).toBe(6);
  });
});
