import { describe, it, expect } from 'vitest';
import { createQualityGovernor } from './qualityGovernor.js';
import { QUALITY, TIER_ORDER, QUALITY_OPTIONS, isMobileDevice, startTier, targetFrameMs, activeTier, pixelRatioFor, bloomEnabled } from './quality.js';

/** Feed `seconds` of frames at `ms` each; collect tier changes. */
function run(gov, ms, seconds) {
  const changes = [];
  for (let t = 0; t < seconds * 1000; t += ms) {
    const c = gov.sample(ms);
    if (c) changes.push(c);
  }
  return changes;
}

describe('createQualityGovernor', () => {
  it('steps down one tier at a time while frames are too slow', () => {
    const gov = createQualityGovernor({ start: 'high', targetMs: 20 });
    const changes = run(gov, 60, 30);
    expect(changes).toEqual(['medium', 'low', 'minimal']);
    expect(gov.tier()).toBe('minimal');
  });

  it('steps up when comfortably fast, up to the max tier', () => {
    const gov = createQualityGovernor({ start: 'minimal', targetMs: 20 });
    expect(run(gov, 5, 60)).toEqual(['low', 'medium', 'high']);
  });

  it('holds a tier that is good enough (no change between 0.6× and 1.15× target)', () => {
    const gov = createQualityGovernor({ start: 'medium', targetMs: 20 });
    expect(run(gov, 18, 30)).toEqual([]);
  });

  it('does not flip back into a tier that was too slow (hysteresis)', () => {
    const gov = createQualityGovernor({ start: 'high', targetMs: 20, failMemorySeconds: 20 });
    expect(run(gov, 40, 3)).toEqual(['medium']); // high was too slow (drop at ~2 s)
    // Medium is very fast, but high failed recently: stay at medium.
    expect(run(gov, 8, 15)).toEqual([]);
    // After the memory expires it may try high again.
    expect(run(gov, 8, 15)).toEqual(['high']);
  });

  it('still steps down on a very slow device (frames of several hundred ms)', () => {
    const gov = createQualityGovernor({ start: 'medium', targetMs: 20 });
    expect(run(gov, 400, 20)).toEqual(['low', 'minimal']);
  });

  it('ignores stalls such as a tab switch', () => {
    const gov = createQualityGovernor({ start: 'medium', targetMs: 20 });
    for (let i = 0; i < 20; i++) expect(gov.sample(5000)).toBeNull();
    expect(gov.tier()).toBe('medium');
  });
});

describe('quality tiers', () => {
  it('get cheaper along TIER_ORDER on every knob', () => {
    for (let i = 1; i < TIER_ORDER.length; i++) {
      const lo = QUALITY[TIER_ORDER[i - 1]];
      const hi = QUALITY[TIER_ORDER[i]];
      for (const k of ['volumeScale', 'steps', 'maxPixelRatio', 'starCap', 'maxPointPx']) expect(lo[k]).toBeLessThanOrEqual(hi[k]);
    }
    expect(QUALITY.high.steps).toBeLessThanOrEqual(96); // shader MAX_STEPS
    expect(QUALITY_OPTIONS[0]).toBe('auto');
  });

  it('starts phones lower and targets 30 fps there, 50 fps on desktop', () => {
    expect(startTier(true)).toBe('low');
    expect(startTier(false)).toBe('medium');
    expect(targetFrameMs(true)).toBeCloseTo(33.3, 1);
    expect(targetFrameMs(false)).toBe(20);
  });

  it('detects phones by coarse pointer or small screen', () => {
    const win = (coarse, w, h) => ({ matchMedia: () => ({ matches: coarse }), screen: { width: w, height: h } });
    expect(isMobileDevice(win(true, 1920, 1080))).toBe(true);
    expect(isMobileDevice(win(false, 390, 844))).toBe(true);
    expect(isMobileDevice(win(false, 1920, 1080))).toBe(false);
    expect(isMobileDevice(undefined)).toBe(false);
  });

  it('maps settings to the active tier, pixel ratio and bloom', () => {
    expect(activeTier('auto', 'low')).toBe('low');
    expect(activeTier('high', 'low')).toBe('high');
    expect(pixelRatioFor(3, 'medium')).toBe(1.5);
    expect(pixelRatioFor(1, 'high')).toBe(1);
    expect(bloomEnabled(0.5, 'low')).toBe(false);
    expect(bloomEnabled(0.5, 'medium')).toBe(true);
    expect(bloomEnabled(0, 'high')).toBe(false);
  });
});
