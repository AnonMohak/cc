/**
 * Minimal animated GIF89a encoder (no dependencies).
 *
 *   const palette = buildPalette(rgbaFrames);        // median cut, ≤256 colours
 *   const index = createIndexer(palette);
 *   const frames = rgbaFrames.map((f) => indexFrame(f, index));
 *   const bytes = encodeGif({ width, height, palette, frames, delaysCs });
 */

/**
 * Median-cut palette over a sample of pixels from all frames.
 * @param {Uint8ClampedArray[]} rgbaFrames
 * @returns {Uint8Array} palette, 3 bytes per colour, length 768 (padded)
 */
export function buildPalette(rgbaFrames, maxColors = 256, maxSamples = 60_000) {
  const total = rgbaFrames.reduce((n, f) => n + f.length / 4, 0);
  const step = Math.max(1, Math.floor(total / maxSamples));
  const pixels = [];
  let k = 0;
  for (const f of rgbaFrames) {
    for (let i = 0; i < f.length; i += 4) {
      if (k++ % step === 0) pixels.push([f[i], f[i + 1], f[i + 2]]);
    }
  }
  let boxes = [pixels.length ? pixels : [[0, 0, 0]]];
  while (boxes.length < maxColors) {
    // Split the box with the widest channel range.
    let bestBox = -1;
    let bestRange = 0;
    let bestChannel = 0;
    boxes.forEach((box, b) => {
      if (box.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 255;
        let hi = 0;
        for (const p of box) {
          if (p[c] < lo) lo = p[c];
          if (p[c] > hi) hi = p[c];
        }
        if (hi - lo > bestRange) {
          bestRange = hi - lo;
          bestBox = b;
          bestChannel = c;
        }
      }
    });
    if (bestBox < 0) break;
    const box = boxes[bestBox].sort((a, b) => a[bestChannel] - b[bestChannel]);
    const mid = box.length >> 1;
    boxes.splice(bestBox, 1, box.slice(0, mid), box.slice(mid));
  }
  const palette = new Uint8Array(768);
  boxes.forEach((box, i) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const p of box) {
      r += p[0];
      g += p[1];
      b += p[2];
    }
    palette[i * 3] = Math.round(r / box.length);
    palette[i * 3 + 1] = Math.round(g / box.length);
    palette[i * 3 + 2] = Math.round(b / box.length);
  });
  return palette;
}

/**
 * Nearest-palette-colour lookup, cached on a 5-bit-per-channel grid
 * (32,768 entries) so indexing a frame is one table read per pixel.
 * @param {Uint8Array} palette
 */
export function createIndexer(palette) {
  const cache = new Int16Array(32768).fill(-1);
  const colors = palette.length / 3;
  return (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let idx = cache[key];
    if (idx < 0) {
      let best = Infinity;
      for (let i = 0; i < colors; i++) {
        const dr = palette[i * 3] - r;
        const dg = palette[i * 3 + 1] - g;
        const db = palette[i * 3 + 2] - b;
        const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
        if (d < best) {
          best = d;
          idx = i;
        }
      }
      cache[key] = idx;
    }
    return idx;
  };
}

// 4×4 Bayer matrix, centred on 0 (values −7.5…+7.5).
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v - 7.5);
const DITHER_STRENGTH = 1.2;

/**
 * RGBA pixels → palette indices. With `width`, applies ordered dithering so
 * smooth glows do not band into rings; it fades out near black so empty sky
 * stays clean.
 */
export function indexFrame(rgba, indexer, width = 0) {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    let r = rgba[i];
    let g = rgba[i + 1];
    let b = rgba[i + 2];
    if (width > 0) {
      const peak = Math.max(r, g, b);
      const fade = peak < 6 ? 0 : peak < 24 ? (peak - 6) / 18 : 1;
      const d = BAYER[((Math.floor(j / width) & 3) << 2) | (j % width & 3)] * DITHER_STRENGTH * fade;
      r = clamp255(r + d);
      g = clamp255(g + d);
      b = clamp255(b + d);
    }
    out[j] = indexer(r, g, b);
  }
  return out;
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

/**
 * @param {{ width: number, height: number, palette: Uint8Array, frames: Uint8Array[], delaysCs: number[], loop?: number }} opts
 *   palette: 768 bytes (256 colours); delaysCs: per-frame delay in 1/100 s
 * @returns {Uint8Array}
 */
export function encodeGif({ width, height, palette, frames, delaysCs, loop = 0 }) {
  const out = new ByteWriter();
  out.str('GIF89a');
  out.u16(width);
  out.u16(height);
  out.u8(0xf7); // global colour table, 8 bits/channel, 256 entries
  out.u8(0); // background colour index
  out.u8(0); // pixel aspect ratio
  out.bytes(palette.subarray(0, 768));
  // NETSCAPE2.0 application extension: loop count (0 = forever).
  out.bytes([0x21, 0xff, 0x0b]);
  out.str('NETSCAPE2.0');
  out.bytes([0x03, 0x01]);
  out.u16(loop);
  out.u8(0);

  frames.forEach((indices, f) => {
    // Graphic control extension: delay, no transparency.
    out.bytes([0x21, 0xf9, 0x04, 0x00]);
    out.u16(Math.max(2, Math.round(delaysCs[f] ?? 10)));
    out.bytes([0x00, 0x00]);
    // Image descriptor.
    out.u8(0x2c);
    out.u16(0);
    out.u16(0);
    out.u16(width);
    out.u16(height);
    out.u8(0);
    // Image data: LZW with 8-bit minimum code size, in ≤255-byte sub-blocks.
    out.u8(8);
    const data = lzwEncode(indices, 8);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.subarray(i, i + 255);
      out.u8(chunk.length);
      out.bytes(chunk);
    }
    out.u8(0);
  });
  out.u8(0x3b); // trailer
  return out.result();
}

/** GIF-flavoured LZW (variable code size, clear/EOI codes, LSB-first). */
export function lzwEncode(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const bits = new BitWriter();
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let dict = new Map();

  bits.write(clear, codeSize);
  if (indices.length === 0) {
    bits.write(eoi, codeSize);
    return bits.result();
  }
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 256 + k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    bits.write(prefix, codeSize);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      // Table full: reset so compression keeps adapting.
      bits.write(clear, codeSize);
      dict = new Map();
      codeSize = minCodeSize + 1;
      next = eoi + 1;
    }
    prefix = k;
  }
  bits.write(prefix, codeSize);
  bits.write(eoi, codeSize);
  return bits.result();
}

class BitWriter {
  constructor() {
    this.bytes = [];
    this.acc = 0;
    this.n = 0;
  }
  write(code, size) {
    this.acc |= code << this.n;
    this.n += size;
    while (this.n >= 8) {
      this.bytes.push(this.acc & 0xff);
      this.acc >>>= 8;
      this.n -= 8;
    }
  }
  result() {
    if (this.n > 0) this.bytes.push(this.acc & 0xff);
    return Uint8Array.from(this.bytes);
  }
}

class ByteWriter {
  constructor() {
    this.chunks = [];
  }
  u8(v) {
    this.chunks.push(v & 0xff);
  }
  u16(v) {
    this.chunks.push(v & 0xff, (v >> 8) & 0xff);
  }
  str(s) {
    for (let i = 0; i < s.length; i++) this.chunks.push(s.charCodeAt(i));
  }
  bytes(arr) {
    for (const b of arr) this.chunks.push(b);
  }
  result() {
    return Uint8Array.from(this.chunks);
  }
}
