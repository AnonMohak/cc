import { describe, it, expect } from 'vitest';
import { aberrate, SPARSE_OUT, bendRay, kerrShadow, captureRadius, curveStep, CAPTURE_R, KERR_M, KERR_A, ESCAPE_R, CURVE_K, CURVE_MIN, CURVE_MAX, DISC_INNER, DISC_OUTER, H0, H1, SLAB_K, SPIN, GLOW_POWER, STEP_K, STEP_MIN, STEP_MAX, halfThickness, slabHeight, radialWindow, glow, angularSpeed, marchStep } from './gargantuaModel.js';
import { marchShader } from './gargantuaShader.js';

describe('gargantuaModel', () => {
  it('is thin inside, flared outside, inside its slab', () => {
    expect(halfThickness(0)).toBe(H0);
    expect(halfThickness(10)).toBeCloseTo(H0 + 10 * H1, 12);
    expect(slabHeight(10)).toBeCloseTo(SLAB_K * halfThickness(10), 12);
  });

  it('has no gas inside the inner edge or past the outer edge', () => {
    expect(radialWindow(DISC_INNER * 0.99)).toBe(0);
    expect(radialWindow(DISC_OUTER)).toBe(0);
    expect(radialWindow(10)).toBe(1);
  });

  it('glows brightest at the inner edge, and the inner gas laps the outer', () => {
    expect(glow(DISC_INNER)).toBe(1);
    expect(glow(1)).toBe(1);
    expect(glow(20)).toBeLessThan(glow(10));
    expect(angularSpeed(DISC_INNER)).toBeCloseTo(SPIN, 12);
    expect(angularSpeed(20)).toBeLessThan(angularSpeed(5));
  });

  it('steps by the local thickness within the bounds', () => {
    expect(marchStep(3)).toBeCloseTo(Math.max(STEP_MIN, STEP_K * halfThickness(3)), 12);
    expect(marchStep(1000)).toBe(STEP_MAX);
    for (let r = 0; r < 80; r += 3) expect(marchStep(r)).toBeLessThanOrEqual(halfThickness(r));
  });

  it('the shader uses the same constants', () => {
    for (const [name, v] of Object.entries({ DISC_INNER, SPARSE_OUT, DISC_OUTER, H0, H1, SLAB_K, SPIN, GLOW_POWER, STEP_K, STEP_MIN, STEP_MAX, CAPTURE_R, KERR_M, KERR_A, ESCAPE_R, CURVE_K, CURVE_MIN, CURVE_MAX })) {
      expect(marchShader).toContain(`const float ${name} = ${v.toFixed(4)};`);
    }
  });
});

describe('bendRay without spin (Schwarzschild)', () => {
  const SHADOW_B = 2.598; // 3√3/2 Rs
  const shoot = (b) => bendRay([-80, b, 0], [1, 0, 0], 4000, 0);

  it('captures inside the shadow and lets the rest escape', () => {
    expect(shoot(SHADOW_B * 0.97).captured).toBe(true);
    expect(shoot(SHADOW_B * 1.05).escaped).toBe(true);
  });

  it('bends by the weak-field angle 2/b far out', () => {
    for (const b of [15, 25]) {
      const { dir } = shoot(b);
      const bend = Math.atan2(-dir[1], dir[0]);
      // From -80 to +90 the ray misses a little of the full bend, and the
      // local tangent at either end (coordinate space, b = r sin α exactly)
      // differs from the asymptote by ~b / 2r²; within 10%.
      expect(bend).toBeGreaterThan((2 / b) * 0.85);
      expect(bend).toBeLessThan((2 / b + (15 * Math.PI) / (16 * b * b)) * 1.1);
    }
  });

  it('bends strongly near the photon sphere', () => {
    const { dir, escaped } = shoot(SHADOW_B * 1.02);
    expect(escaped).toBe(true);
    // Unwrapped: this close to the shadow the light turns past 180°.
    let bend = Math.atan2(-dir[1], dir[0]);
    if (bend < 0) bend += 2 * Math.PI;
    expect(bend).toBeGreaterThan(Math.PI / 2);
  });

  it('captures at the photon sphere', () => {
    expect(captureRadius(0)).toBeCloseTo(1.5, 12);
    const s = kerrShadow(0);
    for (const b of [s.prograde, s.retrograde, s.polar]) expect(b).toBeCloseTo(SHADOW_B, 3);
  });

  it('steps finer near the hole', () => {
    expect(curveStep(2)).toBeLessThan(curveStep(20));
    expect(curveStep(1e6)).toBe(CURVE_MAX);
  });
});

describe('bendRay with spin (Kerr, a = 0.6 M)', () => {
  // The shadow's edge by bisection on the offset of rays from r = 80, as an
  // impact parameter (the camera's view: b = offset / √(1 − 1/r)).
  const edge = (ray) => {
    let lo = 1;
    let hi = 4;
    for (let i = 0; i < 20; i++) {
      const b = (lo + hi) / 2;
      if (ray(b).captured) lo = b;
      else hi = b;
    }
    return lo / Math.sqrt(1 - 1 / 80);
  };

  it('is the film spin, captured inside the prograde photon orbit', () => {
    expect(KERR_A / KERR_M).toBeCloseTo(0.6, 12);
    expect(CAPTURE_R).toBeCloseTo(1.0945, 3);
    const s = kerrShadow();
    expect(s.prograde).toBeCloseTo(1.919, 3);
    expect(s.retrograde).toBeCloseTo(3.158, 3);
    expect(s.polar).toBeCloseTo(2.5245, 3);
  });

  it('casts a D-shaped shadow: the traced edges match the exact ones', () => {
    const s = kerrShadow();
    // The disc turns toward +azimuth (x toward z): from -x, light passing at
    // -z turns with the spin (prograde), at +z against it.
    expect(edge((b) => bendRay([-80, 0, -b], [1, 0, 0], 20000))).toBeCloseTo(s.prograde, 2);
    expect(edge((b) => bendRay([-80, 0, b], [1, 0, 0], 20000))).toBeCloseTo(s.retrograde, 2);
    expect(edge((b) => bendRay([-80, b, 0], [1, 0, 0], 20000))).toBeCloseTo(s.polar, 2);
  });

  it('still bends by the weak-field angle far out', () => {
    const { dir } = bendRay([-80, 20, 0], [1, 0, 0]);
    const bend = Math.atan2(-dir[1], dir[0]);
    expect(bend).toBeGreaterThan((2 / 20) * 0.85);
    expect(bend).toBeLessThan((2 / 20) * 1.15);
  });
});

describe('aberrate (the falling camera)', () => {
  const B = 0.6;
  const boost = [B, 0, 0];
  it('keeps the view at rest and straight ahead', () => {
    expect(aberrate([0, 1, 0], [0, 0, 0])).toEqual([0, 1, 0]);
    const ahead = aberrate([1, 0, 0], boost);
    expect(ahead[0]).toBeCloseTo(1, 9);
  });

  it('crowds the view toward the motion: a look square to it is behind at rest', () => {
    const side = aberrate([0, 1, 0], boost);
    expect(side[0]).toBeCloseTo(-B, 9);
    expect(Math.hypot(...side)).toBeCloseTo(1, 9);
    // cos θ_rest = (cos θ − β) / (1 − β cos θ)
    const c = Math.cos(0.7);
    const look = aberrate([c, Math.sin(0.7), 0], boost);
    expect(look[0]).toBeCloseTo((c - B) / (1 - B * c), 9);
  });
});
