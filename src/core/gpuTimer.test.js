import { describe, it, expect, vi } from 'vitest';
import { createRollingAverage, formatTimings, gpuName, createGpuTimer } from './gpuTimer.js';

describe('createRollingAverage', () => {
  it('averages the last N samples', () => {
    const avg = createRollingAverage(3);
    expect(avg.value()).toBeNull();
    [1, 2, 3, 10].forEach((v) => avg.add(v));
    expect(avg.value()).toBe(5);
  });
});

describe('formatTimings', () => {
  it('lists passes with a total, skipping unknown ones', () => {
    expect(formatTimings({ volume: 2.25, stars: 1, bloom: null })).toBe('GPU 3.3 ms: volume 2.3 · stars 1.0');
    expect(formatTimings({})).toBe('');
  });
});

describe('gpuName', () => {
  const gl = (renderer, withExt = true) => ({
    RENDERER: 1,
    getExtension: () => (withExt ? { UNMASKED_RENDERER_WEBGL: 2 } : null),
    getParameter: (p) => (p === 2 ? renderer : 'WebKit WebGL'),
  });

  it('extracts the device from an ANGLE string', () => {
    expect(gpuName(gl('ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)'))).toBe('Intel(R) UHD Graphics 630');
  });

  it('passes other strings through and falls back when hidden', () => {
    expect(gpuName(gl('Apple GPU'))).toBe('Apple GPU');
    expect(gpuName(gl(null, false))).toBe('WebKit WebGL');
  });
});

describe('createGpuTimer', () => {
  it('is a safe no-op without the extension', () => {
    const t = createGpuTimer({ getExtension: () => null });
    expect(t.supported).toBe(false);
    t.begin('x');
    t.end();
    t.poll();
    expect(t.results()).toEqual({});
  });

  it('records resolved queries per label and ignores disjoint frames', () => {
    let disjoint = false;
    const gl = {
      QUERY_RESULT_AVAILABLE: 'avail',
      QUERY_RESULT: 'result',
      getExtension: () => ({ TIME_ELAPSED_EXT: 'te', GPU_DISJOINT_EXT: 'dj' }),
      createQuery: () => ({}),
      beginQuery: vi.fn(),
      endQuery: vi.fn(),
      deleteQuery: vi.fn(),
      getParameter: () => disjoint,
      getQueryParameter: (_q, p) => (p === 'avail' ? true : 4_000_000),
    };
    const t = createGpuTimer(gl);
    t.begin('volume');
    t.end();
    t.poll();
    disjoint = true;
    t.begin('volume');
    t.end();
    t.poll();
    expect(t.results()).toEqual({ volume: 4 });
    expect(gl.deleteQuery).toHaveBeenCalledTimes(2);
  });
});
