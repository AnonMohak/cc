import { describe, it, expect } from 'vitest';
import { spikeStyle, cinematicEnabled, dofEnabled } from './quality.js';

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
  it('ray-marches black holes on Accurate only, within the shader step cap', async () => {
    const { QUALITY, TIER_ORDER, QUALITY_OPTIONS } = await import('./quality.js');
    const { MAX_HOLE_STEPS } = await import('./BlackHolePass.js');
    for (const [name, tier] of Object.entries(QUALITY)) {
      expect(Boolean(tier.holeMarch)).toBe(name === 'accurate');
    }
    expect(QUALITY.accurate.holeSteps).toBeLessThanOrEqual(MAX_HOLE_STEPS);
    // A manual choice: Auto never picks it.
    expect(TIER_ORDER).not.toContain('accurate');
    expect(QUALITY_OPTIONS).toContain('accurate');
  });
});

describe('activeTier', () => {
  it('is the setting, or the governor tier on Auto', async () => {
    const { activeTier } = await import('./quality.js');
    expect(activeTier('low', 'medium')).toBe('low');
    expect(activeTier('auto', 'medium')).toBe('medium');
  });
});

describe('dofEnabled', () => {
  it('runs with an amount on Medium and High only', () => {
    expect(dofEnabled(0.5, 'medium')).toBe(true);
    expect(dofEnabled(0.5, 'high')).toBe(true);
    expect(dofEnabled(0, 'high')).toBe(false);
    expect(dofEnabled(0.5, 'low')).toBe(false);
    expect(dofEnabled(0.5, 'minimal')).toBe(false);
  });
});
