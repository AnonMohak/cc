import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { GalaxyManager } from './GalaxyManager.js';
import { createStore } from '../state/store.js';
import { createActions } from '../state/actions.js';
import { EMPHASIS_SELECTED, EMPHASIS_OTHERS } from '../galaxy/params.js';

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
    store.dispatch(actions.updateGalaxy('id1', { structure: { arms: 4 } }));
    expect(setShape).not.toHaveBeenCalled();
    expect(galaxy.uniforms.uArms.value).toBe(4);
    store.dispatch(actions.updateGalaxy('id1', { shape: { barLength: 0.2 } }));
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
    ticks.forEach((t) => expect(t).toHaveBeenCalledWith(0.1, 0.1));
    manager.dispose();
    expect(manager.galaxies.size).toBe(0);
  });
});

describe('GalaxyManager selection', () => {
  it('brightens the selected galaxy, dims the others, and resets on deselect', () => {
    const { store, actions, manager, add } = setup();
    add();
    add();
    store.dispatch(actions.selectGalaxy('id1'));
    expect(manager.get('id1').emphasisTarget).toBe(EMPHASIS_SELECTED);
    expect(manager.get('id2').emphasisTarget).toBe(EMPHASIS_OTHERS);
    manager.tick(0, 1);
    expect(manager.get('id2').uniforms.uEmphasis.value).toBe(EMPHASIS_OTHERS);
    store.dispatch(actions.selectGalaxy(null));
    expect(manager.get('id1').emphasisTarget).toBe(1);
    expect(manager.get('id2').emphasisTarget).toBe(1);
    expect(manager.pickTargets().map((t) => t.id)).toEqual(['id1', 'id2']);
  });
});

describe('GalaxyManager dust settings', () => {
  it('applies dust settings to existing and new galaxies', () => {
    const { store, actions, manager, add } = setup();
    add();
    store.dispatch(actions.updateSettings({ dustOpacity: 0.3 }));
    expect(manager.get('id1').uniforms.uDustStrength.value).toBeCloseTo(0.5);
    store.dispatch(actions.updateSettings({ dust: false }));
    expect(manager.get('id1').uniforms.uDustStrength.value).toBe(0);
    add();
    expect(manager.get('id2').uniforms.uDustStrength.value).toBe(0);
  });
});

describe('GalaxyManager quality', () => {
  it('applies the tier the app sets to existing and new galaxies', async () => {
    const { QUALITY } = await import('../core/quality.js');
    const { manager, add } = setup();
    add();
    expect(manager.get('id1').uniforms.uSteps.value).toBe(QUALITY.medium.steps);
    manager.setQuality(QUALITY.minimal);
    const g1 = manager.get('id1');
    expect(g1.uniforms.uSteps.value).toBe(QUALITY.minimal.steps);
    expect(g1.uniforms.uVolumeDust.value).toBe(0);
    expect(g1.uniforms.uMaxPointPx.value).toBe(QUALITY.minimal.maxPointPx);
    add();
    expect(manager.get('id2').uniforms.uSteps.value).toBe(QUALITY.minimal.steps);
  });

  it('ignores the quality setting itself (Auto is resolved by the app)', async () => {
    const { QUALITY } = await import('../core/quality.js');
    const { store, actions, manager, add } = setup();
    add();
    store.dispatch(actions.updateSettings({ quality: 'low' }));
    expect(manager.get('id1').uniforms.uSteps.value).toBe(QUALITY.medium.steps);
  });
});

describe('GalaxyManager LOD', () => {
  it('lowers volume steps when the camera is inside a galaxy', async () => {
    const { QUALITY } = await import('../core/quality.js');
    const { manager, add } = setup();
    add();
    const camera = new THREE.PerspectiveCamera(55, 1.6);
    camera.position.set(0, 30, 40);
    manager.updateCamera(camera, 1280, 800);
    expect(manager.get('id1').uniforms.uSteps.value).toBe(QUALITY.medium.steps);
    camera.position.set(0, 0.5, 0);
    manager.updateCamera(camera, 1280, 800);
    expect(manager.get('id1').uniforms.uSteps.value).toBeLessThan(QUALITY.medium.steps);
  });
});

describe('GalaxyManager render-on-demand hooks', () => {
  it('reports easing while emphasis animates, and notifies after a disc rebake', () => {
    const { store, actions, manager, add } = setup();
    add();
    add();
    manager.tick(0, 1); // settle the initial ease
    expect(manager.isEasing()).toBe(false);
    store.dispatch(actions.selectGalaxy('id1'));
    expect(manager.isEasing()).toBe(true);
    manager.tick(0, 1);
    expect(manager.isEasing()).toBe(false);
    let changed = 0;
    manager.onChange = () => changed++;
    manager.get('id1').bakeDiscMap();
    expect(changed).toBe(1);
  });
});

describe('GalaxyManager black holes', () => {
  const slots = () =>
    Array.from({ length: 10 }, () => ({ center: new THREE.Vector3(), normal: new THREE.Vector3(), hot: new THREE.Color(), cool: new THREE.Color() }));

  it('standalone holes always draw; central holes follow the flag', () => {
    const { store, actions, manager, add } = setup();
    add();
    store.dispatch(actions.addBlackHole(store.getState()));
    const s = slots();
    expect(manager.blackHoleCandidates(s, true)).toBe(2);
    expect(manager.blackHoleCandidates(s, false)).toBe(1);
    expect(s[0].discOuter).toBe(18);
    manager.setBlackHoleMode('off');
    expect(manager.blackHoleCandidates(s, true)).toBe(1);
  });

  it('a standalone hole has no volume or supernovae, and hole edits are live', () => {
    const { store, actions, manager } = setup();
    store.dispatch(actions.addBlackHole(store.getState()));
    const hole = manager.get('id1');
    expect(hole.volume.visible).toBe(false);
    expect(hole.supernovae.visible).toBe(false);
    const geometry = hole.stars.geometry;
    store.dispatch(actions.updateGalaxy('id1', { hole: { size: 0.05, jets: true, discSize: 25 } }));
    expect(hole.stars.geometry).toBe(geometry);
    expect(hole.rsUnit).toBe(0.05);
    expect(hole.jets.visible).toBe(true);
    const s = slots();
    manager.blackHoleCandidates(s);
    expect(s[0].discOuter).toBe(25);
  });

  it('the disc of a galaxy lies in the galaxy plane', () => {
    const { manager, add } = setup();
    add();
    const s = slots();
    manager.blackHoleCandidates(s);
    expect(s[0].normal.y).toBeCloseTo(1, 6);
  });

  it('the disc time runs at the hole spin', () => {
    const { store, actions, manager } = setup();
    store.dispatch(actions.addBlackHole(store.getState()));
    const hole = manager.get('id1');
    hole.tick(1);
    hole.setHoleSpin(3);
    hole.tick(1);
    expect(hole.holeTime).toBeCloseTo(4, 9);
  });
});
