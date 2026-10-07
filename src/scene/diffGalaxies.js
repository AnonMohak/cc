import { SHAPE_KEYS } from '../galaxy/params.js';

/**
 * Compare two galaxy lists by id and sort changes by cost:
 * shapeChanged needs a geometry rebuild, lookChanged only uniform/transform
 * updates (including a standalone black hole's `hole` group).
 *
 * @returns {{ added: object[], removed: string[], shapeChanged: object[], lookChanged: object[] }}
 */
export function diffGalaxies(prev, next) {
  const prevById = new Map(prev.map((g) => [g.id, g]));
  const nextIds = new Set(next.map((g) => g.id));
  const result = { added: [], removed: [], shapeChanged: [], lookChanged: [] };

  for (const g of prev) {
    if (!nextIds.has(g.id)) result.removed.push(g.id);
  }

  for (const g of next) {
    const before = prevById.get(g.id);
    if (!before) {
      result.added.push(g);
      continue;
    }
    if (before === g) continue;
    if (g.seed !== before.seed || SHAPE_KEYS.some((k) => g.shape[k] !== before.shape[k])) {
      result.shapeChanged.push(g);
    }
    if (g.look !== before.look || g.motion !== before.motion || g.structure !== before.structure || g.hole !== before.hole) {
      result.lookChanged.push(g);
    }
  }
  return result;
}
