/**
 * Background sky: the Milky Way as seen from inside a disc galaxy. PURE model
 * (`skyRadiance`) baked once into an equirectangular texture, so drawing the
 * sky costs one texture fetch per pixel.
 *
 * Features (from all-sky photos of the Milky Way):
 *   - a band along the galactic plane, thicker and brighter toward the
 *     galactic centre, with a small bulge;
 *   - patchy star clouds along the band;
 *   - a dark dust rift down the middle of the band (the "Great Rift");
 *   - faint red H II and blue reflection nebulae close to the plane.
 * Kept dim (well under the bloom threshold) so it never competes with the
 * galaxies.
 */

// Plain vectors (no three.js): this module also runs in the bake worker.
const normalize = ([x, y, z]) => {
  const n = Math.hypot(x, y, z);
  return { x: x / n, y: y / n, z: z / n };
};
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Direction of the galactic centre: in the home view, behind and below the first galaxy. */
export const SKY_CENTER = normalize([0.3, -0.5, -0.81]);
/** Galactic north pole: perpendicular to SKY_CENTER, tilted so the band crosses the view. */
export const SKY_POLE = (() => {
  const v = { x: 0.85, y: 0.35, z: 0.1 };
  const k = dot(v, SKY_CENTER);
  return normalize([v.x - k * SKY_CENTER.x, v.y - k * SKY_CENTER.y, v.z - k * SKY_CENTER.z]);
})();
const SKY_EAST = normalize([
  SKY_POLE.y * SKY_CENTER.z - SKY_POLE.z * SKY_CENTER.y,
  SKY_POLE.z * SKY_CENTER.x - SKY_POLE.x * SKY_CENTER.z,
  SKY_POLE.x * SKY_CENTER.y - SKY_POLE.y * SKY_CENTER.x,
]);

export const SKY_MAP_WIDTH = 1024;
export const SKY_MAP_HEIGHT = 512;

// ── 3D value noise on the sphere (no seam, no pinch at the poles) ──────────
function hash3(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  let fx = x - xi;
  let fy = y - yi;
  let fz = z - zi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash3(xi, yi, zi);
  const b = hash3(xi + 1, yi, zi);
  const c = hash3(xi, yi + 1, zi);
  const d = hash3(xi + 1, yi + 1, zi);
  const e = hash3(xi, yi, zi + 1);
  const f = hash3(xi + 1, yi, zi + 1);
  const g = hash3(xi, yi + 1, zi + 1);
  const h = hash3(xi + 1, yi + 1, zi + 1);
  const x00 = a + (b - a) * fx;
  const x10 = c + (d - c) * fx;
  const x01 = e + (f - e) * fx;
  const x11 = g + (h - g) * fx;
  const y0 = x00 + (x10 - x00) * fy;
  const y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

/** fbm in [0, 1], mean ≈ 0.5. */
function fbm(x, y, z, octaves) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x, y, z);
    norm += amp;
    x *= 2.03;
    y *= 2.03;
    z *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Galactic latitude b and longitude l (radians; l = 0 at the centre).
 * @param {number} x @param {number} y @param {number} z unit direction
 */
export function galacticCoords(x, y, z) {
  const sinB = x * SKY_POLE.x + y * SKY_POLE.y + z * SKY_POLE.z;
  const c = x * SKY_CENTER.x + y * SKY_CENTER.y + z * SKY_CENTER.z;
  const e = x * SKY_EAST.x + y * SKY_EAST.y + z * SKY_EAST.z;
  return { b: Math.asin(Math.max(-1, Math.min(1, sinB))), l: Math.atan2(e, c) };
}

/**
 * Linear RGB sky radiance in a unit direction (before the global intensity).
 * @returns {[number, number, number]}
 */
export function skyRadiance(x, y, z) {
  const { b, l } = galacticCoords(x, y, z);
  const ab = Math.abs(b);
  const al = Math.abs(l);
  const toCentre = Math.exp(-al / 1.1);

  // Band: exponential in latitude, thicker toward the centre.
  const width = 0.07 + 0.07 * toCentre;
  let band = Math.exp(-ab / width) * (0.3 + 0.7 * toCentre);
  // Small bulge around the centre.
  band += 0.6 * Math.exp(-(l * l + b * b * 2.2) / (2 * 0.11 * 0.11));
  // Far from the plane nothing below is visible: skip the noise (half the bake time).
  if (ab > 0.9) return [band * 0.82, band * 0.84, band];

  // Star clouds: patchy brightness along the band.
  const clouds = fbm(x * 7 + 11, y * 7, z * 7, 4);
  band *= 0.35 + 1.3 * clouds;

  // Dust rift: a wavering dark lane down the middle, broken up by noise.
  const centreLine = 0.012 * Math.sin(3 * l) + 0.008 * Math.sin(7.3 * l + 1);
  const riftW = 0.016 + 0.01 * toCentre;
  const db = b - centreLine;
  const rift = Math.exp(-(db * db) / (2 * riftW * riftW)) * smoothstep(2.4, 0.6, al);
  // Fine, broken filaments rather than solid blobs.
  const tatter = fbm(x * 26 - 5, y * 26, z * 26 + 3, 3);
  band *= 1 - 0.7 * rift * smoothstep(0.35, 0.65, tatter);

  // Colour: warm toward the old bulge, blue-white in the outer disc.
  const warm = toCentre;
  let r = band * (0.82 + 0.18 * warm);
  let g = band * (0.84 + 0.04 * warm);
  let bl = band * (1.0 - 0.28 * warm);

  // Nebulae close to the plane: red H II (Hα) and faint blue reflection clouds.
  // Faded to 0 before |b| = 0.9, where the early return above skips this.
  const nearPlane = Math.exp(-ab / 0.22) * smoothstep(0.9, 0.6, ab);
  const red = smoothstep(0.6, 0.78, fbm(x * 3.1 + 40, y * 3.1, z * 3.1 - 7, 3)) * nearPlane;
  const blue = smoothstep(0.62, 0.8, fbm(x * 2.7 - 23, y * 2.7 + 9, z * 2.7, 3)) * nearPlane;
  r += 0.55 * red + 0.08 * blue;
  g += 0.1 * red + 0.14 * blue;
  bl += 0.16 * red + 0.32 * blue;

  return [r, g, bl];
}

/** Linear → sRGB 8-bit (dark gradients need sRGB precision). */
function toSrgb8(v) {
  const c = Math.min(1, Math.max(0, v));
  const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

/** Peak linear radiance stored as 1.0 in the texture; the shader scales it back. */
export const SKY_MAP_SCALE = 2.2;

/**
 * Bake the sky into an equirectangular RGBA8 array (sRGB). Pure.
 * Texel (i, j): longitude u = (i + 0.5)/w·2π − π, latitude v = π/2 − (j + 0.5)/h·π,
 * matching the sky shader's direction → uv mapping.
 */
export function bakeSkyMap(width = SKY_MAP_WIDTH, height = SKY_MAP_HEIGHT) {
  const data = new Uint8Array(width * height * 4);
  for (let j = 0; j < height; j++) {
    const lat = Math.PI / 2 - ((j + 0.5) / height) * Math.PI;
    const cl = Math.cos(lat);
    const y = Math.sin(lat);
    for (let i = 0; i < width; i++) {
      const lon = ((i + 0.5) / width) * 2 * Math.PI - Math.PI;
      const [r, g, b] = skyRadiance(cl * Math.cos(lon), y, cl * Math.sin(lon));
      const k = (j * width + i) * 4;
      data[k] = toSrgb8(r / SKY_MAP_SCALE);
      data[k + 1] = toSrgb8(g / SKY_MAP_SCALE);
      data[k + 2] = toSrgb8(b / SKY_MAP_SCALE);
      data[k + 3] = 255;
    }
  }
  return data;
}

/**
 * Density weight for background stars: more stars along the band, like the
 * real sky. In [0.35, 1].
 */
export function starDensity(x, y, z) {
  const { b, l } = galacticCoords(x, y, z);
  return 0.35 + 0.65 * Math.exp(-Math.abs(b) / (0.12 + 0.08 * Math.exp(-Math.abs(l) / 1.1)));
}
