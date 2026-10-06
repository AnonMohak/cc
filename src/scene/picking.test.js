import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { pickGalaxy } from './picking.js';

const UP = new THREE.Vector3(0, 1, 0);
const target = (id, x, y, z, radius = 5, normal = UP) => ({
  id,
  center: new THREE.Vector3(x, y, z),
  normal: normal.clone().normalize(),
  radius,
});
const ray = (origin, dir) => new THREE.Ray(new THREE.Vector3(...origin), new THREE.Vector3(...dir).normalize());

describe('pickGalaxy', () => {
  it('hits a face-on disc inside its radius', () => {
    expect(pickGalaxy(ray([3, 10, 0], [0, -1, 0]), [target('a', 0, 0, 0)])).toBe('a');
  });

  it('misses outside the radius and behind the camera', () => {
    expect(pickGalaxy(ray([6, 10, 0], [0, -1, 0]), [target('a', 0, 0, 0)])).toBeNull();
    expect(pickGalaxy(ray([0, 10, 0], [0, 1, 0]), [target('a', 0, 0, 0)])).toBeNull();
  });

  it('returns the nearest of two galaxies on the ray', () => {
    const targets = [target('far', 0, 0, 0), target('near', 0, 5, 0)];
    expect(pickGalaxy(ray([0, 10, 0], [0, -1, 0]), targets)).toBe('near');
  });

  it('hits a tilted disc by its own plane', () => {
    const tilted = target('t', 0, 0, 0, 5, new THREE.Vector3(1, 1, 0));
    // Straight down the tilted normal onto the centre.
    expect(pickGalaxy(ray([5, 5, 0], [-1, -1, 0]), [tilted])).toBe('t');
    // A flat disc would be hit at (4, 0, 0); the tilted plane is hit at
    // (4, -4, 0), which is outside the radius.
    expect(pickGalaxy(ray([4, 10, 0], [0, -1, 0]), [tilted])).toBeNull();
  });

  it('hits an edge-on disc through its core', () => {
    const edgeOn = target('e', 0, 0, 0, 5, new THREE.Vector3(0, 0, 1));
    expect(pickGalaxy(ray([10, 0, 0], [-1, 0, 0]), [edgeOn])).toBe('e');
    expect(pickGalaxy(ray([10, 3, 0], [-1, 0, 0]), [edgeOn])).toBeNull();
  });
});
