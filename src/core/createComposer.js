import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Tight radius: wide bloom mips paint a faint halo far around bright cores.
const BLOOM_RADIUS = 0.3;
// The raymarched volume already carries the soft glow; bloom only lifts
// genuinely bright cores and stars. A low threshold would flood dust lanes.
const BLOOM_THRESHOLD = 0.45;

const PASS_LABELS = new Map([
  [RenderPass, 'scene'],
  [UnrealBloomPass, 'bloom'],
  [OutputPass, 'output'],
]);

/**
 * RenderPass → UnrealBloomPass → OutputPass (tone mapping + sRGB).
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 */
export function createComposer(renderer, scene, camera, { bloomStrength = 0.8 } = {}) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(size.x, size.y);

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), bloomStrength, BLOOM_RADIUS, BLOOM_THRESHOLD);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  return {
    composer,
    render() {
      // Skip the bloom passes entirely when bloom is off.
      bloom.enabled = bloom.strength > 0;
      composer.render();
    },
    resize(width, height) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
    },
    setBloomStrength(value) {
      bloom.strength = value;
    },
    setExposure(value) {
      renderer.toneMappingExposure = value;
    },
    /** Time each pass with a GPU timer (see gpuTimer.js). */
    attachTimer(timer) {
      composer.passes.forEach((pass) => timer.wrapPass(pass, PASS_LABELS.get(pass.constructor) ?? pass.constructor.name));
    },
    dispose() {
      bloom.dispose();
      composer.dispose();
    },
  };
}
