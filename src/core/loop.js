/**
 * The single animation loop. Tick subscribers receive simulation time
 * (scaled, zero while paused) and real time (for camera/UI motion that must
 * keep working while the simulation is paused).
 *
 * @param {{ maxDelta?: number }} [options] maxDelta caps a frame's dt in
 *   seconds so a background tab does not make galaxies leap forward.
 */
export function createLoop({ maxDelta = 0.1 } = {}) {
  const tickers = new Set();
  let render = () => {};
  let last = null;
  let paused = false;
  let timeScale = 1;
  let elapsed = 0;

  /** @param {number} timestamp milliseconds */
  function step(timestamp) {
    const realDt = last === null ? 0 : Math.min(Math.max((timestamp - last) / 1000, 0), maxDelta);
    last = timestamp;
    const dt = paused ? 0 : realDt * timeScale;
    elapsed += dt;
    for (const tick of tickers) tick(dt, elapsed, realDt);
    render();
  }

  return {
    step,
    /** @param {(dt: number, elapsed: number, realDt: number) => void} fn */
    onTick(fn) {
      tickers.add(fn);
      return () => tickers.delete(fn);
    },
    setRender(fn) {
      render = fn;
    },
    setPaused(value) {
      paused = Boolean(value);
    },
    isPaused: () => paused,
    setTimeScale(value) {
      timeScale = Math.max(0, Number(value) || 0);
    },
    getTimeScale: () => timeScale,
    getElapsed: () => elapsed,
    start(renderer) {
      last = null;
      renderer.setAnimationLoop(step);
    },
    stop(renderer) {
      renderer.setAnimationLoop(null);
    },
  };
}
