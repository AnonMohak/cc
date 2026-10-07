import { describe, it, expect } from 'vitest';
import { mixLevels, mixFades, AMBIENT_LEVEL, MUSIC_LEVEL, MUSIC_MIN, MUSIC_END_FADE } from './soundMix.js';

describe('mixLevels', () => {
  it('is silent when sound is off', () => {
    expect(mixLevels({ enabled: false, mode: 'fall', hasMusic: true })).toEqual({ ambient: 0, music: 0 });
  });

  it('plays the quiet drone outside the fall', () => {
    expect(mixLevels({ enabled: true, mode: 'ambient', hasMusic: true })).toEqual({ ambient: AMBIENT_LEVEL, music: 0 });
    expect(AMBIENT_LEVEL).toBeLessThan(0.1);
  });

  it('swaps the drone for the fall music, or keeps the drone without a track', () => {
    expect(mixLevels({ enabled: true, mode: 'fall', hasMusic: true })).toEqual({ ambient: 0, music: MUSIC_LEVEL });
    expect(mixLevels({ enabled: true, mode: 'fall', hasMusic: false })).toEqual({ ambient: AMBIENT_LEVEL, music: 0 });
  });
});

describe('intro music modes', () => {
  it('plays the track in the wait and the fall, the drone at the end', () => {
    expect(mixLevels({ enabled: true, mode: 'wait', hasMusic: true })).toEqual({ ambient: 0, music: MUSIC_LEVEL });
    expect(mixLevels({ enabled: true, mode: 'end', hasMusic: true })).toEqual({ ambient: AMBIENT_LEVEL, music: 0 });
    expect(mixLevels({ enabled: true, mode: 'wait', hasMusic: false })).toEqual({ ambient: AMBIENT_LEVEL, music: 0 });
  });

  it('rises over the rest of the wait and ends over 5 s before the drone returns', () => {
    expect(mixFades('wait', 4.7)).toMatchObject({ music: 4.7, rise: true });
    expect(mixFades('wait', 0).music).toBeGreaterThan(0);
    const end = mixFades('end');
    expect(end.music).toBe(MUSIC_END_FADE);
    expect(end.ambientDelay).toBe(MUSIC_END_FADE);
    expect(MUSIC_END_FADE).toBeCloseTo(5, 0);
    expect(MUSIC_MIN).toBeLessThan(MUSIC_LEVEL / 10);
  });
});
