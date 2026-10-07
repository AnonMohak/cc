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
/**
 * The orbit around the hole (fallAngle): it starts in the idle wait, makes
 * one full turn by the plunge (at PLUNGE_START_U of the fall), then turns
 * PLUNGE_ANGLE more (at most a quarter turn) while the camera drops in.
 */
export const ORBIT_TURN = 2 * Math.PI;
export const PLUNGE_START_U = 0.85;
export const PLUNGE_ANGLE = 0.45 * Math.PI;
// Seconds for the orbit speed to ease in from rest, and the share of the
// first turn's speed at the start (the rest grows toward the hole).
const ORBIT_EASE_IN = 1.5;
const ORBIT_LINEAR = 0.7;

/**
 * Camera height above the disc plane for the film shot (app.js filmShot); the
 * fall's orbit eases toward it. High enough that the near side of the disc
 * hides the bottom of the shadow.
 */
export const FILM_ELEVATION_DEG = 20;

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
  let tau = 0; // seconds since the wait started (fallAngle's clock)

  return {
    /**
     * @param {number} realDt seconds (real time: it runs while paused, too)
     * @param {boolean} eligible the scene can show the fall now
     * @returns {{ phase: string, u: number, tau: number }} u: fall progress
     *   0–1; tau: seconds since the wait started (stops at the end)
     */
    tick(realDt, eligible) {
      if (phase === 'done') return { phase, u: 0, tau };
      if (!eligible) {
        phase = 'done';
        return { phase, u: 0, tau };
      }
      t += realDt;
      tau = Math.min(tau + realDt, idleSeconds + fallSeconds);
      if (phase === 'waiting' && t >= idleSeconds) {
        phase = 'falling';
        t = 0;
      }
      if (phase === 'falling' && t >= fallSeconds) phase = 'fallen';
      const u = phase === 'waiting' ? 0 : Math.min(1, t / fallSeconds);
      return { phase, u, tau };
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
 * - warp: 0–1 extra lensing near the end (BlackHolePass)
 * - vignette, black: 0–1 amounts
 * @param {number} u
 */
export function fallPose(u) {
  const x = Math.min(1, Math.max(0, u));
  const s = x * x * x;
  return {
    distanceT: s,
    spin: 1 + 14 * s,
    fovAdd: 25 * s,
    warp: smoothstep(0.5, 1, x),
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

// Eased clock: s' rises from 0 to 1 within a few ORBIT_EASE_IN.
function easedClock(tau) {
  return tau - ORBIT_EASE_IN * (1 - Math.exp(-tau / ORBIT_EASE_IN));
}

/**
 * Orbit angle (radians, in the disc's spin direction) at tau seconds from
 * the start of the idle wait. Closed form, so it does not depend on the frame
 * rate. Speed: 0 at tau = 0, eases in, grows a little to the plunge, and is
 * continuous into the plunge (C1).
 * @param {number} tau
 * @param {{ idleSeconds?: number, fallSeconds?: number }} [options]
 */
export function fallAngle(tau, { idleSeconds = 5, fallSeconds = 60 } = {}) {
  const tPlunge = idleSeconds + PLUNGE_START_U * fallSeconds;
  const sPlunge = easedClock(tPlunge);
  const t = Math.min(Math.max(tau, 0), idleSeconds + fallSeconds);
  if (t <= tPlunge) {
    const y = easedClock(t) / sPlunge;
    return ORBIT_TURN * (ORBIT_LINEAR * y + (1 - ORBIT_LINEAR) * y * y);
  }
  // Plunge: k(z) = m z + (1 - m) z², with m matching the speed at the join.
  const duration = idleSeconds + fallSeconds - tPlunge;
  const rateAtPlunge = (ORBIT_TURN * (2 - ORBIT_LINEAR) * (1 - Math.exp(-tPlunge / ORBIT_EASE_IN))) / sPlunge;
  const m = (rateAtPlunge * duration) / PLUNGE_ANGLE;
  const z = (t - tPlunge) / duration;
  return ORBIT_TURN + PLUNGE_ANGLE * (m * z + (1 - m) * z * z);
}
