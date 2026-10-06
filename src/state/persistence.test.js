import { describe, it, expect } from 'vitest';
import { serialize, deserialize, save, load, clear, STORAGE_KEY } from './persistence.js';
import { createStore, createInitialState, STATE_VERSION } from './store.js';
import { createActions } from './actions.js';
import { MAX_GALAXIES, LIMITS } from '../galaxy/params.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    data,
  };
}

function sampleState() {
  let n = 0;
  const actions = createActions({ makeId: () => `g${++n}`, makeSeed: () => 99 });
  const store = createStore();
  store.dispatch(actions.addGalaxy(store.getState(), 'spiral'));
  store.dispatch(actions.addGalaxy(store.getState(), 'elliptical'));
  store.dispatch(actions.updateGalaxy('g1', { look: { colorInner: '#123456' } }));
  store.dispatch(actions.updateSettings({ timeScale: 2.5, bloomStrength: 1.2 }));
  return store.getState();
}

describe('persistence round trip', () => {
  it('restores galaxies, selection and settings', () => {
    const state = sampleState();
    const restored = deserialize(serialize(state));
    expect(restored.galaxies).toEqual(state.galaxies);
    expect(restored.selectedId).toBe(state.selectedId);
    expect(restored.settings).toEqual(state.settings);
  });

  it('save/load use the versioned key on the injected storage', () => {
    const storage = memoryStorage();
    const state = sampleState();
    expect(save(state, storage)).toBe(true);
    expect([...storage.data.keys()]).toEqual([STORAGE_KEY]);
    expect(load(storage).galaxies).toHaveLength(2);
    clear(storage);
    expect(load(storage)).toBeNull();
  });

  it('never restores the paused state', () => {
    const state = { ...sampleState(), settings: { ...sampleState().settings, paused: true } };
    expect(deserialize(serialize(state)).settings.paused).toBe(false);
  });
});

describe('persistence robustness', () => {
  it.each([
    ['missing', null],
    ['empty', ''],
    ['corrupt JSON', '{not json'],
    ['wrong version', JSON.stringify({ version: STATE_VERSION + 1, galaxies: [] })],
    ['not an object', '42'],
  ])('returns null for %s data', (_label, json) => {
    expect(deserialize(json)).toBeNull();
  });

  it('clamps out-of-range values and drops broken galaxies', () => {
    const json = JSON.stringify({
      version: STATE_VERSION,
      galaxies: [
        { id: 'a', preset: 'spiral', seed: 1, shape: { count: 1e9, arms: -3 }, look: { radius: -5 }, motion: { speed: 99 } },
        { nope: true },
        { id: 'a', preset: 'spiral', seed: 2 },
      ],
      selectedId: 'missing',
      settings: { timeScale: 1e6, bloomStrength: 'x' },
    });
    const s = deserialize(json);
    expect(s.galaxies).toHaveLength(1);
    expect(s.galaxies[0].shape.count).toBe(LIMITS.shape.count.max);
    expect(s.galaxies[0].shape.arms).toBe(0);
    expect(s.galaxies[0].look.radius).toBe(LIMITS.look.radius.min);
    expect(s.galaxies[0].motion.speed).toBe(LIMITS.motion.speed.max);
    expect(s.selectedId).toBeNull();
    expect(s.settings.timeScale).toBe(5);
    expect(s.settings.bloomStrength).toBe(createInitialState().settings.bloomStrength);
  });

  it('enforces the galaxy and particle limits on load', () => {
    const galaxies = Array.from({ length: 20 }, (_, i) => ({ id: `g${i}`, preset: 'spiral', seed: i, shape: { count: 200_000 } }));
    const s = deserialize(JSON.stringify({ version: STATE_VERSION, galaxies }));
    expect(s.galaxies.length).toBeLessThanOrEqual(MAX_GALAXIES);
    expect(s.galaxies.reduce((t, g) => t + g.shape.count, 0)).toBeLessThanOrEqual(1_000_000);
  });

  it('save and load swallow storage errors', () => {
    const broken = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('quota');
      },
      removeItem() {
        throw new Error('blocked');
      },
    };
    expect(save(sampleState(), broken)).toBe(false);
    expect(load(broken)).toBeNull();
    expect(() => clear(broken)).not.toThrow();
  });
});
