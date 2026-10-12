import { describe, it, expect } from 'vitest';
import { deflection, traceRay, lensScreenRect, marchScaleFor, MARCH_SCALE_MIN, MARCH_SCALE_MAX, shadowPixels, lensFade, pickLenses, lensOrder, SHADOW_B, MAX_DEFLECTION, DISC_OUTER, MARCH_SPHERE_K } from './blackHole.js';

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

describe('marchDiscRadius', () => {
  it('puts the inner edge at MARCH_INNER, leaves the outer disc alone and never folds', async () => {
    const { marchDiscRadius, MARCH_INNER, MARCH_BLEND, DISC_INNER, PHOTON_SPHERE } = await import('./blackHole.js');
    expect(MARCH_INNER).toBeGreaterThan(PHOTON_SPHERE);
    expect(marchDiscRadius(MARCH_INNER)).toBeCloseTo(DISC_INNER, 9);
    expect(marchDiscRadius(MARCH_BLEND)).toBe(MARCH_BLEND);
    expect(marchDiscRadius(12)).toBe(12);
    let prev = -Infinity;
    for (let r = MARCH_INNER; r <= MARCH_BLEND + 1; r += 0.01) {
      const m = marchDiscRadius(r);
      expect(m).toBeGreaterThan(prev);
      prev = m;
    }
  });
});

describe('lensOrder', () => {
  it('puts the lenses nearest first', () => {
    const out = [9, 9, 9, 9];
    expect(lensOrder([30, 10, 20], 3, out).slice(0, 3)).toEqual([1, 2, 0]);
    expect(lensOrder([5], 1, out)[0]).toBe(0);
    expect(lensOrder([7, 7], 2, out).slice(0, 2)).toEqual([0, 1]);
  });
});

describe('lensScreenRect', () => {
  const tanX = 0.7;
  const tanY = 0.4;
  // Brute force: the uv bounds of the screen rays that pass within `radius`.
  function bruteRect(c, radius) {
    let x0 = 1;
    let y0 = 1;
    let x1 = 0;
    let y1 = 0;
    const N = 400;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const u = i / N;
        const v = j / N;
        const d = [(u * 2 - 1) * tanX, (v * 2 - 1) * tanY, -1];
        const len = Math.hypot(...d);
        const t = (c.x * d[0] + c.y * d[1] + c.z * d[2]) / len;
        if (t <= 0) continue;
        const b = Math.hypot(c.x - (d[0] / len) * t, c.y - (d[1] / len) * t, c.z - (d[2] / len) * t);
        if (b >= radius) continue;
        x0 = Math.min(x0, u);
        y0 = Math.min(y0, v);
        x1 = Math.max(x1, u);
        y1 = Math.max(y1, v);
      }
    }
    return [x0, y0, x1, y1];
  }

  it('bounds exactly the rays within the reach', () => {
    const out = [0, 0, 0, 0];
    for (const [c, r] of [
      [{ x: 0, y: 0, z: -100 }, 10],
      [{ x: 30, y: -12, z: -80 }, 6],
    ]) {
      expect(lensScreenRect(c, r, tanX, tanY, out)).toBe(true);
      const brute = bruteRect(c, r);
      for (let k = 0; k < 4; k++) expect(out[k]).toBeCloseTo(brute[k], 2);
    }
  });

  it('still holds every such ray when the reach leaves the screen', () => {
    // Off the left edge: each axis is bounded on its own, so the rectangle
    // can be a little larger than the on-screen part, never smaller.
    const out = [0, 0, 0, 0];
    lensScreenRect({ x: -50, y: 20, z: -60 }, 15, tanX, tanY, out);
    const brute = bruteRect({ x: -50, y: 20, z: -60 }, 15);
    expect(out[0]).toBeLessThanOrEqual(brute[0] + 0.003);
    expect(out[1]).toBeLessThanOrEqual(brute[1] + 0.003);
    expect(out[2]).toBeGreaterThanOrEqual(brute[2] - 0.003);
    expect(out[3]).toBeGreaterThanOrEqual(brute[3] - 0.003);
  });

  it('covers the whole screen from inside the reach, and nothing from behind', () => {
    const out = [0, 0, 0, 0];
    expect(lensScreenRect({ x: 1, y: 0, z: -5 }, 10, tanX, tanY, out)).toBe(true);
    expect(out).toEqual([0, 0, 1, 1]);
    expect(lensScreenRect({ x: 0, y: 0, z: 5 }, 10, tanX, tanY, out)).toBe(false);
  });

  it('opens a side when the reach wraps past 90° from the view axis', () => {
    const out = [0, 0, 0, 0];
    lensScreenRect({ x: 20, y: 0, z: -5 }, 15, tanX, tanY, out);
    expect(out[2]).toBe(1);
    expect(out[0]).toBeGreaterThan(0);
  });
});
