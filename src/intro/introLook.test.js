import { describe, it, expect } from 'vitest';
import { MARCH_LOOK, COMPOSITE_LOOK, LOOK_LIMITS, lookDeclarations, clampLook } from './introLook.js';
import { marchShader, compositeShader } from './gargantuaShader.js';

describe('introLook', () => {
  it('every number has slider limits that hold its default', () => {
    for (const look of [MARCH_LOOK, COMPOSITE_LOOK]) {
      for (const [name, v] of Object.entries(look)) {
        if (Array.isArray(v)) {
          expect(v).toHaveLength(3);
          continue;
        }
        const [min, max] = LOOK_LIMITS[name];
        expect(v).toBeGreaterThanOrEqual(min);
        expect(v).toBeLessThanOrEqual(max);
      }
    }
  });

  it('the shaders declare every look value as a uniform', () => {
    expect(lookDeclarations({ A: 1, B: [1, 2, 3] })).toBe('  uniform float A;\n  uniform vec3 B;');
    for (const name of Object.keys(MARCH_LOOK)) expect(marchShader).toMatch(new RegExp(`uniform (float|vec3) ${name};`));
    for (const name of Object.keys(COMPOSITE_LOOK)) expect(compositeShader).toMatch(new RegExp(`uniform (float|vec3) ${name};`));
  });

  it('clamps to the limits; the angle tiles stay whole (no seam)', () => {
    expect(clampLook('TAU', 100)).toBe(LOOK_LIMITS.TAU[1]);
    expect(clampLook('ANG_TILES', 6.6)).toBe(7);
    expect(clampLook('UNKNOWN', 5)).toBe(5);
  });
});
