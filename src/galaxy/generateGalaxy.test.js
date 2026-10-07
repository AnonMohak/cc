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
    const bad = [];
    for (let i = 0; i < g.count; i++) {
      const [a, , z, kind] = g.orbit.subarray(i * 4, i * 4 + 4);
      const [temp, size, youth] = g.star.subarray(i * 3, i * 3 + 3);
      const ok = Number.isFinite(a + z)
        && [0, 1, 2, 3, 4].includes(kind)
        && Math.abs(a) <= 1.41
        && Math.abs(z) <= 1
        && temp >= 3000 && temp <= 28000
        && size > 0 
        && (youth === 0 || youth === 1);
      if (!ok) bad.push({ i, a, z, kind, temp, size, youth });
    }
    expect(bad).toEqual([]);
  });

  it('population stats add up and follow the fractions', () => {
    const g = generateGalaxy(small({ count: 20000, bulgeFraction: 0.3, haloFraction: 0.05 }), 4);
    const { disc, bulge, halo, bar, cluster } = g.stats;
    expect(disc + bulge + halo + bar + cluster).toBe(g.count);
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

describe('baked star colours', () => {
  it('match the black-body colour of each star temperature (linear light)', async () => {
    const { blackbody } = await import('./densityModel.js');
    const g = generateGalaxy({ ...DEFAULT_SHAPE, count: 500 }, 4);
    expect(g.color.length).toBe(g.count * 3);
    for (let i = 0; i < g.count; i += 37) {
      const bb = blackbody(g.star[i * 3]).map((v) => v ** 2.2);
      expect(g.color[i * 3]).toBeCloseTo(bb[0], 5);
      expect(g.color[i * 3 + 2]).toBeCloseTo(bb[2], 5);
    }
  });
});

describe('globular clusters', () => {
  it('makes tight balls of old stars in the halo, more in bulge-rich galaxies', () => {
    const spiral = generateGalaxy({ ...DEFAULT_SHAPE, count: 40000, bulgeFraction: 0.15, haloFraction: 0.03 }, 3);
    const elliptical = generateGalaxy({ ...DEFAULT_SHAPE, count: 40000, bulgeFraction: 0.8, haloFraction: 0.1 }, 3);
    expect(spiral.stats.cluster).toBeGreaterThan(0);
    expect(elliptical.stats.cluster).toBeGreaterThan(spiral.stats.cluster * 2);

    const centres = new Map();
    for (let i = 0; i < spiral.count; i++) {
      if (spiral.orbit[i * 4 + 3] !== KIND.CLUSTER) continue;
      expect(spiral.star[i * 3 + 2]).toBe(0); // never "young"
      const key = `${spiral.orbit[i * 4]},${spiral.orbit[i * 4 + 1]}`;
      centres.set(key, (centres.get(key) ?? 0) + 1);
      // Offset from the centre is small (≤ 6 core radii ≤ 0.042).
      expect(Math.hypot(spiral.positions[i * 3], spiral.positions[i * 3 + 1], spiral.positions[i * 3 + 2])).toBeLessThan(0.043);
    }
    // Stars share a few centres: clusters, not a smooth halo.
    expect(centres.size).toBeGreaterThan(3);
    expect(centres.size).toBeLessThanOrEqual(40);
    expect(spiral.stats.cluster / centres.size).toBeGreaterThan(30);
  });
});
