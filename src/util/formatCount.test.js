import { describe, it, expect } from 'vitest';
import { formatCount } from './formatCount.js';

describe('formatCount', () => {
  it('shortens thousands and millions', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(950)).toBe('950');
    expect(formatCount(80000)).toBe('80k');
    expect(formatCount(120500)).toBe('120.5k');
    expect(formatCount(1000000)).toBe('1m');
    expect(formatCount(1250000)).toBe('1.3m');
  });
});
