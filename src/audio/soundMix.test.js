import { describe, it, expect } from 'vitest';
import { mixLevels, AMBIENT_LEVEL, MUSIC_LEVEL } from './soundMix.js';

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
