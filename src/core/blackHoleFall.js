/**
 * Intro "fall into the black hole". A pure state machine — the app moves the
 * camera from what tick() and fallPose() return — so it is testable without
 * a camera (same pattern as tour.js).
 *
 * Phases: 'waiting' (idle countdown) → 'falling' → 'fallen' (black, held),
 * and 'done' from any phase once the user interacts or the scene stops being
 * eligible. 'done' is final: the fall runs at most once per page load.
 */

/** Closest camera distance, in Rs: inside the photon sphere (1.5 Rs). */
export const R_END = 1.2;
/** Orbit speed at the start distance (rad/s) and its cap. */
export const ORBIT_START = 0.06;
export const ORBIT_MAX = 2.5;
/** Camera height above the disc plane that the orbit eases toward. */
export const FALL_ELEVATION_DEG = 6;

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * @param {{ idleSeconds?: number, fallSeconds?: number }} [options]
 */
export function createFall({ idleSeconds = 5, fallSeconds = 60 } = {}) {
  let phase = 'waiting';
  let t = 0;

  return {
    /**
     * @param {number} realDt seconds (real time: it runs while paused, too)
     * @param {boolean} eligible the scene can show the fall now
     * @returns {{ phase: string, u: number }} u: fall progress 0–1
     */
    tick(realDt, eligible) {
      if (phase === 'done') return { phase, u: 0 };
      if (!eligible) {
        phase = 'done';
        return { phase, u: 0 };
      }
      t += realDt;
      if (phase === 'waiting' && t >= idleSeconds) {
        phase = 'falling';
        t = 0;
      }
      if (phase === 'falling' && t >= fallSeconds) phase = 'fallen';
      const u = phase === 'waiting' ? 0 : Math.min(1, t / fallSeconds);
      return { phase, u };
    },
    /**
     * The user interacted. 'escape' when the camera was already moving (the
     * app flies it back), 'cancel' while still waiting, null when done.
     */
    interact() {
      const before = phase;
      phase = 'done';
      if (before === 'falling' || before === 'fallen') return 'escape';
      return before === 'waiting' ? 'cancel' : null;
    },
    phase: () => phase,
  };
}

/**
 * Every curve of the fall at progress u (0–1). The ease is u³: slow for most
 * of the minute, fast at the end.
 * - distanceT: 0 → 1, the camera distance runs from the start distance to
 *   R_END in log space (so the speed keeps growing)
 * - spin: disc time multiplier (the disc seems to spin faster up close)
 * - fovAdd: degrees added to the field of view (a sense of speed)
 * - shake, vignette, black: 0–1 amounts
 * @param {number} u
 */
export function fallPose(u) {
  const x = Math.min(1, Math.max(0, u));
  const s = x * x * x;
  return {
    distanceT: s,
    spin: 1 + 14 * s,
    fovAdd: 25 * s,
    shake: smoothstep(0.75, 1, x),
    vignette: smoothstep(0.55, 1, x),
    black: smoothstep(0.93, 1, x),
  };
}

/**
 * Camera distance (same units as r0 and rEnd) at a distanceT from fallPose.
 */
export function fallDistance(r0, rEnd, distanceT) {
  return Math.exp(Math.log(r0) + (Math.log(rEnd) - Math.log(r0)) * distanceT);
}

/**
 * Orbit speed (rad/s) at distance r: Keplerian, ω ∝ r^-1.5, from ORBIT_START
 * at the start distance r0, capped at ORBIT_MAX.
 */
export function orbitRate(r, r0) {
  return Math.min(ORBIT_MAX, ORBIT_START * (r0 / Math.max(r, 1e-6)) ** 1.5);
}
