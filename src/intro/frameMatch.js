/**
 * How close one of our intro frames is to the film frame it must match:
 * plain image maths on small RGB frames (display values 0–1), used by the
 * measuring and fitting scripts in Node and in the browser. Pure.
 *
 * An image is { w, h, rgb: Float32Array(w · h · 3) }; a mask is a Uint8Array
 * (w · h) with 1 where a pixel counts (0: a spacecraft in the film frame).
 * Coordinates are pixels from the top-left; measured features are given as
 * shares of the frame height (u, v from the top-left; u in heights too).
 */

/** Luma of display values (Rec. 709 weights). */
export function luma(img) {
  const n = img.w * img.h;
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = 0.2126 * img.rgb[3 * i] + 0.7152 * img.rgb[3 * i + 1] + 0.0722 * img.rgb[3 * i + 2];
  return y;
}

/**
 * An image from 8-bit pixels (RGB or RGBA, rows top to bottom).
 * @param {ArrayLike<number>} bytes
 */
export function imageFromBytes(bytes, w, h, channels = 3) {
  const rgb = new Float32Array(w * h * 3);
  for (let i = 0, n = w * h; i < n; i++) {
    rgb[3 * i] = bytes[channels * i] / 255;
    rgb[3 * i + 1] = bytes[channels * i + 1] / 255;
    rgb[3 * i + 2] = bytes[channels * i + 2] / 255;
  }
  return { w, h, rgb };
}

/** Separable box blur of radius r (edges clamped). */
export function boxBlur(src, w, h, r) {
  if (r <= 0) return Float32Array.from(src);
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const k = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / k;
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / k;
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** Half size by 2 × 2 means (odd edges dropped); the mask keeps a pixel when all four count. */
export function halve(src, w, h, mask = null) {
  const w2 = w >> 1;
  const h2 = h >> 1;
  const data = new Float32Array(w2 * h2);
  const m2 = mask ? new Uint8Array(w2 * h2) : null;
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      const i = 2 * y * w + 2 * x;
      data[y * w2 + x] = 0.25 * (src[i] + src[i + 1] + src[i + w] + src[i + w + 1]);
      if (m2) m2[y * w2 + x] = mask[i] & mask[i + 1] & mask[i + w] & mask[i + w + 1];
    }
  }
  return { data, w: w2, h: h2, mask: m2 };
}

function insidePolygon(u, v, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ui, vi] = poly[i];
    const [uj, vj] = poly[j];
    if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) inside = !inside;
  }
  return inside;
}

/**
 * A mask from shapes in frame shares (u, v from the top-left, 0–1 of the
 * width and the height): `keep` polygons (when given, only pixels inside one
 * count) and `cut` circles { u, v, r } (r a share of the height) that never
 * count (a spacecraft).
 */
export function shapeMask(w, h, { keep = null, cut = [] } = {}) {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      let on = !keep || keep.some((poly) => insidePolygon(u, v, poly));
      for (const c of cut) if (on && ((u - c.u) * w) ** 2 + ((v - c.v) * h) ** 2 < (c.r * h) ** 2) on = false;
      mask[y * w + x] = on ? 1 : 0;
    }
  }
  return mask;
}

/**
 * Mean structural similarity of two images over the masked pixels (box
 * windows of radius r): 1 for the same picture, near 0 for unrelated ones.
 */
export function ssim(a, b, w, h, mask = null, r = 3) {
  const C1 = 0.01 ** 2;
  const C2 = 0.03 ** 2;
  const n = w * h;
  const aa = new Float32Array(n);
  const bb = new Float32Array(n);
  const ab = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    aa[i] = a[i] * a[i];
    bb[i] = b[i] * b[i];
    ab[i] = a[i] * b[i];
  }
  const ma = boxBlur(a, w, h, r);
  const mb = boxBlur(b, w, h, r);
  const saa = boxBlur(aa, w, h, r);
  const sbb = boxBlur(bb, w, h, r);
  const sab = boxBlur(ab, w, h, r);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (mask && !mask[i]) continue;
    const va = Math.max(saa[i] - ma[i] * ma[i], 0);
    const vb = Math.max(sbb[i] - mb[i] * mb[i], 0);
    const cov = sab[i] - ma[i] * mb[i];
    sum += ((2 * ma[i] * mb[i] + C1) * (2 * cov + C2)) / ((ma[i] * ma[i] + mb[i] * mb[i] + C1) * (va + vb + C2));
    count++;
  }
  return count ? sum / count : 0;
}

/**
 * Shape: where light and dark are, as the mean SSIM of the luma at three
 * scales (full, half, quarter), lightly blurred so grain and the exact
 * clump pattern do not count, only the forms.
 */
export function shapeScore(ya, yb, w, h, mask = null) {
  let a = { data: boxBlur(ya, w, h, 1), w, h, mask };
  let b = { data: boxBlur(yb, w, h, 1), w, h, mask };
  let sum = 0;
  for (let s = 0; s < 3; s++) {
    sum += Math.max(0, ssim(a.data, b.data, a.w, a.h, a.mask, 3));
    if (s < 2) {
      const m = a.mask;
      a = halve(a.data, a.w, a.h, m);
      b = halve(b.data, b.w, b.h, m);
    }
  }
  return sum / 3;
}

/** Quantiles (0–1 each) of the masked values. */
export function quantiles(values, mask, qs) {
  const list = [];
  for (let i = 0; i < values.length; i++) if (!mask || mask[i]) list.push(values[i]);
  if (!list.length) return qs.map(() => NaN);
  list.sort((x, y) => x - y);
  return qs.map((q) => list[Math.min(list.length - 1, Math.floor(q * list.length))]);
}

const TONE_Q = [0.1, 0.5, 0.9];

/**
 * Light and dark: the luma's 10th, 50th and 90th percentiles over the frame
 * and in each cell of a grid × grid split.
 */
export function toneStats(y, w, h, mask = null, grid = 3) {
  const cells = [];
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const x0 = Math.floor((gx * w) / grid);
      const x1 = Math.floor(((gx + 1) * w) / grid);
      const y0 = Math.floor((gy * h) / grid);
      const y1 = Math.floor(((gy + 1) * h) / grid);
      const vals = [];
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) if (!mask || mask[yy * w + xx]) vals.push(y[yy * w + xx]);
      cells.push(vals.length > 16 ? quantiles(vals, null, TONE_Q) : null);
    }
  }
  return { all: quantiles(y, mask, TONE_Q), cells };
}

/** 1 for the same light and dark, 0 when the percentiles differ by 0.25 on average. */
export function toneScore(sa, sb) {
  let diff = 0;
  let n = 0;
  const add = (qa, qb, weight) => {
    if (!qa || !qb) return;
    for (let i = 0; i < qa.length; i++) {
      diff += weight * Math.abs(qa[i] - qb[i]);
      n += weight;
    }
  };
  add(sa.all, sb.all, 3);
  for (let i = 0; i < sa.cells.length; i++) add(sa.cells[i], sb.cells[i], 1);
  return n ? Math.max(0, 1 - diff / n / 0.25) : 0;
}

/** Luma bands for the colour: middle and bright (the dark band does not count: the shadow and sky stay black). */
export const COLOUR_BANDS = [
  [0.25, 0.6],
  [0.6, 1.01],
];

/** Colour: the mean chroma (r − y, b − y) and pixel share in each luma band. */
export function colourStats(img, y, mask = null) {
  return COLOUR_BANDS.map(([lo, hi]) => {
    let cr = 0;
    let cb = 0;
    let n = 0;
    let total = 0;
    for (let i = 0; i < y.length; i++) {
      if (mask && !mask[i]) continue;
      total++;
      if (y[i] < lo || y[i] >= hi) continue;
      cr += img.rgb[3 * i] - y[i];
      cb += img.rgb[3 * i + 2] - y[i];
      n++;
    }
    return { cr: n ? cr / n : 0, cb: n ? cb / n : 0, share: total ? n / total : 0 };
  });
}

/** 1 for the same colour in each band, 0 at a chroma distance of 0.12; bands one frame hardly has are skipped. */
export function colourScore(ca, cb) {
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < ca.length; i++) {
    const w = Math.min(ca[i].share, cb[i].share);
    if (w < 0.01) continue;
    const d = Math.hypot(ca[i].cr - cb[i].cr, ca[i].cb - cb[i].cb);
    sum += w * Math.max(0, 1 - d / 0.12);
    weight += w;
  }
  return weight ? sum / weight : 1;
}

/**
 * Detail: in each grid cell, the mean fine (one pixel against its 3 × 3
 * neighbourhood) and middle (3 × 3 against 9 × 9) luma contrast.
 */
export function detailStats(y, w, h, mask = null, grid = 3) {
  const b1 = boxBlur(y, w, h, 1);
  const b4 = boxBlur(y, w, h, 4);
  const cells = [];
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      let fine = 0;
      let mid = 0;
      let n = 0;
      for (let yy = Math.floor((gy * h) / grid); yy < Math.floor(((gy + 1) * h) / grid); yy++) {
        for (let xx = Math.floor((gx * w) / grid); xx < Math.floor(((gx + 1) * w) / grid); xx++) {
          const i = yy * w + xx;
          if (mask && !mask[i]) continue;
          fine += Math.abs(y[i] - b1[i]);
          mid += Math.abs(b1[i] - b4[i]);
          n++;
        }
      }
      cells.push(n > 16 ? [fine / n, mid / n] : null);
    }
  }
  return cells;
}

/** 1 for the same detail, 0 when it differs by a factor of 4 on average. */
export function detailScore(da, db) {
  let sum = 0;
  let n = 0;
  const e = 0.002;
  for (let i = 0; i < da.length; i++) {
    if (!da[i] || !db[i]) continue;
    for (let k = 0; k < 2; k++) {
      sum += Math.abs(Math.log2((da[i][k] + e) / (db[i][k] + e)));
      n++;
    }
  }
  return n ? Math.max(0, 1 - sum / n / 2) : 0;
}

/**
 * Streak direction: in each grid cell, the structure tensor of the luma
 * gradients (blurred), as the dominant edge angle (radians, 0–π) and how
 * strongly one direction dominates (coherence 0–1).
 */
export function orientationStats(y, w, h, mask = null, grid = 4) {
  const cells = [];
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      let jxx = 0;
      let jyy = 0;
      let jxy = 0;
      let n = 0;
      for (let yy = Math.max(1, Math.floor((gy * h) / grid)); yy < Math.min(h - 1, Math.floor(((gy + 1) * h) / grid)); yy++) {
        for (let xx = Math.max(1, Math.floor((gx * w) / grid)); xx < Math.min(w - 1, Math.floor(((gx + 1) * w) / grid)); xx++) {
          const i = yy * w + xx;
          if (mask && !mask[i]) continue;
          const dx = 0.5 * (y[i + 1] - y[i - 1]);
          const dy = 0.5 * (y[i + w] - y[i - w]);
          jxx += dx * dx;
          jyy += dy * dy;
          jxy += dx * dy;
          n++;
        }
      }
      if (n < 16) {
        cells.push(null);
        continue;
      }
      const tr = jxx + jyy;
      const coherence = tr > 1e-9 ? Math.hypot(jxx - jyy, 2 * jxy) / tr : 0;
      // The gradient's dominant angle; the streaks run square to it.
      cells.push({ angle: 0.5 * Math.atan2(2 * jxy, jxx - jyy), coherence, energy: tr / n });
    }
  }
  return cells;
}

/** 1 when the streaks run the same way, less as the angles part (weighted by how streaky both cells are). */
export function orientationScore(oa, ob) {
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < oa.length; i++) {
    if (!oa[i] || !ob[i]) continue;
    const w = Math.min(oa[i].coherence, ob[i].coherence);
    if (w < 0.05) continue;
    sum += w * (0.5 + 0.5 * Math.cos(2 * (oa[i].angle - ob[i].angle)));
    weight += w;
  }
  return weight ? sum / weight : 1;
}

/** Weights of the score's parts (they sum to 1). */
export const SCORE_WEIGHTS = { shape: 0.35, tone: 0.25, colour: 0.15, detail: 0.15, streaks: 0.1 };

/**
 * Everything the score needs from one image (film or ours), measured once.
 * @param {{ w: number, h: number, rgb: Float32Array }} img
 */
export function frameStats(img, mask = null) {
  const y = luma(img);
  return {
    y,
    w: img.w,
    h: img.h,
    tone: toneStats(y, img.w, img.h, mask),
    colour: colourStats(img, y, mask),
    detail: detailStats(y, img.w, img.h, mask),
    streaks: orientationStats(y, img.w, img.h, mask),
  };
}

/**
 * The score of our frame against the film frame (same size; the film's
 * mask applies to both): each part 0–1, and their weighted total.
 */
export function scoreFrame(film, ours, mask = null) {
  const parts = {
    shape: shapeScore(film.y, ours.y, film.w, film.h, mask),
    tone: toneScore(film.tone, ours.tone),
    colour: colourScore(film.colour, ours.colour),
    detail: detailScore(film.detail, ours.detail),
    streaks: orientationScore(film.streaks, ours.streaks),
  };
  let total = 0;
  for (const [k, v] of Object.entries(parts)) total += SCORE_WEIGHTS[k] * v;
  return { ...parts, total };
}

/** Least-squares circle through points [x, y] (Kåsa): { cx, cy, r }, or null. */
export function fitCircle(points) {
  if (points.length < 3) return null;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of points) {
    sx += x;
    sy += y;
  }
  const mx = sx / points.length;
  const my = sy / points.length;
  let suu = 0;
  let svv = 0;
  let suv = 0;
  let suuu = 0;
  let svvv = 0;
  let suvv = 0;
  let svuu = 0;
  for (const [x, y] of points) {
    const u = x - mx;
    const v = y - my;
    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-12) return null;
  const a = 0.5 * (suuu + suvv);
  const b = 0.5 * (svvv + svuu);
  const uc = (a * svv - b * suv) / det;
  const vc = (b * suu - a * suv) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / points.length);
  return { cx: uc + mx, cy: vc + my, r };
}

/** A small seeded random source (mulberry32), so measurements repeat. */
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A circle through most of the points (RANSAC, then a least-squares fit to
 * the points within `tol` of it), with its radius in [rMin, rMax] (and
 * `accept(circle)` true, when given): thin arcs of one ring among other
 * bright points. Null if none fits.
 */
export function ransacCircle(points, { tol = 2, rMin = 0, rMax = Infinity, iterations = 400, seed = 1, accept = null } = {}) {
  if (points.length < 3) return null;
  const rand = random(seed);
  let best = null;
  let bestCount = 0;
  for (let it = 0; it < iterations; it++) {
    const sample = [0, 1, 2].map(() => points[Math.floor(rand() * points.length)]);
    const c = fitCircle(sample);
    if (!c || c.r < rMin || c.r > rMax || (accept && !accept(c))) continue;
    let count = 0;
    for (const [x, y] of points) if (Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r) < tol) count++;
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  if (!best) return null;
  const inliers = points.filter(([x, y]) => Math.abs(Math.hypot(x - best.cx, y - best.cy) - best.r) < tol);
  const refined = fitCircle(inliers) ?? best;
  return { ...refined, inliers: inliers.length };
}

/** Least-squares line y = slope · x + offset through points [x, y]. */
export function fitLine(points) {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const [x, y] of points) {
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const det = n * sxx - sx * sx;
  if (Math.abs(det) < 1e-12) return null;
  const slope = (n * sxy - sx * sy) / det;
  return { slope, offset: (sy - slope * sx) / n };
}

/** A line through most of the points (RANSAC within `tol`, then least squares). */
export function ransacLine(points, { tol = 1.5, iterations = 300, seed = 1, maxSlope = 0.5 } = {}) {
  if (points.length < 2) return null;
  const rand = random(seed);
  let best = null;
  let bestCount = 0;
  for (let it = 0; it < iterations; it++) {
    const p = points[Math.floor(rand() * points.length)];
    const q = points[Math.floor(rand() * points.length)];
    if (p[0] === q[0]) continue;
    const slope = (q[1] - p[1]) / (q[0] - p[0]);
    if (Math.abs(slope) > maxSlope) continue;
    const offset = p[1] - slope * p[0];
    let count = 0;
    for (const [x, y] of points) if (Math.abs(slope * x + offset - y) < tol) count++;
    if (count > bestCount) {
      bestCount = count;
      best = { slope, offset };
    }
  }
  if (!best) return null;
  const inliers = points.filter(([x, y]) => Math.abs(best.slope * x + best.offset - y) < tol);
  return { ...(fitLine(inliers) ?? best), inliers: inliers.length };
}

/** Thin bright lines: masked pixels brighter than `min` and than their 7 × 7 neighbourhood by `k`. */
export function ridgePoints(y, w, h, mask = null, { k = 0.06, min = 0.15 } = {}) {
  const b = boxBlur(y, w, h, 3);
  const points = [];
  for (let yy = 1; yy < h - 1; yy++) {
    for (let xx = 1; xx < w - 1; xx++) {
      const i = yy * w + xx;
      if (mask && !mask[i]) continue;
      if (y[i] > min && y[i] - b[i] > k) points.push([xx, yy]);
    }
  }
  return points;
}

/**
 * The disc's thin bright line seen edge-on: in each masked column, the row
 * where the luma stands out most above its vertical neighbourhood, then a
 * near-level line through most of those rows. Returns the line's height at
 * the frame centre and its tilt (both in shares of the height), or null.
 */
export function horizonLine(y, w, h, mask = null, { minContrast = 0.04 } = {}) {
  const points = [];
  for (let x = 2; x < w - 2; x += 2) {
    let best = -1;
    let bestRow = -1;
    for (let r = 4; r < h - 4; r++) {
      const i = r * w + x;
      if (mask && !mask[i]) continue;
      const c = y[i] - 0.5 * (y[i - 4 * w] + y[i + 4 * w]);
      if (c > best) {
        best = c;
        bestRow = r;
      }
    }
    if (best > minContrast) points.push([x, bestRow]);
  }
  const line = ransacLine(points, { tol: 1.5, maxSlope: 0.25 });
  if (!line || line.inliers < points.length * 0.3 || line.inliers < 8) return null;
  return { v: (line.slope * (w / 2) + line.offset + 0.5) / h, tilt: line.slope, inliers: line.inliers };
}

/**
 * The shadow as the region darker than `level`, grown from a seed pixel
 * (4-connected, masked pixels only), and a circle fitted to its edge where
 * the edge is not the frame border: { area (share of the frame), cx, cy, r
 * (shares of the height), edge (points), rms (the edge's spread about the
 * circle, per radius), bottom (its lowest row, share of the height) } or
 * null when the seed is not dark. Edge points below `fitAbove` (a share of
 * the height) are left out of the fit (the dome's flat bottom on the line).
 */
export function shadowRegion(y, w, h, seed, { level = 0.75, mask = null, fitAbove = Infinity } = {}) {
  const [sx, sy] = seed;
  const start = sy * w + sx;
  if (!(y[start] < level)) return null;
  const inside = new Uint8Array(w * h);
  const stack = [start];
  inside[start] = 1;
  let area = 0;
  let bottom = 0;
  while (stack.length) {
    const i = stack.pop();
    area++;
    const x = i % w;
    const yy = (i - x) / w;
    if (yy > bottom) bottom = yy;
    for (const [nx, ny] of [
      [x + 1, yy],
      [x - 1, yy],
      [x, yy + 1],
      [x, yy - 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (inside[j] || y[j] >= level || (mask && !mask[j])) continue;
      inside[j] = 1;
      stack.push(j);
    }
  }
  const edge = [];
  for (let yy = 1; yy < h - 1; yy++) {
    for (let x = 1; x < w - 1; x++) {
      const i = yy * w + x;
      if (!inside[i]) continue;
      if (!inside[i + 1] || !inside[i - 1] || !inside[i + w] || !inside[i - w]) {
        // Only the edge against light, not against a masked spacecraft.
        const masked = mask && (!mask[i + 1] || !mask[i - 1] || !mask[i + w] || !mask[i - w]);
        if (!masked && (yy + 0.5) / h < fitAbove) edge.push([x, yy]);
      }
    }
  }
  const c = fitCircle(edge);
  // How round the edge is: the RMS distance of its points from the circle, per radius.
  let rms = NaN;
  if (c) {
    let sq = 0;
    for (const [x, yy] of edge) sq += (Math.hypot(x - c.cx, yy - c.cy) - c.r) ** 2;
    rms = Math.sqrt(sq / edge.length) / c.r;
  }
  return {
    area: area / (w * h),
    cx: c ? (c.cx + 0.5) / h : NaN,
    cy: c ? (c.cy + 0.5) / h : NaN,
    r: c ? c.r / h : NaN,
    edge: edge.length,
    rms,
    bottom: (bottom + 1) / h,
  };
}

/**
 * Where a small template matches best (normalised cross-correlation) within
 * ±search pixels of (x0, y0): { x, y, ncc } of the template's top-left.
 */
export function trackTemplate(y, w, h, tmpl, tw, th, x0, y0, search) {
  let tm = 0;
  for (let i = 0; i < tmpl.length; i++) tm += tmpl[i];
  tm /= tmpl.length;
  let tv = 0;
  for (let i = 0; i < tmpl.length; i++) tv += (tmpl[i] - tm) ** 2;
  let best = { x: x0, y: y0, ncc: -2 };
  for (let dy = -search; dy <= search; dy++) {
    for (let dx = -search; dx <= search; dx++) {
      const ox = x0 + dx;
      const oy = y0 + dy;
      if (ox < 0 || oy < 0 || ox + tw > w || oy + th > h) continue;
      let m = 0;
      for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) m += y[(oy + ty) * w + ox + tx];
      m /= tmpl.length;
      let cov = 0;
      let v = 0;
      for (let ty = 0; ty < th; ty++) {
        for (let tx = 0; tx < tw; tx++) {
          const d = y[(oy + ty) * w + ox + tx] - m;
          cov += d * (tmpl[ty * tw + tx] - tm);
          v += d * d;
        }
      }
      const ncc = cov / Math.sqrt(v * tv + 1e-12);
      if (ncc > best.ncc) best = { x: ox, y: oy, ncc };
    }
  }
  return best;
}

/** Cut a w × h window out of an image's luma, top-left at (x0, y0). */
export function crop(y, w, x0, y0, cw, ch) {
  const out = new Float32Array(cw * ch);
  for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) out[yy * cw + xx] = y[(y0 + yy) * w + x0 + xx];
  return out;
}

/**
 * Image motion between two frames: in each grid cell, the shift (pixels)
 * of a central block that best matches (least mean absolute difference)
 * within ±search: [dx, dy] per cell (b ≈ a moved by dx, dy), null where
 * the block is masked or flat.
 */
export function blockFlow(a, b, w, h, { grid = 4, search = 8, mask = null } = {}) {
  const out = [];
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const cw = Math.floor(w / grid);
      const ch = Math.floor(h / grid);
      const bw = cw - 2 * search;
      const bh = ch - 2 * search;
      const x0 = gx * cw + search;
      const y0 = gy * ch + search;
      let flat = 0;
      let masked = false;
      let mean = 0;
      for (let yy = 0; yy < bh; yy++) {
        for (let xx = 0; xx < bw; xx++) {
          const i = (y0 + yy) * w + x0 + xx;
          if (mask && !mask[i]) masked = true;
          mean += a[i];
        }
      }
      mean /= bw * bh;
      for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) flat += Math.abs(a[(y0 + yy) * w + x0 + xx] - mean);
      if (masked || flat / (bw * bh) < 0.01 || bw < 4 || bh < 4) {
        out.push(null);
        continue;
      }
      let best = Infinity;
      let shift = [0, 0];
      for (let dy = -search; dy <= search; dy++) {
        for (let dx = -search; dx <= search; dx++) {
          let sad = 0;
          for (let yy = 0; yy < bh; yy += 2) {
            for (let xx = 0; xx < bw; xx += 2) sad += Math.abs(a[(y0 + yy) * w + x0 + xx] - b[(y0 + yy + dy) * w + x0 + xx + dx]);
          }
          if (sad < best) {
            best = sad;
            shift = [dx, dy];
          }
        }
      }
      out.push(shift);
    }
  }
  return out;
}

/** An image at half size (2 × 2 means per channel). */
export function halveImage(img) {
  const w2 = img.w >> 1;
  const h2 = img.h >> 1;
  const rgb = new Float32Array(w2 * h2 * 3);
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      for (let c = 0; c < 3; c++) {
        const i = 3 * (2 * y * img.w + 2 * x) + c;
        rgb[3 * (y * w2 + x) + c] = 0.25 * (img.rgb[i] + img.rgb[i + 3] + img.rgb[i + 3 * img.w] + img.rgb[i + 3 * img.w + 3]);
      }
    }
  }
  return { w: w2, h: h2, rgb };
}

/**
 * Motion: 1 when both frame pairs move the same way in every grid cell
 * (blockFlow), falling as the shifts differ (e^(−distance / scale px));
 * cells either pair cannot measure are skipped.
 */
export function motionScore(fa, fb, scale = 4) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < fa.length; i++) {
    if (!fa[i] || !fb[i]) continue;
    sum += Math.exp(-Math.hypot(fa[i][0] - fb[i][0], fa[i][1] - fb[i][1]) / scale);
    n++;
  }
  return n ? sum / n : NaN;
}
