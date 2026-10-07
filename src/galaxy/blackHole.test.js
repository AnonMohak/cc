import { describe, it, expect } from 'vitest';
import { deflection, shadowPixels, lensFade, pickLenses, SHADOW_B, MAX_DEFLECTION } from './blackHole.js';

describe('deflection', () => {
  it('matches the weak-field limit 2Rs/b far away', () => {
    expect(deflection(1000)).toBeCloseTo(2 / 1000, 5);
  });
  it('decreases with b and is capped near the photon sphere', () => {
    let prev = Infinity;
    for (let b = SHADOW_B + 0.01; b < 40; b += 0.25) {
      const a = deflection(b);
      expect(a).toBeLessThanOrEqual(prev);
      expect(a).toBeGreaterThan(0);
      prev = a;
    }
    expect(deflection(SHADOW_B + 1e-6)).toBe(MAX_DEFLECTION);
    expect(deflection(1)).toBe(MAX_DEFLECTION);
  });
});

describe('shadowPixels / lensFade', () => {
  it('scales with size over distance', () => {
    const px = shadowPixels(0.01, 1, 0.5, 800);
    expect(px).toBeCloseTo(((SHADOW_B * 0.01) / 0.5) * 400, 6);
    expect(shadowPixels(0.01, 2, 0.5, 800)).toBeCloseTo(px / 2, 6);
    expect(shadowPixels(0.01, 0, 0.5, 800)).toBe(0);
  });
  it('fades in from 2 px to 4 px', () => {
    expect(lensFade(1.5)).toBe(0);
    expect(lensFade(4)).toBe(1);
    expect(lensFade(3)).toBeGreaterThan(0);
    expect(lensFade(3)).toBeLessThan(1);
  });
});

describe('pickLenses', () => {
  const c = (shadowPx, visible = true) => ({ shadowPx, visible });
  it('keeps the largest visible lenses, sorted, without allocating', () => {
    const list = [c(1), c(10), c(0.2), c(50, false), c(7), c(5), c(20)];
    const out = new Array(4);
    const n = pickLenses(list, list.length, 4, out);
    expect(n).toBe(4);
    expect(out.slice(0, n).map((x) => x.shadowPx)).toEqual([20, 10, 7, 5]);
  });
  it('respects count and returns 0 when nothing is resolved', () => {
    const out = new Array(4);
    expect(pickLenses([c(9), c(8)], 1, 4, out)).toBe(1);
    expect(out[0].shadowPx).toBe(9);
    expect(pickLenses([c(0.1), c(9, false)], 2, 4, out)).toBe(0);
  });
});
