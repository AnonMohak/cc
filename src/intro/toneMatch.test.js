import { describe, it, expect } from 'vitest';
import { emptyHist, addToHist, mergeHist, matchCurve } from './toneMatch.js';
import { CURVE_KNOTS } from './introLook.js';

/** A w × 1 image whose three channels run through the given values. */
const strip = (values) => ({ w: values.length, h: 1, rgb: Float32Array.from(values.flatMap((v) => [v, v, v])) });
const ramp = (n, f) => strip(Array.from({ length: n }, (_, i) => f((i + 0.5) / n)));

describe('matchCurve', () => {
  it('is the identity for the same distribution', () => {
    const h = addToHist(emptyHist(), ramp(4000, (x) => x));
    const curve = matchCurve(h, h, CURVE_KNOTS);
    curve.forEach((rgb, k) => rgb.forEach((y) => expect(y).toBeCloseTo(CURVE_KNOTS[k], 1)));
  });

  it('lifts a darker image to a brighter film, monotone', () => {
    const ours = addToHist(emptyHist(), ramp(4000, (x) => 0.5 * x));
    const film = addToHist(emptyHist(), ramp(4000, (x) => x));
    const curve = matchCurve(ours, film, CURVE_KNOTS);
    // Our 0.42 is the 84th percentile: the film's 0.84.
    expect(curve[CURVE_KNOTS.indexOf(0.42)][0]).toBeCloseTo(0.84, 1);
    for (let k = 1; k < curve.length; k++) expect(curve[k][1]).toBeGreaterThanOrEqual(curve[k - 1][1]);
  });

  it('maps a pile of black to the middle of the film’s darkest share', () => {
    const ours = addToHist(emptyHist(), strip([...Array(500).fill(0), ...Array.from({ length: 500 }, (_, i) => 0.5 + i / 1000)]));
    const film = addToHist(emptyHist(), ramp(1000, (x) => x));
    expect(matchCurve(ours, film, CURVE_KNOTS)[0][2]).toBeCloseTo(0.25, 1);
  });

  it('counts only the masked pixels, and merges', () => {
    const img = strip([0.1, 0.9]);
    const h = addToHist(emptyHist(), img, Uint8Array.from([1, 0]));
    expect(h.n).toBe(1);
    const m = mergeHist(h, h);
    expect(m.n).toBe(2);
    expect(m.r[Math.floor(0.1 * 256)]).toBe(2);
  });
});
