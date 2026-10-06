import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHistory } from './history.js';
import { createStore } from './store.js';
import { createActions } from './actions.js';

function setup() {
  let n = 0;
  const actions = createActions({ makeId: () => `id${++n}`, makeSeed: () => 7 });
  const store = createStore();
  const history = createHistory(store, { groupMs: 400 });
  const add = () => store.dispatch(actions.addGalaxy(store.getState(), 'spiral'));
  const ids = () => store.getState().galaxies.map((g) => g.id);
  return { store, actions, history, add, ids };
}

describe('createHistory', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('undoes and redoes an add', () => {
    const { history, add, ids } = setup();
    add();
    vi.advanceTimersByTime(500);
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(ids()).toEqual([]);
    expect(history.canRedo()).toBe(true);
    history.redo();
    expect(ids()).toEqual(['id1']);
  });

  it('groups a burst of slider updates into one step', () => {
    const { store, actions, history, add } = setup();
    add();
    vi.advanceTimersByTime(500);
    for (let r = 6; r <= 10; r += 0.5) {
      store.dispatch(actions.updateGalaxy('id1', { look: { radius: r } }));
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(500);
    history.undo();
    expect(store.getState().galaxies[0].look.radius).toBe(6);
    history.undo();
    expect(store.getState().galaxies).toEqual([]);
  });

  it('undo commits a pending change first, so nothing is lost', () => {
    const { history, add, ids } = setup();
    add();
    history.undo(); // no timer elapsed yet
    expect(ids()).toEqual([]);
  });

  it('does not record selection or settings changes', () => {
    const { store, actions, history, add } = setup();
    add();
    vi.advanceTimersByTime(500);
    history.undo();
    store.dispatch(actions.updateSettings({ timeScale: 3 }));
    store.dispatch(actions.selectGalaxy(null));
    vi.advanceTimersByTime(500);
    expect(history.canRedo()).toBe(true);
    expect(history.canUndo()).toBe(false);
  });

  it('a new change clears the redo stack', () => {
    const { history, add } = setup();
    add();
    vi.advanceTimersByTime(500);
    history.undo();
    add();
    vi.advanceTimersByTime(500);
    expect(history.canRedo()).toBe(false);
  });

  it('undo of a delete restores the galaxy; selection survives only if it still exists', () => {
    const { store, actions, history, add } = setup();
    add();
    vi.advanceTimersByTime(500);
    store.dispatch(actions.removeGalaxy('id1'));
    vi.advanceTimersByTime(500);
    history.undo();
    expect(store.getState().galaxies.map((g) => g.id)).toEqual(['id1']);
    expect(store.getState().selectedId).toBeNull();
  });

  it('caps the stack and can be cleared; onChange fires', () => {
    let n = 0;
    const actions = createActions({ makeId: () => `x${++n}`, makeSeed: () => 1 });
    const store = createStore();
    const history = createHistory(store, { limit: 3, groupMs: 10 });
    const fn = vi.fn();
    history.onChange(fn);
    for (let i = 0; i < 6; i++) {
      const a = actions.addGalaxy(store.getState(), 'irregular');
      a.galaxy.shape.count = 1000;
      store.dispatch(a);
      vi.advanceTimersByTime(20);
    }
    let undos = 0;
    while (history.undo()) undos++;
    expect(undos).toBe(3);
    expect(fn).toHaveBeenCalled();
    history.clear();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });
});
