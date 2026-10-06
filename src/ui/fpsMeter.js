const WINDOW_SECONDS = 0.5;

/**
 * Averages frame times over a short window. Returns null until a window
 * completes, then { fps, ms }. Pure, so it is testable without a browser.
 */
export function createFpsCounter(windowSeconds = WINDOW_SECONDS) {
  let frames = 0;
  let elapsed = 0;
  return {
    /** @param {number} realDt seconds */
    tick(realDt) {
      frames++;
      elapsed += realDt;
      if (elapsed < windowSeconds) return null;
      const ms = (elapsed / frames) * 1000;
      frames = 0;
      elapsed = 0;
      return { fps: Math.round(1000 / ms), ms: Math.round(ms * 10) / 10 };
    },
  };
}

/**
 * Small on-screen readout, enabled with `?fps` in the URL. Measures real
 * frame time, so check it on your own GPU (headless browsers render on CPU).
 * It keeps its own clock: the loop caps dt at 0.1 s, which would hide slow frames.
 * @param {HTMLElement} container
 * @param {() => number} [now] milliseconds
 * @param {() => string[]} [details] extra lines (GPU name, quality, pass timings)
 */
export function createFpsMeter(container, now = () => performance.now(), details = () => []) {
  const el = document.createElement('div');
  el.className = 'fps';
  el.textContent = '– fps';
  container.appendChild(el);
  const counter = createFpsCounter();
  let last = null;
  return {
    update() {
      const t = now();
      const dt = last === null ? 0 : (t - last) / 1000;
      last = t;
      if (dt <= 0) return;
      const r = counter.tick(dt);
      if (r) el.textContent = [`${r.fps} fps · ${r.ms} ms`, ...details().filter(Boolean)].join('\n');
    },
  };
}
