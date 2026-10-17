/**
 * The fit's maths (scripts/fit-intro.mjs): a bounded Nelder–Mead search and
 * how fit parameters map onto camera keys and looks. Pure.
 */

/**
 * Minimise f over the box [0, 1]^n (points are clamped into it) with the
 * Nelder–Mead simplex, from x0. f may be async. Stops after `iterations`
 * evaluations or when the simplex's values agree within `tol`.
 * @param {(x: number[]) => number | Promise<number>} f
 * @param {number[]} x0
 * @returns {Promise<{ x: number[], value: number, evaluations: number }>}
 */
export async function nelderMead(f, x0, { step = 0.15, iterations = 200, tol = 1e-4, onStep = null } = {}) {
  const n = x0.length;
  const clamp = (x) => x.map((v) => Math.min(1, Math.max(0, v)));
  let evaluations = 0;
  const evaluate = async (x) => {
    evaluations++;
    const value = await f(x);
    if (onStep) onStep(x, value, evaluations);
    return value;
  };
  const simplex = [clamp(x0)];
  for (let i = 0; i < n; i++) {
    const x = [...simplex[0]];
    x[i] = x[i] + step <= 1 ? x[i] + step : x[i] - step;
    simplex.push(clamp(x));
  }
  const values = [];
  for (const x of simplex) values.push(await evaluate(x));
  while (evaluations < iterations) {
    const order = values.map((v, i) => i).sort((a, b) => values[a] - values[b]);
    const s = order.map((i) => simplex[i]);
    const v = order.map((i) => values[i]);
    simplex.splice(0, simplex.length, ...s);
    values.splice(0, values.length, ...v);
    if (Math.abs(values[n] - values[0]) < tol) break;
    const centroid = Array.from({ length: n }, (_, d) => simplex.slice(0, n).reduce((a, x) => a + x[d], 0) / n);
    const along = (k) => clamp(centroid.map((c, d) => c + k * (simplex[n][d] - c)));
    const xr = along(-1);
    const fr = await evaluate(xr);
    if (fr < values[0]) {
      const xe = along(-2);
      const fe = await evaluate(xe);
      if (fe < fr) [simplex[n], values[n]] = [xe, fe];
      else [simplex[n], values[n]] = [xr, fr];
    } else if (fr < values[n - 1]) {
      [simplex[n], values[n]] = [xr, fr];
    } else {
      const xc = fr < values[n] ? along(-0.5) : along(0.5);
      const fc = await evaluate(xc);
      if (fc < Math.min(fr, values[n])) [simplex[n], values[n]] = [xc, fc];
      else {
        // Shrink toward the best point.
        for (let i = 1; i <= n; i++) {
          simplex[i] = clamp(simplex[i].map((x, d) => simplex[0][d] + 0.5 * (x - simplex[0][d])));
          values[i] = await evaluate(simplex[i]);
        }
      }
    }
  }
  const best = values.indexOf(Math.min(...values));
  return { x: simplex[best], value: values[best], evaluations };
}

/** A parameter's value from its share x (0–1) of its range. */
export const fromShare = (p, x) => p.min + x * (p.max - p.min);
/** A value's share (0–1) of a parameter's range. */
export const toShare = (p, v) => Math.min(1, Math.max(0, (v - p.min) / (p.max - p.min)));

/**
 * Apply fit parameters to a copy of the camera keys and a look:
 *  - `look.NAME` (or `look.NAME[c]`): the base look;
 *  - `key.N.FIELD`: field FIELD of key N (e.g. key.3.r);
 *  - `keys.A-B.FIELD`: field FIELD of keys A to B (one value for a shot);
 *  - `shot.NAME` (or `shot.NAME[c]`): a look value set on every key from
 *    tFrom to tTo (one shot's own look), or from the parameter's own
 *    tFrom / tTo (one part of a shot).
 * @param {{ path: string, min: number, max: number, tFrom?: number, tTo?: number }[]} params
 * @param {number[]} values
 * @param {object[]} keys
 * @param {Record<string, number | number[]>} look the base look
 * @param {{ tFrom?: number, tTo?: number }} window for `shot.` values
 * @returns {{ keys: object[], look: Record<string, number | number[]> }}
 */
export function applyParams(params, values, keys, look, { tFrom = -Infinity, tTo = Infinity } = {}) {
  const outKeys = keys.map((k) => ({ ...k, look: k.look ? { ...k.look } : undefined }));
  const outLook = Object.fromEntries(Object.entries(look).map(([n, v]) => [n, Array.isArray(v) ? [...v] : v]));
  params.forEach((p, i) => {
    const v = values[i];
    const [kind, ...rest] = p.path.split('.');
    const m = /^([A-Z0-9_]+)(?:\[(\d)\])?$/.exec(rest.join('.'));
    if (kind === 'key') {
      outKeys[Number(rest[0])][rest[1]] = v;
    } else if (kind === 'keys') {
      const [from, to] = rest[0].split('-').map(Number);
      for (let k = from; k <= to; k++) outKeys[k][rest[1]] = v;
    } else if (kind === 'look' && m) {
      if (m[2] !== undefined) outLook[m[1]][Number(m[2])] = v;
      else outLook[m[1]] = v;
    } else if (kind === 'shot' && m) {
      const from = p.tFrom ?? tFrom;
      const to = p.tTo ?? tTo;
      for (const k of outKeys) {
        if (k.t < from - 1e-9 || k.t > to + 1e-9) continue;
        k.look = k.look ?? {};
        if (m[2] !== undefined) {
          const base = Array.isArray(k.look[m[1]]) ? [...k.look[m[1]]] : [...(outLook[m[1]] ?? look[m[1]])];
          base[Number(m[2])] = v;
          k.look[m[1]] = base;
        } else k.look[m[1]] = v;
      }
    } else throw new Error(`unknown fit parameter ${p.path}`);
  });
  return { keys: outKeys, look: outLook };
}
