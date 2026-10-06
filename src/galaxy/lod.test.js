import { describe, it, expect } from 'vitest';
import { screenFootprint, adaptiveSteps, starLod } from './lod.js';

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

describe('starLod', () => {
  it('keeps every star when the galaxy is big on screen or inside it', () => {
    expect(starLod(80_000, { radiusPx: 200 })).toEqual({ count: 80_000, gain: 1 });
    expect(starLod(80_000, { radiusPx: Infinity })).toEqual({ count: 80_000, gain: 1 });
  });

  it('draws fewer stars far away and keeps the total light', () => {
    const lod = starLod(80_000, { radiusPx: 40 });
    expect(lod.count).toBeLessThan(80_000);
    expect(lod.count * lod.gain).toBeCloseTo(80_000, -1);
  });

  it('never drops below the minimum or above the gain cap', () => {
    const tiny = starLod(80_000, { radiusPx: 2 });
    expect(tiny.count).toBe(3000);
    expect(tiny.gain).toBe(8);
    expect(starLod(2000, { radiusPx: 2 })).toEqual({ count: 2000, gain: 1 });
  });

  it('changes the count only in coarse steps', () => {
    expect(starLod(80_000, { radiusPx: 40 }).count).toBe(starLod(80_000, { radiusPx: 40.05 }).count);
  });
});
