import { describe, it, expect } from 'vitest';
import { nelderMead, applyParams, fromShare, toShare } from './fitMath.js';

describe('nelderMead', () => {
  it('finds the minimum of a bowl inside the box', async () => {
    const f = ([x, y]) => (x - 0.3) ** 2 + 2 * (y - 0.7) ** 2;
    const r = await nelderMead(f, [0.9, 0.1], { iterations: 300, tol: 1e-12 });
    expect(r.x[0]).toBeCloseTo(0.3, 3);
    expect(r.x[1]).toBeCloseTo(0.7, 3);
  });

  it('stays inside the box when the minimum is outside it', async () => {
    const r = await nelderMead(([x]) => (x - 1.5) ** 2, [0.2], { iterations: 100, tol: 1e-12 });
    expect(r.x[0]).toBeCloseTo(1, 6);
  });

  it('takes async functions and counts evaluations', async () => {
    let calls = 0;
    const r = await nelderMead(async ([x]) => {
      calls++;
      return Math.abs(x - 0.5);
    }, [0], { iterations: 30 });
    expect(r.evaluations).toBe(calls);
    expect(r.evaluations).toBeLessThanOrEqual(31);
  });
});

describe('applyParams', () => {
  const keys = [{ t: 0, r: 5 }, { t: 10, r: 6 }, { t: 20, r: 7, look: { TAU: 1 } }];
  const look = { EMIT: 14, GAS_WARM: [1, 0.5, 0.2], TAU: 5 };

  it('sets base look values, key fields and one shot\'s look without touching the inputs', () => {
    const params = [
      { path: 'look.EMIT', min: 0, max: 40 },
      { path: 'look.GAS_WARM[1]', min: 0, max: 1 },
      { path: 'key.1.r', min: 2, max: 9 },
      { path: 'shot.TAU', min: 0, max: 8 },
      { path: 'shot.GAS_WARM[2]', min: 0, max: 1 },
    ];
    const out = applyParams(params, [20, 0.6, 8, 3, 0.9], keys, look, { tFrom: 5, tTo: 25 });
    expect(out.look.EMIT).toBe(20);
    expect(out.look.GAS_WARM).toEqual([1, 0.6, 0.2]);
    expect(out.keys[1].r).toBe(8);
    expect(out.keys[0].look).toBeUndefined();
    expect(out.keys[1].look).toEqual({ TAU: 3, GAS_WARM: [1, 0.6, 0.9] });
    expect(out.keys[2].look.TAU).toBe(3);
    expect(keys[2].look.TAU).toBe(1);
    expect(look.GAS_WARM[1]).toBe(0.5);
  });

  it('sets one field on a range of keys', () => {
    const out = applyParams([{ path: 'keys.0-1.fov', min: 10, max: 90 }], [40], [{ t: 0, fov: 60 }, { t: 1, fov: 60 }, { t: 2, fov: 60 }], {});
    expect(out.keys.map((k) => k.fov)).toEqual([40, 40, 60]);
  });

  it('rejects unknown parameters', () => {
    expect(() => applyParams([{ path: 'foo.x', min: 0, max: 1 }], [0.5], keys, look)).toThrow();
  });

  it('limits a shot value to the window of the parameter', () => {
    const keys = [{ t: 0 }, { t: 1 }, { t: 2 }];
    const out = applyParams([{ path: 'shot.GAIN', min: 0, max: 9, tFrom: 1.5 }], [4], keys, { GAIN: 1 }, { tFrom: 0, tTo: 2 });
    expect(out.keys.map((k) => k.look?.GAIN)).toEqual([undefined, undefined, 4]);
  });

  it('maps shares to ranges and back', () => {
    const p = { min: 2, max: 6 };
    expect(fromShare(p, 0.25)).toBe(3);
    expect(toShare(p, 3)).toBe(0.25);
    expect(toShare(p, 9)).toBe(1);
  });
});
