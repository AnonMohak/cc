import { describe, it, expect } from 'vitest';
import { createFpsCounter, createFpsMeter } from './fpsMeter.js';

describe('createFpsCounter', () => {
  it('reports the average after each window', () => {
    const c = createFpsCounter(0.5);
    let r = null;
    for (let i = 0; i < 40; i++) r = c.tick(1 / 60) ?? r;
    expect(r).toEqual({ fps: 60, ms: 16.7 });
  });

  it('returns null until a window completes', () => {
    expect(createFpsCounter(0.5).tick(0.1)).toBeNull();
  });
});

describe('createFpsMeter', () => {
  it('uses its own clock, so slow frames are not hidden by the loop dt cap', () => {
    const el = { className: '', textContent: '' };
    const container = { appendChild: () => {} };
    globalThis.document = { createElement: () => el };
    let t = 0;
    const meter = createFpsMeter(container, () => t);
    for (let i = 0; i < 4; i++) {
      meter.update();
      t += 1000; // 1 s per frame: a cap at 0.1 s would report 10 fps
    }
    expect(el.textContent).toBe('1 fps · 1000 ms');
    delete globalThis.document;
  });
});
