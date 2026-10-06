import * as THREE from 'three';
import { generateGalaxy } from './generateGalaxy.js';
import { createStarMaterial, createHiiMaterial } from './starMaterials.js';
import { createVolumeMaterial } from './volumeMaterial.js';
import { volumeBounds } from './densityModel.js';
import { clampShape, clampStructure } from './params.js';
import {
  createGalaxyUniforms,
  applyShapeUniforms,
  applyStructureUniforms,
  applyLookUniforms,
  applyMotionUniforms,
} from './galaxyUniforms.js';
import { approach } from './emphasis.js';
import { LAYERS } from '../core/layers.js';
import { screenFootprint, adaptiveSteps } from './lod.js';
import { createDiscMapTexture } from './discMap.js';

const UP = new THREE.Vector3(0, 1, 0);
// Stars move on orbits up to a·(1 + e) and the halo reaches 1.4; one fixed
// bound at the origin covers every phase of the animation.
const BOUND_RADIUS = 1.7;
const _inverse = new THREE.Matrix4();
// Structure sliders fire many updates; the disc map (tens of ms to bake) is
// rebuilt once they settle. Star uniforms still update immediately.
const REBAKE_DELAY_MS = 120;

/**
 * One galaxy in the scene. Owns its GPU resources; call dispose() on removal.
 *
 * `group` carries position, tilt and radius (as scale). Everything inside is
 * in a unit disc. Layers share one uniform set (see galaxyUniforms.js):
 *   volume — raymarched body: diffuse light + dust (renderOrder 0, drawn first)
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

    this.volumeMaterial = createVolumeMaterial(this.uniforms);
    this.volume = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), this.volumeMaterial);
    this.volume.renderOrder = 0;
    // Rendered at reduced resolution by GalaxyScenePass.
    this.volume.layers.set(LAYERS.VOLUME);

    this.group.add(this.volume, this.stars, this.hii);

    this.phase = 0;
    this.speed = 0;
    this.radius = 1;
    this.dustScale = dustScale;
    this.emphasis = 1;
    this.emphasisTarget = 1;

    this.discMap = null;
    this.rebakeTimer = null;

    this.setShape(shape, seed);
    this.setStructure(structure);
    this.bakeDiscMap();
    this.setLook(look);
    this.setMotion(motion);
  }

  /** Bake the in-plane arm/bar/dust fields for the volume shader now. */
  bakeDiscMap() {
    clearTimeout(this.rebakeTimer);
    this.rebakeTimer = null;
    const map = createDiscMapTexture(this.shape, this.structure);
    this.discMap?.dispose();
    this.discMap = map;
    this.uniforms.uDiscMap.value = map;
  }

  /** Bake soon, once rapid changes (slider drags) have settled. */
  scheduleBake() {
    if (!this.discMap) return; // the constructor bakes once both inputs exist
    clearTimeout(this.rebakeTimer);
    this.rebakeTimer = setTimeout(() => this.bakeDiscMap(), REBAKE_DELAY_MS);
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
    this.shape = shape;
    applyShapeUniforms(this.uniforms, shape);
    this.updateVolumeBounds();
    // Shape edits are already debounced by the panel and rebuild geometry anyway.
    if (this.discMap) this.bakeDiscMap();
  }

  /** Fit the volume box to the current shape and bulge profile. */
  updateVolumeBounds() {
    if (!this.shape || !this.structure) return;
    const [x, y, z] = volumeBounds(clampShape(this.shape), clampStructure(this.structure));
    this.uniforms.uBoxHalf.value.set(x, y, z);
    this.volume.scale.set(x, y, z);
  }

  /** Density-wave arms, dust and volume settings: uniforms only. */
  setStructure(structure) {
    this.structure = structure;
    applyStructureUniforms(this.uniforms, structure, this.dustScale);
    this.updateVolumeBounds();
    this.scheduleBake();
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

  /** Volume raymarch budget (see QUALITY in store.js). */
  setQuality({ steps, octaves }) {
    this.baseSteps = steps;
    this.uniforms.uSteps.value = steps;
    this.uniforms.uOctaves.value = octaves;
  }

  /**
   * Per-frame volume LOD from the on-screen size (see lod.js).
   * @param {THREE.PerspectiveCamera} camera
   * @param {number} width viewport px
   * @param {number} height viewport px
   */
  updateLod(camera, width, height) {
    if (!this.baseSteps) return;
    const distance = camera.position.distanceTo(this.group.position);
    const footprint = screenFootprint(this.radius * 1.3, distance, camera.fov, width, height);
    this.uniforms.uSteps.value = adaptiveSteps(this.baseSteps, footprint);
  }

  setPixelRatio(value) {
    this.uniforms.uPixelRatio.value = value;
  }

  dispose() {
    this.group.removeFromParent();
    this.stars.geometry.dispose();
    this.hii.geometry.dispose();
    this.volume.geometry.dispose();
    this.starMaterial.dispose();
    this.hiiMaterial.dispose();
    this.volumeMaterial.dispose();
    clearTimeout(this.rebakeTimer);
    this.discMap?.dispose();
  }
}
