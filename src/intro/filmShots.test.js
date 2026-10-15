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

  it('give about 24.5 s of black-hole film', () => {
    const total = FILM_SHOTS.reduce((sum, s) => sum + shotSeconds(s), 0);
    expect(total).toBeGreaterThan(24);
    expect(total).toBeLessThan(25);
  });

  it('place still 1 at clip frame 10', () => {
    expect(clipSeconds(stillClipFrame(1))).toBeCloseTo(0.417, 3);
  });
});
