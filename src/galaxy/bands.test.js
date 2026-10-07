import { describe, it, expect } from 'vitest';
import { BANDS, BAND_OPTIONS, bandFor, nextBand, lumaTint } from './bands.js';
import { createGalaxyUniforms, applyBandUniforms } from './galaxyUniforms.js';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

describe('bands', () => {
  it('defines every option with the same keys and sizes as visible', () => {
    expect(Object.keys(BANDS)).toEqual(BAND_OPTIONS);
    const keys = Object.keys(BANDS.visible).sort();
    for (const name of BAND_OPTIONS) {
      const b = BANDS[name];
      expect(Object.keys(b).sort()).toEqual(keys);
      expect(b.starColor).toHaveLength(9);
      expect(b.lightColor).toHaveLength(9);
      for (const v of [b.hiiColor, b.hiiCore, b.gasColor, b.skyTint]) expect(v).toHaveLength(3);
      expect(b.starKeep).toBeGreaterThan(0);
      expect(b.starKeep).toBeLessThanOrEqual(1);
    }
  });

  it('leaves the visible render unchanged', () => {
    const v = BANDS.visible;
    expect(v.starColor).toEqual(IDENTITY);
    expect(v.lightColor).toEqual(IDENTITY);
    expect([v.starGain, v.starKeep, v.dustPass, v.hiiGain, v.discGain, v.bulgeGain, v.snGain, v.fieldGain, v.agnGain, v.jetGain]).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(v.discFalloff).toBe(0);
    expect(v.gasColor).toEqual([0, 0, 0]);
    expect(v.gasHole).toBe(0);
    expect(v.skyTint).toEqual([1, 1, 1]);
  });

  it('models each band physically', () => {
    expect(BANDS.infrared.dustPass).toBeLessThan(0.2); // IR sees through dust
    expect(Math.max(...BANDS.infrared.gasColor)).toBeGreaterThan(0); // dust glows
    expect(BANDS.radio.starGain).toBe(0); // no stars in HI
    expect(BANDS.radio.gasHole).toBeGreaterThan(0); // central HI hole
    expect(BANDS.xray.starKeep).toBeLessThan(0.05); // only compact sources
    expect(BANDS.xray.bulgeGain).toBeGreaterThan(1); // hot gas
  });

  it('falls back to visible and cycles in order', () => {
    expect(bandFor('gamma')).toBe(BANDS.visible);
    expect(nextBand('visible')).toBe('hubble');
    expect(nextBand('xray')).toBe('visible');
    expect(nextBand('bogus')).toBe('visible');
  });

  it('lumaTint maps a colour to its luminance times the tint', () => {
    const m = lumaTint([1, 0.5, 0]);
    const apply = (c) => [0, 1, 2].map((r) => m[r * 3] * c[0] + m[r * 3 + 1] * c[1] + m[r * 3 + 2] * c[2]);
    expect(apply([1, 1, 1])).toEqual([expect.closeTo(1), expect.closeTo(0.5), 0]);
  });
});

describe('applyBandUniforms', () => {
  it('starts visible and switches every band uniform', () => {
    const u = createGalaxyUniforms();
    expect(u.uBandHiiColor.value.toArray()).toEqual(BANDS.visible.hiiColor);
    expect(u.uBandStarColor.value.elements).toEqual(IDENTITY);
    applyBandUniforms(u, 'radio');
    expect(u.uBandStarGain.value).toBe(0);
    expect(u.uBandGasColor.value.toArray()).toEqual(BANDS.radio.gasColor);
    expect(u.uBandGasHole.value).toBe(BANDS.radio.gasHole);
    applyBandUniforms(u, 'xray');
    // Matrix3.set takes row-major values; elements are column-major.
    expect(u.uBandLightColor.value.elements[1]).toBeCloseTo(BANDS.xray.lightColor[3]);
  });
});
