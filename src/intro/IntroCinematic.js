import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { introCamera, fallBoost } from './introTimeline.js';
import { bakeNoise3d, NOISE3D_SIZE } from './noise3d.js';
import { MAX_STEPS, marchShader, resolveShader, compositeShader, lightShader, flareSourceShader, LIGHT_SIZE, QUAD_VERTEX } from './gargantuaShader.js';
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

/** Put a camera at a pose (position, aim, roll in radians, fov in degrees). */
function placeCamera(cam, pose) {
  cam.position.fromArray(pose.position);
  _target.fromArray(pose.target);
  // Roll: tilt the up vector about the view direction.
  _forward.subVectors(_target, cam.position).normalize();
  _right.crossVectors(_forward, THREE.Object3D.DEFAULT_UP).normalize();
  cam.up.copy(THREE.Object3D.DEFAULT_UP).multiplyScalar(Math.cos(pose.roll)).addScaledVector(_right, Math.sin(pose.roll));
  cam.lookAt(_target);
  if (cam.fov !== pose.fov) {
    cam.fov = pose.fov;
    cam.updateProjectionMatrix();
  }
  cam.updateMatrixWorld();
}

/** Ray-march resolution as a share of the drawing buffer. */
const MARCH_SCALE = 0.5;
/** Steps per ray (≤ gargantuaShader.js MAX_STEPS). */
const MARCH_STEPS = 500;
/**
 * Accumulation time constant (s): each frame keeps exp(−dt / this) of the
 * last. About a 180° film shutter's blur, and it averages the step jitter.
 */
const SHUTTER = 0.06;
/** The light pass runs every this many frames. */
const LIGHT_EVERY = 2;

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
    // The camera at the start of the shutter (motion blur).
    this.shutterCamera = new THREE.PerspectiveCamera(60, aspect, 0.01, 1000);
    /** For tuning: a fixed pose ({ position, target, roll, fov }) instead of the timeline. */
    this.override = null;
    /** For tuning: a fixed time (s) instead of the clock. */
    this.fixedTime = null;
    this.time = 0;
    this.exposure = 1;
    this.sparse = 1;
    this.haze = 1;
    this.boost = [0, 0, 0];
    /** For the offline render script: skip live frames (renderStill draws instead). */
    this.holdLive = false;
    this.outTarget = null;

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
    this.lightTime = null;
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
        uCamPos1: { value: new THREE.Vector3() },
        uCamBasis1: { value: new THREE.Matrix3() },
        uTanHalfFov1: { value: new THREE.Vector2(1, 1) },
        uPixelAngle: { value: 0.003 },
        uHaze: { value: 1 },
        uBoost: { value: new THREE.Vector3() },
        uFrame: { value: 0 },
        uFullSize: { value: new THREE.Vector2(1, 1) },
        uParity: { value: 0 },
        uInterleave: { value: 1 },
        uShutterSample: { value: new THREE.Vector2(0, 0) },
        uLight: { value: this.lightTarget.texture },
      },
      vertexShader: QUAD_VERTEX,
      fragmentShader: marchShader,
      depthTest: false,
      depthWrite: false,
    });
    // The flare source: one texel (weighted centre and strength of the
    // brightest light), shared threshold with the composite.
    const compositeLook = lookUniforms(COMPOSITE_LOOK);
    this.flareTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false });
    this.flareSource = new THREE.ShaderMaterial({
      name: 'IntroFlareSource',
      uniforms: { tMarch: { value: null }, FLARE_THRESHOLD: compositeLook.FLARE_THRESHOLD },
      vertexShader: QUAD_VERTEX,
      fragmentShader: flareSourceShader,
      depthTest: false,
      depthWrite: false,
    });
    this.flareQuad = new FullScreenQuad(this.flareSource);
    this.composite = new THREE.ShaderMaterial({
      name: 'IntroComposite',
      uniforms: {
        tMarch: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uExposure: { value: 1 },
        uFocus: { value: 10 },
        uTime: { value: 0 },
        tFlareSource: { value: this.flareTarget.texture },
        ...compositeLook,
      },
      vertexShader: QUAD_VERTEX,
      fragmentShader: compositeShader,
      depthTest: false,
      depthWrite: false,
    });
    this.marchQuad = new FullScreenQuad(this.march);
    // Interleaved march: half the pixels per frame into a packed half-width
    // target, then the resolve into the accumulation (about half the cost).
    this.tracedTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.resolve = new THREE.ShaderMaterial({
      name: 'IntroResolve',
      uniforms: {
        tTraced: { value: this.tracedTarget.texture },
        tPrev: { value: null },
        uHistory: { value: 0 },
        uParity: { value: 0 },
        uInterleave: { value: 1 },
      },
      vertexShader: QUAD_VERTEX,
      fragmentShader: resolveShader,
      depthTest: false,
      depthWrite: false,
    });
    this.resolveQuad = new FullScreenQuad(this.resolve);
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
    for (const cam of [this.camera, this.shutterCamera]) {
      cam.aspect = width / Math.max(height, 1);
      cam.updateProjectionMatrix();
    }
  }

  /** Place the camera for t seconds since the start-box click. */
  update(clock) {
    const t = this.fixedTime ?? clock;
    this.time = t;
    const pose = this.override ?? introCamera(t, _pose);
    placeCamera(this.camera, pose);
    this.exposure = pose.exposure ?? 1;
    this.sparse = pose.sparse ?? 1;
    this.haze = pose.haze ?? 1;
    // The fall's speed for the aberration (a fixed pose: at rest).
    if (this.override) this.boost[0] = this.boost[1] = this.boost[2] = 0;
    else fallBoost(t, this.boost);
    // The shutter's start: the same path SHUTTER_S earlier (a fixed pose: none).
    const shutter = this.march.uniforms.SHUTTER_S.value;
    placeCamera(this.shutterCamera, this.override ?? introCamera(t - shutter, _pose));
  }

  /** @param {THREE.WebGLRenderer} renderer */
  /**
   * The march and composite uniforms shared by live and offline frames: the
   * cameras, the shot's values, the march size (w × h) and the output size.
   */
  setFrameUniforms(w, h, outW, outH) {
    const u = this.march.uniforms;
    const cam = this.camera;
    u.uCamPos.value.copy(cam.position);
    u.uCamBasis.value.setFromMatrix4(cam.matrixWorld);
    const tanY = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    u.uTanHalfFov.value.set(tanY * cam.aspect, tanY);
    const cam1 = this.shutterCamera;
    u.uCamPos1.value.copy(cam1.position);
    u.uCamBasis1.value.setFromMatrix4(cam1.matrixWorld);
    const tanY1 = Math.tan(THREE.MathUtils.degToRad(cam1.fov / 2));
    u.uTanHalfFov1.value.set(tanY1 * cam1.aspect, tanY1);
    u.uPixelAngle.value = (2 * tanY) / h;
    u.uTime.value = this.time;
    u.uFullSize.value.set(w, h);
    u.uSparse.value = this.sparse;
    u.uHaze.value = this.haze;
    u.uBoost.value.fromArray(this.boost);
    const c = this.composite.uniforms;
    c.uExposure.value = this.exposure;
    c.uResolution.value.set(outW, outH);
    // In focus: the hole (its distance from the camera, in Rs).
    c.uFocus.value = cam.position.length();
    c.uTime.value = this.time;
  }

  render(renderer) {
    if (this.holdLive) return;
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

    this.setFrameUniforms(w, h, _size.x, _size.y);
    const u = this.march.uniforms;
    u.uFrame.value = this.frame % 1024;
    u.uParity.value = this.frame % 2;
    const rs = this.resolve.uniforms;
    rs.tPrev.value = read.texture;
    // A traced pixel's last value is two frames old.
    rs.uHistory.value = fresh ? 0 : Math.exp((-2 * dt) / SHUTTER);
    rs.uParity.value = this.frame % 2;
    const tracedWidth = Math.ceil(w / 2);
    if (this.tracedTarget.width !== tracedWidth || this.tracedTarget.height !== h) this.tracedTarget.setSize(tracedWidth, h);
    this.composite.uniforms.tMarch.value = write.texture;

    // The light over the disc changes slowly (the gas turns ~0.35 rad/s at
    // the inner edge): refresh it every LIGHT_EVERY frames, at once after a
    // jump in time. It was the largest single cost (~12 ms on a UHD 630).
    const jump = this.lightTime === null || Math.abs(this.time - this.lightTime) > 0.5;
    if (fresh || jump || this.frame % LIGHT_EVERY === 0) {
      renderer.setRenderTarget(this.lightTarget);
      this.lightQuad.render(renderer);
      this.lightTime = this.time;
    }
    renderer.setRenderTarget(this.tracedTarget);
    this.marchQuad.render(renderer);
    renderer.setRenderTarget(write);
    this.resolveQuad.render(renderer);
    this.flareSource.uniforms.tMarch.value = write.texture;
    renderer.setRenderTarget(this.flareTarget);
    this.flareQuad.render(renderer);
    renderer.setRenderTarget(null);
    this.compositeQuad.render(renderer);
  }

  /**
   * Offline (the pre-rendered video): one finished frame at t seconds. Every
   * pixel is traced (no interleave) at width × height with `steps` steps,
   * `samples` times at stratified moments of the shutter, and the samples
   * are averaged exactly: clean motion blur, no grain from the shutter. The
   * march draws in tiles so no single GPU draw runs long (Windows resets a
   * driver after ~2 s). Live frames start fresh afterwards.
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} t seconds
   * @returns {Uint8Array} RGBA, rows bottom to top
   */
  renderStill(renderer, t, { width = 1920, height = 1080, samples = 16, steps = 1500, tile = 256 } = {}) {
    const fixed = this.fixedTime;
    const aspect = this.camera.aspect;
    this.fixedTime = null;
    for (const cam of [this.camera, this.shutterCamera]) cam.aspect = width / height;
    this.update(t);
    for (const target of [...this.targets, this.tracedTarget]) target.setSize(width, height);
    if (!this.outTarget) this.outTarget = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false });
    this.outTarget.setSize(width, height);

    this.setFrameUniforms(width, height, width, height);
    const u = this.march.uniforms;
    const rs = this.resolve.uniforms;
    u.uSteps.value = Math.min(steps, MAX_STEPS);
    u.uInterleave.value = 0;
    rs.uInterleave.value = 0;
    renderer.setRenderTarget(this.lightTarget);
    this.lightQuad.render(renderer);
    let [read, write] = this.targets;
    const traced = this.tracedTarget;
    for (let s = 0; s < samples; s++) {
      u.uFrame.value = s;
      u.uShutterSample.value.set(s, samples);
      traced.scissorTest = true;
      for (let y = 0; y < height; y += tile) {
        for (let x = 0; x < width; x += tile) {
          traced.scissor.set(x, y, Math.min(tile, width - x), Math.min(tile, height - y));
          renderer.setRenderTarget(traced);
          this.marchQuad.render(renderer);
        }
      }
      traced.scissorTest = false;
      // A running mean: sample s weighs 1 / (s + 1).
      rs.tPrev.value = read.texture;
      rs.uHistory.value = s / (s + 1);
      renderer.setRenderTarget(write);
      this.resolveQuad.render(renderer);
      [read, write] = [write, read];
    }
    this.flareSource.uniforms.tMarch.value = read.texture;
    renderer.setRenderTarget(this.flareTarget);
    this.flareQuad.render(renderer);
    this.composite.uniforms.tMarch.value = read.texture;
    renderer.setRenderTarget(this.outTarget);
    this.compositeQuad.render(renderer);
    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(this.outTarget, 0, 0, width, height, pixels);
    renderer.setRenderTarget(null);

    // Back to live frames.
    u.uSteps.value = MARCH_STEPS;
    u.uInterleave.value = 1;
    rs.uInterleave.value = 1;
    u.uShutterSample.value.set(0, 0);
    for (const cam of [this.camera, this.shutterCamera]) cam.aspect = aspect;
    this.fixedTime = fixed;
    this.frame = 0;
    this.lightTime = null;
    return pixels;
  }

  dispose() {
    this.outTarget?.dispose();
    this.flareTarget.dispose();
    this.flareSource.dispose();
    this.flareQuad.dispose();
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
    this.tracedTarget.dispose();
    this.resolve.dispose();
    this.resolveQuad.dispose();
    this.compositeQuad.dispose();
  }
}
