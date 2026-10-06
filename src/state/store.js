import {
  clampShape,
  clampStructure,
  clampLook,
  clampMotion,
  MAX_GALAXIES,
  MAX_TOTAL_PARTICLES,
  LIMITS,
} from '../galaxy/params.js';
import { PRESETS } from '../galaxy/presets.js';
import { CATALOGUE } from '../galaxy/catalogue.js';

// v2: density-wave renderer (structure group, new shape keys, quality/exposure).
export const STATE_VERSION = 2;

export const SETTINGS_LIMITS = {
  timeScale: { min: 0, max: 5, step: 0.05 },
  bloomStrength: { min: 0, max: 3, step: 0.05 },
  dustOpacity: { min: 0, max: 1, step: 0.01 },
  exposure: { min: 0.3, max: 2.5, step: 0.05 },
};

/**
 * Volume raymarch budget per quality level. Steps dominate GPU cost (it is
 * paid for every covered pixel); octaves set noise detail per step.
 */
export const QUALITY = {
  low: { label: 'Low', steps: 24, octaves: 2 },
  medium: { label: 'Medium', steps: 44, octaves: 3 },
  high: { label: 'High', steps: 72, octaves: 4 },
};

export const DEFAULT_SETTINGS = {
  paused: false,
  timeScale: 1,
  autoRotate: false,
  bloomStrength: 0.45,
  dust: true,
  dustOpacity: 0.6,
  quality: 'medium',
  exposure: 1,
  // HUD
  labels: true,
  minimap: true,
  scaleBar: true,
};

/** Global dust multiplier: 1 at the default amount, 0 when dust is off. */
export function dustScaleFromSettings(settings) {
  return settings.dust ? settings.dustOpacity / DEFAULT_SETTINGS.dustOpacity : 0;
}

export function createInitialState() {
  return { version: STATE_VERSION, galaxies: [], selectedId: null, settings: { ...DEFAULT_SETTINGS } };
}

/** @param {{ galaxies: Array<{ shape: { count: number } }> }} state */
export function totalParticles(state, exceptId = null) {
  return state.galaxies.reduce((sum, g) => (g.id === exceptId ? sum : sum + g.shape.count), 0);
}

export function canAddGalaxy(state, count) {
  return state.galaxies.length < MAX_GALAXIES && totalParticles(state) + count <= MAX_TOTAL_PARTICLES;
}

export function clampSettings(settings) {
  const src = settings && typeof settings === 'object' ? settings : {};
  const out = { ...DEFAULT_SETTINGS };
  for (const key of ['paused', 'autoRotate', 'dust', 'labels', 'minimap', 'scaleBar']) {
    if (typeof src[key] === 'boolean') out[key] = src[key];
  }
  if (Object.hasOwn(QUALITY, src.quality)) out.quality = src.quality;
  for (const [key, limit] of Object.entries(SETTINGS_LIMITS)) {
    const n = Number(src[key]);
    if (src[key] !== null && src[key] !== '' && Number.isFinite(n)) {
      out[key] = Math.min(limit.max, Math.max(limit.min, n));
    }
  }
  return out;
}

/** Validate one galaxy entry; returns null if it cannot be repaired. */
export function sanitizeGalaxy(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id) return null;
  const preset = PRESETS[entry.preset] ? entry.preset : 'spiral';
  const seed = Number.isFinite(entry.seed) ? entry.seed >>> 0 : 1;
  return {
    id: entry.id,
    name: typeof entry.name === 'string' && entry.name ? entry.name.slice(0, 40) : PRESETS[preset].label,
    preset,
    // Real-galaxy origin (catalogue id) for the info card; null for presets.
    catalog: Object.hasOwn(CATALOGUE, entry.catalog) ? entry.catalog : null,
    seed,
    shape: clampShape(entry.shape),
    structure: clampStructure(entry.structure ?? PRESETS[preset].structure),
    look: clampLook(entry.look),
    motion: clampMotion(entry.motion),
  };
}

function nextName(galaxies, preset) {
  let max = 0;
  for (const g of galaxies) {
    const m = /(\d+)$/.exec(g.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${PRESETS[preset].label} ${max + 1}`;
}

/**
 * Pure reducer. Returns the same state object when nothing changes, so
 * subscribers are not notified for no-ops.
 */
export function reducer(state, action) {
  switch (action.type) {
    case 'galaxy/add': {
      const entry = sanitizeGalaxy(action.galaxy);
      if (!entry || state.galaxies.some((g) => g.id === entry.id)) return state;
      if (!canAddGalaxy(state, entry.shape.count)) return state;
      if (!action.galaxy.name) entry.name = nextName(state.galaxies, entry.preset);
      return { ...state, galaxies: [...state.galaxies, entry], selectedId: entry.id };
    }

    case 'galaxy/remove': {
      if (!state.galaxies.some((g) => g.id === action.id)) return state;
      return {
        ...state,
        galaxies: state.galaxies.filter((g) => g.id !== action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
      };
    }

    case 'galaxy/update': {
      const index = state.galaxies.findIndex((g) => g.id === action.id);
      if (index === -1) return state;
      const prev = state.galaxies[index];
      const { shape, structure, look, motion, name, seed, preset, catalog } = action.patch ?? {};
      const next = { ...prev };
      if (shape) {
        next.shape = clampShape({ ...prev.shape, ...shape });
        // Keep the scene inside the total particle budget.
        const room = MAX_TOTAL_PARTICLES - totalParticles(state, prev.id);
        const maxCount = Math.max(LIMITS.shape.count.min, room);
        if (next.shape.count > maxCount) next.shape.count = maxCount;
      }
      if (structure) next.structure = clampStructure({ ...prev.structure, ...structure });
      if (look) next.look = clampLook({ ...prev.look, ...look });
      if (motion) next.motion = clampMotion({ ...prev.motion, ...motion });
      if (typeof name === 'string' && name.trim()) next.name = name.trim().slice(0, 40);
      if (Number.isFinite(seed)) next.seed = seed >>> 0;
      if (PRESETS[preset]) next.preset = preset;
      if (catalog === null || Object.hasOwn(CATALOGUE, catalog)) next.catalog = catalog;
      const galaxies = state.galaxies.slice();
      galaxies[index] = next;
      return { ...state, galaxies };
    }

    case 'galaxy/select': {
      const id = state.galaxies.some((g) => g.id === action.id) ? action.id : null;
      return id === state.selectedId ? state : { ...state, selectedId: id };
    }

    // Undo/redo: galaxies come from an earlier state, so they are already valid.
    case 'galaxies/restore': {
      if (!Array.isArray(action.galaxies)) return state;
      const keep = action.galaxies.some((g) => g.id === state.selectedId);
      return { ...state, galaxies: action.galaxies, selectedId: keep ? state.selectedId : null };
    }

    case 'settings/update':
      return { ...state, settings: clampSettings({ ...state.settings, ...action.patch }) };

    case 'scene/reset':
      return { ...createInitialState(), settings: state.settings };

    case 'scene/load':
      return action.state;

    default:
      return state;
  }
}

/**
 * Tiny observable store. Subscribers get (next, prev) after each change.
 */
export function createStore(reduce = reducer, initial = createInitialState()) {
  let state = initial;
  const listeners = new Set();

  return {
    getState: () => state,
    dispatch(action) {
      const prev = state;
      state = reduce(state, action);
      if (state !== prev) for (const fn of listeners) fn(state, prev);
      return state;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
