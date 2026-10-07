import { describe, it, expect } from 'vitest';
import { spikeStyle, cinematicEnabled } from './quality.js';

describe('spikeStyle', () => {
  it('maps the setting to a shader style, off on cheap tiers', () => {
    expect(spikeStyle('jwst', 'medium')).toBe(2);
    expect(spikeStyle('hubble', 'high')).toBe(1);
    expect(spikeStyle('off', 'high')).toBe(0);
    expect(spikeStyle('jwst', 'low')).toBe(0);
    expect(spikeStyle('jwst', 'minimal')).toBe(0);
    expect(spikeStyle('bogus', 'high')).toBe(0);
  });
});

describe('cinematicEnabled', () => {
  const on = { vignette: 0.3, grain: 0, aberration: 0 };
  const off = { vignette: 0, grain: 0, aberration: 0 };
  it('runs when any effect is above 0 on Medium and High', () => {
    expect(cinematicEnabled(on, 'medium')).toBe(true);
    expect(cinematicEnabled({ ...off, grain: 0.1 }, 'high')).toBe(true);
    expect(cinematicEnabled({ ...off, aberration: 0.1 }, 'high')).toBe(true);
  });
  it('is skipped when all effects are 0 or the tier is cheap', () => {
    expect(cinematicEnabled(off, 'high')).toBe(false);
    expect(cinematicEnabled(on, 'low')).toBe(false);
    expect(cinematicEnabled(on, 'minimal')).toBe(false);
    expect(cinematicEnabled(on, 'bogus')).toBe(false);
  });
});

describe('holeMarch', () => {
  it('ray-marches black holes on High only, within the shader step cap', async () => {
    const { QUALITY } = await import('./quality.js');
    const { MAX_HOLE_STEPS } = await import('./BlackHolePass.js');
    for (const [name, tier] of Object.entries(QUALITY)) {
      expect(Boolean(tier.holeMarch)).toBe(name === 'high');
    }
    expect(QUALITY.high.holeSteps).toBeLessThanOrEqual(MAX_HOLE_STEPS);
  });
});

describe('intro tier', () => {
  it('overrides Auto and fixed tiers only for the intro scene', async () => {
    const { activeTier, QUALITY, TIER_ORDER, QUALITY_OPTIONS } = await import('./quality.js');
    expect(activeTier('low', 'medium')).toBe('low');
    expect(activeTier('auto', 'medium')).toBe('medium');
    expect(activeTier('low', 'medium', { intro: true })).toBe('intro');
    expect(activeTier('auto', 'minimal', { intro: true, mobile: true })).toBe('introMobile');
    for (const name of ['intro', 'introMobile']) {
      expect(QUALITY[name].holeMarch).toBe(false);
      expect(QUALITY[name].holeSamples).toBeGreaterThan(1);
      expect(TIER_ORDER).not.toContain(name);
      expect(QUALITY_OPTIONS).not.toContain(name);
      expect(spikeStyle('jwst', name)).toBe(2);
      expect(cinematicEnabled({ vignette: 0.3, grain: 0, aberration: 0 }, name)).toBe(true);
    }
  });
});
