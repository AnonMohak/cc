import { createRandom } from '../galaxy/random.js';
import { PRESETS } from '../galaxy/presets.js';
import { MAX_GALAXIES, MAX_TOTAL_PARTICLES, LIMITS } from '../galaxy/params.js';

/**
 * Procedural groups of galaxies. Pure and seeded: same options → same scene.
 *
 * Mix follows the morphology–density relation (Dressler 1980): ellipticals
 * dominate dense cluster cores, spirals the outskirts and filaments.
 */

export const LAYOUTS = {
  cluster: { label: 'Cluster' },
  filament: { label: 'Filament' },
};

const GAP = 3;
const PLACEMENT_TRIES = 60;
const STAR_BUDGET = Math.floor(MAX_TOTAL_PARTICLES * 0.9);

/**
 * @param {{ layout?: keyof LAYOUTS, count?: number, seed: number }} options
 * @returns {Array<object>} galaxy entries (without ids), positions included
 */
export function generateUniverse({ layout = 'cluster', count = 8, seed }) {
  const rng = createRandom(seed);
  const n = Math.max(2, Math.min(MAX_GALAXIES, Math.round(count)));
  const perGalaxyStars = Math.max(LIMITS.shape.count.min, Math.min(80_000, Math.floor(STAR_BUDGET / n / 1000) * 1000));

  const kinds = layout === 'cluster' ? clusterKinds(rng, n) : filamentKinds(rng, n);
  const placed = [];
  const spread = layout === 'cluster' ? 18 + 7 * n : 0;

  kinds.forEach((kind, i) => {
    const radius = round(kind === 'irregular' ? rng.range(2.5, 4) : rng.range(4, 8.5));
    // Cluster: ellipticals were sorted first, so they get the inner slots.
    const centrality = n > 1 ? i / (n - 1) : 0;
    let position = null;
    for (let t = 0; t < PLACEMENT_TRIES && !position; t++) {
      const p = layout === 'cluster'
        ? clusterPoint(rng, spread, centrality, t)
        : filamentPoint(rng, n, i, t);
      if (placed.every((q) => Math.hypot(q.x - p[0], q.y - p[1], q.z - p[2]) >= q.r + radius + GAP)) position = p;
    }
    if (!position) return; // no room: skip rather than overlap
    placed.push({ x: position[0], y: position[1], z: position[2], r: radius });

    const preset = PRESETS[kind];
    placed.at(-1).entry = {
      preset: kind,
      name: `${preset.label} ${placed.length}`,
      seed: Math.floor(rng.next() * 2 ** 32),
      shape: { ...preset.shape, count: Math.min(preset.shape.count, perGalaxyStars) },
      structure: varyStructure(rng, kind, preset.structure),
      look: {
        ...preset.look,
        radius,
        position: position.map(round),
        tiltX: round(rng.range(-70, 70)),
        tiltZ: round(rng.range(-40, 40)),
      },
      motion: { ...preset.motion, speed: round(preset.motion.speed * rng.range(0.6, 1.4) * rng.sign()) },
    };
  });
  return placed.map((p) => p.entry);
}

/** Bounding sphere of the generated positions, for framing the camera. */
export function universeBounds(entries) {
  if (entries.length === 0) return { center: [0, 0, 0], radius: 10 };
  const c = [0, 1, 2].map((k) => entries.reduce((s, e) => s + e.look.position[k], 0) / entries.length);
  const radius = Math.max(...entries.map((e) => Math.hypot(...e.look.position.map((v, k) => v - c[k])) + e.look.radius));
  return { center: c, radius };
}

function clusterKinds(rng, n) {
  const ellipticals = Math.max(1, Math.round(n * 0.4));
  const kinds = Array.from({ length: n }, (_, i) => {
    if (i < ellipticals) return 'elliptical';
    const u = rng.next();
    return u < 0.45 ? 'spiral' : u < 0.8 ? 'barred' : 'irregular';
  });
  return kinds; // ellipticals first → central slots
}

function filamentKinds(rng, n) {
  return Array.from({ length: n }, () => {
    const u = rng.next();
    return u < 0.5 ? 'spiral' : u < 0.75 ? 'barred' : u < 0.9 ? 'irregular' : 'elliptical';
  });
}

/** Flattened Gaussian cloud; central galaxies are drawn from a tighter core. */
function clusterPoint(rng, spread, centrality, attempt) {
  // Widen gradually if the tight spots are taken.
  const s = spread * (0.35 + 0.65 * centrality) * (1 + attempt * 0.03);
  return [rng.gaussian(0, s), rng.gaussian(0, s * 0.35), rng.gaussian(0, s)];
}

/** Gentle S-curve through space, galaxies spaced along it with a little scatter. */
function filamentPoint(rng, n, i, attempt) {
  const length = 30 * n;
  const u = n > 1 ? i / (n - 1) : 0.5;
  const along = (u - 0.5) * length + rng.gaussian(0, 3 + attempt * 0.5);
  const bend = Math.sin((along / length) * Math.PI * 1.5) * length * 0.18;
  const scatter = 4 + attempt * 0.4;
  return [along, rng.gaussian(0, scatter * 0.6), bend + rng.gaussian(0, scatter)];
}

function varyStructure(rng, kind, base) {
  if (kind === 'elliptical') return { ...base };
  const arms = kind === 'irregular' ? base.arms : rng.next() < 0.7 ? 2 : rng.next() < 0.6 ? 3 : 4;
  return {
    ...base,
    arms,
    armWinding: round(base.armWinding * rng.range(0.75, 1.3)),
    flocculence: round(Math.min(1, base.flocculence * rng.range(0.7, 1.5))),
    dustStrength: round(base.dustStrength * rng.range(0.6, 1.4)),
  };
}

function round(v) {
  return Math.round(v * 100) / 100;
}
