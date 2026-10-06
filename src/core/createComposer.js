import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const BLOOM_RADIUS = 0.45;
// Low threshold: galaxy cores are made of many dim additive stars, not a
// few bright pixels, so a high threshold would bloom nothing.
const BLOOM_THRESHOLD = 0.08;

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
    dispose() {
      bloom.dispose();
      composer.dispose();
    },
  };
}
