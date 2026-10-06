import { describe, it, expect } from 'vitest';
import { glsl, CHUNKS } from './glsl.js';

describe('glsl chunks', () => {
  it('model chunk defines every function the JS mirror exports', () => {
    for (const fn of ['gm_sersicRe', 'gm_barAngle', 'gm_omega', 'gm_orbitAngle', 'gm_eccentricity', 'gm_armPhase', 'gm_crest', 'gm_dustColumn', 'gm_blackbody', 'gm_sersic']) {
      expect(CHUNKS.model).toContain(`${fn}(`);
    }
    expect(CHUNKS.noise).toContain('gn_ign(');
  });

  it('keeps the same magic numbers as densityModel.js', () => {
    expect(CHUNKS.model).toContain('differential / (a + 0.25)');
    expect(CHUNKS.model).toContain('log(1.0 + max(a, 0.0) / 0.25) / 1.6094379124');
    expect(Math.log(5)).toBeCloseTo(1.6094379124, 9);
    expect(CHUNKS.model).toContain('gm_smoothstep(0.04, 0.3, a)');
    expect(CHUNKS.model).toContain('99.4708025861');
  });

  it('glsl joins parts with newlines', () => {
    expect(glsl('a', 'b')).toBe('a\nb');
  });
});
