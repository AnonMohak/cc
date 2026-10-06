import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { GalaxyScenePass } from './GalaxyScenePass.js';
import { LAYERS } from './layers.js';
import { Galaxy } from '../galaxy/Galaxy.js';
import { PRESETS } from '../galaxy/presets.js';
import { createStarfield } from '../scene/starfield.js';

/** Records every render call with the active target and camera layer mask. */
function mockRenderer() {
  const calls = [];
  let target = 'screen';
  return {
    calls,
    autoClear: true,
    getClearColor: (c) => c.set(0x02030a),
    getClearAlpha: () => 1,
    setClearColor: vi.fn(),
    setRenderTarget: (t) => {
      target = t;
    },
    clear: () => calls.push({ type: 'clear', target }),
    render: (scene, camera) => calls.push({ type: 'render', target, mask: camera.layers.mask, background: scene.background, autoClear: this?.autoClear }),
  };
}

describe('GalaxyScenePass', () => {
  it('sizes the volume target by the volume scale and follows resizes', () => {
    const pass = new GalaxyScenePass(new THREE.Scene(), new THREE.PerspectiveCamera(), { volumeScale: 0.5 });
    pass.setSize(1920, 1080);
    expect([pass.volumeTarget.width, pass.volumeTarget.height]).toEqual([960, 540]);
    pass.setVolumeScale(0.25);
    expect([pass.volumeTarget.width, pass.volumeTarget.height]).toEqual([480, 270]);
    pass.setVolumeScale(5);
    expect(pass.volumeScale).toBe(1);
  });

  it('renders background, then volumes into the low-res target, then stars', () => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#02030a');
    const camera = new THREE.PerspectiveCamera();
    const pass = new GalaxyScenePass(scene, camera);
    pass.setSize(100, 100);
    pass.composite.render = vi.fn();
    const renderer = mockRenderer();
    const readBuffer = { name: 'read' };
    pass.render(renderer, null, readBuffer);

    const renders = renderer.calls.filter((c) => c.type === 'render');
    expect(renders.map((c) => c.mask)).toEqual([1 << LAYERS.BACKGROUND, 1 << LAYERS.VOLUME, 1 << LAYERS.STARS]);
    expect(renders[0].target).toBe(readBuffer);
    expect(renders[1].target).toBe(pass.volumeTarget);
    expect(renders[1].background).toBeNull(); // volumes must not paint the sky colour
    expect(renders[2].target).toBe(readBuffer);
    expect(pass.composite.render).toHaveBeenCalledOnce();
    // The volume target starts at L = 0, T = 1.
    expect(renderer.setClearColor).toHaveBeenCalledWith(0x000000, 1);
  });

  it('restores camera layers, background and renderer state', () => {
    const scene = new THREE.Scene();
    const bg = new THREE.Color('#123456');
    scene.background = bg;
    const camera = new THREE.PerspectiveCamera();
    camera.layers.enableAll();
    const mask = camera.layers.mask;
    const pass = new GalaxyScenePass(scene, camera);
    pass.composite.render = vi.fn();
    const renderer = mockRenderer();
    pass.render(renderer, null, {});
    expect(camera.layers.mask).toBe(mask);
    expect(scene.background).toBe(bg);
    expect(renderer.autoClear).toBe(true);
  });
});

describe('layer assignment', () => {
  it('puts galaxy volumes, stars and the starfield on their layers', () => {
    const p = PRESETS.spiral;
    const g = new Galaxy({ shape: { ...p.shape, count: 1000 }, seed: 1, structure: p.structure, look: p.look, motion: p.motion });
    expect(g.volume.layers.mask).toBe(1 << LAYERS.VOLUME);
    expect(g.stars.layers.mask).toBe(1 << LAYERS.STARS);
    expect(g.hii.layers.mask).toBe(1 << LAYERS.STARS);
    expect(createStarfield({ count: 10 }).object.layers.mask).toBe(1 << LAYERS.BACKGROUND);
  });
});
