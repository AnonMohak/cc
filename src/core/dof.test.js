import { describe, it, expect } from 'vitest';
import { circleOfConfusion, easeFocus, DOF_FAR } from './dof.js';

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
