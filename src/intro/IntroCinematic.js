import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { introCamera } from './introTimeline.js';
import { bakeNoise3d, NOISE3D_SIZE } from './noise3d.js';
import { marchShader, compositeShader, lightShader, LIGHT_SIZE, QUAD_VERTEX } from './gargantuaShader.js';
import { MARCH_LOOK, COMPOSITE_LOOK } from './introLook.js';

/** Uniform objects for a look: numbers, or THREE.Vector3 for colours. */
function lookUniforms(look) {
  return Object.fromEntries(Object.entries(look).map(([name, v]) => [name, { value: Array.isArray(v) ? new THREE.Vector3(...v) : v }]));
}

const _pose = { position: [0, 0, 0], target: [0, 0, 0], roll: 0, fov: 60, exposure: 1 };
const _target = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _size = new THREE.Vector2();

/** Ray-march resolution as a share of the drawing buffer. */
const MARCH_SCALE = 0.5;
/** Steps per ray (≤ gargantuaShader.js MAX_STEPS). */
const MARCH_STEPS = 500;
/**
 * Accumulation time constant (s): each frame keeps exp(−dt / this) of the
 * last. About a 180° film shutter's blur, and it averages the step jitter.
 */
const SHUTTER = 0.06;

/**
 * The intro cinematic: the animation black hole (Gargantua), its own camera
 * and its own rendering, apart from the scene and its black holes. It exists
 * only while the intro plays (app.js), then is disposed.
 *
 * Rendering: a ray march of the disc gas along bent light paths at
 * MARCH_SCALE resolution into one of two HalfFloat targets (light, depth),
 * mixed with the other (the last frame: accumulation), with mipmaps for the
 * glow; then a full-resolution composite (depth of field, glow, flare,
 * exposure, ACES, grade, grain) to the screen.
 */
export class IntroCinematic {
  /** @param {{ aspect: number }} options */
  constructor({ aspect }) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.01, 1000);
    /** For tuning: a fixed pose ({ position, target, roll, fov }) instead of the timeline. */
    this.override = null;
    /** For tuning: a fixed time (s) instead of the clock. */
    this.fixedTime = null;
    this.time = 0;
    this.exposure = 1;
    this.sparse = 1;
    this.haze = 1;

    // The noise bakes in a worker (main-thread fallback); until it arrives
    // the cinematic is not ready (the start box keeps saying Loading).
    this.ready = false;
    this.noise = new THREE.Data3DTexture(new Uint8Array(2), 1, 1, 1);
    this.noise.format = THREE.RGFormat;
    this.noise.type = THREE.UnsignedByteType;
    this.noise.minFilter = THREE.LinearFilter;
    this.noise.magFilter = THREE.LinearFilter;
    this.noise.wrapS = this.noise.wrapT = this.noise.wrapR = THREE.RepeatWrapping;
    this.noise.unpackAlignment = 1;
    this.noise.needsUpdate = true;
    this.worker = null;
    this.bakeNoise();

    const camUniforms = {
      uCamPos: { value: new THREE.Vector3() },
      uCamBasis: { value: new THREE.Matrix3() },
      uTanHalfFov: { value: new THREE.Vector2(1, 1) },
    };
    const targetOptions = { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter };
    this.targets = [new THREE.WebGLRenderTarget(1, 1, targetOptions), new THREE.WebGLRenderTarget(1, 1, targetOptions)];
    this.frame = 0;
    this.lastRender = null;
    // The gas uniforms, shared by the march and the light pass (by reference).
    const gasUniforms = {
      uNoise: { value: this.noise },
      uTime: { value: 0 },
      uSparse: { value: 1 },
      ...lookUniforms(MARCH_LOOK),
    };
    // Self-shadowing: the inner disc's light through the gas, over the disc
    // (u = angle, wraps; v = log radius), once per frame.
    this.lightTarget = new THREE.WebGLRenderTarget(LIGHT_SIZE[0], LIGHT_SIZE[1], { type: THREE.HalfFloatType, depthBuffer: false });
    this.lightTarget.texture.wrapS = THREE.RepeatWrapping;
    this.light = new THREE.ShaderMaterial({
      name: 'IntroLight',
      uniforms: gasUniforms,
      vertexShader: QUAD_VERTEX,
      fragmentShader: lightShader,
      depthTest: false,
      depthWrite: false,
    });
    this.lightQuad = new FullScreenQuad(this.light);
    this.march = new THREE.ShaderMaterial({
      name: 'IntroMarch',
      uniforms: {
        ...camUniforms,
        ...gasUniforms,
        uSteps: { value: MARCH_STEPS },
        uPixelAngle: { value: 0.003 },
        uHaze: { value: 1 },
        tPrev: { value: null },
        uHistory: { value: 0 },
        uFrame: { value: 0 },
        uLight: { value: this.lightTarget.texture },
      },
      vertexShader: QUAD_VERTEX,
      fragmentShader: marchShader,
      depthTest: false,
      depthWrite: false,
    });
    this.composite = new THREE.ShaderMaterial({
      name: 'IntroComposite',
      uniforms: {
        tMarch: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uExposure: { value: 1 },
        uFocus: { value: 10 },
        uTime: { value: 0 },
        ...lookUniforms(COMPOSITE_LOOK),
      },
      vertexShader: QUAD_VERTEX,
      fragmentShader: compositeShader,
      depthTest: false,
      depthWrite: false,
    });
    this.marchQuad = new FullScreenQuad(this.march);
    this.compositeQuad = new FullScreenQuad(this.composite);
  }

  bakeNoise() {
    const accept = (data) => {
      if (!this.noise) return; // disposed meanwhile
      this.noise.image = { data, width: NOISE3D_SIZE, height: NOISE3D_SIZE, depth: NOISE3D_SIZE };
      this.noise.needsUpdate = true;
      this.ready = true;
    };
    const onMainThread = () => setTimeout(() => accept(bakeNoise3d()), 0);
    if (typeof Worker !== 'function') return onMainThread();
    try {
      this.worker = new Worker(new URL('./noiseWorker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        accept(data.data);
        this.worker?.terminate();
        this.worker = null;
      };
      this.worker.onerror = () => {
        this.worker?.terminate();
        this.worker = null;
        onMainThread();
      };
      this.worker.postMessage({ size: NOISE3D_SIZE });
    } catch {
      onMainThread();
    }
  }

  /** The current look values (introLook.js keys). */
  getLook() {
    const out = {};
    for (const material of [this.march, this.composite]) {
      for (const name of Object.keys(material === this.march ? MARCH_LOOK : COMPOSITE_LOOK)) {
        const v = material.uniforms[name].value;
        out[name] = typeof v === 'number' ? v : v.toArray();
      }
    }
    return out;
  }

  /** Change look values live (introLook.js keys; colours as [r, g, b]). */
  setLook(values) {
    for (const [name, v] of Object.entries(values)) {
      const u = this.march.uniforms[name] ?? this.composite.uniforms[name];
      if (!u) continue;
      if (Array.isArray(v)) u.value.fromArray(v);
      else u.value = v;
    }
  }

  setSize(width, height) {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  /** Place the camera for t seconds since the start-box click. */
  update(clock) {
    const t = this.fixedTime ?? clock;
    this.time = t;
    const pose = this.override ?? introCamera(t, _pose);
    const cam = this.camera;
    cam.position.fromArray(pose.position);
    _target.fromArray(pose.target);
    // Roll: tilt the up vector about the view direction.
    _forward.subVectors(_target, cam.position).normalize();
    _right.crossVectors(_forward, THREE.Object3D.DEFAULT_UP).normalize();
    cam.up.copy(THREE.Object3D.DEFAULT_UP).multiplyScalar(Math.cos(pose.roll)).addScaledVector(_right, Math.sin(pose.roll));
    cam.lookAt(_target);
    this.exposure = pose.exposure ?? 1;
    this.sparse = pose.sparse ?? 1;
    this.haze = pose.haze ?? 1;
    if (cam.fov !== pose.fov) {
      cam.fov = pose.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  /** @param {THREE.WebGLRenderer} renderer */
  render(renderer) {
    renderer.getDrawingBufferSize(_size);
    const w = Math.max(1, Math.round(_size.x * MARCH_SCALE));
    const h = Math.max(1, Math.round(_size.y * MARCH_SCALE));
    let fresh = this.frame === 0;
    for (const target of this.targets) {
      if (target.width !== w || target.height !== h) {
        target.setSize(w, h);
        fresh = true;
      }
    }
    // Real time since the last frame sets how much of it to keep.
    const now = performance.now();
    const dt = this.lastRender === null ? 1 : (now - this.lastRender) / 1000;
    this.lastRender = now;
    const [read, write] = this.frame % 2 === 0 ? this.targets : [this.targets[1], this.targets[0]];
    this.frame++;

    const u = this.march.uniforms;
    const cam = this.camera;
    u.uCamPos.value.copy(cam.position);
    u.uCamBasis.value.setFromMatrix4(cam.matrixWorld);
    const tanY = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    u.uTanHalfFov.value.set(tanY * cam.aspect, tanY);
    u.uPixelAngle.value = (2 * tanY) / h;
    u.uTime.value = this.time;
    u.tPrev.value = read.texture;
    u.uHistory.value = fresh ? 0 : Math.exp(-dt / SHUTTER);
    u.uFrame.value = this.frame % 1024;
    u.uSparse.value = this.sparse;
    u.uHaze.value = this.haze;
    const c = this.composite.uniforms;
    c.tMarch.value = write.texture;
    c.uExposure.value = this.exposure;
    c.uResolution.value.copy(_size);
    // In focus: the hole (its distance from the camera, in Rs).
    c.uFocus.value = cam.position.length();
    c.uTime.value = this.time;

    renderer.setRenderTarget(this.lightTarget);
    this.lightQuad.render(renderer);
    renderer.setRenderTarget(write);
    this.marchQuad.render(renderer);
    renderer.setRenderTarget(null);
    this.compositeQuad.render(renderer);
  }

  dispose() {
    this.lightTarget.dispose();
    this.light.dispose();
    this.lightQuad.dispose();
    this.worker?.terminate();
    this.worker = null;
    this.noise.dispose();
    this.noise = null;
    for (const target of this.targets) target.dispose();
    this.march.dispose();
    this.composite.dispose();
    this.marchQuad.dispose();
    this.compositeQuad.dispose();
  }
}
