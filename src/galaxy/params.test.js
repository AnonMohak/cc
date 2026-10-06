import { describe, it, expect } from 'vitest';
import {
  clampShape,
  clampLook,
  clampMotion,
  DEFAULT_SHAPE,
  DEFAULT_LOOK,
  DEFAULT_MOTION,
  LIMITS,
  SHAPE_KEYS,
} from './params.js';
import { PRESETS } from './presets.js';

describe('clampShape', () => {
  it('returns defaults for missing input', () => {
    expect(clampShape()).toEqual(DEFAULT_SHAPE);
    expect(clampShape(null)).toEqual(DEFAULT_SHAPE);
  });

  it('falls back to the default for NaN, null and non-numeric values', () => {
    const out = clampShape({ count: NaN, arms: 'abc', spin: null });
    expect(out.count).toBe(DEFAULT_SHAPE.count);
    expect(out.arms).toBe(DEFAULT_SHAPE.arms);
    expect(out.spin).toBe(DEFAULT_SHAPE.spin);
  });

  it('clamps out-of-range values and rounds integer fields', () => {
    const out = clampShape({ count: -5, arms: 99, spin: 10, clumps: 2.6 });
    expect(out.count).toBe(LIMITS.shape.count.min);
    expect(out.arms).toBe(LIMITS.shape.arms.max);
    expect(out.spin).toBe(LIMITS.shape.spin.max);
    expect(out.clumps).toBe(3);
  });

  it('ignores unknown keys', () => {
    expect(clampShape({ evil: 1 })).not.toHaveProperty('evil');
  });

  it('SHAPE_KEYS lists every shape field', () => {
    expect(SHAPE_KEYS.sort()).toEqual(Object.keys(DEFAULT_SHAPE).sort());
  });
});

describe('clampLook', () => {
  it('validates colors and position', () => {
    const out = clampLook({ colorInner: 'red', colorOuter: '#AABBCC', position: [1, 'x', 3] });
    expect(out.colorInner).toBe(DEFAULT_LOOK.colorInner);
    expect(out.colorOuter).toBe('#AABBCC');
    expect(out.position).toEqual([1, 0, 3]);
  });

  it('clamps radius', () => {
    expect(clampLook({ radius: 1000 }).radius).toBe(LIMITS.look.radius.max);
  });
});

describe('clampMotion', () => {
  it('allows negative speed and clamps the range', () => {
    expect(clampMotion({ speed: -1 }).speed).toBe(-1);
    expect(clampMotion({ speed: -100 }).speed).toBe(LIMITS.motion.speed.min);
    expect(clampMotion()).toEqual(DEFAULT_MOTION);
  });
});

describe('presets', () => {
  it.each(Object.entries(PRESETS))('%s passes clamping unchanged', (_name, preset) => {
    expect(clampShape(preset.shape)).toEqual(preset.shape);
    expect(clampLook(preset.look)).toEqual(preset.look);
    expect(clampMotion(preset.motion)).toEqual(preset.motion);
  });
});
