import { PRESETS, BLACK_HOLE_TEMPLATE } from '../galaxy/presets.js';
import { CATALOGUE, catalogueParams } from '../galaxy/catalogue.js';
import { randomSeed } from '../galaxy/random.js';
import { findFreePosition } from './placement.js';
import { generateUniverse } from './universe.js';
import { withoutIntro } from './store.js';

function defaultId() {
  // randomUUID needs a secure context; plain-HTTP LAN access falls back.
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Action creators. Id and seed sources are injectable so tests are
 * deterministic.
 */
export function createActions({ makeId = defaultId, makeSeed = randomSeed } = {}) {
  return {
    /**
     * @param {object} state current store state (used for placement)
     * @param {keyof PRESETS} presetName
     * @param {number[]} [target] preferred position, e.g. the camera target
     */
    addGalaxy(state, presetName = 'spiral', target = [0, 0, 0]) {
      const preset = PRESETS[presetName] ?? PRESETS.spiral;
      const look = { ...preset.look };
      look.position = findFreePosition(withoutIntro(state.galaxies), target, look.radius);
      return {
        type: 'galaxy/add',
        galaxy: {
          id: makeId(),
          preset: PRESETS[presetName] ? presetName : 'spiral',
          seed: makeSeed(),
          shape: { ...preset.shape },
          structure: { ...preset.structure },
          look,
          motion: { ...preset.motion },
        },
      };
    },
    /**
     * Add a standalone black hole (in a sparse star cloud) near `target`.
     * @param {object} state current store state (used for placement)
     * @param {number[]} [target]
     * @param {{ intro?: boolean }} [options] intro: the animation black hole of
     *   the start scene (the next add replaces it)
     */
    addBlackHole(state, target = [0, 0, 0], { intro = false } = {}) {
      const t = BLACK_HOLE_TEMPLATE;
      const look = { ...t.look, position: findFreePosition(withoutIntro(state.galaxies), target, t.look.radius) };
      return {
        type: 'galaxy/add',
        galaxy: {
          id: makeId(),
          kind: 'blackhole',
          preset: t.preset,
          seed: makeSeed(),
          shape: { ...t.shape },
          structure: { ...t.structure },
          look,
          motion: { ...t.motion },
          hole: { ...t.hole },
          ...(intro ? { intro: true } : {}),
        },
      };
    },
    /**
     * Add a real galaxy from the catalogue (named, tilted to its true
     * inclination, sized by its real diameter).
     */
    addCatalogueGalaxy(state, catalogId, target = [0, 0, 0]) {
      const params = catalogueParams(catalogId);
      if (!params) return { type: 'noop' };
      const look = { ...params.look, position: findFreePosition(withoutIntro(state.galaxies), target, params.look.radius) };
      return {
        type: 'galaxy/add',
        galaxy: {
          id: makeId(),
          name: CATALOGUE[catalogId].name,
          preset: params.preset,
          catalog: catalogId,
          seed: makeSeed(),
          shape: params.shape,
          structure: params.structure,
          look,
          motion: params.motion,
        },
      };
    },
    /**
     * Replace the scene with a generated cluster or filament (one undo step).
     * @param {'cluster' | 'filament'} layout
     * @param {number} count
     */
    generateUniverse(layout, count) {
      const galaxies = generateUniverse({ layout, count, seed: makeSeed() }).map((g) => ({ ...g, id: makeId() }));
      return { type: 'galaxies/replace', galaxies };
    },
    removeGalaxy: (id) => ({ type: 'galaxy/remove', id }),
    /**
     * The end of a consumption: remove the victim, patch the winner (one step).
     * @param {string} winnerId
     * @param {string} victimId
     * @param {object} patch galaxy/consumption.js consumeResult
     */
    consumeGalaxy: (winnerId, victimId, patch) => ({ type: 'galaxy/consume', winnerId, victimId, patch }),
    updateGalaxy: (id, patch) => ({ type: 'galaxy/update', id, patch }),
    reseedGalaxy: (id) => ({ type: 'galaxy/update', id, patch: { seed: makeSeed() } }),
    /** Reset shape, look colours and motion to the preset, keeping position. */
    applyPreset(galaxy, presetName) {
      const preset = PRESETS[presetName];
      if (!preset) return { type: 'noop' };
      return {
        type: 'galaxy/update',
        id: galaxy.id,
        patch: {
          preset: presetName,
          // A generic preset replaces the real-galaxy parameters.
          catalog: null,
          shape: { ...preset.shape },
          structure: { ...preset.structure },
          look: { ...preset.look, position: galaxy.look.position },
          motion: { ...preset.motion },
        },
      };
    },
    selectGalaxy: (id) => ({ type: 'galaxy/select', id }),
    updateSettings: (patch) => ({ type: 'settings/update', patch }),
    resetScene: () => ({ type: 'scene/reset' }),
    loadState: (state) => ({ type: 'scene/load', state }),
  };
}
