import { describe, it, expect } from 'vitest';
import { shadowAngle, distanceForShadow, holeOnScreen, solveShot, shotPose, SHOT_MEASURES, STILL_ASPECT, B_CRIT } from './shotSolve.js';
import { bendRay } from './gargantuaModel.js';

const DEG = Math.PI / 180;

describe('shadowAngle / distanceForShadow', () => {
  it('fills half the view at b_c and is b_c / r far away', () => {
    expect(shadowAngle(B_CRIT)).toBeCloseTo(Math.PI / 2, 6);
    expect(Math.sin(shadowAngle(1000))).toBeCloseTo(B_CRIT / 1000, 9);
  });

  it('inverts', () => {
    for (const r of [2.7, 3.6, 8, 40]) expect(distanceForShadow(shadowAngle(r))).toBeCloseTo(r, 6);
  });

  it('matches the traced shadow edge', () => {
    // From r = 6 a ray just inside the angle falls in; just outside escapes.
    const r = 6;
    const a = shadowAngle(r);
    const ray = (angle) => bendRay([r, 0, 0], [-Math.cos(angle), Math.sin(angle), 0]);
    expect(ray(a * 0.98).captured).toBe(true);
    expect(ray(a * 1.02).escaped).toBe(true);
  });
});

describe('solveShot', () => {
  it('reproduces the measured framing of every shot', () => {
    for (const [n, m] of Object.entries(SHOT_MEASURES)) {
      const pose = shotPose(n);
      const [u, v] = holeOnScreen(pose, m.fov, STILL_ASPECT);
      expect(u).toBeCloseTo(m.center[0], 3);
      expect(v).toBeCloseTo(m.center[1], 3);
      // The shadow's radius on screen (share of the frame height).
      const radius = Math.tan(shadowAngle(pose.r)) / Math.tan((m.fov / 2) * DEG) / 2;
      expect(radius).toBeCloseTo(m.radius, 3);
      expect(pose.r).toBeGreaterThan(B_CRIT);
      expect(pose.r).toBeGreaterThan(1.5);
    }
  });

  it('aims at the hole when it sits at the centre', () => {
    const pose = solveShot({ radius: 0.3, center: [0.5, 0.5], fov: 60, el: 0, az: 30 }, 16 / 9);
    expect(pose.lead).toBeCloseTo(0, 4);
    expect(pose.aimY).toBeCloseTo(0, 4);
  });
});
