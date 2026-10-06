import { describe, it, expect } from 'vitest';
import {
  omega,
  orbitAngle,
  eccentricity,
  armPhase,
  crest,
  starPosition,
  dustColumn,
  blackbody,
  sersic,
} from './densityModel.js';

describe('blackbody', () => {
  it('is red-orange at 3000 K, near white at 6500 K and blue at 10000 K', () => {
    const [r3, g3, b3] = blackbody(3000);
    expect(r3).toBe(1);
    expect(g3).toBeLessThan(0.75);
    expect(b3).toBeLessThan(0.5);
    const [r6, g6, b6] = blackbody(6500);
    expect(Math.min(r6, g6, b6)).toBeGreaterThan(0.9);
    const [r10, , b10] = blackbody(10000);
    expect(b10).toBe(1);
    expect(r10).toBeLessThan(0.85);
  });

  it('stays in [0, 1]', () => {
    for (let k = 1000; k <= 40000; k += 500) {
      for (const v of blackbody(k)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('orbit model', () => {
  it('omega is faster inside when differential > 0 and flat at 0', () => {
    expect(omega(0.1, 0.6)).toBeGreaterThan(omega(0.9, 0.6));
    expect(omega(0.1, 0)).toBe(1);
    expect(omega(0.9, 0)).toBe(1);
  });

  it('orbit angle grows with radius and with pattern phase', () => {
    expect(orbitAngle(0.8, 0.5, 0, 0.3)).toBeGreaterThan(orbitAngle(0.2, 0.5, 0, 0.3));
    expect(orbitAngle(0.5, 0.5, 2, 0.3)).toBeCloseTo(orbitAngle(0.5, 0.5, 0, 0.3) + 0.6);
  });

  it('eccentricity is 0 in the centre and peaks in the inner disc', () => {
    expect(eccentricity(0, 0.2)).toBe(0);
    expect(eccentricity(0.35, 0.2)).toBeCloseTo(0.2);
    expect(eccentricity(1.2, 0.2)).toBeCloseTo(0.1);
  });

  it('arm phase is periodic with period 2π/m in θ', () => {
    const m = 3;
    const a = armPhase(0.4, 0.5, m, 0.6, 1, 0.3);
    const b = armPhase(0.4 + (2 * Math.PI) / m, 0.5, m, 0.6, 1, 0.3);
    expect(Math.sin(b)).toBeCloseTo(Math.sin(a));
    expect(Math.cos(b)).toBeCloseTo(Math.cos(a));
  });

  it('crest is 1 on the crest, 0 between arms, and flips with winding sign', () => {
    expect(crest(-Math.PI / 2, 1)).toBeCloseTo(1);
    expect(crest(Math.PI / 2, 1)).toBeCloseTo(0);
    expect(crest(Math.PI / 2, -1)).toBeCloseTo(1);
  });

  it('a star with no arms moves on a circle', () => {
    const p = starPosition(0.5, 1, { arms: 0, winding: 0.5, eMax: 0.2, patternSpeed: 0.3, differential: 0.5 }, 3);
    expect(p.r).toBeCloseTo(0.5);
  });
});

describe('density-wave arms emerge from crowded orbits', () => {
  it('stars at a fixed radius crowd near the predicted crest angles', () => {
    const params = { arms: 2, winding: 0.6, eMax: 0.22, patternSpeed: 0.3, differential: 0.6 };
    const phase = 4.2;
    // Many orbits, uniform in a and start angle.
    const bins = new Array(72).fill(0);
    const ring = [0.48, 0.52];
    for (let i = 0; i < 400; i++) {
      const a = 0.3 + (0.4 * i) / 400;
      for (let j = 0; j < 400; j++) {
        const { r, theta } = starPosition(a, (2 * Math.PI * j) / 400, params, phase);
        if (r < ring[0] || r > ring[1]) continue;
        const t = ((theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        bins[Math.floor((t / (2 * Math.PI)) * bins.length) % bins.length]++;
      }
    }
    const peak = bins.indexOf(Math.max(...bins));
    const peakTheta = ((peak + 0.5) / bins.length) * 2 * Math.PI;
    // Model: crest where m(θ − φ(r)) = −π/2 (+ 2πk).
    const psi = armPhase(peakTheta, 0.5, params.arms, params.winding, phase, params.patternSpeed);
    expect(crest(psi, params.winding)).toBeGreaterThan(0.8);
    // And the arms carry clearly more stars than the gaps.
    const min = Math.min(...bins);
    expect(Math.max(...bins) / Math.max(min, 1)).toBeGreaterThan(1.5);
  });
});

describe('dustColumn', () => {
  it('is ~0 well above the slab, 1 at the midplane and ~2 well below', () => {
    expect(dustColumn(10, 1, 0.05)).toBeLessThan(1e-6);
    expect(dustColumn(0, 1, 0.05)).toBe(1);
    expect(dustColumn(-10, 1, 0.05)).toBeCloseTo(2);
  });

  it('is symmetric when the camera is below', () => {
    expect(dustColumn(0.03, -1, 0.05)).toBeCloseTo(dustColumn(-0.03, 1, 0.05));
  });
});

describe('sersic', () => {
  it('is 1 at the centre and falls off', () => {
    expect(sersic(0, 0.1, 4)).toBe(1);
    expect(sersic(0.1, 0.1, 4)).toBeLessThan(0.01);
    expect(sersic(0.05, 0.1, 1)).toBeGreaterThan(sersic(0.05, 0.1, 4));
  });
});
