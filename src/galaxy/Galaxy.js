import * as THREE from 'three';
import { generateGalaxy } from './generateGalaxy.js';
import { createStarMaterial, createHiiMaterial, createSupernovaMaterial, createJetMaterial } from './starMaterials.js';
import { createSupernovaSchedule, pickSupernovaSite, SUPERNOVA_SLOTS } from './supernovae.js';
import { createVolumeMaterial } from './volumeMaterial.js';
import { volumeBounds, marchBounds } from './densityModel.js';
import { clampShape, clampStructure, clampHole } from './params.js';
import {
  createGalaxyUniforms,
  applyBandUniforms,
  applyShapeUniforms,
  applyStructureUniforms,
  applyLookUniforms,
  applyMotionUniforms,
} from './galaxyUniforms.js';
import { approach } from './emphasis.js';
import { LAYERS } from '../core/layers.js';
import { screenFootprint, adaptiveSteps, starLod } from './lod.js';
import { createDiscMapTexture } from './discMap.js';
import { createDofProxy, setDofProxyHole, disposeDofProxy } from './dofProxy.js';

const UP = new THREE.Vector3(0, 1, 0);
// Stars move on orbits up to a·(1 + e) and the halo reaches 1.4; one fixed
// bound at the origin covers every phase of the animation.
const BOUND_RADIUS = 1.7;
const _inverse = new THREE.Matrix4();
const _quaternion = new THREE.Quaternion();
const JET_SEGMENTS = 8;

/** Two strips (north/south jet), x ∈ [−0.5, 0.5] across, y ∈ [0, 1] along. */
function createJetGeometry() {
  const positions = [];
  const sides = [];
  const index = [];
  for (const side of [1, -1]) {
    const base = positions.length / 3;
    for (let i = 0; i <= JET_SEGMENTS; i++) {
      const y = i / JET_SEGMENTS;
      positions.push(-0.5, y, 0, 0.5, y, 0);
      sides.push(side, side);
    }
    for (let i = 0; i < JET_SEGMENTS; i++) {
      const a = base + i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSide', new THREE.Float32BufferAttribute(sides, 1));
  geometry.setIndex(index);
  // The strips turn to face the camera in the shader: bound the whole axis
  // (a standalone black hole's jets are longer, see setHole).
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2.5);
  return geometry;
}
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
 *   supernovae — a few flash points that follow their exploding star (renderOrder 3)
 *   jets  — a standalone black hole's jets along its axis, when its Jets is on (layer JETS, core/JetPass.js)
 * The black hole's shadow, lensing and accretion disc are drawn by
 * core/BlackHolePass.js from blackHoleInfo().
 *
 * A standalone black hole (kind 'blackhole') is the same object: its stars
 * are a sparse cloud, with no volume and no supernovae, and its hole comes
 * from the `hole` params (setHole) instead of the bulge.
 */
export class Galaxy {
  /**
   * @param {{ shape: object, seed: number, structure?: object, look?: object, motion?: object, kind?: string, hole?: object, pixelRatio?: number, dustScale?: number, supernovae?: boolean }} params
   */
  constructor({ shape, seed, structure, look, motion, kind, hole, pixelRatio = 1, dustScale = 1, supernovae = true }) {
    this.group = new THREE.Group();
    this.standalone = kind === 'blackhole';
    this.hole = this.standalone ? clampHole(hole) : null;
    // Disc colours for the lens (linear; set from the hole params in setHole).
    this.holeHot = new THREE.Color();
    this.holeCool = new THREE.Color();
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
    // A black hole's star cloud has no diffuse body.
    this.volume.visible = !this.standalone;

    // Supernovae: SUPERNOVA_SLOTS points, reused oldest-first.
    const snGeometry = new THREE.BufferGeometry();
    snGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SUPERNOVA_SLOTS * 3), 3));
    snGeometry.setAttribute('aOrbit', new THREE.BufferAttribute(new Float32Array(SUPERNOVA_SLOTS * 4), 4));
    // Born long ago = dark until the first explosion.
    snGeometry.setAttribute('aBirth', new THREE.BufferAttribute(new Float32Array(SUPERNOVA_SLOTS).fill(-1e4), 1));
    snGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), BOUND_RADIUS);
    this.supernovaMaterial = createSupernovaMaterial(this.uniforms);
    this.supernovae = new THREE.Points(snGeometry, this.supernovaMaterial);
    this.supernovae.renderOrder = 3;
    this.supernovaeOn = supernovae;
    this.supernovae.visible = supernovae && !this.standalone;
    this.snSchedule = createSupernovaSchedule(seed);
    this.snSlot = 0;
    this.snTime = 0;
    // Accretion-disc time: simulation time × holeSpin (the intro fall spins
    // the disc up). Accumulated, so a spin change never makes the streaks jump.
    this.holeTime = 0;
    this.holeSpin = 1;
    // Intro-fall lens warp 0–1 (BlackHolePass; blackHole.js WARP_*).
    this.holeWarp = 0;

    this.jetMaterial = createJetMaterial(this.uniforms);
    this.jets = new THREE.Mesh(createJetGeometry(), this.jetMaterial);
    this.jets.renderOrder = 4;
    this.jets.visible = false;
    // Drawn after the black-hole pass (core/JetPass.js), so the lens and its
    // cleared cavity never dim the jet base.
    this.jets.layers.set(LAYERS.JETS);
    this.rsUnit = 0;

    // Depth-of-field stand-in (galaxies share it; a black hole owns its material).
    this.dofProxy = createDofProxy(this.standalone);

    this.group.add(this.volume, this.stars, this.hii, this.supernovae, this.jets, this.dofProxy);

    this.phase = 0;
    this.speed = 0;
    this.radius = 1;
    this.dustScale = dustScale;
    this.emphasis = 1;
    this.emphasisTarget = 1;

    this.discMap = null;
    this.lodCount = Infinity; // star LOD; Infinity = no LOD limit
    // Collision (scene/CollisionSim.js): the sim moves the group and may
    // own the star positions; homePosition is where the store puts it.
    this.colliding = false;
    this.simCount = Infinity;
    this.homePosition = [0, 0, 0];
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
    this.onBaked?.();
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
    stars.setAttribute('aColor', new THREE.BufferAttribute(data.color, 3));
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
    if (this.standalone) this.setHole(this.hole);
    this.applyStarCap();
    applyShapeUniforms(this.uniforms, shape);
    this.updateVolumeBounds();
    // Shape edits are already debounced by the panel and rebuild geometry anyway.
    if (this.discMap) this.bakeDiscMap();
  }

  /** Fit the volume box to the current shape and bulge profile. */
  updateVolumeBounds() {
    if (!this.shape || !this.structure) return;
    const shape = clampShape(this.shape);
    const structure = clampStructure(this.structure);
    const [x, y, z] = volumeBounds(shape, structure);
    this.uniforms.uBoxHalf.value.set(x, y, z);
    this.volume.scale.set(x, y, z);
    const march = marchBounds(shape, structure);
    const u = this.uniforms;
    u.uDiscHalfHeight.value = march.discHalfHeight;
    u.uDiscRadius.value = march.discRadius;
    u.uBulgeRadii.value.fromArray(march.bulgeRadii);
    u.uStepLength.value = march.stepLength;
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
    this.homePosition = l.position;
    // A collision moves the group itself (and never lets radius/tilt change).
    if (!this.colliding) this.group.position.fromArray(l.position);
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
    this.holeTime += dt * this.holeSpin;
    this.tickSupernovae(dt);
    if (this.emphasis !== this.emphasisTarget) {
      this.emphasis = approach(this.emphasis, this.emphasisTarget, realDt);
      this.uniforms.uEmphasis.value = this.emphasis;
    }
  }

  /** Fire scheduled explosions (simulation time: nothing happens while paused). */
  tickSupernovae(dt) {
    this.snTime += dt;
    this.uniforms.uSnTime.value = this.snTime;
    if (!this.supernovae.visible) return;
    const events = this.snSchedule.update(dt);
    if (events === 0) return;
    const geo = this.stars.geometry;
    const orbit = geo.getAttribute('aOrbit').array;
    const star = geo.getAttribute('aStar').array;
    const snOrbit = this.supernovae.geometry.getAttribute('aOrbit');
    const snBirth = this.supernovae.geometry.getAttribute('aBirth');
    for (let e = 0; e < events; e++) {
      const i = pickSupernovaSite(this.snSchedule.rng, orbit, star, this.count);
      if (i < 0) continue;
      const slot = this.snSlot;
      this.snSlot = (slot + 1) % SUPERNOVA_SLOTS;
      for (let k = 0; k < 4; k++) snOrbit.array[slot * 4 + k] = orbit[i * 4 + k];
      snBirth.array[slot] = this.snTime;
    }
    snOrbit.needsUpdate = true;
    snBirth.needsUpdate = true;
  }

  /** Diffraction spike style for the supernova flashes (0 off, 1 Hubble, 2 JWST). */
  setSpikeStyle(style) {
    this.uniforms.uSpikeStyle.value = style;
  }

  /** Settings → View (wavelength band, see bands.js). */
  setBand(name) {
    applyBandUniforms(this.uniforms, name);
  }

  updateJets() {
    this.jets.visible = this.standalone && this.hole.jets && this.rsUnit > 0;
  }

  /** Disc spin multiplier (core/blackHoleFall.js fallPose spin); 1 = normal. */
  setHoleSpin(k) {
    this.holeSpin = k;
  }

  /** Intro-fall lens warp, 0 (none) to 1 (blackHole.js WARP_*). */
  setHoleWarp(k) {
    this.holeWarp = k;
  }

  /** A standalone black hole's params (params.js LIMITS.hole): uniforms only. */
  setHole(hole) {
    if (!this.standalone) return;
    this.hole = clampHole(hole);
    this.rsUnit = this.hole.size;
    this.holeHot.set(this.hole.colorHot);
    this.holeCool.set(this.hole.colorCool);
    this.uniforms.uJetRs.value = this.rsUnit;
    // Jets reach well past the disc, out of the star cloud.
    this.uniforms.uJetLength.value = Math.min(2, this.rsUnit * 60);
    this.uniforms.uJetDiscOuter.value = this.hole.discSize;
    // Depth-of-field stand-in: just past the disc, writing the hole's depth
    // only where the lens shows the hole (dofProxy.js).
    if (this.dofProxy) setDofProxyHole(this.dofProxy, this.rsUnit, this.hole.discSize);
    this.updateJets();
  }

  /**
   * Fill a lens slot for BlackHolePass (world centre, disc normal, Rs in world
   * units, disc time, disc look). False for galaxies: only standalone black
   * holes are drawn. Allocation-free: called every frame.
   */
  blackHoleInfo(slot) {
    if (!this.standalone || this.rsUnit <= 0) return false;
    this.group.updateMatrixWorld();
    this.group.getWorldPosition(slot.center);
    this.group.getWorldQuaternion(_quaternion);
    slot.normal.copy(UP).applyQuaternion(_quaternion);
    slot.rsWorld = this.rsUnit * this.radius;
    slot.time = this.holeTime;
    const h = this.hole;
    slot.discOuter = h.discSize;
    // The hole is the whole object, so it follows the selection emphasis.
    slot.gain = h.brightness * this.emphasis;
    slot.glow = h.glow;
    slot.streak = h.streak ? 1 : 0;
    slot.warp = this.holeWarp;
    slot.hot.copy(this.holeHot);
    slot.cool.copy(this.holeCool);
    return true;
  }

  /** Settings → Supernovae (never in a black hole's star cloud, nor while colliding). */
  setSupernovae(on) {
    this.supernovaeOn = on;
    this.supernovae.visible = on && !this.standalone && !this.colliding;
  }

  /** Start of a collision: the sim moves the group from now on. */
  beginCollision() {
    this.colliding = true;
    // Flashes follow analytic orbits, which no longer match the stars.
    this.setSupernovae(this.supernovaeOn);
  }

  /** End of a collision: back home, analytic stars, full gas. */
  endCollision() {
    this.colliding = false;
    this.group.position.fromArray(this.homePosition);
    this.setStarSimulation(null);
    this.setGasFade(1);
    this.setSupernovae(this.supernovaeOn);
  }

  /** Gas fade 0–1 (collision.js gasFade): volume, H II and dust. */
  setGasFade(f) {
    this.uniforms.uGasFade.value = f;
    this.volume.visible = !this.standalone && f > 0;
  }

  /**
   * Draw the stars from a simulated position texture (world space, one
   * texel per star), or analytic again with null. Only the first `count`
   * stars are simulated, so only those draw.
   * @param {import('three').Texture | null} texture
   * @param {number} [count]
   */
  setStarSimulation(texture, count = Infinity) {
    const u = this.uniforms;
    u.uSim.value = texture ? 1 : 0;
    u.uSimPos.value = texture;
    this.simCount = texture ? count : Infinity;
    // Tidal tails reach far outside the fixed bounding sphere.
    this.stars.frustumCulled = !texture;
    this.applyStarCap();
  }

  /** Per frame while simulated: the texture to read (ping-pong) and world → unit space. */
  updateStarSimulation(texture) {
    this.uniforms.uSimPos.value = texture;
    this.group.updateMatrixWorld();
    this.uniforms.uSimToLocal.value.copy(this.group.matrixWorld).invert();
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

  /** Apply a quality tier (core/quality.js): steps, star cap, point size, volume dust. */
  setQuality(tier) {
    this.quality = tier;
    this.baseSteps = tier.steps;
    const u = this.uniforms;
    u.uSteps.value = tier.steps;
    u.uMaxPointPx.value = tier.maxPointPx;
    u.uVolumeDust.value = tier.volumeDust ? 1 : 0;
    this.applyStarCap();
  }

  /**
   * Draw only the first N stars (they are in random order, so it is a fair
   * subset): the tier cap, then the star LOD (updateLod).
   */
  applyStarCap() {
    if (!this.quality) return;
    const drawn = Math.min(this.count, this.quality.starCap, this.lodCount, this.simCount);
    this.stars.geometry.setDrawRange(0, drawn);
    const hiiCap = Math.ceil(this.hiiCount * Math.min(1, drawn / Math.max(this.count, 1)));
    this.hii.geometry.setDrawRange(0, hiiCap);
  }

  /**
   * Per-frame LOD from the on-screen size (see lod.js): volume steps, and
   * fewer but brighter stars for far galaxies.
   * @param {THREE.PerspectiveCamera} camera
   * @param {number} width viewport px
   * @param {number} height viewport px
   */
  updateLod(camera, width, height) {
    if (!this.baseSteps) return;
    const distance = camera.position.distanceTo(this.group.position);
    const footprint = screenFootprint(this.radius * 1.3, distance, camera.fov, width, height);
    this.uniforms.uSteps.value = adaptiveSteps(this.baseSteps, footprint);
    const lod = starLod(Math.min(this.count, this.quality.starCap, this.simCount), footprint);
    this.uniforms.uLodGain.value = lod.gain;
    const lodCount = lod.gain === 1 ? Infinity : lod.count;
    if (lodCount !== this.lodCount) {
      this.lodCount = lodCount;
      this.applyStarCap();
    }
  }

  setPixelRatio(value) {
    this.uniforms.uPixelRatio.value = value;
  }

  dispose() {
    this.group.removeFromParent();
    this.stars.geometry.dispose();
    this.hii.geometry.dispose();
    this.supernovae.geometry.dispose();
    this.supernovaMaterial.dispose();
    this.volume.geometry.dispose();
    this.starMaterial.dispose();
    this.hiiMaterial.dispose();
    this.volumeMaterial.dispose();
    this.jets.geometry.dispose();
    this.jetMaterial.dispose();
    disposeDofProxy(this.dofProxy);
    clearTimeout(this.rebakeTimer);
    this.discMap?.dispose();
  }
}
