import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createStarfield } from './starfield.js';

describe('createStarfield', () => {
  it('creates the requested number of stars on the shell', () => {
    const field = createStarfield({ count: 500, radius: 100 });
    const pos = field.object.geometry.getAttribute('position');
    expect(pos.count).toBe(500);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const r = v.fromBufferAttribute(pos, i).length();
      expect(r).toBeGreaterThanOrEqual(89.99);
      expect(r).toBeLessThanOrEqual(100.01);
    }
  });

  it('is deterministic for a seed', () => {
    const a = createStarfield({ count: 50, seed: 9 }).object.geometry.getAttribute('position').array;
    const b = createStarfield({ count: 50, seed: 9 }).object.geometry.getAttribute('position').array;
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('follows the camera and disposes its GPU resources', () => {
    const field = createStarfield({ count: 10 });
    field.update(new THREE.Vector3(1, 2, 3));
    expect(field.object.position.toArray()).toEqual([1, 2, 3]);
    const g = vi.spyOn(field.object.geometry, 'dispose');
    const m = vi.spyOn(field.object.material, 'dispose');
    field.dispose();
    expect(g).toHaveBeenCalled();
    expect(m).toHaveBeenCalled();
  });
});

describe('starfield diffraction spikes', () => {
  it('puts spike sprites on the brightest stars, hidden until a style is set', () => {
    const field = createStarfield({ count: 2000 });
    const spikes = field.spikes;
    expect(spikes.geometry.getAttribute('position').count).toBe(30);
    expect(spikes.visible).toBe(false);
    field.setSpikeStyle(2);
    expect(spikes.visible).toBe(true);
    expect(spikes.material.uniforms.uSpikeStyle.value).toBe(2);
    field.setSpikeStyle(0);
    expect(spikes.visible).toBe(false);
    // Spike stars are among the brightest: every one beats the field median.
    const lum = (arr, i) => arr[i * 3] + arr[i * 3 + 1] + arr[i * 3 + 2];
    const all = field.object.geometry.getAttribute('aColor').array;
    const median = Array.from({ length: 2000 }, (_, i) => lum(all, i)).sort((a, b) => a - b)[1000];
    const top = spikes.geometry.getAttribute('aColor').array;
    for (let k = 0; k < 30; k++) expect(lum(top, k)).toBeGreaterThan(median);
  });
});
