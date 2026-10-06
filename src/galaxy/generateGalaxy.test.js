import { describe, it, expect } from 'vitest';
import { generateGalaxy, COMPONENT } from './generateGalaxy.js';
import { PRESETS } from './presets.js';
import { DEFAULT_SHAPE } from './params.js';

const small = (overrides = {}) => ({ ...DEFAULT_SHAPE, count: 5000, ...overrides });

describe('generateGalaxy', () => {
  it('returns typed arrays sized for the star count', () => {
    const g = generateGalaxy(small(), 1);
    expect(g.count).toBe(5000);
    expect(g.positions).toBeInstanceOf(Float32Array);
    expect(g.positions.length).toBe(15000);
    expect(g.radiusNorm.length).toBe(5000);
    expect(g.colorJitter.length).toBe(5000);
    expect(g.sizes.length).toBe(5000);
  });

  it('is deterministic for the same seed', () => {
    const a = generateGalaxy(small(), 123);
    const b = generateGalaxy(small(), 123);
    expect(a.positions).toEqual(b.positions);
    expect(a.colorJitter).toEqual(b.colorJitter);
  });

  it('differs for a different seed', () => {
    const a = generateGalaxy(small(), 1);
    const b = generateGalaxy(small(), 2);
    expect(a.positions).not.toEqual(b.positions);
  });

  it('clamps the shape before generating', () => {
    expect(generateGalaxy({ count: -10 }, 1).count).toBe(1000);
  });

  it.each(Object.entries(PRESETS))('%s keeps every star in bounds with finite values', (_n, preset) => {
    const g = generateGalaxy({ ...preset.shape, count: 8000 }, 7);
    for (let i = 0; i < g.count; i++) {
      const x = g.positions[i * 3];
      const y = g.positions[i * 3 + 1];
      const z = g.positions[i * 3 + 2];
      expect(Number.isFinite(x + y + z)).toBe(true);
      expect(Math.hypot(x, z)).toBeLessThanOrEqual(2.0001);
      expect(Math.abs(y)).toBeLessThanOrEqual(1);
      expect(g.radiusNorm[i]).toBeGreaterThanOrEqual(0);
      expect(g.radiusNorm[i]).toBeLessThanOrEqual(1);
      expect(g.colorJitter[i]).toBeGreaterThanOrEqual(-1);
      expect(g.colorJitter[i]).toBeLessThanOrEqual(1);
      expect(g.sizes[i]).toBeGreaterThan(0);
    }
  });

  it('puts roughly bulgeFraction of the stars in the bulge', () => {
    const g = generateGalaxy(small({ count: 20000, bulgeFraction: 0.3 }), 4);
    expect(g.stats.bulge / g.count).toBeCloseTo(0.3, 1);
  });

  it('component stats add up to the count', () => {
    const g = generateGalaxy(PRESETS.irregular.shape, 5);
    const total = Object.values(g.stats).reduce((a, b) => a + b, 0);
    expect(total).toBe(g.count);
    expect(g.stats.clump).toBeGreaterThan(0);
  });

  it('only makes bar stars when barLength > 0', () => {
    expect(generateGalaxy(small({ barLength: 0 }), 1).stats.bar).toBe(0);
    expect(generateGalaxy(small({ barLength: 0.3 }), 1).stats.bar).toBeGreaterThan(0);
  });

  it('concentrates arm stars near the arm angles', () => {
    // Two arms, no spin, no scatter, no bulge: arm stars sit on angle 0 or PI.
    const g = generateGalaxy(
      small({ arms: 2, spin: 0, armSpread: 0, armContrast: 1, bulgeFraction: 0, haloFraction: 0 }),
      9,
    );
    for (let i = 0; i < g.count; i++) {
      if (g.components[i] !== COMPONENT.DISC) continue;
      const z = g.positions[i * 3 + 2];
      expect(Math.abs(z)).toBeLessThan(1e-5);
    }
  });

  it('makes a bulge-only elliptical with no disc arms', () => {
    const g = generateGalaxy({ ...PRESETS.elliptical.shape, count: 10000 }, 3);
    expect(g.stats.bulge / g.count).toBeGreaterThan(0.85);
  });
});
