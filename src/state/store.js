import {
  clampShape,
  clampStructure,
  clampLook,
  clampMotion,
  clampHole,
  MAX_GALAXIES,
  MAX_TOTAL_PARTICLES,
  LIMITS,
} from '../galaxy/params.js';
import { PRESETS, BLACK_HOLE_TEMPLATE } from '../galaxy/presets.js';
import { CATALOGUE } from '../galaxy/catalogue.js';
import { QUALITY_OPTIONS, SPIKE_OPTIONS } from '../core/quality.js';
import { BAND_OPTIONS } from '../galaxy/bands.js';
import { BLACK_HOLE_OPTIONS } from '../galaxy/blackHole.js';

// v2: density-wave renderer (structure group, new shape keys, quality/exposure).
// v3: standalone black holes (entries may have kind 'blackhole' + a hole group).
export const STATE_VERSION = 3;

export const SETTINGS_LIMITS = {
  timeScale: { min: 0, max: 5, step: 0.05 },
  bloomStrength: { min: 0, max: 3, step: 0.05 },
  dustOpacity: { min: 0, max: 1, step: 0.01 },
  exposure: { min: 0.3, max: 2.5, step: 0.05 },
  // Cinematic pass (core/CinematicPass.js), 0–1 each.
  vignette: { min: 0, max: 1, step: 0.01 },
  grain: { min: 0, max: 1, step: 0.01 },
  aberration: { min: 0, max: 1, step: 0.01 },
  flare: { min: 0, max: 1, step: 0.01 }, // lens-flare ghosts (core/LensFlarePass.js)
};


export const DEFAULT_SETTINGS = {
  paused: false,
  timeScale: 1,
  autoRotate: false,
  bloomStrength: 0.45,
  dust: true,
  dustOpacity: 0.6,
  // 'auto' lets the governor pick a tier; or a fixed tier (core/quality.js).
  quality: 'auto',
  exposure: 1,
  autoExposure: true, // darken bright scenes (core/autoExposure.js); exposure is then the bias
  sky: true, // Milky Way background (scene/sky.js)
  supernovae: true, // flashes in every galaxy (galaxy/supernovae.js)
  spikes: 'jwst', // diffraction spikes: 'jwst' | 'hubble' | 'off'
  vignette: 0.3,
  grain: 0.1,
  aberration: 0.15,
  flare: 0.5,
  band: 'visible', // wavelength view mode (galaxy/bands.js)
  blackHoles: 'on', // 'on' | 'jets' | 'off' (galaxy/blackHole.js)
  // HUD
  labels: false,
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
  for (const key of ['paused', 'autoRotate', 'dust', 'sky', 'supernovae', 'labels', 'minimap', 'scaleBar', 'autoExposure']) {
    if (typeof src[key] === 'boolean') out[key] = src[key];
  }
  if (QUALITY_OPTIONS.includes(src.quality)) out.quality = src.quality;
  if (SPIKE_OPTIONS.includes(src.spikes)) out.spikes = src.spikes;
  if (BAND_OPTIONS.includes(src.band)) out.band = src.band;
  if (BLACK_HOLE_OPTIONS.includes(src.blackHoles)) out.blackHoles = src.blackHoles;
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
  const hole = entry.kind === 'blackhole';
  const out = {
    id: entry.id,
    name: typeof entry.name === 'string' && entry.name ? entry.name.slice(0, 40) : hole ? BLACK_HOLE_TEMPLATE.label : PRESETS[preset].label,
    preset,
    // Real-galaxy origin (catalogue id) for the info card; null for presets.
    catalog: Object.hasOwn(CATALOGUE, entry.catalog) ? entry.catalog : null,
    seed,
    shape: clampShape(entry.shape),
    structure: clampStructure(entry.structure ?? PRESETS[preset].structure),
    look: clampLook(entry.look),
    motion: clampMotion(entry.motion),
  };
  // Only standalone black holes carry these, so galaxy entries keep their form.
  if (hole) {
    out.kind = 'blackhole';
    out.hole = clampHole(entry.hole);
  }
  return out;
}

function nextName(galaxies, label) {
  let max = 0;
  for (const g of galaxies) {
    const m = /(\d+)$/.exec(g.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${label} ${max + 1}`;
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
      if (!action.galaxy.name) entry.name = nextName(state.galaxies, entry.kind === 'blackhole' ? BLACK_HOLE_TEMPLATE.label : PRESETS[entry.preset].label);
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
      const { shape, structure, look, motion, hole, name, seed, preset, catalog } = action.patch ?? {};
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
      if (hole && prev.kind === 'blackhole') next.hole = clampHole({ ...prev.hole, ...hole });
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

    // Replace every galaxy at once (universe generator). Entries are
    // sanitized and kept inside the galaxy and star budgets.
    case 'galaxies/replace': {
      const galaxies = [];
      let total = 0;
      for (const raw of Array.isArray(action.galaxies) ? action.galaxies : []) {
        const g = sanitizeGalaxy(raw);
        if (!g || galaxies.some((x) => x.id === g.id)) continue;
        if (galaxies.length >= MAX_GALAXIES || total + g.shape.count > MAX_TOTAL_PARTICLES) break;
        total += g.shape.count;
        galaxies.push(g);
      }
      return { ...state, galaxies, selectedId: null };
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
