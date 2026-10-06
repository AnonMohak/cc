/**
 * Guided tour: fly to each galaxy in turn, then orbit it slowly. A pure
 * state machine — tick() returns the next event, the app performs it — so
 * it is testable without a camera.
 *
 * Events: { type: 'fly', id } | { type: 'dwell', id } | { type: 'end' }
 *
 * @param {() => string[]} getIds current galaxy ids (re-read each step, so
 *   deleted galaxies are skipped and new ones join the next lap)
 */
export function createTour(getIds, { flySeconds = 3, dwellSeconds = 6, laps = 1 } = {}) {
  let order = [];
  let index = -1;
  let phase = 'idle';
  let t = 0;
  let lap = 0;

  function next() {
    const ids = new Set(getIds());
    // Skip galaxies deleted since the tour started.
    do index++;
    while (index < order.length && !ids.has(order[index]));
    if (index >= order.length) {
      lap++;
      if (lap >= laps || ids.size === 0) {
        phase = 'idle';
        return { type: 'end' };
      }
      order = [...ids];
      index = 0;
    }
    phase = 'fly';
    t = 0;
    return { type: 'fly', id: order[index] };
  }

  return {
    /** @returns {{ type: 'fly', id: string } | { type: 'end' }} */
    start() {
      order = getIds();
      index = -1;
      lap = 0;
      if (order.length === 0) return { type: 'end' };
      return next();
    },
    /** @param {number} dt real seconds */
    tick(dt) {
      if (phase === 'idle') return null;
      t += dt;
      if (phase === 'fly' && t >= flySeconds) {
        phase = 'dwell';
        t = 0;
        return { type: 'dwell', id: order[index] };
      }
      if (phase === 'dwell' && t >= dwellSeconds) return next();
      return null;
    },
    stop() {
      phase = 'idle';
    },
    isActive: () => phase !== 'idle',
    current: () => (phase === 'idle' ? null : order[index]),
  };
}
