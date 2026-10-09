import { describe, it, expect } from 'vitest';
import { circleOfConfusion, easeFocus, easeRange, focusSpan, DOF_FAR, FOCUS_MARGIN } from './dof.js';

describe('circleOfConfusion', () => {
  it('is zero in focus and when off', () => {
    expect(circleOfConfusion(20, 20, 1, 10)).toBe(0);
    expect(circleOfConfusion(80, 20, 0, 10)).toBe(0);
  });

  it('grows with distance from the focus, saturates far away, and is capped', () => {
    const near = circleOfConfusion(30, 20, 1, 10);
    const far = circleOfConfusion(60, 20, 1, 10);
    expect(far).toBeGreaterThan(near);
    expect(circleOfConfusion(DOF_FAR, 20, 1, 10)).toBeCloseTo(10, 1);
    expect(circleOfConfusion(DOF_FAR, 20, 0.5, 10)).toBeCloseTo(5, 1);
    expect(circleOfConfusion(2, 20, 1, 10)).toBe(10); // very near: capped
  });
});

describe('easeFocus', () => {
  it('moves toward the target and snaps at the end', () => {
    let f = 10;
    f = easeFocus(f, 20, 0.1);
    expect(f).toBeGreaterThan(10);
    expect(f).toBeLessThan(20);
    for (let i = 0; i < 100; i++) f = easeFocus(f, 20, 0.1);
    expect(f).toBe(20);
    expect(easeFocus(0, 15, 0.1)).toBe(15);
  });
});

describe('focus range', () => {
  it('keeps everything within the range sharp and blurs from its edge', () => {
    expect(circleOfConfusion(25, 20, 1, 10, 5)).toBe(0);
    expect(circleOfConfusion(15, 20, 1, 10, 5)).toBe(0);
    expect(circleOfConfusion(30, 20, 1, 10, 5)).toBeCloseTo((10 * 5) / 30);
  });

  it('focusSpan centres on the span and covers every depth', () => {
    const out = focusSpan([30, 10, 20], 3, { focus: 0, range: 0 });
    expect(out.focus).toBe(20);
    expect(out.range).toBeCloseTo(10 + 20 * FOCUS_MARGIN);
    for (const d of [10, 20, 30]) expect(circleOfConfusion(d, out.focus, 1, 10, out.range)).toBe(0);
    expect(focusSpan([12], 1, out)).toEqual({ focus: 12, range: 0 });
  });

  it('easeRange moves toward the target and snaps, also to 0', () => {
    let r = 8;
    for (let i = 0; i < 200; i++) r = easeRange(r, 0, 50, 0.1);
    expect(r).toBe(0);
    expect(easeRange(0, 4, 50, 0.1)).toBeGreaterThan(0);
  });
});
