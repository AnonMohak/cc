import { describe, it, expect } from 'vitest';
import { filmColour, planck, DISC_K, WHITE_K } from './filmColour.js';

describe('filmColour', () => {
  it('is white at the white point and normalised by 0.30R + 0.59G + 0.11B', () => {
    const w = filmColour(WHITE_K);
    expect(w[0]).toBeCloseTo(1, 9);
    expect(w[1]).toBeCloseTo(1, 9);
    expect(w[2]).toBeCloseTo(1, 9);
    const d = filmColour(DISC_K);
    expect(0.3 * d[0] + 0.59 * d[1] + 0.11 * d[2]).toBeCloseTo(1, 9);
  });

  it('makes the 4500 K disc warm, and warmer as it cools', () => {
    const [r, g, b] = filmColour(DISC_K);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(filmColour(3000)[2]).toBeLessThan(b);
    expect(filmColour(10000)[2]).toBeGreaterThan(1);
  });

  it('uses Wien peaks: hotter bodies peak bluer', () => {
    const peak = (k) => {
      let best = 0;
      let at = 0;
      for (let nm = 200; nm < 3000; nm += 5) if (planck(nm, k) > best) [best, at] = [planck(nm, k), nm];
      return at;
    };
    expect(peak(4500)).toBeGreaterThan(600);
    expect(peak(4500)).toBeLessThan(680);
    expect(peak(9000)).toBeLessThan(peak(4500));
  });
});
