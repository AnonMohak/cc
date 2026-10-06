import { TIER_ORDER } from './quality.js';

/**
 * Picks a quality tier from measured frame times (Auto quality).
 *
 * - Too slow (mean frame time > target × 1.15 over `windowSeconds`): one tier down.
 * - Comfortably fast (mean < target × 0.6 for `upHoldSeconds`): one tier up,
 *   but never back into a tier that was too slow in the last `failMemorySeconds`
 *   — that is the hysteresis that stops it flipping between two tiers.
 * - After any change, wait `cooldownSeconds` so the new tier is measured fairly.
 *
 * Pure: feed it frame times, it returns the new tier name when it changes.
 *
 * @param {{ start: string, targetMs: number, maxTier?: string, windowSeconds?: number,
 *   upHoldSeconds?: number, cooldownSeconds?: number, failMemorySeconds?: number }} options
 */
export function createQualityGovernor({
  start,
  targetMs,
  maxTier = 'high',
  windowSeconds = 1.5,
  upHoldSeconds = 4,
  cooldownSeconds = 2,
  failMemorySeconds = 20,
}) {
  let index = TIER_ORDER.indexOf(start);
  const maxIndex = TIER_ORDER.indexOf(maxTier);
  let clock = 0;
  let cooldownUntil = cooldownSeconds;
  let fastSince = null;
  const window = [];
  let windowTime = 0;
  /** tier index → time it was last found too slow */
  const failedAt = new Map();

  function change(next) {
    index = next;
    window.length = 0;
    windowTime = 0;
    fastSince = null;
    cooldownUntil = clock + cooldownSeconds;
    return TIER_ORDER[index];
  }

  return {
    tier: () => TIER_ORDER[index],
    /**
     * @param {number} frameMs real time of the last frame
     * @returns {string | null} the new tier, or null if unchanged
     */
    sample(frameMs) {
      // Ignore gaps over 1 s (tab switch, long stall). Clamp very slow frames
      // instead of ignoring them: a 3 fps device must still step down.
      if (!(frameMs > 0) || frameMs > 1000) return null;
      frameMs = Math.min(frameMs, 250);
      clock += frameMs / 1000;
      window.push(frameMs);
      windowTime += frameMs / 1000;
      while (windowTime > windowSeconds && window.length > 1) windowTime -= window.shift() / 1000;
      if (clock < cooldownUntil || windowTime < windowSeconds * 0.9) return null;

      const mean = window.reduce((a, b) => a + b, 0) / window.length;
      if (mean > targetMs * 1.15 && index > 0) {
        failedAt.set(index, clock);
        return change(index - 1);
      }
      if (mean < targetMs * 0.6 && index < maxIndex) {
        fastSince ??= clock;
        const recentlyFailed = clock - (failedAt.get(index + 1) ?? -Infinity) < failMemorySeconds;
        if (clock - fastSince >= upHoldSeconds && !recentlyFailed) return change(index + 1);
      } else {
        fastSince = null;
      }
      return null;
    },
  };
}
