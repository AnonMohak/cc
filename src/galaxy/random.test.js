import { describe, it, expect } from 'vitest';
import { createRandom } from './random.js';

describe('createRandom', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = createRandom(42);
    const b = createRandom(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('gives a different sequence for a different seed', () => {
    const a = createRandom(1);
    const b = createRandom(2);
    const same = Array.from({ length: 20 }, () => a.next() === b.next());
    expect(same.every(Boolean)).toBe(false);
  });

  it('stays in [0, 1)', () => {
    const r = createRandom(7);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('gaussian has roughly the requested mean and spread', () => {
    const r = createRandom(3);
    const n = 20000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const v = r.gaussian(5, 2);
      expect(Number.isFinite(v)).toBe(true);
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    const sd = Math.sqrt(sumSq / n - mean * mean);
    expect(mean).toBeCloseTo(5, 1);
    expect(sd).toBeCloseTo(2, 1);
  });
});
