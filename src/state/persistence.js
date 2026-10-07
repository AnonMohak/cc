import {
  STATE_VERSION,
  createInitialState,
  clampSettings,
  sanitizeGalaxy,
} from './store.js';
import { MAX_GALAXIES, MAX_TOTAL_PARTICLES, DEFAULT_LOOK } from '../galaxy/params.js';
import { PRESETS } from '../galaxy/presets.js';

// Bump the suffix together with STATE_VERSION when the stored shape changes.
export const STORAGE_KEY = `galaxy-sandbox:v${STATE_VERSION}`;
export const LEGACY_KEYS = ['galaxy-sandbox:v2', 'galaxy-sandbox:v1'];

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
  if (!data || typeof data !== 'object') return null;
  if (data.version === 1) data = migrateV1(data);
  // v2 → v3 only added optional black-hole fields: v2 data is valid v3.
  if (data.version === 2) data = { ...data, version: 3 };
  if (data.version !== STATE_VERSION) return null;

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

/**
 * v1 → v2. The renderer was rebuilt (density waves + volume), so old shape
 * numbers do not map onto the new model. Keep what the user chose — name,
 * preset, seed, position, size, tilt, speed, settings — and take the shape,
 * structure and colours from the preset.
 */
export function migrateV1(data) {
  const galaxies = (Array.isArray(data.galaxies) ? data.galaxies : []).map((g) => {
    if (!g || typeof g !== 'object') return g;
    const preset = PRESETS[g.preset] ?? PRESETS.spiral;
    const look = g.look && typeof g.look === 'object' ? g.look : {};
    return {
      id: g.id,
      name: g.name,
      preset: g.preset,
      seed: g.seed,
      shape: { ...preset.shape, count: g.shape?.count ?? preset.shape.count },
      structure: { ...preset.structure },
      look: {
        ...preset.look,
        radius: look.radius ?? DEFAULT_LOOK.radius,
        starSize: look.starSize ?? DEFAULT_LOOK.starSize,
        brightness: look.brightness ?? DEFAULT_LOOK.brightness,
        tiltX: look.tiltX ?? 0,
        tiltZ: look.tiltZ ?? 0,
        position: look.position,
      },
      motion: { ...preset.motion, speed: g.motion?.speed ?? preset.motion.speed },
    };
  });
  return { ...data, version: 2, galaxies };
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
    const current = deserialize(storage.getItem(STORAGE_KEY));
    if (current) return current;
    for (const key of LEGACY_KEYS) {
      const migrated = deserialize(storage.getItem(key));
      if (migrated) {
        // Move to the current key so the legacy copy is migrated only once.
        save(migrated, storage);
        storage.removeItem(key);
        return migrated;
      }
    }
    return null;
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
