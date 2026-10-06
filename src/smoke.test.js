import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

describe('test environment', () => {
  it('loads three in Node', () => {
    expect(new THREE.Vector3(1, 2, 3).length()).toBeCloseTo(Math.sqrt(14));
  });
});
