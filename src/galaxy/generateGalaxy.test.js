import { describe, it, expect } from 'vitest';
import { generateGalaxy, KIND } from './generateGalaxy.js';
import { PRESETS } from './presets.js';
import { DEFAULT_SHAPE, DEFAULT_STRUCTURE, DEFAULT_MOTION } from './params.js';
import { starPosition, armPhase, crest } from './densityModel.js';

const small = (overrides = {}) => ({ ...DEFAULT_SHAPE, count: 5000, ...overrides });

describe('generateGalaxy', () => {
  it('returns orbit (vec4), star (vec3) and position arrays sized for the count', () => {
    const g = generateGalaxy(small(), 1);
    expect(g.count).toBe(5000);
    expect(g.orbit).toBeInstanceOf(Float32Array);
    expect(g.orbit.length).toBe(20000);
    expect(g.star.length).toBe(15000);
    expect(g.positions.length).toBe(15000);
  });

  it('is deterministic for the same seed and differs for another', () => {
    expect(generateGalaxy(small(), 3).orbit).toEqual(generateGalaxy(small(), 3).orbit);
    expect(generateGalaxy(small(), 3).orbit).not.toEqual(generateGalaxy(small(), 4).orbit);
  });

  it('clamps the shape before generating', () => {
    expect(generateGalaxy({ count: -10 }, 1).count).toBe(1000);
  });

  it.each(Object.entries(PRESETS))('%s: finite values, valid kinds, temperatures and bounds', (_n, preset) => {
    const g = generateGalaxy({ ...preset.shape, count: 6000 }, 7);
    for (let i = 0; i < g.count; i++) {
      const [a, , z, kind] = g.orbit.subarray(i * 4, i * 4 + 4);
      const [temp, size, youth] = g.star.subarray(i * 3, i * 3 + 3);
      expect(Number.isFinite(a + z)).toBe(true);
      expect([0, 1, 2, 3]).toContain(kind);
      expect(Math.abs(a)).toBeLessThanOrEqual(1.41);
      expect(Math.abs(z)).toBeLessThanOrEqual(1);
      expect(temp).toBeGreaterThanOrEqual(3000);
      expect(temp).toBeLessThanOrEqual(28000);
      expect(size).toBeGreaterThan(0);
      expect([0, 1]).toContain(youth);
    }
  });

  it('population stats add up and follow the fractions', () => {
    const g = generateGalaxy(small({ count: 20000, bulgeFraction: 0.3, haloFraction: 0.05 }), 4);
    const { disc, bulge, halo, bar } = g.stats;
    expect(disc + bulge + halo + bar).toBe(g.count);
    expect(bulge / g.count).toBeCloseTo(0.3, 1);
    expect(halo / g.count).toBeCloseTo(0.05, 1);
  });

  it('young hot stars are only in the disc', () => {
    const g = generateGalaxy(small({ youngFraction: 0.4 }), 5);
    for (let i = 0; i < g.count; i++) {
      if (g.star[i * 3 + 2] === 1) {
        expect(g.orbit[i * 4 + 3]).toBe(KIND.DISC);
        expect(g.star[i * 3]).toBeGreaterThanOrEqual(9000);
      }
    }
    expect(g.stats.young).toBeGreaterThan(0);
  });

  it('bulge stars are old and cool', () => {
    const g = generateGalaxy(small({ bulgeFraction: 0.5 }), 6);
    for (let i = 0; i < g.count; i++) {
      if (g.orbit[i * 4 + 3] === KIND.BULGE) expect(g.star[i * 3]).toBeLessThanOrEqual(5200);
    }
  });

  it('only makes bar stars when barLength > 0, within the bar', () => {
    expect(generateGalaxy(small({ barLength: 0 }), 1).stats.bar).toBe(0);
    const g = generateGalaxy(small({ barLength: 0.3 }), 1);
    expect(g.stats.bar).toBeGreaterThan(0);
    for (let i = 0; i < g.count; i++) {
      if (g.orbit[i * 4 + 3] === KIND.BAR) expect(Math.abs(g.orbit[i * 4])).toBeLessThanOrEqual(0.3);
    }
  });

  it('disc heights follow a thin sech² profile', () => {
    const g = generateGalaxy(small({ count: 20000, bulgeFraction: 0, haloFraction: 0, discThickness: 0.02 }), 8);
    let sumAbs = 0;
    for (let i = 0; i < g.count; i++) sumAbs += Math.abs(g.orbit[i * 4 + 2]);
    // Mean |z| of sech²(z/z0) is z0·ln2 ≈ 0.69·z0; flaring raises it a bit.
    const mean = sumAbs / g.count;
    expect(mean).toBeGreaterThan(0.01);
    expect(mean).toBeLessThan(0.03);
  });

  it('makes H II regions in proportion to hiiAmount', () => {
    expect(generateGalaxy(small({ hiiAmount: 0.04 }), 1).hii.count).toBe(200);
    expect(generateGalaxy(small({ hiiAmount: 0 }), 1).hii.count).toBe(0);
  });

  it('disc stars, moved by the density-wave model, gather on the arms', () => {
    const g = generateGalaxy({ ...DEFAULT_SHAPE, count: 60000, bulgeFraction: 0, haloFraction: 0 }, 9);
    const params = { ...DEFAULT_STRUCTURE, ...DEFAULT_MOTION, eMax: DEFAULT_STRUCTURE.eccentricity, winding: DEFAULT_STRUCTURE.armWinding };
    const phase = 2.5;
    let onArm = 0;
    let offArm = 0;
    for (let i = 0; i < g.count; i++) {
      const a = g.orbit[i * 4];
      if (a < 0.3 || a > 0.8) continue;
      const p = starPosition(a, g.orbit[i * 4 + 1], params, phase);
      const c = crest(armPhase(p.theta, p.r, params.arms, params.winding, phase, params.patternSpeed), params.winding);
      if (c > 0.8) onArm++;
      else if (c < 0.2) offArm++;
    }
    // Equal angular area on and off the arms; the arms must hold more stars.
    expect(onArm / offArm).toBeGreaterThan(1.2);
  });
});

describe('disc edge', () => {
  it('has no pile-up rim of stars at the outer edge, even with a bar', () => {
    const g = generateGalaxy({ ...DEFAULT_SHAPE, count: 40000, barLength: 0.3, bulgeFraction: 0, haloFraction: 0 }, 11);
    let inOuterBand = 0;
    let inInnerBand = 0;
    for (let i = 0; i < g.count; i++) {
      if (g.orbit[i * 4 + 3] !== KIND.DISC) continue;
      const a = g.orbit[i * 4];
      if (a > 1.1 && a <= 1.15) inOuterBand++;
      if (a > 1.0 && a <= 1.05) inInnerBand++;
    }
    // Exponential falloff: the last band must not hold more than the one before.
    expect(inOuterBand).toBeLessThanOrEqual(inInnerBand);
  });
});
