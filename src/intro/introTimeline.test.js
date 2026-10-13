import { describe, it, expect } from 'vitest';
import { introCamera, fallBoost, FALL_START, FALL_FULL, FALL_BETA_MAX, introPhase, keyPosition, keyTarget, CAMERA_KEYS, INTRO_SECONDS, BLACK_FULL, MUSIC_RISE_SECONDS } from './introTimeline.js';

const pose = () => ({ position: [0, 0, 0], target: [0, 0, 0], roll: 0, fov: 0, exposure: 1 });

describe('introCamera', () => {
  it('passes through every key', () => {
    for (const key of CAMERA_KEYS) {
      const out = introCamera(key.t, pose());
      const want = keyPosition(key);
      for (let c = 0; c < 3; c++) expect(out.position[c]).toBeCloseTo(want[c], 9);
      expect(out.fov).toBeCloseTo(key.fov, 9);
      expect(out.roll).toBeCloseTo((key.roll * Math.PI) / 180, 9);
      const aim = keyTarget(key);
      for (let c = 0; c < 3; c++) expect(out.target[c]).toBeCloseTo(aim[c], 9);
      expect(out.exposure).toBeCloseTo(key.exp, 9);
    }
  });

  it('moves smoothly (no jumps) and stays outside the hole', () => {
    let prev = introCamera(0, pose()).position.slice();
    for (let t = 0.05; t <= BLACK_FULL; t += 0.05) {
      const p = introCamera(t, pose()).position;
      expect(Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2])).toBeLessThan(0.2);
      expect(Math.hypot(...p)).toBeGreaterThan(1);
      prev = p.slice();
    }
  });

  it('clamps outside the timeline', () => {
    expect(introCamera(-5, pose()).position).toEqual(introCamera(0, pose()).position);
    expect(introCamera(999, pose()).position).toEqual(introCamera(BLACK_FULL, pose()).position);
  });

  it('keys are in time order and end at full black', () => {
    for (let i = 1; i < CAMERA_KEYS.length; i++) expect(CAMERA_KEYS[i].t).toBeGreaterThan(CAMERA_KEYS[i - 1].t);
    expect(CAMERA_KEYS.at(-1).t).toBe(BLACK_FULL);
  });
});

describe('keyTarget', () => {
  it('aims at the hole with no lead, and turns toward the motion with a lead', () => {
    expect(keyTarget({ r: 10, el: 0, az: 0, lead: 0, aimY: 0.5 }).map((v) => +v.toFixed(9))).toEqual([0, 0.5, 0]);
    // At azimuth 0 the motion is +z: a 90° lead looks along +z from (10, 0, 0).
    const t = keyTarget({ r: 10, el: 0, az: 0, lead: 90, aimY: 0 });
    expect(t[0]).toBeCloseTo(10, 9);
    expect(t[2]).toBeCloseTo(10, 9);
  });
});

describe('introPhase', () => {
  it('rises the music, plays it, then ends in black and loads the scene', () => {
    expect(introPhase(0)).toEqual({ vignette: 0, black: 0, sound: 'wait', done: false });
    expect(introPhase(MUSIC_RISE_SECONDS).sound).toBe('fall');
    expect(introPhase(30).black).toBe(0);
    expect(introPhase(BLACK_FULL)).toEqual({ vignette: 1, black: 1, sound: 'end', done: false });
    expect(introPhase(INTRO_SECONDS).done).toBe(true);
  });
});

describe('fallBoost', () => {
  it('is zero for the reference shots, then ramps in along the motion', () => {
    for (const t of [0, 25, 44, FALL_START]) expect(Math.hypot(...fallBoost(t))).toBe(0);
    let last = 0;
    for (let t = FALL_FULL; t <= BLACK_FULL; t += 1) {
      const b = Math.hypot(...fallBoost(t));
      expect(b).toBeGreaterThan(0.3);
      expect(b).toBeLessThanOrEqual(FALL_BETA_MAX + 1e-9);
      // Faster as it falls in.
      expect(b).toBeGreaterThanOrEqual(last - 1e-9);
      last = b;
    }
  });

  it('points along the path', () => {
    const t = 60;
    const b = fallBoost(t);
    const p0 = introCamera(t - 0.2, pose()).position;
    const p1 = introCamera(t + 0.2, pose()).position;
    const d = p1.map((x, i) => x - p0[i]);
    const cos = (b[0] * d[0] + b[1] * d[1] + b[2] * d[2]) / (Math.hypot(...b) * Math.hypot(...d));
    expect(cos).toBeGreaterThan(0.99);
  });
});
