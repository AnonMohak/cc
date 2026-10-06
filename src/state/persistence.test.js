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
        { id: 'a', preset: 'spiral', seed: 1, shape: { count: 1e9, clumps: -3 }, structure: { arms: 99 }, look: { radius: -5 }, motion: { speed: 99 } },
        { nope: true },
        { id: 'a', preset: 'spiral', seed: 2 },
      ],
      selectedId: 'missing',
      settings: { timeScale: 1e6, bloomStrength: 'x' },
    });
    const s = deserialize(json);
    expect(s.galaxies).toHaveLength(1);
    expect(s.galaxies[0].shape.count).toBe(LIMITS.shape.count.max);
    expect(s.galaxies[0].shape.clumps).toBe(0);
    expect(s.galaxies[0].structure.arms).toBe(6);
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

describe('v1 → v2 migration', () => {
  const v1 = {
    version: 1,
    galaxies: [
      {
        id: 'old',
        name: 'My spiral',
        preset: 'barred',
        seed: 77,
        shape: { count: 120000, arms: 4, spin: 1.2, armSpread: 0.3 },
        look: { radius: 9, colorInner: '#ff0000', tiltX: 20, position: [5, 0, 3] },
        motion: { speed: -1.2, differential: 0.25 },
      },
    ],
    selectedId: 'old',
    settings: { timeScale: 2, bloomStrength: 1.5 },
  };

  it('keeps identity, placement, size, tilt and speed; takes the rest from the preset', async () => {
    const { migrateV1 } = await import('./persistence.js');
    const { PRESETS } = await import('../galaxy/presets.js');
    const s = deserialize(JSON.stringify(v1));
    const g = s.galaxies[0];
    expect(s.version).toBe(STATE_VERSION);
    expect(g).toMatchObject({ id: 'old', name: 'My spiral', preset: 'barred', seed: 77 });
    expect(g.look).toMatchObject({ radius: 9, tiltX: 20, position: [5, 0, 3] });
    expect(g.motion.speed).toBe(-1.2);
    expect(g.shape.count).toBe(120000);
    expect(g.shape.barLength).toBe(PRESETS.barred.shape.barLength);
    expect(g.structure).toEqual(PRESETS.barred.structure);
    expect(g.shape).not.toHaveProperty('spin');
    expect(s.selectedId).toBe('old');
    expect(s.settings.timeScale).toBe(2);
    expect(migrateV1({ version: 1 }).galaxies).toEqual([]);
  });

  it('load() migrates the legacy key once and moves it to the v2 key', () => {
    const storage = memoryStorage();
    storage.setItem('galaxy-sandbox:v1', JSON.stringify(v1));
    const s = load(storage);
    expect(s.galaxies).toHaveLength(1);
    expect(storage.getItem('galaxy-sandbox:v1')).toBeNull();
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(STORAGE_KEY).toBe('galaxy-sandbox:v2');
  });
});

describe('quality and exposure settings', () => {
  it('accept known quality levels and clamp exposure', async () => {
    const { clampSettings } = await import('./store.js');
    // Old saved values (low/medium/high) stay valid; unknown ones fall back to Auto.
    for (const q of ['auto', 'minimal', 'low', 'medium', 'high']) expect(clampSettings({ quality: q }).quality).toBe(q);
    expect(clampSettings({ quality: 'ultra' }).quality).toBe('auto');
    expect(clampSettings({}).quality).toBe('auto');
    expect(clampSettings({ exposure: 99 }).exposure).toBe(2.5);
  });
});

describe('catalogue persistence', () => {
  it('round-trips the catalogue link', () => {
    const actions = createActions({ makeId: () => 'c1', makeSeed: () => 5 });
    const store = createStore();
    store.dispatch(actions.addCatalogueGalaxy(store.getState(), 'lmc'));
    expect(deserialize(serialize(store.getState())).galaxies[0].catalog).toBe('lmc');
  });
});

describe('HUD settings', () => {
  it('default on, accept booleans, and round-trip', async () => {
    const { clampSettings } = await import('./store.js');
    expect(clampSettings({})).toMatchObject({ labels: false, minimap: true, scaleBar: true });
    expect(clampSettings({ minimap: false, labels: 'no' })).toMatchObject({ minimap: false, labels: false });
  });
});
