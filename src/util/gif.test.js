import { describe, it, expect } from 'vitest';
import { buildPalette, createIndexer, indexFrame, encodeGif, lzwEncode } from './gif.js';

/** Reference GIF LZW decoder, written independently for the round-trip test. */
function lzwDecode(data, minCodeSize, pixelCount) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let dict = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict[i] = [i];
    dict[clear] = [];
    dict[eoi] = [];
    codeSize = minCodeSize + 1;
  };
  reset();
  const out = [];
  let bitPos = 0;
  const read = () => {
    let code = 0;
    for (let i = 0; i < codeSize; i++, bitPos++) {
      if ((data[bitPos >> 3] >> (bitPos & 7)) & 1) code |= 1 << i;
    }
    return code;
  };
  let prev = null;
  while (out.length < pixelCount) {
    const code = read();
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry;
    if (code < dict.length) entry = dict[code];
    else entry = [...prev, prev[0]];
    out.push(...entry);
    if (prev) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length === 1 << codeSize && codeSize < 12) codeSize++;
  }
  return out;
}

function gradientFrame(w, h, shift) {
  const f = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      f[i] = (x * 255) / w;
      f[i + 1] = ((y + shift) * 255) / h;
      f[i + 2] = 128;
      f[i + 3] = 255;
    }
  }
  return f;
}

describe('lzwEncode', () => {
  it('round-trips through an independent decoder, including table resets', () => {
    const indices = new Uint8Array(20000);
    for (let i = 0; i < indices.length; i++) indices[i] = (i * 7 + (i >> 5)) & 255;
    const decoded = lzwDecode(lzwEncode(indices, 8), 8, indices.length);
    expect(decoded).toEqual(Array.from(indices));
  });

  it('compresses flat images well', () => {
    expect(lzwEncode(new Uint8Array(10000), 8).length).toBeLessThan(400);
  });
});

describe('palette', () => {
  it('has at most 256 colours and maps pixels to close colours', () => {
    const frame = gradientFrame(64, 32, 0);
    const palette = buildPalette([frame]);
    expect(palette.length).toBe(768);
    const index = createIndexer(palette);
    const i = index(200, 100, 128);
    expect(Math.abs(palette[i * 3] - 200)).toBeLessThan(40);
    expect(Math.abs(palette[i * 3 + 1] - 100)).toBeLessThan(40);
  });

  it('keeps pure black exact (the space background)', () => {
    const frame = new Uint8ClampedArray(4 * 100).fill(0);
    for (let i = 3; i < frame.length; i += 4) frame[i] = 255;
    frame.set([255, 255, 255, 255], 0);
    const palette = buildPalette([frame]);
    const i = createIndexer(palette)(0, 0, 0);
    expect([...palette.subarray(i * 3, i * 3 + 3)]).toEqual([0, 0, 0]);
  });
});

describe('encodeGif', () => {
  it('writes a valid animated GIF89a whose frames decode back to the indices', () => {
    const w = 40;
    const h = 20;
    const rgba = [gradientFrame(w, h, 0), gradientFrame(w, h, 5)];
    const palette = buildPalette(rgba);
    const index = createIndexer(palette);
    const frames = rgba.map((f) => indexFrame(f, index));
    const gif = encodeGif({ width: w, height: h, palette, frames, delaysCs: [8, 8] });

    expect(String.fromCharCode(...gif.subarray(0, 6))).toBe('GIF89a');
    expect(gif[6] | (gif[7] << 8)).toBe(w);
    expect(gif[8] | (gif[9] << 8)).toBe(h);
    expect(gif[gif.length - 1]).toBe(0x3b);
    expect(String.fromCharCode(...gif.subarray(13 + 768 + 3, 13 + 768 + 14))).toBe('NETSCAPE2.0');

    // Walk the blocks and decode each frame.
    let p = 13 + 768 + 19;
    const decodedFrames = [];
    while (gif[p] !== 0x3b) {
      expect(gif[p]).toBe(0x21); // graphic control extension
      p += 8;
      expect(gif[p]).toBe(0x2c); // image descriptor
      p += 10;
      const minCode = gif[p++];
      const data = [];
      while (gif[p] !== 0) {
        const n = gif[p++];
        data.push(...gif.subarray(p, p + n));
        p += n;
      }
      p++;
      decodedFrames.push(lzwDecode(Uint8Array.from(data), minCode, w * h));
    }
    expect(decodedFrames).toEqual(frames.map((f) => Array.from(f)));
  });
});

describe('ordered dithering', () => {
  it('keeps black sky clean and spreads a smooth gradient over more colours', () => {
    const w = 64;
    const h = 8;
    const frame = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = x < 8 ? 0 : 40 + x; // black strip, then a faint ramp
        frame.set([v, v, v, 255], i);
      }
    }
    // A coarse 8-colour palette makes banding obvious.
    const palette = buildPalette([frame], 8);
    const index = createIndexer(palette);
    const plain = indexFrame(frame, index);
    const dithered = indexFrame(frame, index, w);
    const black = index(0, 0, 0);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < 8; x++) expect(dithered[y * w + x]).toBe(black);
    }
    // Dithering mixes neighbouring colours inside the ramp: more index changes per row.
    const changes = (arr) => {
      let n = 0;
      for (let x = 9; x < w; x++) if (arr[x] !== arr[x - 1]) n++;
      return n;
    };
    expect(changes(dithered)).toBeGreaterThan(changes(plain));
  });
});
