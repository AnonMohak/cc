import { Pass } from 'three/addons/postprocessing/Pass.js';
import { LAYERS } from './layers.js';

/**
 * Black-hole jets, drawn after BlackHolePass straight onto the frame (no
 * swap, no clear, additive). Drawn earlier they were lensed with the scene,
 * and the pass's cleared cavity dimmed their base. The jet shader hides the
 * part behind the hole's shadow itself (the buffer's depth is stale here).
 * Enabled only while a jet is visible (createComposer setJetSource).
 */
export class JetPass extends Pass {
  /**
   * @param {import('three').Scene} scene
   * @param {import('three').Camera} camera
   */
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = false;
    this.enabled = false;
  }

  render(renderer, writeBuffer, readBuffer) {
    const { scene, camera } = this;
    const mask = camera.layers.mask;
    const autoClear = renderer.autoClear;
    const background = scene.background;
    renderer.autoClear = false;
    scene.background = null;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    camera.layers.set(LAYERS.JETS);
    renderer.render(scene, camera);
    camera.layers.mask = mask;
    scene.background = background;
    renderer.autoClear = autoClear;
  }
}
