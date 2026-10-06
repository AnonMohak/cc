import { describe, it, expect } from 'vitest';
import { moveDirection, applyLook } from './flyControls.js';

describe('moveDirection', () => {
  it('maps WASD and Q/E to local axes', () => {
    expect(moveDirection(new Set(['KeyW']))).toEqual([0, 0, -1]);
    expect(moveDirection(new Set(['KeyD']))).toEqual([1, 0, 0]);
    expect(moveDirection(new Set(['KeyE']))).toEqual([0, 1, 0]);
    expect(moveDirection(new Set())).toEqual([0, 0, 0]);
  });

  it('normalises diagonals and cancels opposites', () => {
    const [x, , z] = moveDirection(new Set(['KeyW', 'KeyD']));
    expect(Math.hypot(x, z)).toBeCloseTo(1);
    expect(moveDirection(new Set(['KeyW', 'KeyS']))).toEqual([0, 0, 0]);
    expect(moveDirection(new Set(['KeyX', 'ShiftLeft']))).toEqual([0, 0, 0]);
  });
});

describe('applyLook', () => {
  it('turns with the drag and stops pitch short of straight up', () => {
    expect(applyLook(0, 0, 100, 0).yaw).toBeLessThan(0);
    const up = applyLook(0, 0, 0, -100000);
    expect(up.pitch).toBeLessThan(Math.PI / 2);
    expect(up.pitch).toBeGreaterThan(1.5);
  });
});
