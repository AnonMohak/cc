import { describe, it, expect } from 'vitest';
import { infoFor } from './infoCard.js';

describe('infoFor', () => {
  it('is null for preset galaxies and missing entries', () => {
    expect(infoFor(null)).toBeNull();
    expect(infoFor({ name: 'Spiral 1', catalog: null })).toBeNull();
    expect(infoFor({ name: 'X', catalog: 'unknown' })).toBeNull();
  });

  it('lists facts for a catalogue galaxy', () => {
    const info = infoFor({ name: 'Andromeda (M31)', catalog: 'm31' });
    expect(info.title).toBe('Andromeda (M31)');
    expect(info.subtitle).toBe('SA(s)b spiral');
    expect(Object.fromEntries(info.rows)).toMatchObject({ Distance: '2.5 million ly', Constellation: 'Andromeda', Inclination: '77°' });
    expect(info.fact).toMatch(/Milky Way/);
  });

  it('says what a renamed galaxy is based on', () => {
    expect(infoFor({ name: 'My hat', catalog: 'm104' }).subtitle).toBe('“My hat”, based on Sombrero (M104)');
  });
});
