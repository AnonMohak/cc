/**
 * Per-pass GPU timings with EXT_disjoint_timer_query_webgl2 (for the ?fps
 * overlay). Queries resolve a few frames later, so poll() once per frame.
 * Where the extension is missing (Safari, some mobiles, privacy settings),
 * every method is a no-op and results() is empty.
 */

/** Rolling mean of the last `size` samples. Pure, for tests. */
export function createRollingAverage(size = 30) {
  const samples = [];
  return {
    add(v) {
      samples.push(v);
      if (samples.length > size) samples.shift();
    },
    value: () => (samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : null),
  };
}

/** "scene 3.1 · bloom 0.8 ms" style summary of per-pass results. */
export function formatTimings(results) {
  const parts = Object.entries(results)
    .filter(([, ms]) => ms !== null)
    .map(([label, ms]) => `${label} ${ms.toFixed(1)}`);
  if (parts.length === 0) return '';
  const total = Object.values(results).reduce((s, ms) => s + (ms ?? 0), 0);
  return `GPU ${total.toFixed(1)} ms: ${parts.join(' · ')}`;
}

/** Name of the GPU the browser renders with, or null if hidden. */
export function gpuName(gl) {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  // ANGLE wraps it as "ANGLE (Vendor, Device (0x…) Direct3D11 …, D3D11)"; keep the device.
  if (typeof name === 'string' && name.startsWith('ANGLE (')) {
    const device = name.slice(7).split(',')[1] ?? '';
    return device.replace(/\s*\(0x[0-9a-f]+\)/i, '').replace(/\s+(Direct3D|OpenGL|Metal|Vulkan).*$/i, '').trim() || name;
  }
  return name?.trim() || null;
}

/** @param {WebGL2RenderingContext} gl */
export function createGpuTimer(gl) {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const averages = new Map();
  const pending = [];
  let active = null;

  return {
    supported: Boolean(ext),
    begin(label) {
      if (!ext || active) return;
      const query = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      active = { label, query };
    },
    end() {
      if (!ext || !active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },
    poll() {
      if (!ext || pending.length === 0) return;
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      while (pending.length && gl.getQueryParameter(pending[0].query, gl.QUERY_RESULT_AVAILABLE)) {
        const { label, query } = pending.shift();
        if (!disjoint) {
          if (!averages.has(label)) averages.set(label, createRollingAverage());
          averages.get(label).add(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
        }
        gl.deleteQuery(query);
      }
    },
    /** @returns {Record<string, number | null>} mean ms per label */
    results() {
      return Object.fromEntries([...averages].map(([label, avg]) => [label, avg.value()]));
    },
    /** Time each composer pass under its own label. */
    wrapPass(pass, label) {
      if (!ext) return;
      const render = pass.render.bind(pass);
      pass.render = (...args) => {
        this.begin(label);
        render(...args);
        this.end();
      };
    },
  };
}
