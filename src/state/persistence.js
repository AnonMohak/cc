import {
  STATE_VERSION,
  createInitialState,
  clampSettings,
  sanitizeGalaxy,
} from './store.js';
import { MAX_GALAXIES, MAX_TOTAL_PARTICLES } from '../galaxy/params.js';

// Bump the suffix together with STATE_VERSION when the stored shape changes.
export const STORAGE_KEY = `galaxy-sandbox:v${STATE_VERSION}`;

/** Only params are stored; vertices are regenerated from the seed. */
export function serialize(state) {
  const { galaxies, selectedId, settings } = state;
  return JSON.stringify({ version: STATE_VERSION, galaxies, selectedId, settings });
}

/**
 * Parse and repair stored state. Returns null when there is nothing usable,
 * so the caller can fall back to a fresh scene. Never throws.
 *
 * @param {string | null} json
 */
export function deserialize(json) {
  if (typeof json !== 'string' || !json) return null;
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || data.version !== STATE_VERSION) return null;

  const galaxies = [];
  const ids = new Set();
  let total = 0;
  for (const raw of Array.isArray(data.galaxies) ? data.galaxies : []) {
    const g = sanitizeGalaxy(raw);
    if (!g || ids.has(g.id)) continue;
    if (galaxies.length >= MAX_GALAXIES || total + g.shape.count > MAX_TOTAL_PARTICLES) break;
    ids.add(g.id);
    total += g.shape.count;
    galaxies.push(g);
  }

  return {
    ...createInitialState(),
    galaxies,
    selectedId: ids.has(data.selectedId) ? data.selectedId : null,
    // A reload should never come back frozen.
    settings: { ...clampSettings(data.settings), paused: false },
  };
}

/** @param {Storage} storage */
export function save(state, storage) {
  try {
    storage.setItem(STORAGE_KEY, serialize(state));
    return true;
  } catch {
    // Quota exceeded or storage blocked (private mode): run without saving.
    return false;
  }
}

/** @param {Storage} storage */
export function load(storage) {
  try {
    return deserialize(storage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function clear(storage) {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore: nothing to clear if storage is blocked.
  }
}
