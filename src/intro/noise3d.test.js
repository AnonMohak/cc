import { describe, it, expect } from 'vitest';
import { valueNoise, fbm, bakeNoise3d } from './noise3d.js';

describe('noise3d', () => {
  it('value noise is periodic and in 0–1', () => {
    for (const [x, y, z] of [[0.3, 1.7, 2.2], [5.9, 0.1, 3.3]]) {
      const a = valueNoise(x, y, z, 6, 3);
      expect(valueNoise(x + 6, y, z, 6, 3)).toBeCloseTo(a, 12);
      expect(valueNoise(x, y - 6, z + 12, 6, 3)).toBeCloseTo(a, 12);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it('fbm tiles over the texture size on every axis', () => {
    const size = 24;
    for (const [x, y, z] of [[1, 2, 3], [7.5, 11, 0.25]]) {
      const a = fbm(x, y, z, size, 6, 3, 9);
      expect(fbm(x + size, y, z, size, 6, 3, 9)).toBeCloseTo(a, 12);
      expect(fbm(x, y + size, z - size, size, 6, 3, 9)).toBeCloseTo(a, 12);
    }
  });

  it('bakes RG bytes, seeded and varied', () => {
    const a = bakeNoise3d(12, 1);
    expect(a).toHaveLength(12 ** 3 * 2);
    expect(bakeNoise3d(12, 1)).toEqual(a);
    expect(bakeNoise3d(12, 2)).not.toEqual(a);
    const r = a.filter((_, i) => i % 2 === 0);
    expect(Math.max(...r) - Math.min(...r)).toBeGreaterThan(60);
  });
});

describe('bakeNoise3d grid', () => {
  it('matches fbm() texel for texel', () => {
    const size = 12;
    const data = bakeNoise3d(size, 5);
    for (const [x, y, z] of [[0, 0, 0], [3, 7, 11], [11, 2, 5]]) {
      const i = ((z * size + y) * size + x) * 2;
      expect(data[i]).toBe(Math.round(255 * fbm(x, y, z, size, 6, 4, 5)));
      expect(data[i + 1]).toBe(Math.round(255 * fbm(x, y, z, size, 3, 2, 106)));
    }
  });
});
