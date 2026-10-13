import { describe, it, expect } from 'vitest';
import { shotNumberFromName, contentBounds } from './tunerMath.js';

describe('shotNumberFromName', () => {
  it('takes the last number before the extension', () => {
    expect(shotNumberFromName('7.jpg')).toBe(7);
    expect(shotNumberFromName('shot-10.png')).toBe(10);
    expect(shotNumberFromName('2024_clip_03.jpeg')).toBe(3);
    expect(shotNumberFromName('reference.jpg')).toBeNull();
  });

  it('maps the clip frames to their shots and skips the rest', () => {
    expect(shotNumberFromName('frame_001.png')).toBe(1);
    expect(shotNumberFromName('frame_006.png')).toBe(5);
    expect(shotNumberFromName('frame_018.png')).toBe(8);
    expect(shotNumberFromName('frame_026.png')).toBe(10);
    expect(shotNumberFromName('frame_007.png')).toBeNull();
  });
});

describe('contentBounds', () => {
  // A 20×10 image: grey bars 3 px wide at the sides, a varied picture inside.
  function image() {
    const w = 20;
    const h = 10;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = x < 3 || x >= 17 ? 128 : (x * 37 + y * 91) % 256;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    return { data, w, h };
  }

  it('finds the picture inside flat side bars', () => {
    const { data, w, h } = image();
    expect(contentBounds(data, w, h)).toEqual({ x0: 3, y0: 0, x1: 17, y1: 10 });
  });

  it('keeps the whole image when it is flat', () => {
    const data = new Uint8ClampedArray(8 * 8 * 4).fill(100);
    expect(contentBounds(data, 8, 8)).toEqual({ x0: 0, y0: 0, x1: 8, y1: 8 });
  });
});
