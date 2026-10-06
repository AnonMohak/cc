import { EMPHASIS_SELECTED, EMPHASIS_OTHERS } from './params.js';

// Time constant of the brightness ease; ~5τ ≈ 0.25 s to settle.
const EASE_TAU = 0.05;

/**
 * Target brightness multiplier for a galaxy. With no selection every galaxy
 * is at full brightness; otherwise the selected one is lifted a little and
 * the rest are dimmed so the selection reads without any overlay.
 *
 * @param {string} id
 * @param {string | null} selectedId
 */
export function emphasisTarget(id, selectedId) {
  if (!selectedId) return 1;
  return id === selectedId ? EMPHASIS_SELECTED : EMPHASIS_OTHERS;
}

/** Frame-rate independent exponential ease from `current` toward `target`. */
export function approach(current, target, dt) {
  if (dt <= 0) return current;
  const next = target + (current - target) * Math.exp(-dt / EASE_TAU);
  return Math.abs(next - target) < 1e-3 ? target : next;
}
