import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import stepShader from '../galaxy/shaders/collisionStep.glsl?raw';
import initShader from '../galaxy/shaders/collisionInit.glsl?raw';
import starsChunk from '../galaxy/shaders/chunks/stars.glsl?raw';
import { glsl, CHUNKS } from '../galaxy/shaders/glsl.js';
import {
  designOrbit,
  createCentres,
  stepCentres,
  warpFactor,
  gasFade,
  spinAxis,
  starSubsteps,
  simTextureSize,
  galaxyMass,
  G_SIM,
  SOFTENING,
} from '../galaxy/collision.js';

const INIT_SHADER = glsl(CHUNKS.model, starsChunk, initShader);

const UP = new THREE.Vector3(0, 1, 0);
const _normal = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();

/**
 * Whether this GPU can render to float textures (the star simulation needs
 * RGBA32F targets; half floats are too coarse for world positions).
 * @param {THREE.WebGLRenderer} renderer
 */
export function collisionSupported(renderer) {
  return renderer.capabilities.maxVertexTextures > 0 && renderer.extensions.has('EXT_color_buffer_float');
}

/**
 * One running collision between two galaxies (see galaxy/collision.js for
 * the physics). Owns the GPU star simulation; call dispose() to stop it,
 * which also puts both galaxies back where the store has them.
 *
 * Stages: the centres glide in on their orbit (fast-forwarded while far
 * apart; stars still analytic), then, from contact, each galaxy's stars
 * become test particles stepped on the GPU in two RGBA32F ping-pong
 * textures (position + crest, velocity).
 */
export class CollisionSim {
  /**
   * @param {{ renderer: THREE.WebGLRenderer, a: import('../galaxy/Galaxy.js').Galaxy, b: import('../galaxy/Galaxy.js').Galaxy, pass?: number, speed?: number }} options
   */
  constructor({ renderer, a, b, pass, speed }) {
    this.renderer = renderer;
    this.galaxies = [a, b];
    this.ids = [a.id, b.id];
    const posA = a.group.position.toArray();
    const posB = b.group.position.toArray();
    const orbit = designOrbit({ posA, posB, radiusA: a.radius, radiusB: b.radius, spinA: spinOf(a), pass, speed });
    this.state = createCentres({ posA, posB, ...orbit, radiusA: a.radius, radiusB: b.radius });
    /** @type {{ gpu: GPUComputationRenderer, pos: object, vel: object, count: number }[] | null} */
    this.stars = null;
    for (const g of this.galaxies) g.beginCollision();
    this.apply();
  }

  /** The objects in the collision (depth of field keeps them all sharp). */
  members() {
    return this.galaxies;
  }

  /** The two galaxy ids. */
  pair() {
    return this.ids;
  }

  /** The barycentre (fixed: the orbit has zero total momentum). */
  centre(out = new THREE.Vector3()) {
    const s = this.state;
    const M = s.mass[0] + s.mass[1];
    return out.set(
      (s.mass[0] * s.pos[0][0] + s.mass[1] * s.pos[1][0]) / M,
      (s.mass[0] * s.pos[0][1] + s.mass[1] * s.pos[1][1]) / M,
      (s.mass[0] * s.pos[0][2] + s.mass[1] * s.pos[1][2]) / M,
    );
  }

  /** @param {number} dt simulation seconds (0 while paused) */
  update(dt) {
    const s = this.state;
    if (dt > 0) {
      if (!s.interacting) {
        stepCentres(s, dt * warpFactor(s));
        if (s.interacting) this.startStars();
      } else {
        const n = starSubsteps(dt);
        const h = dt / n;
        for (let i = 0; i < n; i++) {
          // Stars feel the centres where they are at the start of the step.
          this.setCentreUniforms(h);
          for (const sim of this.stars) sim.gpu.compute();
          stepCentres(s, h);
        }
      }
    }
    this.apply();
  }

  /** Move the groups, fade the gas, hand the current star textures to the shaders. */
  apply() {
    const s = this.state;
    for (let b = 0; b < 2; b++) {
      const g = this.galaxies[b];
      g.group.position.fromArray(s.pos[b]);
      g.setGasFade(gasFade(s.disruption[b]));
      if (this.stars) g.updateStarSimulation(this.stars[b].gpu.getCurrentRenderTarget(this.stars[b].pos).texture);
    }
  }

  setCentreUniforms(h) {
    const s = this.state;
    for (const sim of this.stars) {
      for (const variable of [sim.pos, sim.vel]) {
        const u = variable.material.uniforms;
        u.uDt.value = h;
        u.uCentre0.value.fromArray(s.pos[0]);
        u.uCentre1.value.fromArray(s.pos[1]);
        u.uGm.value.set(s.gm[0], s.gm[1]);
        u.uEps2.value.set(s.eps2[0], s.eps2[1]);
      }
    }
  }

  /**
   * Contact: hand each galaxy's stars, as they are now, to the GPU. The
   * start state is one shader pass running the star shader's own
   * gs_position (collisionInit.glsl), so there is no CPU loop over up to
   * 200k stars (~100 ms) at the moment of contact.
   */
  startStars() {
    const s = this.state;
    this.stars = this.galaxies.map((g, b) => {
      g.group.position.fromArray(s.pos[b]);
      g.group.updateMatrixWorld();
      const count = Math.min(g.count, g.quality?.starCap ?? g.count);
      const { width, height } = simTextureSize(count);
      const gpu = new GPUComputationRenderer(width, height, this.renderer);
      const vel = gpu.addVariable('textureVelocity', stepShader, gpu.createTexture());
      const pos = gpu.addVariable('texturePosition', `#define WRITE_POSITION\n${stepShader}`, gpu.createTexture());
      gpu.setVariableDependencies(vel, [pos, vel]);
      gpu.setVariableDependencies(pos, [pos, vel]);
      for (const variable of [pos, vel]) {
        Object.assign(variable.material.uniforms, {
          uDt: { value: 0 },
          uCentre0: { value: new THREE.Vector3() },
          uCentre1: { value: new THREE.Vector3() },
          uGm: { value: new THREE.Vector2() },
          uEps2: { value: new THREE.Vector2() },
        });
      }
      const error = gpu.init();
      if (error) throw new Error(error);
      this.writeStartState(gpu, g, b, pos, vel, count, width, height);
      g.setStarSimulation(gpu.getCurrentRenderTarget(pos).texture, count);
      return { gpu, pos, vel, count };
    });
  }

  /** Render the start positions and velocities into the current targets. */
  writeStartState(gpu, g, b, pos, vel, count, width, height) {
    const s = this.state;
    const geo = g.stars.geometry;
    const orbit = new THREE.DataTexture(padded(geo.getAttribute('aOrbit').array, count, 4, width * height), width, height, THREE.RGBAFormat, THREE.FloatType);
    const offset = new THREE.DataTexture(padded(geo.getAttribute('position').array, count, 3, width * height), width, height, THREE.RGBAFormat, THREE.FloatType);
    orbit.needsUpdate = true;
    offset.needsUpdate = true;
    const uniforms = {
      // gs_position reads the galaxy's motion and structure uniforms (by reference).
      ...g.uniforms,
      uOrbit: { value: orbit },
      uOffset: { value: offset },
      uMatrix: { value: g.group.matrixWorld.clone() },
      uCentre: { value: new THREE.Vector3().fromArray(s.pos[b]) },
      uCentreVel: { value: new THREE.Vector3().fromArray(s.vel[b]) },
      uSpin: { value: new THREE.Vector3().fromArray(spinOf(g)) },
      uGmSelf: { value: G_SIM * galaxyMass(g.radius) },
      uEps2Self: { value: (SOFTENING * g.radius) ** 2 },
    };
    for (const [variable, define] of [[pos, '#define WRITE_POSITION\n'], [vel, '']]) {
      const material = gpu.createShaderMaterial(define + INIT_SHADER, uniforms);
      gpu.doRenderTarget(material, gpu.getCurrentRenderTarget(variable));
      material.dispose();
    }
    orbit.dispose();
    offset.dispose();
  }

  dispose() {
    for (const sim of this.stars ?? []) sim.gpu.dispose();
    this.stars = null;
    for (const g of this.galaxies) g.endCollision();
  }
}

/** The first `count` items of `itemSize` floats, as RGBA texels padded to `texels`. */
function padded(source, count, itemSize, texels) {
  const data = new Float32Array(texels * 4);
  if (itemSize === 4) {
    data.set(source.subarray(0, count * 4));
    return data;
  }
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < itemSize; k++) data[i * 4 + k] = source[i * itemSize + k];
  }
  return data;
}

/** World spin axis of a galaxy (collision.js spinAxis). */
function spinOf(galaxy) {
  galaxy.group.updateMatrixWorld();
  galaxy.group.getWorldQuaternion(_quaternion);
  _normal.copy(UP).applyQuaternion(_quaternion);
  return spinAxis(_normal.toArray(), galaxy.speed);
}
