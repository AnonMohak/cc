import { describe, it, expect } from 'vitest';
import { shadowAngle, distanceForShadow, holeOnScreen, solveShot, B_CRIT, SHADOW_SHIFT, shadowCentre } from './shotSolve.js';
import { FILM_MEASURES } from './filmMeasures.js';
import { bendRay } from './gargantuaModel.js';

const DEG = Math.PI / 180;

describe('shadowAngle / distanceForShadow', () => {
  it('is b_c √(1 − 1/r) / r, as a static observer sees it, and fills the view near the photon sphere', () => {
    expect(shadowAngle(1.5)).toBeGreaterThan(1.2);
    expect(Math.sin(shadowAngle(1000))).toBeCloseTo((B_CRIT * Math.sqrt(1 - 1 / 1000)) / 1000, 9);
    expect(shadowAngle(20)).toBeLessThan(shadowAngle(5));
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
  it('reproduces the measured shadows of the film clip', () => {
    // Each film shot's shadow (or ring) circles, solved with a chosen field
    // of view, land where they were measured.
    const aspect = 16 / 9;
    const cases = [
      ['ring', 40, 0.3],
      ['shadow', 60, 4],
    ];
    for (const [key, fov, el] of cases) {
      for (const m of FILM_MEASURES.filter((f) => f[key] && f[key].cx > 0.2 && f[key].cy > 0.05).slice(0, 6)) {
        const c = m[key];
        const shot = { radius: c.r, center: [c.cx / aspect, c.cy], fov, el, az: 30 };
        const pose = { ...solveShot(shot, aspect), el, az: 30 };
        const [u, v] = holeOnScreen(pose, fov, aspect, shadowCentre(pose));
        expect(u).toBeCloseTo(shot.center[0], 3);
        expect(v).toBeCloseTo(shot.center[1], 3);
        const radius = Math.tan(shadowAngle(pose.r)) / Math.tan((fov / 2) * DEG) / 2;
        expect(radius).toBeCloseTo(c.r, 3);
        expect(pose.r).toBeGreaterThan(B_CRIT);
      }
    }
  });

  it('aims at the shadow centre, beside the hole on the retrograde side', () => {
    const shot = { radius: 0.3, center: [0.5, 0.5], fov: 60, el: 0, az: 30 };
    const pose = { ...solveShot(shot, 16 / 9), el: 0, az: 30 };
    const [u, v] = holeOnScreen(pose, 60, 16 / 9, shadowCentre(pose));
    expect(u).toBeCloseTo(0.5, 4);
    expect(v).toBeCloseTo(0.5, 4);
    expect(pose.aimY).toBeCloseTo(0, 4);
    expect(Math.hypot(...shadowCentre(pose))).toBeCloseTo(SHADOW_SHIFT * Math.sqrt(1 - 1 / pose.r), 9);
  });

  it('puts the shadow centre where the traced shadow is', () => {
    // From far out along -x: the traced edges across the view (z) are
    // symmetric about the centre's z.
    const pose = { r: 80, el: 0, az: 180, lead: 0, aimY: 0 };
    const c = shadowCentre(pose);
    const edge = (side) => {
      let lo = 1;
      let hi = 4;
      for (let i = 0; i < 20; i++) {
        const b = (lo + hi) / 2;
        if (bendRay([-80, 0, side * b], [1, 0, 0], 20000).captured) lo = b;
        else hi = b;
      }
      return side * lo;
    };
    expect((edge(1) + edge(-1)) / 2).toBeCloseTo(c[2], 2);
    expect(c[0]).toBeCloseTo(0, 9);
  });
});
