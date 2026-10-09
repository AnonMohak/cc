import { Galaxy } from '../galaxy/Galaxy.js';
import { diffGalaxies } from './diffGalaxies.js';
import { emphasisTarget } from '../galaxy/emphasis.js';
import { dustScaleFromSettings } from '../state/store.js';
import { QUALITY } from '../core/quality.js';

/**
 * Keeps the Three.js scene in step with the store. The only owner of
 * Galaxy instances; everything else refers to galaxies by id.
 */
export class GalaxyManager {
  /**
   * @param {{ scene: import('three').Object3D, store: ReturnType<typeof import('../state/store.js').createStore>, pixelRatio?: number, GalaxyClass?: typeof Galaxy }} options
   */
  constructor({ scene, store, pixelRatio = 1, GalaxyClass = Galaxy }) {
    this.scene = scene;
    this.dustScale = dustScaleFromSettings(store.getState().settings);
    this.supernovae = store.getState().settings.supernovae ?? true;
    this.spikeStyle = 0; // set by the app (setting × tier)
    this.band = 'visible'; // settings.band (bands.js)
    // The app sets the active tier (Auto can change it at any time).
    this.quality = QUALITY.medium;
    this.pixelRatio = pixelRatio;
    this.GalaxyClass = GalaxyClass;
    /** @type {Map<string, Galaxy>} */
    this.galaxies = new Map();
    // Galaxies outside the store (a merger's remnant preview, scene/CollisionSim.js):
    // configured, ticked and lit like the others, but never picked or saved.
    /** @type {Set<Galaxy>} */
    this.detached = new Set();

    this.selectedId = null;
    this.sync(store.getState().galaxies, []);
    this.setSelected(store.getState().selectedId);
    this.unsubscribe = store.subscribe((next, prev) => {
      if (next.galaxies !== prev.galaxies) this.sync(next.galaxies, prev.galaxies);
      if (next.selectedId !== prev.selectedId) this.setSelected(next.selectedId);
      const s = next.settings;
      if (s.dust !== prev.settings.dust || s.dustOpacity !== prev.settings.dustOpacity) {
        this.setDustScale(dustScaleFromSettings(s));
      }
      if (s.supernovae !== prev.settings.supernovae) {
        this.supernovae = s.supernovae;
        for (const galaxy of this.galaxies.values()) galaxy.setSupernovae(s.supernovae);
      }
    });
  }

  sync(next, prev) {
    const diff = diffGalaxies(prev, next);
    for (const id of diff.removed) {
      this.galaxies.get(id)?.dispose();
      this.galaxies.delete(id);
    }
    for (const entry of diff.added) {
      const galaxy = this.build(entry, this.supernovae);
      galaxy.setEmphasis(emphasisTarget(entry.id, this.selectedId), true);
      this.galaxies.set(entry.id, galaxy);
    }
    for (const entry of diff.shapeChanged) {
      this.galaxies.get(entry.id)?.setShape(entry.shape, entry.seed);
    }
    for (const entry of diff.lookChanged) {
      const galaxy = this.galaxies.get(entry.id);
      galaxy?.setStructure(entry.structure);
      galaxy?.setLook(entry.look);
      galaxy?.setMotion(entry.motion);
      if (entry.hole) galaxy?.setHole(entry.hole);
    }
  }

  /** A configured Galaxy in the scene (quality, spikes, band like the rest). */
  build(entry, supernovae) {
    const galaxy = new this.GalaxyClass({ ...entry, pixelRatio: this.pixelRatio, dustScale: this.dustScale, supernovae });
    galaxy.id = entry.id;
    galaxy.onBaked = () => this.onChange?.();
    galaxy.setQuality(this.quality);
    galaxy.setSpikeStyle(this.spikeStyle);
    galaxy.setBand(this.band);
    this.scene.add(galaxy.group);
    return galaxy;
  }

  /** A galaxy outside the store (no supernovae); removeDetached disposes it. */
  createDetached(entry) {
    const galaxy = this.build(entry, false);
    this.detached.add(galaxy);
    return galaxy;
  }

  removeDetached(galaxy) {
    if (!this.detached.delete(galaxy)) return;
    galaxy.dispose();
  }

  /** Every galaxy in the scene: the store's and the detached ones. */
  *all() {
    yield* this.galaxies.values();
    yield* this.detached;
  }

  /** Selection is shown by brightness: see emphasisTarget(). */
  /** True while any galaxy is still easing its selection brightness. */
  isEasing() {
    for (const galaxy of this.galaxies.values()) if (galaxy.emphasis !== galaxy.emphasisTarget) return true;
    return false;
  }

  setSelected(id) {
    this.selectedId = id;
    for (const [gid, galaxy] of this.galaxies) galaxy.setEmphasis(emphasisTarget(gid, id));
  }

  setSpikeStyle(style) {
    this.spikeStyle = style;
    for (const galaxy of this.all()) galaxy.setSpikeStyle(style);
  }

  /**
   * Fill BlackHolePass candidate slots with the standalone black holes;
   * returns how many are in use.
   * @param {object[]} slots
   */
  blackHoleCandidates(slots) {
    let n = 0;
    for (const galaxy of this.galaxies.values()) {
      if (n >= slots.length) break;
      if (galaxy.blackHoleInfo(slots[n])) n++;
    }
    return n;
  }

  /** Whether JetPass has anything to draw this frame (jets, or stars after the lens). */
  hasVisibleJets() {
    for (const galaxy of this.galaxies.values()) if (galaxy.jets.visible || galaxy.starsAfterLens?.visible) return true;
    return false;
  }

  setBand(name) {
    this.band = name;
    for (const galaxy of this.all()) galaxy.setBand(name);
  }

  setDustScale(scale) {
    this.dustScale = scale;
    for (const galaxy of this.all()) galaxy.setDustScale(scale);
  }

  setQuality(quality) {
    this.quality = quality;
    for (const galaxy of this.all()) galaxy.setQuality(quality);
  }

  /**
   * Per-frame: camera position in each galaxy's local space (for dust) and
   * the volume step budget from each galaxy's on-screen size.
   */
  updateCamera(camera, width, height) {
    for (const galaxy of this.all()) {
      galaxy.updateCamera(camera.position);
      if (height) galaxy.uniforms.uViewHeight.value = height;
      if (width && height) galaxy.updateLod(camera, width, height);
    }
  }

  pickTargets() {
    return [...this.galaxies.values()].map((g) => g.pickTarget());
  }

  get(id) {
    return this.galaxies.get(id);
  }

  tick(dt, realDt = dt) {
    for (const galaxy of this.all()) galaxy.tick(dt, realDt);
  }

  setPixelRatio(value) {
    this.pixelRatio = value;
    for (const galaxy of this.all()) galaxy.setPixelRatio(value);
  }

  dispose() {
    this.unsubscribe();
    for (const galaxy of this.all()) galaxy.dispose();
    this.galaxies.clear();
    this.detached.clear();
  }
}
