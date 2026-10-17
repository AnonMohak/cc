import { describe, it, expect } from 'vitest';
import { sprayParticles, IntroSpray } from './introSpray.js';

describe('sprayParticles', () => {
  it('is seeded, in range, mostly faint', () => {
    const a = sprayParticles(2000, 3);
    expect(Array.from(a)).toEqual(Array.from(sprayParticles(2000, 3)));
    expect(Array.from(a)).not.toEqual(Array.from(sprayParticles(2000, 4)));
    let faint = 0;
    let legs = 0;
    for (let i = 0; i < 2000; i++) {
      expect(a[6 * i + 2]).toBeGreaterThanOrEqual(0);
      expect(a[6 * i + 2]).toBeLessThan(1);
      if (a[6 * i + 3] < 0.2) faint++;
      // A leg speck sits below the core, near one of the two lines.
      if (a[6 * i + 4] !== a[6 * i]) {
        legs++;
        expect(a[6 * i + 5]).toBeLessThan(0.3);
      }
    }
    expect(faint).toBeGreaterThan(800);
    expect(legs).toBeGreaterThan(650);
    expect(legs).toBeLessThan(950);
  });
});

describe('IntroSpray', () => {
  it('shows only once its shot has begun, and disposes', () => {
    const spray = new IntroSpray();
    expect(spray.active).toBe(false);
    spray.uniforms.uAge.value = 1;
    expect(spray.active).toBe(true);
    // Two vertices (a streak) per particle.
    expect(spray.geometry.getAttribute('position').count).toBe(2 * (sprayParticles().length / 6));
    expect(spray.geometry.getAttribute('aExtra').count).toBe(spray.geometry.getAttribute('position').count);
    expect(spray.geometry.getAttribute('aLeg').count).toBe(spray.geometry.getAttribute('position').count);
    // Soft round points and plain streaks: two different fragment shaders.
    expect(spray.pointMaterial.fragmentShader).toContain('gl_PointCoord');
    expect(spray.lineMaterial.fragmentShader).not.toContain('gl_PointCoord');
    expect(spray.lineMaterial.fragmentShader).toContain('SPRAY_LINE');
    spray.dispose();
  });
});
