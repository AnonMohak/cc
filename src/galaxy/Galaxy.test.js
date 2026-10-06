import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Galaxy } from './Galaxy.js';
import { PRESETS } from './presets.js';

function makeGalaxy(overrides = {}) {
  const p = PRESETS.spiral;
  return new Galaxy({
    shape: { ...p.shape, count: 2000 },
    seed: 1,
    look: p.look,
    motion: p.motion,
    ...overrides,
  });
}

describe('Galaxy', () => {
  it('builds geometry with all star attributes', () => {
    const g = makeGalaxy();
    const geo = g.points.geometry;
    expect(geo.getAttribute('position').count).toBe(2000);
    for (const name of ['aRadiusNorm', 'aColorJitter', 'aSize']) {
      expect(geo.getAttribute(name).count).toBe(2000);
    }
    expect(geo.boundingSphere.center.toArray()).toEqual([0, 0, 0]);
  });

  it('setShape replaces the geometry and disposes the old one', () => {
    const g = makeGalaxy();
    const old = g.points.geometry;
    const spy = vi.spyOn(old, 'dispose');
    g.setShape({ ...PRESETS.barred.shape, count: 3000 }, 2);
    expect(spy).toHaveBeenCalledOnce();
    expect(g.points.geometry).not.toBe(old);
    expect(g.count).toBe(3000);
  });

  it('setLook changes uniforms and transforms but not geometry', () => {
    const g = makeGalaxy();
    const geo = g.points.geometry;
    g.setLook({ radius: 12, colorInner: '#ff0000', tiltX: 30, position: [5, 0, -2], starSize: 2 });
    expect(g.points.geometry).toBe(geo);
    expect(g.group.scale.x).toBe(12);
    expect(g.material.uniforms.uScale.value).toBe(12);
    expect(g.material.uniforms.uSize.value).toBe(2);
    expect(g.group.position.toArray()).toEqual([5, 0, -2]);
    expect(g.group.rotation.x).toBeCloseTo(THREE.MathUtils.degToRad(30));
    expect(g.material.uniforms.uColorInner.value.getHexString()).toBe('ff0000');
  });

  it('tick accumulates phase from speed and stops when dt is 0', () => {
    const g = makeGalaxy({ motion: { speed: 2, differential: 0.5 } });
    g.tick(0.5);
    expect(g.phase).toBeCloseTo(1);
    g.tick(0);
    expect(g.phase).toBeCloseTo(1);
    expect(g.material.uniforms.uPhase.value).toBeCloseTo(1);
    expect(g.material.uniforms.uDifferential.value).toBe(0.5);
  });

  it('a speed change keeps the current phase (no jump)', () => {
    const g = makeGalaxy({ motion: { speed: 1 } });
    g.tick(1);
    g.setMotion({ speed: -3 });
    expect(g.phase).toBeCloseTo(1);
    g.tick(0.1);
    expect(g.phase).toBeCloseTo(0.7);
  });

  it('dispose frees GPU resources and detaches from the scene', () => {
    const g = makeGalaxy();
    const scene = new THREE.Scene();
    scene.add(g.group);
    const geo = vi.spyOn(g.points.geometry, 'dispose');
    const mat = vi.spyOn(g.material, 'dispose');
    g.dispose();
    expect(geo).toHaveBeenCalled();
    expect(mat).toHaveBeenCalled();
    expect(scene.children).not.toContain(g.group);
  });
});
