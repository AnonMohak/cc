import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GalaxyScenePass } from './GalaxyScenePass.js';

// Tight radius: wide bloom mips paint a faint halo far around bright cores.
const BLOOM_RADIUS = 0.3;
// The raymarched volume already carries the soft glow; bloom only lifts
// genuinely bright cores and stars. A low threshold would flood dust lanes.
const BLOOM_THRESHOLD = 0.45;

const PASS_LABELS = new Map([
  [UnrealBloomPass, 'bloom'],
  [OutputPass, 'output'],
]);

/**
 * GalaxyScenePass (low-res volumes) → UnrealBloomPass → OutputPass (tone mapping + sRGB).
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 */
export function createComposer(renderer, scene, camera, { bloomStrength = 0.8, volumeScale = 0.5 } = {}) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(size.x, size.y);

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), bloomStrength, BLOOM_RADIUS, BLOOM_THRESHOLD);
  const scenePass = new GalaxyScenePass(scene, camera, { volumeScale });
  composer.addPass(scenePass);
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
      // The scene pass times its own steps (background / volume / stars).
      scenePass.timer = timer;
      composer.passes
        .filter((pass) => pass !== scenePass)
        .forEach((pass) => timer.wrapPass(pass, PASS_LABELS.get(pass.constructor) ?? pass.constructor.name));
    },
    /** Resolution fraction for the raymarched volumes. */
    setVolumeScale(scale) {
      scenePass.setVolumeScale(scale);
    },
    dispose() {
      scenePass.dispose();
      bloom.dispose();
      composer.dispose();
    },
  };
}
