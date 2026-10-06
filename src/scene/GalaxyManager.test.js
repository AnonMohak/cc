import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { GalaxyManager } from './GalaxyManager.js';
import { createStore } from '../state/store.js';
import { createActions } from '../state/actions.js';

function setup() {
  let n = 0;
  const actions = createActions({ makeId: () => `id${++n}`, makeSeed: () => 7 });
  const store = createStore();
  const scene = new THREE.Scene();
  const manager = new GalaxyManager({ scene, store });
  const add = () => {
    const action = actions.addGalaxy(store.getState(), 'spiral');
    action.galaxy.shape.count = 2000;
    store.dispatch(action);
  };
  return { store, actions, scene, manager, add };
}

describe('GalaxyManager', () => {
  it('adds galaxies from the store to the scene', () => {
    const { scene, manager, add } = setup();
    add();
    add();
    expect(manager.galaxies.size).toBe(2);
    expect(scene.children).toContain(manager.get('id1').group);
  });

  it('creates galaxies that already exist in the store', () => {
    const { store } = setup();
    const scene = new THREE.Scene();
    const actions = createActions({ makeId: () => 'pre', makeSeed: () => 1 });
    const action = actions.addGalaxy(store.getState());
    action.galaxy.shape.count = 1000;
    store.dispatch(action);
    const manager = new GalaxyManager({ scene, store });
    expect(manager.get('pre')).toBeDefined();
  });

  it('removes and disposes deleted galaxies', () => {
    const { store, actions, scene, manager, add } = setup();
    add();
    const galaxy = manager.get('id1');
    const spy = vi.spyOn(galaxy, 'dispose');
    store.dispatch(actions.removeGalaxy('id1'));
    expect(spy).toHaveBeenCalledOnce();
    expect(manager.galaxies.size).toBe(0);
    expect(scene.children).not.toContain(galaxy.group);
  });

  it('rebuilds only on shape changes', () => {
    const { store, actions, manager, add } = setup();
    add();
    const galaxy = manager.get('id1');
    const setShape = vi.spyOn(galaxy, 'setShape');
    const setLook = vi.spyOn(galaxy, 'setLook');
    store.dispatch(actions.updateGalaxy('id1', { look: { radius: 10 } }));
    store.dispatch(actions.updateGalaxy('id1', { motion: { speed: 2 } }));
    expect(setShape).not.toHaveBeenCalled();
    expect(setLook).toHaveBeenCalledTimes(2);
    expect(galaxy.speed).toBe(2);
    store.dispatch(actions.updateGalaxy('id1', { shape: { arms: 4 } }));
    expect(setShape).toHaveBeenCalledOnce();
  });

  it('selection and settings changes do not touch galaxies', () => {
    const { store, actions, manager, add } = setup();
    add();
    const spy = vi.spyOn(manager, 'sync');
    store.dispatch(actions.selectGalaxy(null));
    store.dispatch(actions.updateSettings({ timeScale: 2 }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('ticks every galaxy and disposes all on dispose', () => {
    const { manager, add } = setup();
    add();
    add();
    const ticks = [...manager.galaxies.values()].map((g) => vi.spyOn(g, 'tick'));
    manager.tick(0.1);
    ticks.forEach((t) => expect(t).toHaveBeenCalledWith(0.1));
    manager.dispose();
    expect(manager.galaxies.size).toBe(0);
  });
});

describe('GalaxyManager selection', () => {
  it('highlights only the selected galaxy and returns pick targets', () => {
    const { store, actions, manager, add } = setup();
    add();
    add();
    expect(manager.get('id2').ring?.parent).toBe(manager.get('id2').group);
    store.dispatch(actions.selectGalaxy('id1'));
    expect(manager.get('id1').ring.parent).toBe(manager.get('id1').group);
    expect(manager.get('id2').ring.parent).toBeNull();
    expect(manager.pickTargets().map((t) => t.id)).toEqual(['id1', 'id2']);
  });
});
