import { describe, it, expect } from 'vitest';
import { niceScaleBar, pxPerUnitAt, labelPlacement, minimapLayout, minimapHit } from './hudMath.js';
import { LY_PER_WORLD_UNIT, radiusForDiameter } from '../galaxy/catalogue.js';

describe('scale', () => {
  it('is consistent with the catalogue: an M31-sized galaxy spans ~152,000 ly', () => {
    expect(2 * radiusForDiameter(152_000) * LY_PER_WORLD_UNIT).toBeCloseTo(152_000, -2);
  });

  it('picks a 1/2/5 × 10^k length near the target width', () => {
    const bar = niceScaleBar(10, LY_PER_WORLD_UNIT, 120);
    expect(String(bar.ly)).toMatch(/^[125]0*$/);
    expect(bar.px).toBeGreaterThan(60);
    expect(bar.px).toBeLessThan(200);
    expect(niceScaleBar(0, 9000)).toBeNull();
  });

  it('zooming in shortens the distance the bar represents', () => {
    expect(niceScaleBar(100, 9000).ly).toBeLessThan(niceScaleBar(5, 9000).ly);
  });

  it('pxPerUnitAt falls with distance', () => {
    expect(pxPerUnitAt(10, 55, 800)).toBeCloseTo(2 * pxPerUnitAt(20, 55, 800));
  });
});

describe('labelPlacement', () => {
  it('sits below the projected centre and hides behind the camera or off screen', () => {
    const p = labelPlacement({ x: 0, y: 0, z: 0.5 }, 100, 1000, 800);
    expect(p.left).toBe(500);
    expect(p.top).toBeGreaterThan(400);
    expect(p.visible).toBe(true);
    expect(labelPlacement({ x: 0, y: 0, z: 1.5 }, 100, 1000, 800).visible).toBe(false);
    expect(labelPlacement({ x: 5, y: 0, z: 0.5 }, 100, 1000, 800).visible).toBe(false);
  });

  it('fades out tiny distant galaxies', () => {
    expect(labelPlacement({ x: 0, y: 0, z: 0.5 }, 1, 1000, 800).visible).toBe(false);
    expect(labelPlacement({ x: 0, y: 0, z: 0.5 }, 6, 1000, 800).opacity).toBeLessThan(1);
  });
});

describe('minimap', () => {
  const items = [
    { id: 'a', x: 0, z: 0, r: 6 },
    { id: 'b', x: 40, z: -10, r: 4 },
  ];
  const camera = { x: 0, z: 30, dirX: 0, dirZ: -1 };

  it('fits every galaxy and the camera inside the canvas', () => {
    const m = minimapLayout(items, camera, 160);
    for (const d of m.dots) {
      expect(d.px - d.pr).toBeGreaterThanOrEqual(0);
      expect(d.px + d.pr).toBeLessThanOrEqual(160);
      expect(d.py - d.pr).toBeGreaterThanOrEqual(0);
      expect(d.py + d.pr).toBeLessThanOrEqual(160);
    }
    expect(m.camera.px).toBeGreaterThanOrEqual(0);
    expect(m.camera.py).toBeLessThanOrEqual(160);
    expect(m.camera.angle).toBeCloseTo(-Math.PI / 2);
  });

  it('hit-tests clicks on dots', () => {
    const m = minimapLayout(items, camera, 160);
    const b = m.dots.find((d) => d.id === 'b');
    expect(minimapHit(m.dots, b.px, b.py)).toBe('b');
    expect(minimapHit(m.dots, 0, 159)).toBeNull();
  });
});
