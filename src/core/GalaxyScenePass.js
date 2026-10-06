import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { LAYERS } from './layers.js';

/**
 * Replaces RenderPass. Renders the scene in three steps so the expensive
 * raymarched volumes run at a fraction of the screen resolution:
 *
 *   1. background starfield (full resolution)
 *   2. all galaxy volumes → a scaled render target, holding
 *        rgb = emitted light, a = transmittance (product over galaxies)
 *      then composited:  dst = L + dst · T   (dust dims what is behind)
 *   3. galaxy stars and H II regions (full resolution, sharp) on top;
 *      they carry their own analytic dust, so the volume must not dim them.
 *
 * Writes into readBuffer like RenderPass (needsSwap = false).
 */
export class GalaxyScenePass extends Pass {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {{ volumeScale?: number }} [options]
   */
  constructor(scene, camera, { volumeScale = 0.5 } = {}) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = false;
    this.volumeScale = volumeScale;
    /** Optional GPU timer (gpuTimer.js) for per-step timings. */
    this.timer = null;
    this.width = 1;
    this.height = 1;

    // Half float keeps bright cores above 1.0 for bloom/tone mapping.
    this.volumeTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });

    this.composite = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: { tVolume: { value: this.volumeTarget.texture } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D tVolume;
          varying vec2 vUv;
          void main() {
            gl_FragColor = texture2D(tVolume, vUv);
          }`,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.SrcAlphaFactor,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.clearColor = new THREE.Color();
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.resizeVolumeTarget();
  }

  /** Fraction of the screen resolution used for the volumes (0.1–1). */
  setVolumeScale(scale) {
    this.volumeScale = THREE.MathUtils.clamp(scale, 0.1, 1);
    this.resizeVolumeTarget();
  }

  resizeVolumeTarget() {
    this.volumeTarget.setSize(
      Math.max(1, Math.round(this.width * this.volumeScale)),
      Math.max(1, Math.round(this.height * this.volumeScale)),
    );
  }

  render(renderer, writeBuffer, readBuffer) {
    const { scene, camera } = this;
    const layersMask = camera.layers.mask;
    const autoClear = renderer.autoClear;
    const background = scene.background;
    renderer.getClearColor(this.clearColor);
    const clearAlpha = renderer.getClearAlpha();
    const target = this.renderToScreen ? null : readBuffer;

    // 1. Background. autoClear stays on here: three only paints a colour
    //    scene.background as part of an automatic clear.
    this.timer?.begin('background');
    renderer.autoClear = true;
    renderer.setRenderTarget(target);
    camera.layers.set(LAYERS.BACKGROUND);
    renderer.render(scene, camera);
    renderer.autoClear = false;
    this.timer?.end();

    // 2. Volumes at reduced resolution: start from L = 0, T = 1.
    this.timer?.begin('volume');
    scene.background = null;
    renderer.setRenderTarget(this.volumeTarget);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, false, false);
    camera.layers.set(LAYERS.VOLUME);
    renderer.render(scene, camera);
    renderer.setRenderTarget(target);
    this.composite.render(renderer);
    this.timer?.end();

    // 3. Stars and nebulae on top, full resolution.
    this.timer?.begin('stars');
    camera.layers.set(LAYERS.STARS);
    renderer.render(scene, camera);
    this.timer?.end();

    scene.background = background;
    camera.layers.mask = layersMask;
    renderer.setClearColor(this.clearColor, clearAlpha);
    renderer.autoClear = autoClear;
  }

  dispose() {
    this.volumeTarget.dispose();
    this.composite.material.dispose();
    this.composite.dispose();
  }
}
