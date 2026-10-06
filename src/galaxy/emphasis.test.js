import { describe, it, expect } from 'vitest';
import { emphasisTarget, approach } from './emphasis.js';
import { EMPHASIS_SELECTED, EMPHASIS_OTHERS } from './params.js';

describe('emphasisTarget', () => {
  it('is 1 for every galaxy when nothing is selected', () => {
    expect(emphasisTarget('a', null)).toBe(1);
  });

  it('lifts the selected galaxy a little and dims the others by 20–30%', () => {
    expect(emphasisTarget('a', 'a')).toBe(EMPHASIS_SELECTED);
    expect(emphasisTarget('b', 'a')).toBe(EMPHASIS_OTHERS);
    expect(EMPHASIS_SELECTED).toBeGreaterThan(1);
    expect(EMPHASIS_SELECTED).toBeLessThanOrEqual(1.2);
    expect(1 - EMPHASIS_OTHERS).toBeGreaterThanOrEqual(0.2);
    expect(1 - EMPHASIS_OTHERS).toBeLessThanOrEqual(0.3);
  });
});

describe('approach', () => {
  it('moves toward the target and settles within about 0.25 s', () => {
    let v = 1;
    v = approach(v, 0.75, 1 / 60);
    expect(v).toBeLessThan(1);
    expect(v).toBeGreaterThan(0.75);
    for (let t = 0; t < 0.3; t += 1 / 60) v = approach(v, 0.75, 1 / 60);
    expect(v).toBe(0.75);
  });

  it('does not move when dt is 0', () => {
    expect(approach(1, 0.5, 0)).toBe(1);
  });
});
