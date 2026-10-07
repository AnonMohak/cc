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
      const galaxy = new this.GalaxyClass({ ...entry, pixelRatio: this.pixelRatio, dustScale: this.dustScale, supernovae: this.supernovae });
      galaxy.id = entry.id;
      galaxy.onBaked = () => this.onChange?.();
      galaxy.setQuality(this.quality);
      galaxy.setSpikeStyle(this.spikeStyle);
      galaxy.setBand(this.band);
      galaxy.setEmphasis(emphasisTarget(entry.id, this.selectedId), true);
      this.galaxies.set(entry.id, galaxy);
      this.scene.add(galaxy.group);
    }
    for (const entry of diff.shapeChanged) {
      this.galaxies.get(entry.id)?.setShape(entry.shape, entry.seed);
    }
    for (const entry of diff.lookChanged) {
      const galaxy = this.galaxies.get(entry.id);
      galaxy?.setStructure(entry.structure);
      galaxy?.setLook(entry.look);
      galaxy?.setMotion(entry.motion);
    }
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
    for (const galaxy of this.galaxies.values()) galaxy.setSpikeStyle(style);
  }

  setBand(name) {
    this.band = name;
    for (const galaxy of this.galaxies.values()) galaxy.setBand(name);
  }

  setDustScale(scale) {
    this.dustScale = scale;
    for (const galaxy of this.galaxies.values()) galaxy.setDustScale(scale);
  }

  setQuality(quality) {
    this.quality = quality;
    for (const galaxy of this.galaxies.values()) galaxy.setQuality(quality);
  }

  /**
   * Per-frame: camera position in each galaxy's local space (for dust) and
   * the volume step budget from each galaxy's on-screen size.
   */
  updateCamera(camera, width, height) {
    for (const galaxy of this.galaxies.values()) {
      galaxy.updateCamera(camera.position);
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
    for (const galaxy of this.galaxies.values()) galaxy.tick(dt, realDt);
  }

  setPixelRatio(value) {
    this.pixelRatio = value;
    for (const galaxy of this.galaxies.values()) galaxy.setPixelRatio(value);
  }

  dispose() {
    this.unsubscribe();
    for (const galaxy of this.galaxies.values()) galaxy.dispose();
    this.galaxies.clear();
  }
}
