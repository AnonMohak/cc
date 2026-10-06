import { describe, it, expect } from 'vitest';
import { supernovaLight, createSupernovaSchedule, pickSupernovaSite, LIFETIME, MEAN_INTERVAL, SUPERNOVA_SLOTS } from './supernovae.js';
import { createRandom } from './random.js';

describe('supernovaLight', () => {
  it('rises fast, peaks at 1, fades to 0 by the end of its life', () => {
    expect(supernovaLight(-1)).toBe(0);
    expect(supernovaLight(0)).toBe(0);
    expect(supernovaLight(0.25)).toBeCloseTo(1, 5);
    expect(supernovaLight(1.5)).toBeLessThan(supernovaLight(0.5));
    expect(supernovaLight(LIFETIME - 0.01)).toBeLessThan(0.01);
    expect(supernovaLight(LIFETIME)).toBe(0);
  });
});

describe('createSupernovaSchedule', () => {
  it('fires at about the mean rate and is deterministic', () => {
    const count = (seed) => {
      const s = createSupernovaSchedule(seed);
      let n = 0;
      for (let t = 0; t < 900; t += 0.1) n += s.update(0.1);
      return n;
    };
    const n = count(1);
    expect(n).toBeGreaterThan((900 / MEAN_INTERVAL) * 0.7);
    expect(n).toBeLessThan((900 / MEAN_INTERVAL) * 1.3);
    expect(count(1)).toBe(n);
  });

  it('does nothing while paused and caps a burst at the slot count', () => {
    const s = createSupernovaSchedule(2);
    expect(s.update(0)).toBe(0);
    expect(s.update(1e6)).toBe(SUPERNOVA_SLOTS);
  });
});

describe('pickSupernovaSite', () => {
  it('prefers young stars and never picks cluster stars', () => {
    const n = 100;
    const orbit = new Float32Array(n * 4);
    const star = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) orbit[i * 4 + 3] = i < 50 ? 4 : 0; // half cluster stars
    star[77 * 3 + 2] = 1; // one young star
    const rng = createRandom(3);
    let young = 0;
    for (let k = 0; k < 200; k++) {
      const i = pickSupernovaSite(rng, orbit, star, n);
      expect(orbit[i * 4 + 3]).toBe(0);
      if (i === 77) young++;
    }
    expect(young).toBeGreaterThan(0);
    expect(pickSupernovaSite(rng, orbit, star, 0)).toBe(-1);
  });
});

describe('pickSupernovaSite core avoidance', () => {
  it('avoids the bright core when other stars exist', () => {
    const n = 100;
    const orbit = new Float32Array(n * 4);
    const star = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) orbit[i * 4] = i < 80 ? 0.05 : 0.6;
    const rng = createRandom(5);
    for (let k = 0; k < 100; k++) expect(orbit[pickSupernovaSite(rng, orbit, star, n) * 4]).toBeCloseTo(0.6);
  });
});
