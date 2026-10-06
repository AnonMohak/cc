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

describe('Galaxy selection helpers', () => {
  it('setHighlighted adds and removes a ring that is disposed with the galaxy', () => {
    const g = makeGalaxy();
    g.setHighlighted(true);
    expect(g.group.children).toContain(g.ring);
    g.setHighlighted(false);
    expect(g.group.children).not.toContain(g.ring);
    const spy = vi.spyOn(g.ring.geometry, 'dispose');
    g.dispose();
    expect(spy).toHaveBeenCalled();
  });

  it('pickTarget reports world centre, tilted normal and radius', () => {
    const g = makeGalaxy();
    g.id = 'x';
    g.setLook({ radius: 7, position: [1, 2, 3], tiltX: 90 });
    const t = g.pickTarget();
    expect(t.id).toBe('x');
    expect(t.radius).toBe(7);
    expect(t.center.toArray()).toEqual([1, 2, 3]);
    expect(t.normal.z).toBeCloseTo(1);
  });
});

describe('Galaxy dust', () => {
  it('builds a dust layer that shares rotation uniforms with the stars', () => {
    const g = makeGalaxy();
    expect(g.dust.geometry.getAttribute('position').count).toBe(g.dustCount);
    expect(g.dustCount).toBeGreaterThan(0);
    g.tick(1);
    expect(g.dustMaterial.uniforms.uPhase.value).toBe(g.phase);
  });

  it('setDust toggles visibility and opacity; setShape disposes the old dust', () => {
    const g = makeGalaxy();
    g.setDust({ enabled: false, opacity: 0.2 });
    expect(g.dust.visible).toBe(false);
    expect(g.dustMaterial.uniforms.uOpacity.value).toBe(0.2);
    const spy = vi.spyOn(g.dust.geometry, 'dispose');
    g.setShape({ ...PRESETS.spiral.shape, count: 1000 }, 3);
    expect(spy).toHaveBeenCalledOnce();
  });
});
