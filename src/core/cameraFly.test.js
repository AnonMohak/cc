import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createCameraFly, easeInOutCubic, framingPosition } from './cameraFly.js';

describe('easeInOutCubic', () => {
  it('starts at 0, ends at 1 and is symmetric', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
  });
});

describe('createCameraFly', () => {
  function setup() {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 10);
    const controls = { target: new THREE.Vector3() };
    return { camera, controls, fly: createCameraFly(camera, controls) };
  }

  it('reaches the target exactly after the duration', () => {
    const { camera, controls, fly } = setup();
    fly.flyTo(new THREE.Vector3(5, 0, 0), new THREE.Vector3(5, 5, 5), 1);
    expect(fly.isFlying()).toBe(true);
    for (let i = 0; i < 10; i++) fly.update(0.1);
    expect(fly.isFlying()).toBe(false);
    expect(camera.position.toArray()).toEqual([5, 5, 5]);
    expect(controls.target.toArray()).toEqual([5, 0, 0]);
  });

  it('is partway at the midpoint and stops on cancel', () => {
    const { camera, fly } = setup();
    fly.flyTo(new THREE.Vector3(), new THREE.Vector3(0, 0, 20), 1);
    fly.update(0.5);
    expect(camera.position.z).toBeCloseTo(15);
    fly.cancel();
    fly.update(0.5);
    expect(camera.position.z).toBeCloseTo(15);
  });
});

describe('framingPosition', () => {
  it('frames a galaxy from its visible side within the distance limits', () => {
    const center = new THREE.Vector3(10, 0, 0);
    const up = new THREE.Vector3(0, 1, 0);
    const pos = framingPosition(new THREE.Vector3(10, -50, 1), center, up, 6, { min: 1, max: 100 });
    expect(pos.distanceTo(center)).toBeCloseTo(15.6);
    expect(pos.y).toBeLessThan(0); // camera was below the disc, stays below
    const clamped = framingPosition(new THREE.Vector3(0, 10, 0), center, up, 100, { min: 1, max: 50 });
    expect(clamped.distanceTo(center)).toBeCloseTo(50);
  });
});
