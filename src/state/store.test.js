import { describe, it, expect, vi } from 'vitest';
import {
  createStore,
  createInitialState,
  reducer,
  totalParticles,
  canAddGalaxy,
  clampSettings,
  sanitizeGalaxy,
  isIntroScene,
  splitIntroStart,
  restorePending,
  DEFAULT_SETTINGS,
} from './store.js';
import { createActions } from './actions.js';
import { tiltForInclination } from '../galaxy/catalogue.js';
import { MAX_GALAXIES, MAX_TOTAL_PARTICLES, LIMITS } from '../galaxy/params.js';

function setup() {
  let n = 0;
  const actions = createActions({ makeId: () => `id${++n}`, makeSeed: () => 42 });
  const store = createStore();
  const add = (preset = 'spiral') => store.dispatch(actions.addGalaxy(store.getState(), preset));
  return { store, actions, add };
}

describe('store', () => {
  it('notifies subscribers with next and prev, and not for no-ops', () => {
    const { store, actions, add } = setup();
    const fn = vi.fn();
    store.subscribe(fn);
    add();
    expect(fn).toHaveBeenCalledOnce();
    const [next, prev] = fn.mock.calls[0];
    expect(next.galaxies).toHaveLength(1);
    expect(prev.galaxies).toHaveLength(0);
    store.dispatch(actions.removeGalaxy('missing'));
    store.dispatch({ type: 'unknown' });
    expect(fn).toHaveBeenCalledOnce();
  });

  it('unsubscribe stops notifications', () => {
    const { store, add } = setup();
    const fn = vi.fn();
    const off = store.subscribe(fn);
    off();
    add();
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('reducer: galaxies', () => {
  it('adds a galaxy, names it and selects it', () => {
    const { store, add } = setup();
    add('barred');
    const s = store.getState();
    expect(s.galaxies[0]).toMatchObject({ id: 'id1', preset: 'barred', seed: 42, name: 'Barred spiral 1' });
    expect(s.selectedId).toBe('id1');
  });

  it('places a second galaxy so it does not overlap the first', () => {
    const { store, add } = setup();
    add();
    add();
    const [a, b] = store.getState().galaxies;
    const d = Math.hypot(a.look.position[0] - b.look.position[0], a.look.position[2] - b.look.position[2]);
    expect(d).toBeGreaterThanOrEqual(a.look.radius + b.look.radius);
    expect(b.name).toBe('Spiral 2');
  });

  it('ignores duplicate ids', () => {
    const { store, actions } = setup();
    const action = actions.addGalaxy(store.getState());
    store.dispatch(action);
    const before = store.getState();
    store.dispatch(action);
    expect(store.getState()).toBe(before);
  });

  it('enforces the galaxy count limit', () => {
    const { store, add } = setup();
    for (let i = 0; i < MAX_GALAXIES + 3; i++) add('irregular');
    expect(store.getState().galaxies).toHaveLength(MAX_GALAXIES);
  });

  it('enforces the total particle budget on add and on update', () => {
    const { store, actions, add } = setup();
    for (let i = 0; i < 6; i++) add();
    for (const g of store.getState().galaxies) {
      store.dispatch(actions.updateGalaxy(g.id, { shape: { count: LIMITS.shape.count.max } }));
    }
    const s = store.getState();
    expect(totalParticles(s)).toBeLessThanOrEqual(MAX_TOTAL_PARTICLES);
    expect(canAddGalaxy(s, 100_000)).toBe(false);
  });

  it('removing the selected galaxy clears the selection', () => {
    const { store, actions, add } = setup();
    add();
    add();
    store.dispatch(actions.selectGalaxy('id1'));
    store.dispatch(actions.removeGalaxy('id1'));
    expect(store.getState().selectedId).toBeNull();
    expect(store.getState().galaxies.map((g) => g.id)).toEqual(['id2']);
  });

  it('removing another galaxy keeps the selection', () => {
    const { store, actions, add } = setup();
    add();
    add();
    store.dispatch(actions.removeGalaxy('id1'));
    expect(store.getState().selectedId).toBe('id2');
  });

  it('update merges and clamps each group without touching the others', () => {
    const { store, actions, add } = setup();
    add();
    const before = store.getState().galaxies[0];
    store.dispatch(actions.updateGalaxy('id1', { look: { radius: 999, colorInner: '#112233' } }));
    const after = store.getState().galaxies[0];
    expect(after.look.radius).toBe(LIMITS.look.radius.max);
    expect(after.look.colorInner).toBe('#112233');
    expect(after.look.colorOuter).toBe(before.look.colorOuter);
    expect(after.shape).toBe(before.shape);
    expect(after.motion).toBe(before.motion);
  });

  it('reseed and rename', () => {
    let seed = 1;
    const actions = createActions({ makeId: () => 'x', makeSeed: () => seed++ });
    const store = createStore();
    store.dispatch(actions.addGalaxy(store.getState()));
    store.dispatch(actions.reseedGalaxy('x'));
    store.dispatch(actions.updateGalaxy('x', { name: '  Andromeda  ' }));
    expect(store.getState().galaxies[0]).toMatchObject({ seed: 2, name: 'Andromeda' });
  });

  it('applyPreset keeps position but resets shape, look and motion', () => {
    const { store, actions, add } = setup();
    add();
    store.dispatch(actions.updateGalaxy('id1', { look: { position: [5, 1, 5] } }));
    const g = store.getState().galaxies[0];
    store.dispatch(actions.applyPreset(g, 'elliptical'));
    const after = store.getState().galaxies[0];
    expect(after.structure.arms).toBe(0);
    expect(after.shape.bulgeFraction).toBeGreaterThan(0.9);
    expect(after.preset).toBe('elliptical');
    expect(after.look.position).toEqual([5, 1, 5]);
  });

  it('select ignores unknown ids', () => {
    const { store, actions, add } = setup();
    add();
    store.dispatch(actions.selectGalaxy('nope'));
    expect(store.getState().selectedId).toBeNull();
  });
});

describe('reducer: settings and scene', () => {
  it('clamps settings', () => {
    const s = reducer(createInitialState(), { type: 'settings/update', patch: { timeScale: 99, paused: 'yes' } });
    expect(s.settings.timeScale).toBe(5);
    expect(s.settings.paused).toBe(false);
    expect(clampSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps the post-processing amounts to 0–1 and fills them in for old saves', () => {
    const s = clampSettings({ flare: 3, vignette: -1, grain: 'x' });
    expect(s.flare).toBe(1);
    expect(s.vignette).toBe(0);
    expect(s.grain).toBe(DEFAULT_SETTINGS.grain);
    expect(clampSettings({}).aberration).toBe(DEFAULT_SETTINGS.aberration);
  });

  it('turns depth of field on by default, also for saves from before (old key dof)', () => {
    expect(DEFAULT_SETTINGS.depthOfField).toBe(0.35);
    expect(clampSettings({ dof: 0 }).depthOfField).toBe(0.35);
    expect(clampSettings({ depthOfField: 0 }).depthOfField).toBe(0);
  });

  it('keeps a known wavelength band and falls back to visible', () => {
    expect(clampSettings({ band: 'radio' }).band).toBe('radio');
    expect(clampSettings({ band: 'gamma' }).band).toBe('visible');
  });

  it('reset clears galaxies but keeps settings', () => {
    const { store, actions, add } = setup();
    add();
    store.dispatch(actions.updateSettings({ timeScale: 2 }));
    store.dispatch(actions.resetScene());
    expect(store.getState().galaxies).toEqual([]);
    expect(store.getState().settings.timeScale).toBe(2);
  });

  it('load replaces the state', () => {
    const { store, actions } = setup();
    const loaded = { ...createInitialState(), selectedId: null };
    store.dispatch(actions.loadState(loaded));
    expect(store.getState()).toBe(loaded);
  });
});

describe('sanitizeGalaxy', () => {
  it('rejects entries without an id and repairs the rest', () => {
    expect(sanitizeGalaxy({})).toBeNull();
    const g = sanitizeGalaxy({ id: 'a', preset: 'nope', seed: 'x', shape: { count: -1 } });
    expect(g.preset).toBe('spiral');
    expect(g.seed).toBe(1);
    expect(g.shape.count).toBe(LIMITS.shape.count.min);
  });
});

describe('catalogue galaxies', () => {
  it('addCatalogueGalaxy adds a named, tilted galaxy that remembers its origin', () => {
    const { store, actions } = setup();
    store.dispatch(actions.addCatalogueGalaxy(store.getState(), 'm104'));
    const g = store.getState().galaxies[0];
    expect(g).toMatchObject({ name: 'Sombrero (M104)', catalog: 'm104', preset: 'spiral' });
    expect(g.look.tiltX).toBe(tiltForInclination(84));
    expect(store.getState().selectedId).toBe(g.id);
  });

  it('unknown catalogue ids are a no-op', () => {
    const { store, actions } = setup();
    const before = store.getState();
    store.dispatch(actions.addCatalogueGalaxy(before, 'm999'));
    expect(store.getState()).toBe(before);
  });

  it('applying a generic preset clears the catalogue link', () => {
    const { store, actions } = setup();
    store.dispatch(actions.addCatalogueGalaxy(store.getState(), 'm31'));
    const g = store.getState().galaxies[0];
    store.dispatch(actions.applyPreset(g, 'barred'));
    expect(store.getState().galaxies[0].catalog).toBeNull();
  });

  it('sanitize keeps valid catalogue ids and drops invalid ones; preset galaxies have none', () => {
    expect(sanitizeGalaxy({ id: 'a', catalog: 'm87' }).catalog).toBe('m87');
    expect(sanitizeGalaxy({ id: 'a', catalog: 'evil' }).catalog).toBeNull();
    const { store, add } = setup();
    add();
    expect(store.getState().galaxies[0].catalog).toBeNull();
  });
});

describe('standalone black holes', () => {
  it('adds a named black hole with clamped hole params', () => {
    const { store, actions } = setup();
    store.dispatch(actions.addBlackHole(store.getState()));
    const [hole] = store.getState().galaxies;
    expect(hole.kind).toBe('blackhole');
    expect(hole.name).toBe('Black hole 1');
    expect(hole.hole.discSize).toBe(18);
    expect(store.getState().selectedId).toBe(hole.id);
  });

  it('updates and clamps the hole group, only on black holes', () => {
    const { store, actions, add } = setup();
    store.dispatch(actions.addBlackHole(store.getState()));
    add();
    const [hole, galaxy] = store.getState().galaxies;
    store.dispatch(actions.updateGalaxy(hole.id, { hole: { size: 99, colorHot: 'red', streak: false } }));
    const next = store.getState().galaxies[0].hole;
    expect(next.size).toBe(LIMITS.hole.size.max);
    expect(next.colorHot).toBe(hole.hole.colorHot);
    expect(next.streak).toBe(false);
    store.dispatch(actions.updateGalaxy(galaxy.id, { hole: { size: 0.05 } }));
    expect(store.getState().galaxies[1].hole).toBeUndefined();
  });

  it('keeps galaxy entries free of black-hole fields', () => {
    const { store, add } = setup();
    add();
    const [g] = store.getState().galaxies;
    expect('kind' in g).toBe(false);
    expect('hole' in g).toBe(false);
  });
});

describe('animation black hole (intro)', () => {
  const intro = (store, actions) => store.dispatch(actions.addBlackHole(store.getState(), [0, 0, 0], { intro: true }));

  it('opens every load on the intro and holds a saved scene back', () => {
    const { store, add } = setup();
    add();
    add();
    const saved = { ...store.getState(), settings: { ...store.getState().settings, sound: false } };
    const { state, pending } = splitIntroStart(saved);
    expect(state.galaxies).toEqual([]);
    expect(state.selectedId).toBeNull();
    expect(state.settings.sound).toBe(false);
    expect(pending.galaxies).toBe(saved.galaxies);
    expect(pending.selectedId).toBe(saved.selectedId);
    // Settings changed during the intro are kept on restore.
    const back = restorePending({ ...state, settings: { ...state.settings, sound: true } }, pending);
    expect(back.galaxies).toBe(saved.galaxies);
    expect(back.selectedId).toBe(saved.selectedId);
    expect(back.settings.sound).toBe(true);
  });

  it('holds nothing back for a fresh, empty or intro-only save', () => {
    expect(splitIntroStart(null).pending).toBeNull();
    expect(splitIntroStart(null).state.galaxies).toEqual([]);
    expect(splitIntroStart(createInitialState()).pending).toBeNull();
    const { store, actions } = setup();
    intro(store, actions);
    const { state, pending } = splitIntroStart(store.getState());
    expect(pending).toBeNull();
    expect(isIntroScene(state)).toBe(true);
  });

  it('the first add replaces it, in one action', () => {
    const { store, actions, add } = setup();
    intro(store, actions);
    expect(isIntroScene(store.getState())).toBe(true);
    add();
    const { galaxies, selectedId } = store.getState();
    expect(galaxies).toHaveLength(1);
    expect(galaxies[0].kind).toBeUndefined();
    expect(selectedId).toBe(galaxies[0].id);
    expect(isIntroScene(store.getState())).toBe(false);
  });

  it('places the new object at the target, not beside the intro hole', () => {
    const { store, actions } = setup();
    intro(store, actions);
    store.dispatch(actions.addGalaxy(store.getState(), 'spiral', [0, 0, 0]));
    expect(store.getState().galaxies[0].look.position).toEqual([0, 0, 0]);
  });

  it('also goes on a black hole add or a real-galaxy add, even after edits', () => {
    const { store, actions } = setup();
    intro(store, actions);
    const id = store.getState().galaxies[0].id;
    store.dispatch(actions.updateGalaxy(id, { hole: { colorHot: '#ff0000' } }));
    expect(store.getState().galaxies[0].intro).toBe(true);
    store.dispatch(actions.addBlackHole(store.getState()));
    expect(store.getState().galaxies.map((g) => g.id)).not.toContain(id);
    expect(store.getState().galaxies[0].intro).toBeUndefined();

    const other = setup();
    intro(other.store, other.actions);
    other.store.dispatch(other.actions.addCatalogueGalaxy(other.store.getState(), 'm31'));
    expect(other.store.getState().galaxies.map((g) => g.catalog)).toEqual(['m31']);
  });

  it('later adds remove nothing, also with a single user black hole', () => {
    const { store, actions, add } = setup();
    store.dispatch(actions.addBlackHole(store.getState()));
    expect(isIntroScene(store.getState())).toBe(false);
    add();
    add();
    expect(store.getState().galaxies).toHaveLength(3);
  });

  it('does not count toward the budget', () => {
    const { store, actions } = setup();
    intro(store, actions);
    const state = store.getState();
    expect(canAddGalaxy(state, MAX_TOTAL_PARTICLES)).toBe(true);
    expect(canAddGalaxy(state, MAX_TOTAL_PARTICLES + 1)).toBe(false);
  });

  it('sanitize keeps the flag only on black holes and only when true', () => {
    const { store, actions, add } = setup();
    intro(store, actions);
    const hole = store.getState().galaxies[0];
    expect(sanitizeGalaxy(hole).intro).toBe(true);
    expect(sanitizeGalaxy({ ...hole, intro: 'yes' }).intro).toBeUndefined();
    add();
    const galaxy = store.getState().galaxies[0];
    expect(sanitizeGalaxy({ ...galaxy, intro: true }).intro).toBeUndefined();
  });
});

describe('galaxy/consume', () => {
  it('removes the victim and patches the winner in one change; a selected victim hands over', () => {
    const { store, actions, add } = setup();
    add();
    add();
    const [a, b] = store.getState().galaxies;
    store.dispatch(actions.selectGalaxy(b.id));
    const fn = vi.fn();
    store.subscribe(fn);
    store.dispatch(actions.consumeGalaxy(a.id, b.id, { look: { radius: a.look.radius * 1.2 }, shape: { count: a.shape.count + b.shape.count } }));
    expect(fn).toHaveBeenCalledOnce();
    const s = store.getState();
    expect(s.galaxies.map((g) => g.id)).toEqual([a.id]);
    expect(s.galaxies[0].look.radius).toBeCloseTo(a.look.radius * 1.2);
    expect(s.galaxies[0].shape.count).toBe(a.shape.count + b.shape.count);
    expect(s.selectedId).toBe(a.id);
  });

  it('ignores missing ids and self-consumption', () => {
    const { store, actions, add } = setup();
    add();
    const [a] = store.getState().galaxies;
    const before = store.getState();
    store.dispatch(actions.consumeGalaxy(a.id, 'missing', {}));
    store.dispatch(actions.consumeGalaxy(a.id, a.id, {}));
    expect(store.getState()).toBe(before);
  });

  it('a black hole winner takes its hole patch', () => {
    const { store, actions } = setup();
    store.dispatch(actions.addBlackHole(store.getState()));
    store.dispatch(actions.addBlackHole(store.getState(), [50, 0, 0]));
    const [h1, h2] = store.getState().galaxies;
    store.dispatch(actions.consumeGalaxy(h1.id, h2.id, { hole: { size: h1.hole.size * 1.2 } }));
    const [w] = store.getState().galaxies;
    expect(w.hole.size).toBeCloseTo(h1.hole.size * 1.2);
    expect(w.kind).toBe('blackhole');
  });
});
