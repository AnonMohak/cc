import { describe, it, expect } from 'vitest';
import { fbmTile, getNoiseTexture } from './noiseTexture.js';

describe('fbmTile', () => {
  it('is deterministic and differs between seeds', () => {
    expect(fbmTile(1, 32, 4)).toEqual(fbmTile(1, 32, 4));
    expect(fbmTile(1, 32, 4)).not.toEqual(fbmTile(2, 32, 4));
  });

  it('stays in [0, 1] with a mean near 0.5', () => {
    const t = fbmTile(3, 64, 8);
    let sum = 0;
    for (const v of t) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      sum += v;
    }
    expect(sum / t.length).toBeGreaterThan(0.4);
    expect(sum / t.length).toBeLessThan(0.6);
  });

  it('tiles seamlessly: wrapping across an edge is as smooth as inside', () => {
    const size = 64;
    const t = fbmTile(5, size, 8);
    let inside = 0;
    let across = 0;
    for (let y = 0; y < size; y++) {
      inside += Math.abs(t[y * size + 1] - t[y * size + 2]);
      across += Math.abs(t[y * size + size - 1] - t[y * size]);
    }
    expect(across).toBeLessThan(inside * 2.5);
  });
});

describe('getNoiseTexture', () => {
  it('is shared and repeats', () => {
    const a = getNoiseTexture();
    expect(getNoiseTexture()).toBe(a);
    expect(a.wrapS).toBe(1000); // THREE.RepeatWrapping
  });
});
