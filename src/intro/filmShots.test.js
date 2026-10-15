import { describe, it, expect } from 'vitest';
import { FILM_SHOTS, stillClipFrame, clipSeconds, shotSeconds, shotOfFrame } from './filmShots.js';

describe('FILM_SHOTS', () => {
  it('are in film order and do not overlap', () => {
    for (let i = 1; i < FILM_SHOTS.length; i++) expect(FILM_SHOTS[i].first).toBeGreaterThan(FILM_SHOTS[i - 1].last);
  });

  it('hold their stills', () => {
    for (const shot of FILM_SHOTS) {
      for (const still of shot.stills) expect(shotOfFrame(stillClipFrame(still))).toBe(shot);
    }
  });

  it('leave the actor stills out', () => {
    for (const still of [7, 8, 9, 21, 22]) expect(shotOfFrame(stillClipFrame(still))).toBeNull();
  });

  it('give about 24.5 s of black-hole film before the plunge, 12 s for it', () => {
    const before = FILM_SHOTS.filter((s) => s.stills.length).reduce((sum, s) => sum + shotSeconds(s), 0);
    const plunge = FILM_SHOTS.filter((s) => !s.stills.length).reduce((sum, s) => sum + shotSeconds(s), 0);
    expect(before).toBeGreaterThan(24);
    expect(before).toBeLessThan(25);
    expect(plunge).toBeCloseTo(11.97, 1);
  });

  it('place still 1 at clip frame 10', () => {
    expect(clipSeconds(stillClipFrame(1))).toBeCloseTo(0.417, 3);
  });
});

describe('scoreMask', () => {
  it('leaves the film shadow out of the score, but not of the features', async () => {
    const { scoreMask, measureMask } = await import('./filmFeatures.js');
    const m = { shot: 'wall', frame: 0, ship: null, shadow: { cx: 0.5, cy: 0.5, r: 0.2 } };
    const w = 96;
    const h = 54;
    const at = (mask, u, v) => mask[Math.floor(v * h) * w + Math.floor(u * w)];
    expect(at(scoreMask(m, w, h), 0.5 / (w / h), 0.5)).toBe(0);
    expect(at(scoreMask(m, w, h), 0.9, 0.9)).toBe(1);
    expect(at(measureMask('wall', null, w, h), 0.5 / (w / h), 0.5)).toBe(1);
  });
});
