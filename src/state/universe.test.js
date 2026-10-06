import { describe, it, expect, vi } from 'vitest';
import { generateUniverse, universeBounds } from './universe.js';
import { clampShape, clampStructure, clampLook, clampMotion, MAX_GALAXIES, MAX_TOTAL_PARTICLES } from '../galaxy/params.js';
import { createStore } from './store.js';
import { createActions } from './actions.js';
import { createHistory } from './history.js';

const dist = (a, b) => Math.hypot(...a.look.position.map((v, k) => v - b.look.position[k]));
const centerDist = (e, c) => Math.hypot(...e.look.position.map((v, k) => v - c[k]));

describe('generateUniverse', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    expect(generateUniverse({ layout: 'cluster', count: 8, seed: 5 })).toEqual(generateUniverse({ layout: 'cluster', count: 8, seed: 5 }));
    expect(generateUniverse({ layout: 'cluster', count: 8, seed: 5 })).not.toEqual(generateUniverse({ layout: 'cluster', count: 8, seed: 6 }));
  });

  it.each(['cluster', 'filament'])('%s: respects count and budgets, and galaxies never overlap', (layout) => {
    for (let seed = 1; seed <= 20; seed++) {
      const list = generateUniverse({ layout, count: 99, seed });
      expect(list.length).toBeLessThanOrEqual(MAX_GALAXIES);
      expect(list.length).toBeGreaterThanOrEqual(MAX_GALAXIES - 1);
      expect(list.reduce((s, g) => s + g.shape.count, 0)).toBeLessThanOrEqual(MAX_TOTAL_PARTICLES);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          expect(dist(list[i], list[j])).toBeGreaterThanOrEqual(list[i].look.radius + list[j].look.radius);
        }
      }
    }
  });

  it('produces params that are already within limits', () => {
    for (const g of generateUniverse({ layout: 'cluster', count: 10, seed: 3 })) {
      expect(clampShape(g.shape)).toEqual(g.shape);
      expect(clampStructure(g.structure)).toEqual(g.structure);
      expect(clampMotion(g.motion)).toEqual(g.motion);
      expect(clampLook(g.look)).toEqual(g.look);
    }
  });

  it('cluster: ellipticals sit nearer the core than spirals (morphology–density relation)', () => {
    let ellipticalDist = 0;
    let otherDist = 0;
    let ne = 0;
    let no = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const list = generateUniverse({ layout: 'cluster', count: 10, seed });
      const { center } = universeBounds(list);
      for (const g of list) {
        if (g.preset === 'elliptical') {
          ellipticalDist += centerDist(g, center);
          ne++;
        } else {
          otherDist += centerDist(g, center);
          no++;
        }
      }
    }
    expect(ellipticalDist / ne).toBeLessThan(otherDist / no);
  });

  it('filament: long and thin, mostly spirals', () => {
    const list = generateUniverse({ layout: 'filament', count: 10, seed: 11 });
    const xs = list.map((g) => g.look.position[0]);
    const ys = list.map((g) => g.look.position[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(3 * (Math.max(...ys) - Math.min(...ys)));
    const spirals = list.filter((g) => g.preset === 'spiral' || g.preset === 'barred').length;
    expect(spirals).toBeGreaterThanOrEqual(list.length / 2);
  });

  it('universeBounds encloses every galaxy', () => {
    const list = generateUniverse({ layout: 'cluster', count: 6, seed: 2 });
    const { center, radius } = universeBounds(list);
    for (const g of list) expect(centerDist(g, center) + g.look.radius).toBeLessThanOrEqual(radius + 1e-9);
  });
});

describe('generate action', () => {
  it('replaces the scene, clears selection, and is one undo step', () => {
    vi.useFakeTimers();
    let n = 0;
    const actions = createActions({ makeId: () => `u${++n}`, makeSeed: () => 42 });
    const store = createStore();
    const history = createHistory(store, { groupMs: 10 });
    store.dispatch(actions.addGalaxy(store.getState(), 'spiral'));
    vi.advanceTimersByTime(50);
    const before = store.getState().galaxies;
    store.dispatch(actions.generateUniverse('filament', 6));
    vi.advanceTimersByTime(50);
    const s = store.getState();
    expect(s.galaxies.length).toBeGreaterThanOrEqual(5);
    expect(s.selectedId).toBeNull();
    expect(new Set(s.galaxies.map((g) => g.id)).size).toBe(s.galaxies.length);
    history.undo();
    expect(store.getState().galaxies).toBe(before);
    vi.useRealTimers();
  });
});
