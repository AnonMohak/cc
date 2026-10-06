import { Galaxy } from '../galaxy/Galaxy.js';
import { diffGalaxies } from './diffGalaxies.js';

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
    });
  }

  sync(next, prev) {
    const diff = diffGalaxies(prev, next);
    for (const id of diff.removed) {
      this.galaxies.get(id)?.dispose();
      this.galaxies.delete(id);
    }
    for (const entry of diff.added) {
      const galaxy = new this.GalaxyClass({ ...entry, pixelRatio: this.pixelRatio });
      galaxy.id = entry.id;
      this.galaxies.set(entry.id, galaxy);
      this.scene.add(galaxy.group);
    }
    for (const entry of diff.shapeChanged) {
      this.galaxies.get(entry.id)?.setShape(entry.shape, entry.seed);
    }
    for (const entry of diff.lookChanged) {
      const galaxy = this.galaxies.get(entry.id);
      galaxy?.setLook(entry.look);
      galaxy?.setMotion(entry.motion);
    }
  }

  setSelected(id) {
    this.galaxies.get(this.selectedId)?.setHighlighted(false);
    this.selectedId = id;
    this.galaxies.get(id)?.setHighlighted(true);
  }

  pickTargets() {
    return [...this.galaxies.values()].map((g) => g.pickTarget());
  }

  get(id) {
    return this.galaxies.get(id);
  }

  tick(dt) {
    for (const galaxy of this.galaxies.values()) galaxy.tick(dt);
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
