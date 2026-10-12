import { describe, it, expect } from 'vitest';
import { SPARSE_OUT, bendRay, curveStep, PHOTON_SPHERE, ESCAPE_R, CURVE_K, CURVE_MIN, CURVE_MAX, DISC_INNER, DISC_OUTER, H0, H1, SLAB_K, SPIN, GLOW_POWER, STEP_K, STEP_MIN, STEP_MAX, halfThickness, slabHeight, radialWindow, glow, angularSpeed, marchStep } from './gargantuaModel.js';
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
    for (const [name, v] of Object.entries({ DISC_INNER, SPARSE_OUT, DISC_OUTER, H0, H1, SLAB_K, SPIN, GLOW_POWER, STEP_K, STEP_MIN, STEP_MAX, PHOTON_SPHERE, ESCAPE_R, CURVE_K, CURVE_MIN, CURVE_MAX })) {
      expect(marchShader).toContain(`const float ${name} = ${v.toFixed(4)};`);
    }
  });
});

describe('bendRay (lensing)', () => {
  const SHADOW_B = 2.598; // 3√3/2 Rs
  const shoot = (b) => bendRay([-80, b, 0], [1, 0, 0]);

  it('captures inside the shadow and lets the rest escape', () => {
    expect(shoot(SHADOW_B * 0.97).captured).toBe(true);
    expect(shoot(SHADOW_B * 1.05).escaped).toBe(true);
  });

  it('bends by the weak-field angle 2/b far out', () => {
    for (const b of [15, 25]) {
      const { dir } = shoot(b);
      const bend = Math.atan2(-dir[1], dir[0]);
      // From -80 to +90 the ray misses a little of the full bend; within 10%.
      expect(bend).toBeGreaterThan((2 / b) * 0.85);
      expect(bend).toBeLessThan((2 / b + (15 * Math.PI) / (16 * b * b)) * 1.05);
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

  it('steps finer near the hole', () => {
    expect(curveStep(2)).toBeLessThan(curveStep(20));
    expect(curveStep(1e6)).toBe(CURVE_MAX);
  });
});
