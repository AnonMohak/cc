import { describe, it, expect } from 'vitest';
import { DISC_INNER, DISC_OUTER, H0, H1, SLAB_K, SPIN, GLOW_POWER, STEP_K, STEP_MIN, STEP_MAX, halfThickness, slabHeight, radialWindow, glow, angularSpeed, marchStep } from './gargantuaModel.js';
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
    for (const [name, v] of Object.entries({ DISC_INNER, DISC_OUTER, H0, H1, SLAB_K, SPIN, GLOW_POWER, STEP_K, STEP_MIN, STEP_MAX })) {
      expect(marchShader).toContain(`const float ${name} = ${v.toFixed(4)};`);
    }
  });
});
