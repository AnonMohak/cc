import * as THREE from 'three';
import { generateGalaxy } from './generateGalaxy.js';
import { createGalaxyMaterial } from './galaxyMaterial.js';
import { clampLook, clampMotion } from './params.js';

const UP = new THREE.Vector3(0, 1, 0);
const RING_RADIUS = 1.08;
const RING_SEGMENTS = 128;

/**
 * One galaxy in the scene. Owns its GPU resources; call dispose() on removal.
 *
 * `group` carries position, tilt and radius (as scale). Stars are generated
 * in a unit disc, so resizing never rebuilds geometry.
 */
export class Galaxy {
  /**
   * @param {{ shape: object, seed: number, look?: object, motion?: object, pixelRatio?: number }} params
   */
  constructor({ shape, seed, look, motion, pixelRatio = 1 }) {
    this.group = new THREE.Group();
    this.material = createGalaxyMaterial();
    this.material.uniforms.uPixelRatio.value = pixelRatio;
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.group.add(this.points);

    this.phase = 0;
    this.speed = 0;
    this.radius = 1;
    /** @type {THREE.LineLoop | null} created on first highlight */
    this.ring = null;

    this.setShape(shape, seed);
    this.setLook(look);
    this.setMotion(motion);
  }

  /** Rebuild the geometry. The old geometry is disposed first. */
  setShape(shape, seed) {
    const data = generateGalaxy(shape, seed);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('aRadiusNorm', new THREE.BufferAttribute(data.radiusNorm, 1));
    geometry.setAttribute('aColorJitter', new THREE.BufferAttribute(data.colorJitter, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(data.sizes, 1));
    // Rotation happens in the shader around the origin, so the bound must be
    // a sphere at the origin, not around the unrotated points.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), maxLength(data.positions));

    const old = this.points.geometry;
    old.dispose();
    this.points.geometry = geometry;
    this.count = data.count;
  }

  /** Uniforms and transforms only; never touches geometry. */
  setLook(look) {
    const l = clampLook(look);
    const u = this.material.uniforms;
    this.radius = l.radius;
    this.group.position.fromArray(l.position);
    this.group.rotation.set(THREE.MathUtils.degToRad(l.tiltX), 0, THREE.MathUtils.degToRad(l.tiltZ));
    this.group.scale.setScalar(l.radius);
    u.uScale.value = l.radius;
    u.uSize.value = l.starSize;
    u.uBrightness.value = l.brightness;
    u.uColorInner.value.set(l.colorInner);
    u.uColorOuter.value.set(l.colorOuter);
  }

  setMotion(motion) {
    const m = clampMotion(motion);
    this.speed = m.speed;
    this.material.uniforms.uDifferential.value = m.differential;
  }

  /**
   * Advance rotation. `dt` is simulation time (already scaled and zero while
   * paused). Accumulating phase means a speed change never makes stars jump.
   */
  tick(dt) {
    this.phase += dt * this.speed;
    this.material.uniforms.uPhase.value = this.phase;
  }

  /** Show or hide the selection ring (lives in unit space, so it follows size and tilt). */
  setHighlighted(on) {
    if (on && !this.ring) this.ring = createRing();
    if (this.ring) {
      if (on) this.group.add(this.ring);
      else this.ring.removeFromParent();
    }
  }

  /** Data for picking: world centre, disc normal and radius. */
  pickTarget() {
    this.group.updateMatrixWorld();
    return {
      id: this.id,
      center: this.group.getWorldPosition(new THREE.Vector3()),
      normal: UP.clone().applyQuaternion(this.group.getWorldQuaternion(new THREE.Quaternion())),
      radius: this.radius,
    };
  }

  setPixelRatio(value) {
    this.material.uniforms.uPixelRatio.value = value;
  }

  dispose() {
    this.group.removeFromParent();
    this.points.geometry.dispose();
    this.material.dispose();
    if (this.ring) {
      this.ring.geometry.dispose();
      this.ring.material.dispose();
    }
  }
}

function createRing() {
  const points = [];
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const a = (i / RING_SEGMENTS) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(a) * RING_RADIUS, 0, Math.sin(a) * RING_RADIUS));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: 0x8fb4ff,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  return new THREE.LineLoop(geometry, material);
}

function maxLength(positions) {
  let max = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const l = positions[i] ** 2 + positions[i + 1] ** 2 + positions[i + 2] ** 2;
    if (l > max) max = l;
  }
  return Math.sqrt(max);
}
