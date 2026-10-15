import { describe, it, expect } from 'vitest';
import { MARCH_LOOK, COMPOSITE_LOOK, LOOK_LIMITS, lookDeclarations, clampLook } from './introLook.js';
import { marchShader, compositeShader, lightShader } from './gargantuaShader.js';

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
    // The light pass shares the gas (and its look values) with the march.
    for (const name of Object.keys(MARCH_LOOK)) expect(lightShader).toMatch(new RegExp(`uniform (float|vec3) ${name};`));
    expect(lightShader).toContain('vec3 gas(vec3 p)');
    expect(marchShader).toContain('lightAt(p, rc)');
  });

  it('clamps to the limits; the angle tiles stay whole (no seam)', () => {
    expect(clampLook('TAU', 100)).toBe(LOOK_LIMITS.TAU[1]);
    expect(clampLook('ANG_TILES', 6.6)).toBe(7);
    expect(clampLook('UNKNOWN', 5)).toBe(5);
  });
});

describe('colour fit tone curve', () => {
  it('has one point per knot, lifts black only a little (as the film does) and never falls', async () => {
    const { CURVE_KNOTS } = await import('./introLook.js');
    const points = CURVE_KNOTS.map((_, i) => COMPOSITE_LOOK[`CURVE_${i}`]);
    expect(points.every(Boolean)).toBe(true);
    expect(COMPOSITE_LOOK[`CURVE_${CURVE_KNOTS.length}`]).toBeUndefined();
    for (const v of points[0]) expect(v).toBeLessThan(0.05);
    for (let c = 0; c < 3; c++) {
      for (let i = 1; i < points.length; i++) expect(points[i][c]).toBeGreaterThanOrEqual(points[i - 1][c]);
    }
    expect(compositeShader).toContain('vec3 toneCurve(vec3 x)');
  });
});

describe('spray look', () => {
  it('every spray value has limits that hold its default, and the spray shader declares it', async () => {
    const { SPRAY_LOOK } = await import('./introLook.js');
    const { IntroSpray } = await import('./introSpray.js');
    const spray = new IntroSpray();
    for (const [name, v] of Object.entries(SPRAY_LOOK)) {
      const [min, max] = LOOK_LIMITS[name];
      expect(v).toBeGreaterThanOrEqual(min);
      expect(v).toBeLessThanOrEqual(max);
      expect(spray.lineMaterial.vertexShader).toMatch(new RegExp(`uniform float ${name};`));
      expect(spray.uniforms[name].value).toBe(v);
    }
    spray.dispose();
  });
});
