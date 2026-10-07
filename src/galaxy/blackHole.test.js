import { describe, it, expect } from 'vitest';
import { deflection, traceRay, marchScaleFor, MARCH_SCALE_MIN, MARCH_SCALE_MAX, shadowPixels, lensFade, pickLenses, SHADOW_B, MAX_DEFLECTION, DISC_OUTER, MARCH_SPHERE_K } from './blackHole.js';

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

describe('traceRay', () => {
  // Total bending of a ray from far away (0..2π, so loops count).
  const bend = (b) => {
    const r = traceRay([-400, b, 0], [1, 0, 0], { maxSteps: 4000, escapeRadius: 400 });
    let a = Math.atan2(-r.dir[1], r.dir[0]);
    if (a < 0) a += 2 * Math.PI;
    return { ...r, bend: a };
  };

  it('captures rays inside the shadow and lets the rest escape', () => {
    expect(bend(2.5).captured).toBe(true);
    expect(bend(SHADOW_B - 0.05).captured).toBe(true);
    expect(bend(2.7).escaped).toBe(true);
    expect(bend(8).escaped).toBe(true);
  });

  it('matches the exact Schwarzschild deflection', () => {
    // Exact values from the deflection integral (Rs = 1).
    expect(bend(3.5).bend).toBeCloseTo(1.128, 2);
    expect(bend(5).bend).toBeCloseTo(0.59, 2);
    expect(bend(10).bend).toBeCloseTo(0.236, 2);
    expect(bend(20).bend).toBeCloseTo(0.108, 2);
  });

  it('loops near the critical ray (the secondary images)', () => {
    expect(bend(2.65).bend).toBeGreaterThan(Math.PI);
  });

  it('crosses the march sphere in few steps', () => {
    const R = DISC_OUTER * MARCH_SPHERE_K;
    for (const b of [3, 6, 12, 20]) {
      const r = traceRay([-Math.sqrt(R * R - b * b), b, 0], [1, 0, 0], { maxSteps: 64, escapeRadius: R });
      expect(r.escaped).toBe(true);
      expect(r.steps).toBeLessThan(64);
    }
  });
});

describe('marchScaleFor', () => {
  it('gives small holes more resolution, in 0.1 steps', () => {
    expect(marchScaleFor(1)).toBe(MARCH_SCALE_MIN);
    expect(marchScaleFor(0.5)).toBe(0.5);
    expect(marchScaleFor(0.3)).toBe(0.7);
    expect(marchScaleFor(0.01)).toBe(MARCH_SCALE_MAX);
    for (let c = 0.02; c <= 1; c += 0.07) {
      const s = marchScaleFor(c);
      expect(Math.round(s * 10) / 10).toBe(s);
      // Same budget or less: covered march pixels never exceed a full screen at the minimum scale.
      expect(c * s * s).toBeLessThanOrEqual(MARCH_SCALE_MIN * MARCH_SCALE_MIN + 1e-9);
    }
  });
});

describe('warpedReach', () => {
  it('is LENS_REACH without warp and grows with it, clamped', async () => {
    const { warpedReach, LENS_REACH, WARP_REACH } = await import('./blackHole.js');
    expect(warpedReach(0)).toBe(LENS_REACH);
    expect(warpedReach(1)).toBeCloseTo(LENS_REACH * (1 + WARP_REACH), 9);
    expect(warpedReach(0.5)).toBeGreaterThan(LENS_REACH);
    expect(warpedReach(5)).toBe(warpedReach(1));
    expect(warpedReach(-1)).toBe(LENS_REACH);
  });
});
