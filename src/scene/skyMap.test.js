import { describe, it, expect } from 'vitest';
import { skyRadiance, galacticCoords, bakeSkyMap, starDensity, SKY_CENTER, SKY_POLE } from './skyMap.js';

const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
// Average over a small ring so single noise samples do not decide a test.
function meanLum(dir, spread = 0.03) {
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const x = dir.x + spread * Math.cos(a);
    const y = dir.y + spread * Math.sin(a);
    const z = dir.z + spread * Math.cos(a + 1);
    const n = Math.hypot(x, y, z);
    sum += lum(skyRadiance(x / n, y / n, z / n));
  }
  return sum / 16;
}

describe('sky model', () => {
  it('puts the galactic centre at l = 0, b = 0 and the pole at b = 90°', () => {
    const c = galacticCoords(SKY_CENTER.x, SKY_CENTER.y, SKY_CENTER.z);
    expect(c.b).toBeCloseTo(0, 5);
    expect(c.l).toBeCloseTo(0, 5);
    expect(galacticCoords(SKY_POLE.x, SKY_POLE.y, SKY_POLE.z).b).toBeCloseTo(Math.PI / 2, 5);
  });

  it('is brightest along the band and toward the centre, dark at the poles', () => {
    const anti = { x: -SKY_CENTER.x, y: -SKY_CENTER.y, z: -SKY_CENTER.z };
    const centre = meanLum(SKY_CENTER, 0.08);
    expect(centre).toBeGreaterThan(meanLum(anti) * 2);
    expect(meanLum(anti)).toBeGreaterThan(lum(skyRadiance(SKY_POLE.x, SKY_POLE.y, SKY_POLE.z)) * 20);
  });

  it('bakes a deterministic sRGB map of the requested size without clipping', () => {
    const a = bakeSkyMap(64, 32);
    expect(a.length).toBe(64 * 32 * 4);
    expect(Array.from(a)).toEqual(Array.from(bakeSkyMap(64, 32)));
    let max = 0;
    for (let i = 0; i < a.length; i += 4) max = Math.max(max, a[i], a[i + 1], a[i + 2]);
    expect(max).toBeGreaterThan(60);
    expect(max).toBeLessThan(255);
  });

  it('gives background stars more weight along the band', () => {
    expect(starDensity(SKY_CENTER.x, SKY_CENTER.y, SKY_CENTER.z)).toBeGreaterThan(0.95);
    expect(starDensity(SKY_POLE.x, SKY_POLE.y, SKY_POLE.z)).toBeCloseTo(0.35, 2);
  });
});
