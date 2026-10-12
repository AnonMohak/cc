import { describe, it, expect } from 'vitest';
import { introCamera, introPhase, keyPosition, CAMERA_KEYS, INTRO_SECONDS, BLACK_FULL, MUSIC_RISE_SECONDS } from './introTimeline.js';

const pose = () => ({ position: [0, 0, 0], target: [0, 0, 0], roll: 0, fov: 0 });

describe('introCamera', () => {
  it('passes through every key', () => {
    for (const key of CAMERA_KEYS) {
      const out = introCamera(key.t, pose());
      const want = keyPosition(key);
      for (let c = 0; c < 3; c++) expect(out.position[c]).toBeCloseTo(want[c], 9);
      expect(out.fov).toBeCloseTo(key.fov, 9);
      expect(out.roll).toBeCloseTo((key.roll * Math.PI) / 180, 9);
      expect(out.target).toEqual(key.look.map((v) => expect.closeTo(v, 9)));
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

describe('introPhase', () => {
  it('rises the music, plays it, then ends in black and loads the scene', () => {
    expect(introPhase(0)).toEqual({ vignette: 0, black: 0, sound: 'wait', done: false });
    expect(introPhase(MUSIC_RISE_SECONDS).sound).toBe('fall');
    expect(introPhase(30).black).toBe(0);
    expect(introPhase(BLACK_FULL)).toEqual({ vignette: 1, black: 1, sound: 'end', done: false });
    expect(introPhase(INTRO_SECONDS).done).toBe(true);
  });
});
