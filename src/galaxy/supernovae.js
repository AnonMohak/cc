import { createRandom } from './random.js';

/**
 * Supernova flashes. PURE timing and site choice; Galaxy.js owns the points.
 *
 * Real rates are ~1 per century per galaxy; here they are compressed to one
 * every few seconds so the sky feels alive. Core-collapse supernovae come
 * from young massive stars, so sites prefer young (arm) stars; galaxies
 * without young stars (ellipticals) get type Ia events anywhere.
 */

export const SUPERNOVA_SLOTS = 4;
/** Mean seconds of simulation time between flashes in one galaxy. */
export const MEAN_INTERVAL = 9;
const RISE = 0.25;
const DECAY = 1.1;
/** After this age a flash is invisible and its slot is free. */
export const LIFETIME = 5;
const MIN_SITE_RADIUS = 0.22;

/**
 * Light curve: fast rise, exponential fade. 0 before birth and after LIFETIME.
 * @param {number} age seconds since the explosion
 */
export function supernovaLight(age) {
  if (age < 0 || age >= LIFETIME) return 0;
  if (age < RISE) {
    const t = age / RISE;
    return t * t * (3 - 2 * t);
  }
  // Fades to ~0 just before LIFETIME, so the end does not pop.
  const fade = Math.exp(-(age - RISE) / DECAY);
  const end = Math.exp(-(LIFETIME - RISE) / DECAY);
  return (fade - end) / (1 - end);
}

/**
 * Poisson schedule of explosions.
 * @param {number} seed
 * @param {number} [meanInterval]
 */
export function createSupernovaSchedule(seed, meanInterval = MEAN_INTERVAL) {
  const rng = createRandom(seed ^ 0x5e5e5e5);
  // First flash comes sooner, so a new galaxy shows one early.
  let wait = meanInterval * (0.15 + 0.35 * rng.next());
  return {
    rng,
    /**
     * Advance by dt; returns how many explosions happened.
     * @param {number} dt simulation seconds (0 while paused)
     */
    update(dt) {
      if (dt <= 0) return 0;
      wait -= dt;
      let events = 0;
      while (wait <= 0) {
        events++;
        wait += -meanInterval * Math.log(1 - rng.next());
      }
      return Math.min(events, SUPERNOVA_SLOTS);
    },
  };
}

/**
 * Pick the star that explodes: a young star when the galaxy has them, else
 * any field star. Sites inside the bright core (a < MIN_SITE_RADIUS) are
 * avoided, since the bulge would hide the flash. Globular-cluster stars
 * (kind 4) are skipped: their shader position needs a per-star offset the
 * flash does not carry.
 *
 * @param {{ next(): number }} rng
 * @param {ArrayLike<number>} orbit aOrbit (vec4 per star)
 * @param {ArrayLike<number>} star aStar (temperature, size, youth)
 * @param {number} count stars available
 * @returns {number} star index, or -1
 */
export function pickSupernovaSite(rng, orbit, star, count) {
  if (count <= 0) return -1;
  let fallback = -1;
  for (let tries = 0; tries < 40; tries++) {
    const i = Math.floor(rng.next() * count);
    if (orbit[i * 4 + 3] > 3.5) continue;
    if (Math.abs(orbit[i * 4]) < MIN_SITE_RADIUS) {
      if (fallback < 0) fallback = i; // only if nothing better turns up
      continue;
    }
    if (star[i * 3 + 2] === 1) return i;
    if (fallback < 0 || Math.abs(orbit[fallback * 4]) < MIN_SITE_RADIUS) fallback = i;
  }
  return fallback;
}
