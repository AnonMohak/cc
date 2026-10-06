import { describe, it, expect } from 'vitest';
import { spikeStyle } from './quality.js';

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
