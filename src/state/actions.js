import { PRESETS } from '../galaxy/presets.js';
import { randomSeed } from '../galaxy/random.js';
import { findFreePosition } from './placement.js';

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
      look.position = findFreePosition(state.galaxies, target, look.radius);
      return {
        type: 'galaxy/add',
        galaxy: {
          id: makeId(),
          preset: PRESETS[presetName] ? presetName : 'spiral',
          seed: makeSeed(),
          shape: { ...preset.shape },
          look,
          motion: { ...preset.motion },
        },
      };
    },
    removeGalaxy: (id) => ({ type: 'galaxy/remove', id }),
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
          shape: { ...preset.shape },
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
