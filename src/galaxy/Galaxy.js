import * as THREE from 'three';
import { generateGalaxy } from './generateGalaxy.js';
import { createStarMaterial, createHiiMaterial } from './starMaterials.js';
import {
  createGalaxyUniforms,
  applyShapeUniforms,
  applyStructureUniforms,
  applyLookUniforms,
  applyMotionUniforms,
} from './galaxyUniforms.js';
import { approach } from './emphasis.js';

const UP = new THREE.Vector3(0, 1, 0);
// Stars move on orbits up to a·(1 + e) and the halo reaches 1.4; one fixed
// bound at the origin covers every phase of the animation.
const BOUND_RADIUS = 1.7;
const _inverse = new THREE.Matrix4();

/**
 * One galaxy in the scene. Owns its GPU resources; call dispose() on removal.
 *
 * `group` carries position, tilt and radius (as scale). Everything inside is
 * in a unit disc. Layers share one uniform set (see galaxyUniforms.js):
 *   stars — density-wave star particles (renderOrder 1)
 *   hii   — H II nebulae that glow on the arm crests (renderOrder 2)
 */
export class Galaxy {
  /**
   * @param {{ shape: object, seed: number, structure?: object, look?: object, motion?: object, pixelRatio?: number, dustScale?: number }} params
   */
  constructor({ shape, seed, structure, look, motion, pixelRatio = 1, dustScale = 1 }) {
    this.group = new THREE.Group();
    this.uniforms = createGalaxyUniforms();
    this.uniforms.uPixelRatio.value = pixelRatio;

    this.starMaterial = createStarMaterial(this.uniforms);
    this.stars = new THREE.Points(new THREE.BufferGeometry(), this.starMaterial);
    this.stars.renderOrder = 1;

    this.hiiMaterial = createHiiMaterial(this.uniforms);
    this.hii = new THREE.Points(new THREE.BufferGeometry(), this.hiiMaterial);
    this.hii.renderOrder = 2;

    this.group.add(this.stars, this.hii);

    this.phase = 0;
    this.speed = 0;
    this.radius = 1;
    this.dustScale = dustScale;
    this.emphasis = 1;
    this.emphasisTarget = 1;

    this.setShape(shape, seed);
    this.setStructure(structure);
    this.setLook(look);
    this.setMotion(motion);
  }

  /** Rebuild the star geometry. The old geometry is disposed first. */
  setShape(shape, seed) {
    const data = generateGalaxy(shape, seed);
    const sphere = new THREE.Sphere(new THREE.Vector3(), BOUND_RADIUS);

    const stars = new THREE.BufferGeometry();
    stars.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    stars.setAttribute('aOrbit', new THREE.BufferAttribute(data.orbit, 4));
    stars.setAttribute('aStar', new THREE.BufferAttribute(data.star, 3));
    stars.boundingSphere = sphere;

    const hii = new THREE.BufferGeometry();
    hii.setAttribute('position', new THREE.BufferAttribute(data.hii.positions, 3));
    hii.setAttribute('aOrbit', new THREE.BufferAttribute(data.hii.orbit, 4));
    hii.setAttribute('aSize', new THREE.BufferAttribute(data.hii.size, 1));
    hii.boundingSphere = sphere.clone();

    this.stars.geometry.dispose();
    this.hii.geometry.dispose();
    this.stars.geometry = stars;
    this.hii.geometry = hii;
    this.count = data.count;
    this.hiiCount = data.hii.count;
    applyShapeUniforms(this.uniforms, shape);
  }

  /** Density-wave arms, dust and volume settings: uniforms only. */
  setStructure(structure) {
    this.structure = structure;
    applyStructureUniforms(this.uniforms, structure, this.dustScale);
  }

  /** Global dust multiplier from the settings (0 turns dust off). */
  setDustScale(scale) {
    this.dustScale = scale;
    applyStructureUniforms(this.uniforms, this.structure, scale);
  }

  /** Uniforms and transforms only; never touches geometry. */
  setLook(look) {
    const l = applyLookUniforms(this.uniforms, look);
    this.radius = l.radius;
    this.group.position.fromArray(l.position);
    this.group.rotation.set(THREE.MathUtils.degToRad(l.tiltX), 0, THREE.MathUtils.degToRad(l.tiltZ));
    this.group.scale.setScalar(l.radius);
  }

  setMotion(motion) {
    this.speed = applyMotionUniforms(this.uniforms, motion).speed;
  }

  /**
   * Advance rotation and the selection-emphasis ease. `dt` is simulation time
   * (scaled, zero while paused); `realDt` is wall time, so the emphasis still
   * eases while paused. Accumulating phase means a speed change never jumps.
   */
  tick(dt, realDt = dt) {
    this.phase += dt * this.speed;
    this.uniforms.uPhase.value = this.phase;
    if (this.emphasis !== this.emphasisTarget) {
      this.emphasis = approach(this.emphasis, this.emphasisTarget, realDt);
      this.uniforms.uEmphasis.value = this.emphasis;
    }
  }

  /**
   * Camera position in this galaxy's unit space, for per-star dust (which
   * side of the dust slab the camera is on, and the viewing angle).
   * @param {THREE.Vector3} cameraWorld
   */
  updateCamera(cameraWorld) {
    this.group.updateMatrixWorld();
    _inverse.copy(this.group.matrixWorld).invert();
    this.uniforms.uCameraLocal.value.copy(cameraWorld).applyMatrix4(_inverse);
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
      this.uniforms.uEmphasis.value = target;
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
    this.uniforms.uPixelRatio.value = value;
  }

  dispose() {
    this.group.removeFromParent();
    this.stars.geometry.dispose();
    this.hii.geometry.dispose();
    this.starMaterial.dispose();
    this.hiiMaterial.dispose();
  }
}
