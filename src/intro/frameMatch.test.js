import { describe, it, expect } from 'vitest';
import {
  luma,
  imageFromBytes,
  boxBlur,
  halve,
  shapeMask,
  ssim,
  frameStats,
  scoreFrame,
  toneStats,
  toneScore,
  colourStats,
  colourScore,
  detailStats,
  detailScore,
  orientationStats,
  orientationScore,
  fitCircle,
  ransacCircle,
  ransacLine,
  horizonLine,
  shadowRegion,
  trackTemplate,
  crop,
  blockFlow,
  halveImage,
  motionScore,
} from './frameMatch.js';

const W = 96;
const H = 54;

/** An image from a function (x, y) → [r, g, b] (0–1). */
function make(fn, w = W, h = H) {
  const rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x, y);
      rgb.set(c, 3 * (y * w + x));
    }
  }
  return { w, h, rgb };
}

const grey = (v) => [v, v, v];
// A dark disc on a bright frame (a shadow), centre (cx, cy), radius r (px).
const disc = (cx, cy, r) => make((x, y) => grey(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r ? 0.05 : 0.9));
// Smooth pseudo-random texture, so SSIM has structure to compare.
const texture = (seed) => make((x, y) => grey(0.5 + 0.3 * Math.sin(x * 0.37 + seed) * Math.cos(y * 0.51 + 2 * seed)));

describe('basics', () => {
  it('luma weighs the channels by Rec. 709', () => {
    const y = luma(make(() => [1, 0, 0], 2, 2));
    expect(y[0]).toBeCloseTo(0.2126, 4);
  });

  it('reads RGBA bytes', () => {
    const img = imageFromBytes([255, 0, 0, 255, 0, 255, 0, 255], 2, 1, 4);
    expect(Array.from(img.rgb)).toEqual([1, 0, 0, 0, 1, 0]);
  });

  it('box blur keeps a flat image and spreads an impulse', () => {
    expect(Array.from(boxBlur(new Float32Array(25).fill(0.4), 5, 5, 1)).every((v) => Math.abs(v - 0.4) < 1e-6)).toBe(true);
    const impulse = new Float32Array(49);
    impulse[24] = 9;
    const b = boxBlur(impulse, 7, 7, 1);
    expect(b[24]).toBeCloseTo(1, 5);
    expect(b[16]).toBeCloseTo(1, 5);
    expect(b[0]).toBe(0);
  });

  it('halve averages 2 × 2 blocks and their mask', () => {
    const { data, w, h, mask } = halve(Float32Array.from([1, 3, 0, 0, 1, 3, 0, 0]), 4, 2, Uint8Array.from([1, 1, 1, 0, 1, 1, 1, 1]));
    expect([w, h]).toEqual([2, 1]);
    expect(Array.from(data)).toEqual([2, 0]);
    expect(Array.from(mask)).toEqual([1, 0]);
  });

  it('shape masks keep polygons and cut circles', () => {
    const m = shapeMask(10, 10, { keep: [[[0, 0], [0.5, 0], [0.5, 1], [0, 1]]], cut: [{ u: 0.25, v: 0.5, r: 0.1 }] });
    expect(m[5 * 10 + 8]).toBe(0); // right half: not kept
    expect(m[1 * 10 + 1]).toBe(1);
    expect(m[5 * 10 + 2]).toBe(0); // inside the cut circle
  });
});

describe('score', () => {
  it('ssim is 1 for the same image and lower for another', () => {
    const a = luma(texture(1));
    expect(ssim(a, a, W, H)).toBeCloseTo(1, 5);
    expect(ssim(a, luma(texture(4)), W, H)).toBeLessThan(0.5);
  });

  it('a frame scores 1 against itself', () => {
    const s = frameStats(texture(2));
    const r = scoreFrame(s, s);
    for (const v of Object.values(r)) expect(v).toBeCloseTo(1, 5);
  });

  it('a shadow in the wrong place scores lower than one close by', () => {
    const film = frameStats(disc(30, 27, 15));
    const near = scoreFrame(film, frameStats(disc(32, 27, 15)));
    const far = scoreFrame(film, frameStats(disc(70, 27, 15)));
    expect(near.shape).toBeGreaterThan(far.shape);
    expect(near.total).toBeGreaterThan(far.total);
  });

  it('tone falls with brightness', () => {
    const a = toneStats(luma(make(() => grey(0.2))), W, H);
    expect(toneScore(a, a)).toBe(1);
    expect(toneScore(a, toneStats(luma(make(() => grey(0.3))), W, H))).toBeCloseTo(0.6, 3);
    expect(toneScore(a, toneStats(luma(make(() => grey(0.9))), W, H))).toBe(0);
  });

  it('colour tells orange from blue but ignores the dark band', () => {
    const orange = make(() => [0.9, 0.5, 0.2]);
    const blue = make(() => [0.3, 0.5, 0.9]);
    const sa = colourStats(orange, luma(orange));
    expect(colourScore(sa, sa)).toBe(1);
    expect(colourScore(sa, colourStats(blue, luma(blue)))).toBeLessThan(0.1);
    // Dark teal against black: neither is in a counted band.
    const teal = make(() => [0.05, 0.2, 0.22]);
    const black = make(() => grey(0));
    expect(colourScore(colourStats(teal, luma(teal)), colourStats(black, luma(black)))).toBe(1);
  });

  it('detail tells texture from a flat image', () => {
    const t = luma(texture(3));
    const flat = luma(make(() => grey(0.5)));
    const dt = detailStats(t, W, H);
    expect(detailScore(dt, dt)).toBe(1);
    expect(detailScore(dt, detailStats(flat, W, H))).toBeLessThan(0.3);
  });

  it('streaks: vertical stripes do not match horizontal ones', () => {
    const v = luma(make((x) => grey(0.5 + 0.4 * Math.sin(x * 0.9))));
    const hz = luma(make((x, y) => grey(0.5 + 0.4 * Math.sin(y * 0.9))));
    const ov = orientationStats(v, W, H);
    expect(orientationScore(ov, ov)).toBeCloseTo(1, 5);
    expect(orientationScore(ov, orientationStats(hz, W, H))).toBeLessThan(0.05);
  });
});

describe('features', () => {
  const circle = (cx, cy, r, n) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);

  it('fits a circle exactly and through outliers', () => {
    const c = fitCircle(circle(40, 30, 20, 30));
    expect(c.cx).toBeCloseTo(40, 6);
    expect(c.cy).toBeCloseTo(30, 6);
    expect(c.r).toBeCloseTo(20, 6);
    // A half arc plus a blob of other bright points.
    const arc = circle(40, 30, 20, 120).slice(0, 60);
    const blob = Array.from({ length: 25 }, (_, i) => [5 + (i % 5), 5 + Math.floor(i / 5)]);
    const r = ransacCircle([...arc, ...blob], { tol: 1, rMin: 10, rMax: 40 });
    expect(r.cx).toBeCloseTo(40, 3);
    expect(r.r).toBeCloseTo(20, 3);
  });

  it('fits a line through outliers', () => {
    const pts = Array.from({ length: 40 }, (_, i) => [i, 0.1 * i + 7]);
    pts.push([3, 40], [9, 1], [20, 33]);
    const l = ransacLine(pts);
    expect(l.slope).toBeCloseTo(0.1, 6);
    expect(l.offset).toBeCloseTo(7, 6);
  });

  it('finds the thin bright line', () => {
    const y = luma(make((x, yy) => grey(yy === 20 ? 0.8 : 0.05)));
    const line = horizonLine(y, W, H);
    expect(line.v).toBeCloseTo(20.5 / H, 4);
    expect(line.tilt).toBeCloseTo(0, 6);
  });

  it('measures a dark shadow and leaves the frame border out of the fit', () => {
    // Centre off the frame's left edge: only the right part of the edge counts.
    const y = luma(disc(-5, 27, 30));
    const s = shadowRegion(y, W, H, [1, 27]);
    expect(s.r).toBeCloseTo(30 / H, 1);
    expect(s.cx).toBeCloseTo(-5 / H, 1);
    expect(shadowRegion(y, W, H, [90, 5])).toBeNull();
  });

  it('tracks a pattern and measures image motion', () => {
    const a = luma(texture(5));
    const shifted = luma(make((x, y) => {
      const v = 0.5 + 0.3 * Math.sin((x - 3) * 0.37 + 5) * Math.cos((y - 2) * 0.51 + 10);
      return grey(v);
    }));
    const t = crop(a, W, 40, 20, 12, 10);
    const hit = trackTemplate(shifted, W, H, t, 12, 10, 40, 20, 6);
    expect([hit.x, hit.y]).toEqual([43, 22]);
    const flow = blockFlow(a, shifted, W, H, { grid: 2, search: 5 });
    expect(flow.filter(Boolean).every(([dx, dy]) => dx === 3 && dy === 2)).toBe(true);
  });
});

describe('helpers', () => {
  it('halves an image by 2 × 2 means', () => {
    const img = { w: 2, h: 2, rgb: Float32Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1]) };
    const half = halveImage(img);
    expect([half.w, half.h]).toEqual([1, 1]);
    expect(Array.from(half.rgb)).toEqual([0.5, 0.25, 0.25]);
  });

  it('scores motion by how far the shifts differ', () => {
    expect(motionScore([[1, 0], [2, 2], null], [[1, 0], [2, 2], [5, 5]])).toBe(1);
    expect(motionScore([[0, 0]], [[4, 0]], 4)).toBeCloseTo(Math.exp(-1), 6);
    expect(motionScore([null], [[1, 1]])).toBeNaN();
  });
});
