import { describe, it, expect } from 'vitest';
import { diffGalaxies } from './diffGalaxies.js';
import { DEFAULT_SHAPE, DEFAULT_LOOK, DEFAULT_MOTION } from '../galaxy/params.js';

const entry = (id, over = {}) => ({
  id,
  seed: 1,
  shape: DEFAULT_SHAPE,
  look: DEFAULT_LOOK,
  motion: DEFAULT_MOTION,
  ...over,
});

describe('diffGalaxies', () => {
  it('finds added and removed galaxies', () => {
    const a = entry('a');
    const b = entry('b');
    const d = diffGalaxies([a], [b]);
    expect(d.added).toEqual([b]);
    expect(d.removed).toEqual(['a']);
  });

  it('reports nothing for the same object', () => {
    const a = entry('a');
    const d = diffGalaxies([a], [a]);
    expect(d).toEqual({ added: [], removed: [], shapeChanged: [], lookChanged: [] });
  });

  it('a shape value change is a shapeChange only', () => {
    const a = entry('a');
    const a2 = { ...a, shape: { ...a.shape, arms: 4 } };
    const d = diffGalaxies([a], [a2]);
    expect(d.shapeChanged).toEqual([a2]);
    expect(d.lookChanged).toEqual([]);
  });

  it('a new shape object with equal values does not rebuild', () => {
    const a = entry('a');
    const d = diffGalaxies([a], [{ ...a, shape: { ...a.shape } }]);
    expect(d.shapeChanged).toEqual([]);
  });

  it('a seed change rebuilds', () => {
    const a = entry('a');
    expect(diffGalaxies([a], [{ ...a, seed: 2 }]).shapeChanged).toHaveLength(1);
  });

  it('look and motion changes are lookChanges', () => {
    const a = entry('a');
    const d1 = diffGalaxies([a], [{ ...a, look: { ...a.look, radius: 9 } }]);
    const d2 = diffGalaxies([a], [{ ...a, motion: { ...a.motion, speed: 2 } }]);
    expect(d1.lookChanged).toHaveLength(1);
    expect(d2.lookChanged).toHaveLength(1);
    expect(d1.shapeChanged).toHaveLength(0);
  });
});
