import * as THREE from 'three';
import { generateGalaxy } from './generateGalaxy.js';
import { createGalaxyMaterial } from './galaxyMaterial.js';
import { createDustMaterial } from './dustMaterial.js';
import { clampLook, clampMotion } from './params.js';
import { approach } from './emphasis.js';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * One galaxy in the scene. Owns its GPU resources; call dispose() on removal.
 *
 * `group` carries position, tilt and radius (as scale). Stars are generated
 * in a unit disc, so resizing never rebuilds geometry.
 */
export class Galaxy {
  /**
   * @param {{ shape: object, seed: number, look?: object, motion?: object, pixelRatio?: number, dust?: { enabled: boolean, opacity: number } }} params
   */
  constructor({ shape, seed, look, motion, pixelRatio = 1, dust = { enabled: true, opacity: 0.6 } }) {
    this.group = new THREE.Group();
    this.material = createGalaxyMaterial();
    this.material.uniforms.uPixelRatio.value = pixelRatio;
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.group.add(this.points);

    this.dustMaterial = createDustMaterial(this.material);
    this.dust = new THREE.Points(new THREE.BufferGeometry(), this.dustMaterial);
    // Drawn after the stars so it darkens them.
    this.dust.renderOrder = 1;
    this.group.add(this.dust);
    this.setDust(dust);

    this.phase = 0;
    this.speed = 0;
    this.radius = 1;
    this.emphasis = 1;
    this.emphasisTarget = 1;

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

    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(data.dust.positions, 3));
    dustGeometry.setAttribute('aRadiusNorm', new THREE.BufferAttribute(data.dust.radiusNorm, 1));
    dustGeometry.setAttribute('aColorJitter', new THREE.BufferAttribute(new Float32Array(data.dust.count), 1));
    dustGeometry.setAttribute('aSize', new THREE.BufferAttribute(data.dust.sizes, 1));
    dustGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), maxLength(data.dust.positions));

    this.points.geometry.dispose();
    this.dust.geometry.dispose();
    this.points.geometry = geometry;
    this.dust.geometry = dustGeometry;
    this.count = data.count;
    this.dustCount = data.dust.count;
  }

  /** Global dust settings (visibility and opacity). */
  setDust({ enabled, opacity }) {
    this.dust.visible = Boolean(enabled);
    this.dustMaterial.uniforms.uOpacity.value = opacity;
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
   * Advance rotation and the selection-emphasis ease. `dt` is simulation time
   * (scaled, zero while paused); `realDt` is wall time, so the emphasis still
   * eases while paused. Accumulating phase means a speed change never jumps.
   */
  tick(dt, realDt = dt) {
    this.phase += dt * this.speed;
    this.material.uniforms.uPhase.value = this.phase;
    if (this.emphasis !== this.emphasisTarget) {
      this.emphasis = approach(this.emphasis, this.emphasisTarget, realDt);
      this.material.uniforms.uEmphasis.value = this.emphasis;
    }
  }

  /**
   * Brightness multiplier for selection emphasis.
   * @param {number} target
   * @param {boolean} [immediate] skip the ease (e.g. a just-created galaxy)
   */
  setEmphasis(target, immediate = false) {
    this.emphasisTarget = target;
    if (immediate) {
      this.emphasis = target;
      this.material.uniforms.uEmphasis.value = target;
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
    this.dust.geometry.dispose();
    this.dustMaterial.dispose();
  }
}

function maxLength(positions) {
  let max = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const l = positions[i] ** 2 + positions[i + 1] ** 2 + positions[i + 2] ** 2;
    if (l > max) max = l;
  }
  return Math.sqrt(max);
}
