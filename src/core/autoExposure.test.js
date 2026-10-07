import { describe, it, expect } from 'vitest';
import { meterFrame, targetFactor, adapt, isSettled, METER_SIZE, LOG_MIN, LOG_MAX, KEY, MIN_FACTOR, DARKEN_SECONDS, BRIGHTEN_SECONDS } from './autoExposure.js';

/** Meter bytes: every texel the same log2 luminance, bright mask and weight. */
function meter(log2, bright, weight = 1) {
  const bytes = new Uint8Array(METER_SIZE * METER_SIZE * 4);
  const r = Math.round(((log2 - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 255);
  for (let i = 0; i < bytes.length; i += 4) {
    bytes[i] = r;
    bytes[i + 1] = Math.round(bright * weight * 255);
    bytes[i + 2] = Math.round(weight * 255);
  }
  return bytes;
}

describe('meterFrame', () => {
  it('decodes coverage and the mean log luminance of the bright part', () => {
    const m = meterFrame(meter(2, 0.5));
    expect(m.coverage).toBeCloseTo(0.5, 2);
    expect(m.meanLog2).toBeCloseTo(2, 1);
  });
  it('reports nothing bright for a black frame', () => {
    const m = meterFrame(meter(LOG_MIN, 0));
    expect(m.coverage).toBe(0);
    expect(m.meanLog2).toBe(LOG_MIN);
  });
});

describe('targetFactor', () => {
  it('leaves normal views alone (little bright coverage)', () => {
    expect(targetFactor({ coverage: 0.05, meanLog2: 4 })).toBe(1);
  });
  it('never brightens a dim centre', () => {
    expect(targetFactor({ coverage: 1, meanLog2: -6 })).toBe(1);
  });
  it('brings a bright centre down to KEY, within the limit', () => {
    expect(targetFactor({ coverage: 1, meanLog2: 3 })).toBeCloseTo(KEY / 8, 6);
    expect(targetFactor({ coverage: 1, meanLog2: 20 })).toBeCloseTo(MIN_FACTOR, 6);
  });
  it('counts the Exposure slider as bias', () => {
    const base = targetFactor({ coverage: 1, meanLog2: 1 }, 1);
    expect(targetFactor({ coverage: 1, meanLog2: 1 }, 2)).toBeCloseTo(base / 2, 6);
  });
  it('blends in smoothly with coverage', () => {
    const half = targetFactor({ coverage: 0.25, meanLog2: 3 });
    expect(half).toBeLessThan(1);
    expect(half).toBeGreaterThan(targetFactor({ coverage: 1, meanLog2: 3 }));
  });
});

describe('adapt', () => {
  it('darkens fast and brightens slowly (~95% in the set time)', () => {
    const down = adapt(1, 1 / 16, DARKEN_SECONDS);
    expect(Math.log2(down)).toBeCloseTo(-4 * 0.95, 1);
    const up = adapt(1 / 16, 1, DARKEN_SECONDS);
    expect(Math.log2(up)).toBeGreaterThan(-4 * 0.6); // far from done
    expect(Math.log2(adapt(1 / 16, 1, BRIGHTEN_SECONDS))).toBeCloseTo(-4 * 0.05, 1);
  });
  it('does not depend on the frame rate', () => {
    let a = 1;
    for (let i = 0; i < 60; i++) a = adapt(a, 0.1, 1 / 60);
    let b = 1;
    for (let i = 0; i < 15; i++) b = adapt(b, 0.1, 1 / 15);
    expect(a).toBeCloseTo(b, 6);
  });
  it('snaps to the target once settled', () => {
    let f = 1;
    for (let i = 0; i < 600; i++) f = adapt(f, 0.25, 1 / 60);
    expect(f).toBe(0.25);
    expect(isSettled(f, 0.25)).toBe(true);
    expect(isSettled(0.5, 0.25)).toBe(false);
  });
});
