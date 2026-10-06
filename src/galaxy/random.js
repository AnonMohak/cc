/**
 * Seeded PRNG (mulberry32). Same seed → same sequence, so galaxies are
 * reproducible from their params and persistence only stores the seed.
 * @param {number} seed
 */
export function createRandom(seed) {
  let state = seed >>> 0;

  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function range(min, max) {
    return min + (max - min) * next();
  }

  // Box–Muller; 1 - next() keeps log() away from 0.
  function gaussian(mean = 0, sd = 1) {
    const u = 1 - next();
    const v = next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function sign() {
    return next() < 0.5 ? -1 : 1;
  }

  return { next, range, gaussian, sign };
}

/** A fresh 32-bit seed for new galaxies. Not for use inside generation. */
export function randomSeed() {
  return Math.floor(Math.random() * 4294967296);
}
