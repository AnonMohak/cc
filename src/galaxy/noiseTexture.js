import * as THREE from 'three';
import { createRandom } from './random.js';

/**
 * Shared tileable 2D fbm noise for the volume shader (replaces two
 * procedural 3D fbm calls per raymarch step with one texture fetch).
 *   R = flocculence (feathers and fragments in the disc light)
 *   G = dust filaments
 * Values are fbm in [0, 1] with mean ≈ 0.5, like the old gn_fbm.
 */

export const NOISE_SIZE = 256;
/** Unit-space distance covered by one tile, and lattice cells per tile (7 per unit). */
export const NOISE_TILE_UNITS = 2;
export const NOISE_BASE_CELLS = 14;
const OCTAVES = 4;

/** Periodic value noise: a `period`×`period` lattice that wraps. */
function latticeNoise(rng, period) {
  const lattice = new Float32Array(period * period);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (a, b) => lattice[(((b % period) + period) % period) * period + (((a % period) + period) % period)];
    const top = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
    const bottom = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
    return top + (bottom - top) * sy;
  };
}

/** Tileable fbm channel as floats in [0, 1]. Pure and seeded. */
export function fbmTile(seed, size = NOISE_SIZE, baseCells = NOISE_BASE_CELLS, octaves = OCTAVES) {
  const rng = createRandom(seed);
  const layers = Array.from({ length: octaves }, (_, o) => latticeNoise(rng, baseCells << o));
  const out = new Float32Array(size * size);
  let norm = 0;
  for (let o = 0; o < octaves; o++) norm += 0.5 ** (o + 1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let o = 0; o < octaves; o++) {
        const cells = baseCells << o;
        sum += 0.5 ** (o + 1) * layers[o]((x / size) * cells, (y / size) * cells);
      }
      out[y * size + x] = sum / norm;
    }
  }
  return out;
}

let shared = null;

/** The one noise texture all galaxies share (created on first use). */
export function getNoiseTexture() {
  if (shared) return shared;
  const a = fbmTile(9001);
  const b = fbmTile(4242);
  const data = new Uint8Array(NOISE_SIZE * NOISE_SIZE * 4);
  for (let i = 0; i < a.length; i++) {
    data[i * 4] = Math.round(a[i] * 255);
    data[i * 4 + 1] = Math.round(b[i] * 255);
    data[i * 4 + 3] = 255;
  }
  shared = new THREE.DataTexture(data, NOISE_SIZE, NOISE_SIZE, THREE.RGBAFormat);
  shared.wrapS = THREE.RepeatWrapping;
  shared.wrapT = THREE.RepeatWrapping;
  shared.minFilter = THREE.LinearMipmapLinearFilter;
  shared.magFilter = THREE.LinearFilter;
  shared.generateMipmaps = true;
  shared.needsUpdate = true;
  return shared;
}
