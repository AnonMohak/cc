import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Galaxy } from './Galaxy.js';
import { PRESETS } from './presets.js';

function makeGalaxy(overrides = {}) {
  const p = PRESETS.spiral;
  return new Galaxy({
    shape: { ...p.shape, count: 2000 },
    seed: 1,
    structure: p.structure,
    look: p.look,
    motion: p.motion,
    ...overrides,
  });
}

describe('Galaxy layers', () => {
  it('builds star geometry with orbit and star attributes, plus H II regions', () => {
    const g = makeGalaxy();
    const geo = g.stars.geometry;
    expect(geo.getAttribute('aOrbit').itemSize).toBe(4);
    expect(geo.getAttribute('aOrbit').count).toBe(2000);
    expect(geo.getAttribute('aStar').itemSize).toBe(3);
    expect(geo.boundingSphere.center.toArray()).toEqual([0, 0, 0]);
    expect(g.hii.geometry.getAttribute('aOrbit').count).toBe(g.hiiCount);
    expect(g.hiiCount).toBeGreaterThan(0);
  });

  it('all layers share one uniform set by reference', () => {
    const g = makeGalaxy();
    expect(g.starMaterial.uniforms).toBe(g.uniforms);
    expect(g.hiiMaterial.uniforms).toBe(g.uniforms);
    expect(g.volumeMaterial.uniforms).toBe(g.uniforms);
  });

  it('has no selection ring or extra line objects', () => {
    const g = makeGalaxy();
    let lines = 0;
    g.group.traverse((o) => {
      if (o.isLine) lines++;
    });
    expect(lines).toBe(0);
  });
});

describe('Galaxy volume', () => {
  it('draws the volume first, from back faces, with transmittance blending', () => {
    const g = makeGalaxy();
    expect(g.volume.renderOrder).toBeLessThan(g.stars.renderOrder);
    expect(g.stars.renderOrder).toBeLessThan(g.hii.renderOrder);
    expect(g.volumeMaterial.side).toBe(THREE.BackSide);
    expect(g.volumeMaterial.blendSrc).toBe(THREE.OneFactor);
    expect(g.volumeMaterial.blendDst).toBe(THREE.SrcAlphaFactor);
    expect(g.volumeMaterial.depthWrite).toBe(false);
  });

  it('fits its box to the shape: an elliptical is taller than a spiral', () => {
    const spiral = makeGalaxy();
    const e = PRESETS.elliptical;
    const elliptical = makeGalaxy({ shape: { ...e.shape, count: 2000 }, structure: e.structure });
    expect(spiral.volume.scale.y).toBeLessThan(elliptical.volume.scale.y);
    expect(spiral.uniforms.uBoxHalf.value.y).toBe(spiral.volume.scale.y);
  });
});

describe('Galaxy updates', () => {
  it('setShape replaces both geometries, disposes the old ones and updates shape uniforms', () => {
    const g = makeGalaxy();
    const oldStars = vi.spyOn(g.stars.geometry, 'dispose');
    const oldHii = vi.spyOn(g.hii.geometry, 'dispose');
    g.setShape({ ...PRESETS.barred.shape, count: 3000 }, 2);
    expect(oldStars).toHaveBeenCalledOnce();
    expect(oldHii).toHaveBeenCalledOnce();
    expect(g.count).toBe(3000);
    expect(g.uniforms.uBar.value).toBe(PRESETS.barred.shape.barLength);
  });

  it('setStructure changes arm uniforms without touching geometry', () => {
    const g = makeGalaxy();
    const geo = g.stars.geometry;
    g.setStructure({ ...PRESETS.spiral.structure, arms: 4, armWinding: -0.8, dustStrength: 2 });
    expect(g.stars.geometry).toBe(geo);
    expect(g.uniforms.uArms.value).toBe(4);
    expect(g.uniforms.uWinding.value).toBe(-0.8);
    expect(g.uniforms.uDustStrength.value).toBe(2);
  });

  it('the global dust scale multiplies the galaxy dust; 0 turns it off', () => {
    const g = makeGalaxy();
    g.setDustScale(0.5);
    expect(g.uniforms.uDustStrength.value).toBe(PRESETS.spiral.structure.dustStrength * 0.5);
    g.setDustScale(0);
    expect(g.uniforms.uDustStrength.value).toBe(0);
  });

  it('setLook changes uniforms and transforms but not geometry', () => {
    const g = makeGalaxy();
    const geo = g.stars.geometry;
    g.setLook({ radius: 12, colorInner: '#ff0000', tiltX: 30, position: [5, 0, -2], starSize: 2, physicalColor: 0.2 });
    expect(g.stars.geometry).toBe(geo);
    expect(g.group.scale.x).toBe(12);
    expect(g.uniforms.uScale.value).toBe(12);
    expect(g.uniforms.uSize.value).toBe(2);
    expect(g.uniforms.uPhysical.value).toBe(0.2);
    expect(g.group.position.toArray()).toEqual([5, 0, -2]);
    expect(g.group.rotation.x).toBeCloseTo(THREE.MathUtils.degToRad(30));
    expect(g.uniforms.uColorInner.value.getHexString()).toBe('ff0000');
  });

  it('tick accumulates phase from speed; a speed change keeps the phase', () => {
    const g = makeGalaxy({ motion: { speed: 2, differential: 0.5, patternSpeed: 0.4 } });
    g.tick(0.5);
    expect(g.phase).toBeCloseTo(1);
    g.tick(0);
    expect(g.uniforms.uPhase.value).toBeCloseTo(1);
    expect(g.uniforms.uPatternSpeed.value).toBe(0.4);
    g.setMotion({ speed: -3 });
    g.tick(0.1);
    expect(g.phase).toBeCloseTo(0.7);
  });

  it('eases emphasis with real time, even while paused', () => {
    const g = makeGalaxy();
    g.setEmphasis(0.75);
    g.tick(0, 1 / 60);
    const u = g.uniforms.uEmphasis;
    expect(u.value).toBeLessThan(1);
    expect(u.value).toBeGreaterThan(0.75);
    for (let i = 0; i < 30; i++) g.tick(0, 1 / 60);
    expect(u.value).toBe(0.75);
    g.setEmphasis(1.15, true);
    expect(u.value).toBe(1.15);
  });

  it('updateCamera converts the camera to unit space', () => {
    const g = makeGalaxy();
    g.setLook({ radius: 10, position: [100, 0, 0] });
    g.updateCamera(new THREE.Vector3(100, 20, 0));
    expect(g.uniforms.uCameraLocal.value.toArray().map((v) => +v.toFixed(6))).toEqual([0, 2, 0]);
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

  it('dispose frees every GPU resource and detaches from the scene', () => {
    const g = makeGalaxy();
    const scene = new THREE.Scene();
    scene.add(g.group);
    const spies = [g.stars.geometry, g.hii.geometry, g.volume.geometry, g.starMaterial, g.hiiMaterial, g.volumeMaterial].map((o) => vi.spyOn(o, 'dispose'));
    g.dispose();
    spies.forEach((s) => expect(s).toHaveBeenCalled());
    expect(scene.children).not.toContain(g.group);
  });
});
