import { describe, it, expect } from 'vitest';
import { buildPhotonLut, photonPath, periapsisU, lutRow, B_CRIT, LUT_HEIGHT, LUT_ROWS_CAPTURE } from './photonLut.js';
import { SHADOW_B } from './blackHole.js';

const lut = buildPhotonLut();

/**
 * Reference: RK4 on Binet's equation u'' = −u + 1.5 u² in the swept angle,
 * from the camera. Radius after sweep s, or null once escaped / fallen in.
 */
function reference(rc, b, inward, s, h = 2e-4) {
  let u = 1 / rc;
  let du = (inward ? 1 : -1) * Math.sqrt(Math.max(0, 1 / (b * b) - u * u + u * u * u));
  const acc = (x) => -x + 1.5 * x * x;
  for (let phi = 0; phi < s; phi += h) {
    const k1u = du;
    const k1v = acc(u);
    const k2u = du + 0.5 * h * k1v;
    const k2v = acc(u + 0.5 * h * k1u);
    const k3u = du + 0.5 * h * k2v;
    const k3v = acc(u + 0.5 * h * k2u);
    const k4u = du + h * k3v;
    const k4v = acc(u + h * k3u);
    u += (h / 6) * (k1u + 2 * k2u + 2 * k3u + k4u);
    du += (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
    if (u <= 0 || u >= 1) return null;
  }
  return 1 / u;
}

describe('photonLut', () => {
  it('has the shadow edge where the rest of the code has it', () => {
    expect(B_CRIT).toBeCloseTo(SHADOW_B, 3);
    expect(periapsisU(B_CRIT + 1e-9)).toBeCloseTo(2 / 3, 3);
    expect(periapsisU(1000)).toBeCloseTo(1 / 1000, 5);
    expect(lutRow(0)).toBeCloseTo(0, 6);
    expect(lutRow(B_CRIT + 1e-9)).toBeCloseTo(LUT_ROWS_CAPTURE, 6);
    expect(lutRow(1e6)).toBeCloseTo(LUT_HEIGHT - 1, 6);
  });

  // Relative error in r inside the lens reach (where the disc is), absolute
  // error in u = 1/r everywhere (far out u is tiny, so r itself is loose).
  it('matches a direct integration along the path', () => {
    let worst = 0;
    let worstU = 0;
    for (const rc of [30, 10, 5]) {
      for (const b of [0.8, 2.0, 2.5, 2.62, 2.8, 3.5, 6, 12, 20]) {
        if (b >= rc) continue;
        for (const inward of [true, false]) {
          const path = photonPath(lut, rc, b, inward);
          for (const k of [0.05, 0.3, 0.6, 0.9]) {
            const s = k * path.escapeSweep;
            const want = reference(rc, b, inward, s);
            const got = path.radiusAt(s);
            if (want === null) continue; // the reference leaves a step early
            expect(got).not.toBeNull();
            if (want <= 40) worst = Math.max(worst, Math.abs(got - want) / want);
            worstU = Math.max(worstU, Math.abs(1 / got - 1 / want));
          }
        }
      }
    }
    expect(worst).toBeLessThan(0.005);
    expect(worstU).toBeLessThan(2e-3);
  });

  it('captures inward rays inside the shadow and lets the others go', () => {
    expect(photonPath(lut, 20, 2.0, true).escapes).toBe(false);
    expect(photonPath(lut, 20, 2.0, false).escapes).toBe(true);
    expect(photonPath(lut, 20, 2.7, true).escapes).toBe(true);
    expect(photonPath(lut, 20, 2.0, true).radiusAt(1e3)).toBeNull();
  });

  it('bends a far ray by the weak-field angle and loops near the ring', () => {
    // From far away, the escape sweep is π + the deflection (plus the small
    // angle the camera already sees off the axis).
    const rc = 1e4;
    for (const b of [20, 40]) {
      const path = photonPath(lut, rc, b, true);
      const deflection = path.escapeSweep - (Math.PI - Math.asin(b / rc));
      expect(deflection).toBeCloseTo(2 / b + (15 * Math.PI) / (16 * b * b), 2);
    }
    // Just outside the shadow edge the photon circles the hole.
    expect(photonPath(lut, 30, B_CRIT + 1e-4, true).escapeSweep).toBeGreaterThan(2.5 * Math.PI);
  });
});
