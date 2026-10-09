import { generateGalaxy } from './generateGalaxy.js';
import { bakeDiscFields } from './discMap.js';
import { clampShape, clampStructure } from './params.js';

/**
 * One galaxy built ahead of time, off the main thread when a Worker is
 * there (generateWorker.js): a merger's remnant is known when the merger
 * starts, and building it at the end would stall a frame for 0.2–0.4 s
 * (generateGalaxy) plus ~50 ms (the disc-map bake). Galaxy.setShape and
 * bakeDiscMap read the cache first; the data is read-only, so the preview
 * and the remnant can share it.
 */

const cache = { galaxyKey: null, galaxy: null, discKey: null, disc: null };
let worker = null;
let pending = null;

/** Cache key of a galaxy build (the generator clamps the shape too). */
export function galaxyKey(shape, seed) {
  return `${JSON.stringify(clampShape(shape))}#${seed >>> 0}`;
}

/** Cache key of a disc-map bake (it does not depend on the star count). */
export function discKey(shape, structure) {
  const { count: _count, ...rest } = clampShape(shape);
  return `${JSON.stringify(rest)}|${JSON.stringify(clampStructure(structure))}`;
}

/** The prepared build for this shape and seed, or null. */
export function cachedGalaxyData(shape, seed) {
  return cache.galaxy && cache.galaxyKey === galaxyKey(shape, seed) ? cache.galaxy : null;
}

/** The prepared disc-map fields for this shape and structure, or null. */
export function cachedDiscFields(shape, structure) {
  return cache.disc && cache.discKey === discKey(shape, structure) ? cache.disc : null;
}

/** Whether the build for this shape and seed is ready. */
export function isGalaxyReady(shape, seed) {
  return cachedGalaxyData(shape, seed) !== null;
}

/**
 * Build a galaxy (and its disc map) ahead of time. Resolves once it is in
 * the cache. A new call replaces an earlier one.
 * @param {object} shape
 * @param {number} seed
 * @param {object} structure
 * @param {{ useWorker?: boolean }} [options]
 * @returns {Promise<void>}
 */
export function prepareGalaxy(shape, seed, structure, { useWorker = typeof Worker === 'function' } = {}) {
  const gKey = galaxyKey(shape, seed);
  const dKey = discKey(shape, structure);
  if (cache.galaxyKey === gKey && cache.discKey === dKey && cache.galaxy) return Promise.resolve();
  const store = (galaxy, disc) => {
    cache.galaxyKey = gKey;
    cache.galaxy = galaxy;
    cache.discKey = dKey;
    cache.disc = disc;
  };
  const onMainThread = () => store(generateGalaxy(shape, seed), bakeDiscFields(shape, structure));
  if (!useWorker) {
    onMainThread();
    return Promise.resolve();
  }
  pending?.reject?.();
  return new Promise((resolve) => {
    const job = { reject: null };
    pending = job;
    const fallback = () => {
      stopWorker();
      if (pending !== job) return;
      pending = null;
      // One stall instead of none; still correct.
      setTimeout(() => {
        onMainThread();
        resolve();
      }, 0);
    };
    try {
      worker ??= new Worker(new URL('./generateWorker.js', import.meta.url), { type: 'module' });
    } catch {
      fallback();
      return;
    }
    job.reject = () => resolve();
    worker.onmessage = ({ data }) => {
      if (pending !== job) return;
      pending = null;
      store(data.galaxy, data.disc);
      resolve();
    };
    worker.onerror = fallback;
    worker.postMessage({ shape: clampShape(shape), seed: seed >>> 0, structure: clampStructure(structure) });
  });
}

function stopWorker() {
  worker?.terminate();
  worker = null;
}

/** Drop the prepared build (and stop the worker). */
export function clearGalaxyCache() {
  cache.galaxyKey = cache.galaxy = cache.discKey = cache.disc = null;
  pending = null;
  stopWorker();
}
