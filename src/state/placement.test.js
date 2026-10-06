import { describe, it, expect } from 'vitest';
import { findFreePosition } from './placement.js';

const g = (x, z, radius) => ({ look: { position: [x, 0, z], radius } });

describe('findFreePosition', () => {
  it('uses the target when it is free', () => {
    expect(findFreePosition([], [1, 2, 3], 5)).toEqual([1, 2, 3]);
    expect(findFreePosition([g(100, 0, 5)], [0, 0, 0], 5)).toEqual([0, 0, 0]);
  });

  it('moves away from an overlapping galaxy', () => {
    const existing = [g(0, 0, 6)];
    const [x, , z] = findFreePosition(existing, [0, 0, 0], 6);
    expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(12);
  });

  it('finds room among many galaxies', () => {
    const existing = [];
    for (let i = 0; i < 9; i++) {
      const [x, , z] = findFreePosition(existing, [0, 0, 0], 4);
      for (const e of existing) {
        expect(Math.hypot(e.look.position[0] - x, e.look.position[2] - z)).toBeGreaterThanOrEqual(8);
      }
      existing.push(g(x, z, 4));
    }
  });
});
