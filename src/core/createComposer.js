import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GalaxyScenePass } from './GalaxyScenePass.js';
import { CinematicPass } from './CinematicPass.js';
import { LensFlarePass } from './LensFlarePass.js';
import { BlackHolePass } from './BlackHolePass.js';
import { ExposureMeterPass } from './ExposureMeterPass.js';

// Bloom is blurry by nature: half resolution looks the same and costs 1/4.
const BLOOM_SCALE = 0.5;

// Tight radius: wide bloom mips paint a faint halo far around bright cores.
const BLOOM_RADIUS = 0.3;
// The raymarched volume already carries the soft glow; bloom only lifts
// genuinely bright cores and stars. A low threshold would flood dust lanes.
const BLOOM_THRESHOLD = 0.45;
// Only sources far above the bloom threshold cast ghosts (cores, supernovae),
// measured on the blurred bloom mip the flare reads (a bright core peaks ~0.5
// there, ordinary bright stars ~0.2).
const FLARE_THRESHOLD = 0.2;
// Flare light at full setting: ghosts stay a faint hint, never a blob.
const FLARE_GAIN = 0.5;

const PASS_LABELS = new Map([
  [UnrealBloomPass, 'bloom'],
  [BlackHolePass, 'blackhole'],
  [LensFlarePass, 'flare'],
  [ExposureMeterPass, 'meter'],
  [OutputPass, 'output'],
  [CinematicPass, 'cinematic'],
]);

/**
 * GalaxyScenePass (low-res volumes) → UnrealBloomPass → BlackHolePass (lensing +
 * accretion discs; only while a black hole is resolved) → LensFlarePass (reads the bloom
 * mips; only when bloom runs) → ExposureMeterPass (auto exposure reading; the image
 * passes through) → OutputPass (tone mapping + sRGB)
 * → CinematicPass (vignette, grain, aberration; skipped when off).
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
  const setBloomSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => setBloomSize(Math.max(1, Math.round(w * BLOOM_SCALE)), Math.max(1, Math.round(h * BLOOM_SCALE)));
  let bloomMode = 'half';
  const scenePass = new GalaxyScenePass(scene, camera, { volumeScale });
  composer.addPass(scenePass);
  composer.addPass(bloom);
  // After bloom: the bloom of a bright core would otherwise flood the shadow.
  const blackHole = new BlackHolePass(camera);
  composer.addPass(blackHole);
  const flare = new LensFlarePass(bloom);
  let flareAmount = 0;
  composer.addPass(flare);
  // Measures the finished HDR frame, before the exposure it controls.
  const meter = new ExposureMeterPass();
  composer.addPass(meter);
  let exposureBias = 1;
  let autoFactor = 1;
  composer.addPass(new OutputPass());
  // Last, in display space; EffectComposer sends the last enabled pass to the screen.
  const cinematic = new CinematicPass();
  cinematic.enabled = false;
  composer.addPass(cinematic);

  return {
    composer,
    render() {
      // Skip the bloom passes entirely when bloom is off (by strength or tier).
      bloom.enabled = bloom.strength > 0 && bloomMode !== 'off';
      blackHole.update();
      flare.enabled = bloom.enabled && flareAmount > 0;
      composer.render();
    },
    resize(width, height) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
    },
    setBloomStrength(value) {
      bloom.strength = value;
    },
    /** 'half' or 'off', from the quality tier. */
    setBloomMode(mode) {
      bloomMode = mode;
    },
    /** Effect amounts (0–1) and whether the pass runs at all (cinematicEnabled). */
    setCinematic(amounts, enabled) {
      cinematic.setAmounts(amounts);
      cinematic.enabled = enabled;
    },
    /** Lens flare amount 0–1 (runs only while bloom runs: it reads the bloom mips). */
    setFlare(amount) {
      flareAmount = amount;
      flare.setAmount(amount * FLARE_GAIN, FLARE_THRESHOLD);
    },
    /**
     * Black holes: `source(slots)` fills candidate slots and returns the count;
     * `allowed` is false when the setting or the quality tier turns them off.
     */
    setBlackHoles(source, allowed) {
      blackHole.source = source;
      blackHole.allowed = allowed;
    },
    /** Accretion-disc brightness for the wavelength band. */
    setBlackHoleGain(gain) {
      blackHole.setDiscGain(gain);
    },
    /** The Exposure slider; auto exposure multiplies it (setAutoExposureFactor). */
    setExposure(value) {
      exposureBias = value;
      meter.setBias(value);
      renderer.toneMappingExposure = exposureBias * autoFactor;
    },
    /**
     * Auto exposure on/off; `onReading(bytes)` receives each meter result
     * (autoExposure.js meterFrame), a few frames late.
     */
    setAutoExposure(enabled, onReading) {
      meter.enabled = enabled;
      meter.onReading = onReading;
    },
    /** True when the async readback is unavailable: auto exposure cannot run. */
    autoExposureFailed() {
      return meter.failed;
    },
    setAutoExposureFactor(factor) {
      autoFactor = factor;
      renderer.toneMappingExposure = exposureBias * autoFactor;
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
      flare.dispose();
      blackHole.dispose();
      meter.dispose();
      cinematic.dispose();
      composer.dispose();
    },
  };
}
