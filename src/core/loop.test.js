import { describe, it, expect, vi } from 'vitest';
import { createLoop } from './loop.js';

function run(loop, timestamps) {
  for (const t of timestamps) loop.step(t);
}

describe('createLoop', () => {
  it('passes dt in seconds and accumulates elapsed time', () => {
    const loop = createLoop();
    const calls = [];
    loop.onTick((dt, elapsed, realDt) => calls.push({ dt, elapsed, realDt }));
    run(loop, [1000, 1016, 1032]);
    expect(calls[0].dt).toBe(0);
    expect(calls[1].dt).toBeCloseTo(0.016);
    expect(calls[2].elapsed).toBeCloseTo(0.032);
  });

  it('gives dt = 0 while paused but keeps realDt', () => {
    const loop = createLoop();
    const calls = [];
    loop.onTick((dt, elapsed, realDt) => calls.push({ dt, realDt }));
    loop.setPaused(true);
    run(loop, [0, 50]);
    expect(calls[1].dt).toBe(0);
    expect(calls[1].realDt).toBeCloseTo(0.05);
    expect(loop.getElapsed()).toBe(0);
  });

  it('scales dt by the time scale and clamps negative scale to 0', () => {
    const loop = createLoop();
    const dts = [];
    loop.onTick((dt) => dts.push(dt));
    loop.setTimeScale(2);
    run(loop, [0, 50]);
    expect(dts[1]).toBeCloseTo(0.1);
    loop.setTimeScale(-1);
    expect(loop.getTimeScale()).toBe(0);
  });

  it('caps a long frame at maxDelta', () => {
    const loop = createLoop({ maxDelta: 0.1 });
    const dts = [];
    loop.onTick((dt) => dts.push(dt));
    run(loop, [0, 5000]);
    expect(dts[1]).toBeCloseTo(0.1);
  });

  it('renders after all tickers and supports unsubscribe', () => {
    const loop = createLoop();
    const order = [];
    const off = loop.onTick(() => order.push('a'));
    loop.onTick(() => order.push('b'));
    loop.setRender(() => order.push('render'));
    loop.step(0);
    off();
    loop.step(16);
    expect(order).toEqual(['a', 'b', 'render', 'b', 'render']);
  });

  it('start/stop drive renderer.setAnimationLoop', () => {
    const loop = createLoop();
    const renderer = { setAnimationLoop: vi.fn() };
    loop.start(renderer);
    expect(renderer.setAnimationLoop).toHaveBeenCalledWith(loop.step);
    loop.stop(renderer);
    expect(renderer.setAnimationLoop).toHaveBeenLastCalledWith(null);
  });
});
