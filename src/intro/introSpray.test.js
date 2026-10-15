import { describe, it, expect } from 'vitest';
import { sprayParticles, IntroSpray } from './introSpray.js';

describe('sprayParticles', () => {
  it('is seeded, in range, mostly faint', () => {
    const a = sprayParticles(2000, 3);
    expect(Array.from(a)).toEqual(Array.from(sprayParticles(2000, 3)));
    expect(Array.from(a)).not.toEqual(Array.from(sprayParticles(2000, 4)));
    let faint = 0;
    for (let i = 0; i < 2000; i++) {
      expect(a[4 * i + 2]).toBeGreaterThanOrEqual(0);
      expect(a[4 * i + 2]).toBeLessThan(1);
      if (a[4 * i + 3] < 0.2) faint++;
    }
    expect(faint).toBeGreaterThan(1000);
  });
});

describe('IntroSpray', () => {
  it('shows only once its shot has begun, and disposes', () => {
    const spray = new IntroSpray();
    expect(spray.active).toBe(false);
    spray.uniforms.uAge.value = 1;
    expect(spray.active).toBe(true);
    // Two vertices (a streak) per particle.
    expect(spray.geometry.getAttribute('position').count).toBe(2 * (sprayParticles().length / 4));
    expect(spray.geometry.getAttribute('aExtra').count).toBe(spray.geometry.getAttribute('position').count);
    spray.dispose();
  });
});
