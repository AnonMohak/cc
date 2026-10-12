/**
 * Tileable 3D noise for the intro disc (Gargantua), baked once. Two
 * channels: R = 4-octave value-noise fbm (cloud detail), G = 2-octave
 * low-frequency fbm (the large dark dust clumps). Every octave's lattice
 * period divides the size, so the texture tiles seamlessly on all axes
 * (RepeatWrapping). Pure: no three.js, so it can run in a worker later.
 */

/** Texels per side. */
export const NOISE3D_SIZE = 96;

// Lattice value in 0–1 at integer cell (x, y, z), wrapped to the period.
function lattice(x, y, z, period, seed) {
  const xi = ((x % period) + period) % period;
  const yi = ((y % period) + period) % period;
  const zi = ((z % period) + period) % period;
  let h = Math.imul(xi, 0x27d4eb2d) ^ Math.imul(yi, 0x165667b1) ^ Math.imul(zi, 0x9e3779b1) ^ Math.imul(seed + period, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);

/** Periodic value noise (0–1) at a point given in lattice cells. */
export function valueNoise(x, y, z, period, seed = 1) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const fz = fade(z - z0);
  const c = (dx, dy, dz) => lattice(x0 + dx, y0 + dy, z0 + dz, period, seed);
  const x00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * fx;
  const x10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * fx;
  const x01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * fx;
  const x11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * fx;
  const y0v = x00 + (x10 - x00) * fy;
  const y1v = x01 + (x11 - x01) * fy;
  return y0v + (y1v - y0v) * fz;
}

/** fbm (0–1) at texel (x, y, z) of a size³ texture; base period in cells. */
export function fbm(x, y, z, size, basePeriod, octaves, seed) {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    const k = period / size;
    sum += amp * valueNoise(x * k, y * k, z * k, period, seed + o * 7919);
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

// One octave's lattice values (period³), x fastest.
function latticeTable(period, seed) {
  const t = new Float32Array(period * period * period);
  let i = 0;
  for (let z = 0; z < period; z++) for (let y = 0; y < period; y++) for (let x = 0; x < period; x++) t[i++] = lattice(x, y, z, period, seed);
  return t;
}

// fbm over a whole size³ grid from precomputed lattices (same values as fbm()).
function fbmGrid(size, basePeriod, octaves, seed, out, channel, stride) {
  const tables = [];
  let norm = 0;
  for (let o = 0, amp = 1, period = basePeriod; o < octaves; o++, amp *= 0.5, period *= 2) {
    tables.push({ table: latticeTable(period, seed + o * 7919), period, amp, k: period / size });
    norm += amp;
  }
  const sums = new Float32Array(size * size * size);
  for (const { table, period, amp, k } of tables) {
    const pp = period * period;
    // Per-axis cell index and fade weight (the same for x, y and z).
    const i0 = new Int32Array(size);
    const i1 = new Int32Array(size);
    const w = new Float32Array(size);
    for (let a = 0; a < size; a++) {
      const v = a * k;
      const f = Math.floor(v);
      i0[a] = f % period;
      i1[a] = (f + 1) % period;
      w[a] = fade(v - f);
    }
    let i = 0;
    for (let z = 0; z < size; z++) {
      const z0 = i0[z] * pp;
      const z1 = i1[z] * pp;
      const fz = w[z];
      for (let y = 0; y < size; y++) {
        const y0 = i0[y] * period;
        const y1 = i1[y] * period;
        const fy = w[y];
        for (let x = 0; x < size; x++, i++) {
          const x0 = i0[x];
          const x1 = i1[x];
          const fx = w[x];
          const a00 = table[z0 + y0 + x0] + (table[z0 + y0 + x1] - table[z0 + y0 + x0]) * fx;
          const a10 = table[z0 + y1 + x0] + (table[z0 + y1 + x1] - table[z0 + y1 + x0]) * fx;
          const a01 = table[z1 + y0 + x0] + (table[z1 + y0 + x1] - table[z1 + y0 + x0]) * fx;
          const a11 = table[z1 + y1 + x0] + (table[z1 + y1 + x1] - table[z1 + y1 + x0]) * fx;
          const b0 = a00 + (a10 - a00) * fy;
          const b1 = a01 + (a11 - a01) * fy;
          sums[i] += amp * (b0 + (b1 - b0) * fz);
        }
      }
    }
  }
  for (let i = 0; i < sums.length; i++) out[i * stride + channel] = Math.round((255 * sums[i]) / norm);
}

/**
 * The texture data: RG bytes, x fastest (Data3DTexture order).
 * @param {number} [size]
 * @param {number} [seed]
 */
export function bakeNoise3d(size = NOISE3D_SIZE, seed = 4500) {
  const data = new Uint8Array(size * size * size * 2);
  fbmGrid(size, 6, 4, seed, data, 0, 2);
  fbmGrid(size, 3, 2, seed + 101, data, 1, 2);
  return data;
}
