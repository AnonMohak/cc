import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { introCamera } from './introTimeline.js';
import { bakeNoise3d, NOISE3D_SIZE } from './noise3d.js';
import { marchShader, compositeShader, QUAD_VERTEX } from './gargantuaShader.js';

const _pose = { position: [0, 0, 0], target: [0, 0, 0], roll: 0, fov: 60 };
const _target = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _size = new THREE.Vector2();

/** Ray-march resolution as a share of the drawing buffer. */
const MARCH_SCALE = 0.5;
/** Steps per ray (≤ gargantuaShader.js MAX_STEPS). */
const MARCH_STEPS = 500;

/**
 * The intro cinematic: the animation black hole (Gargantua), its own camera
 * and its own rendering, apart from the scene and its black holes. It exists
 * only while the intro plays (app.js), then is disposed.
 *
 * Rendering: a ray march of the disc gas at MARCH_SCALE resolution into a
 * HalfFloat target (light, transmittance), then a full-resolution composite
 * (sky, exposure, tone mapping, grade) to the screen.
 */
export class IntroCinematic {
  /** @param {{ aspect: number }} options */
  constructor({ aspect }) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.01, 1000);
    /** For tuning: a fixed pose ({ position, target, roll, fov }) instead of the timeline. */
    this.override = null;
    this.time = 0;

    this.noise = new THREE.Data3DTexture(bakeNoise3d(), NOISE3D_SIZE, NOISE3D_SIZE, NOISE3D_SIZE);
    this.noise.format = THREE.RGFormat;
    this.noise.type = THREE.UnsignedByteType;
    this.noise.minFilter = THREE.LinearFilter;
    this.noise.magFilter = THREE.LinearFilter;
    this.noise.wrapS = this.noise.wrapT = this.noise.wrapR = THREE.RepeatWrapping;
    this.noise.unpackAlignment = 1;
    this.noise.needsUpdate = true;

    const camUniforms = {
      uCamPos: { value: new THREE.Vector3() },
      uCamBasis: { value: new THREE.Matrix3() },
      uTanHalfFov: { value: new THREE.Vector2(1, 1) },
    };
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.march = new THREE.ShaderMaterial({
      name: 'IntroMarch',
      uniforms: { ...camUniforms, uNoise: { value: this.noise }, uTime: { value: 0 }, uSteps: { value: MARCH_STEPS } },
      vertexShader: QUAD_VERTEX,
      fragmentShader: marchShader,
      depthTest: false,
      depthWrite: false,
    });
    this.composite = new THREE.ShaderMaterial({
      name: 'IntroComposite',
      uniforms: { ...camUniforms, tMarch: { value: this.target.texture }, uResolution: { value: new THREE.Vector2(1, 1) }, uExposure: { value: 1 } },
      vertexShader: QUAD_VERTEX,
      fragmentShader: compositeShader,
      depthTest: false,
      depthWrite: false,
    });
    this.marchQuad = new FullScreenQuad(this.march);
    this.compositeQuad = new FullScreenQuad(this.composite);
  }

  setSize(width, height) {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  /** Place the camera for t seconds since the start-box click. */
  update(t) {
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
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);

    const u = this.march.uniforms;
    const cam = this.camera;
    u.uCamPos.value.copy(cam.position);
    u.uCamBasis.value.setFromMatrix4(cam.matrixWorld);
    const tanY = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    u.uTanHalfFov.value.set(tanY * cam.aspect, tanY);
    u.uTime.value = this.time;
    this.composite.uniforms.uResolution.value.copy(_size);

    renderer.setRenderTarget(this.target);
    this.marchQuad.render(renderer);
    renderer.setRenderTarget(null);
    this.compositeQuad.render(renderer);
  }

  dispose() {
    this.noise.dispose();
    this.target.dispose();
    this.march.dispose();
    this.composite.dispose();
    this.marchQuad.dispose();
    this.compositeQuad.dispose();
  }
}
