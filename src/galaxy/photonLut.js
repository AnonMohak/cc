/**
 * PURE: exact light paths past a Schwarzschild black hole, as a lookup table
 * for core/BlackHolePass.js (no three.js).
 *
 * A photon stays in one plane. With u = 1/r (Rs = 1) and φ the angle swept
 * in that plane, its path obeys Binet's equation u'' + u = 1.5 u², with the
 * first integral (du/dφ)² = f(u) = 1/b² − u² + u³ for impact parameter b.
 * Φ(u) = ∫₀ᵘ du / √f is the angle swept from infinity to radius 1/u:
 * - b > B_CRIT: the photon turns at the periapsis u_p (smallest root of f)
 *   and escapes after a total sweep of 2 Φ_p.
 * - b < B_CRIT: no turning point; inward photons reach the horizon (u = 1)
 *   after Φ_h = Φ(1).
 * A camera at u_c on the way in starts at ψ_c = Φ(u_c) (on the way out at
 * 2 Φ_p − Φ(u_c)); after a further sweep s the photon is at ψ = ψ_c + s.
 *
 * The table (FloatType RGBA, sampled with a manual bilinear in the shader so
 * it keeps full precision) has one row per b and one column per x in [0, 1]:
 *   R: Φ at column x (x = w for b > B_CRIT, where u = u_p (1 − w²); x = u for
 *      b < B_CRIT), so Φ(u_c) is one lookup;
 *   G: the inverse, g at t = ψ / Φ_end (u = u_p (1 − g²) above, u = g below);
 *   B: Φ_end of the row (Φ_p or Φ_h); A: u_end of the row (u_p or 1).
 * Rows are spaced in log |b − B_CRIT|, so they crowd at the photon ring.
 */

/** Critical impact parameter (√27 / 2): the shadow edge. */
export const B_CRIT = Math.sqrt(27) / 2;
/** Table size: columns, rows below and above B_CRIT. */
export const LUT_WIDTH = 256;
export const LUT_ROWS_CAPTURE = 128;
export const LUT_ROWS_ESCAPE = 192;
export const LUT_HEIGHT = LUT_ROWS_CAPTURE + LUT_ROWS_ESCAPE;
/** Closest approach to B_CRIT the table resolves, and the largest b. */
export const LUT_B_EPS = 1e-5;
export const LUT_B_MAX = 128;

const Y_CAPTURE_START = Math.log(B_CRIT);
const Y_NEAR = Math.log(LUT_B_EPS);
const Y_ESCAPE_END = Math.log(LUT_B_MAX - B_CRIT);
// Integration steps per row (the table samples the running integral).
const FINE = 1024;

/** f(u) = 1/b² − u² + u³: (du/dφ)². */
function orbitF(u, b) {
  return 1 / (b * b) - u * u + u * u * u;
}

/**
 * Periapsis u_p for b > B_CRIT: the smallest positive root of
 * u³ − u² + 1/b² (trigonometric cubic solution). 2/3 at B_CRIT.
 * @param {number} b
 */
export function periapsisU(b) {
  const q = 1 / (b * b);
  const theta = Math.acos(Math.min(1, Math.max(-1, 1 - 13.5 * q)));
  return 1 / 3 + (2 / 3) * Math.cos((theta - 2 * Math.PI) / 3);
}

/** Row (fractional, 0 … LUT_HEIGHT − 1) for impact parameter b. */
export function lutRow(b) {
  if (b < B_CRIT) {
    const y = Math.log(Math.max(B_CRIT - b, LUT_B_EPS));
    return ((y - Y_CAPTURE_START) / (Y_NEAR - Y_CAPTURE_START)) * (LUT_ROWS_CAPTURE - 1);
  }
  const y = Math.log(Math.min(Math.max(b - B_CRIT, LUT_B_EPS), LUT_B_MAX - B_CRIT));
  return LUT_ROWS_CAPTURE + ((y - Y_NEAR) / (Y_ESCAPE_END - Y_NEAR)) * (LUT_ROWS_ESCAPE - 1);
}

/** Impact parameter at an integer row. */
function rowB(row) {
  if (row < LUT_ROWS_CAPTURE) {
    const y = Y_CAPTURE_START + (row / (LUT_ROWS_CAPTURE - 1)) * (Y_NEAR - Y_CAPTURE_START);
    return Math.max(0, B_CRIT - Math.exp(y));
  }
  const y = Y_NEAR + ((row - LUT_ROWS_CAPTURE) / (LUT_ROWS_ESCAPE - 1)) * (Y_ESCAPE_END - Y_NEAR);
  return B_CRIT + Math.exp(y);
}

/** Linear interpolation in a monotonic table: x at value v (xs ascending in vs). */
function invert(vs, xs, v) {
  let lo = 0;
  let hi = vs.length - 1;
  if (v <= vs[lo]) return xs[lo];
  if (v >= vs[hi]) return xs[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (vs[mid] <= v) lo = mid;
    else hi = mid;
  }
  const k = (v - vs[lo]) / (vs[hi] - vs[lo] || 1);
  return xs[lo] + k * (xs[hi] - xs[lo]);
}

/**
 * One row: running Φ on a fine grid of the column variable x, then the
 * table's columns. Escape rows integrate in w (u = u_p (1 − w²)), which
 * removes the 1/√ singularity at the periapsis.
 */
function buildRow(b, out, row) {
  const escape = b > B_CRIT;
  const uEnd = escape ? periapsisU(b) : 1;
  // phiAt[i]: Φ at x = i / FINE.
  const phiAt = new Float64Array(FINE + 1);
  if (b <= 0) {
    // Radial ray: no sweep at all.
  } else if (escape) {
    // Φ(w) = ∫_w^1 2 u_p w' / √f(u_p (1 − w'²)) dw'; integrate from w = 1 down.
    const integrand = (w) => {
      if (w <= 0) {
        // Limit at the periapsis: f ≈ |f'(u_p)| u_p w².
        const fp = Math.abs(-2 * uEnd + 3 * uEnd * uEnd);
        return (2 * uEnd) / Math.sqrt(Math.max(fp * uEnd, 1e-30));
      }
      const u = uEnd * (1 - w * w);
      return (2 * uEnd * w) / Math.sqrt(Math.max(orbitF(u, b), 1e-30));
    };
    const h = 1 / FINE;
    for (let i = FINE - 1; i >= 0; i--) {
      const w0 = i * h;
      // Simpson on each step.
      phiAt[i] = phiAt[i + 1] + (h / 6) * (integrand(w0) + 4 * integrand(w0 + h / 2) + integrand(w0 + h));
    }
  } else {
    const integrand = (u) => 1 / Math.sqrt(Math.max(orbitF(u, b), 1e-30));
    const h = 1 / FINE;
    for (let i = 1; i <= FINE; i++) {
      const u0 = (i - 1) * h;
      phiAt[i] = phiAt[i - 1] + (h / 6) * (integrand(u0) + 4 * integrand(u0 + h / 2) + integrand(u0 + h));
    }
  }
  const phiEnd = escape ? phiAt[0] : phiAt[FINE];
  // Inverse: for escape rows Φ falls as w grows, so walk it reversed.
  const xs = new Float64Array(FINE + 1);
  const vs = new Float64Array(FINE + 1);
  for (let i = 0; i <= FINE; i++) {
    const k = escape ? FINE - i : i;
    xs[i] = k / FINE;
    vs[i] = phiAt[k];
  }
  for (let col = 0; col < LUT_WIDTH; col++) {
    const x = col / (LUT_WIDTH - 1);
    const fi = x * FINE;
    const i0 = Math.min(FINE - 1, Math.floor(fi));
    const phi = phiAt[i0] + (fi - i0) * (phiAt[i0 + 1] - phiAt[i0]);
    const g = phiEnd > 0 ? invert(vs, xs, x * phiEnd) : escape ? 1 : 0;
    const o = (row * LUT_WIDTH + col) * 4;
    out[o] = phi;
    out[o + 1] = g;
    out[o + 2] = phiEnd;
    out[o + 3] = uEnd;
  }
}

/**
 * Build the table (about 30 ms on a desktop CPU; once per page). Float32Array, LUT_WIDTH × LUT_HEIGHT × RGBA.
 * @returns {Float32Array}
 */
export function buildPhotonLut() {
  const data = new Float32Array(LUT_WIDTH * LUT_HEIGHT * 4);
  for (let row = 0; row < LUT_HEIGHT; row++) buildRow(rowB(row), data, row);
  return data;
}

/** Bilinear read of channel ch at column x (0–1) and fractional row. Mirrors the shader. */
export function lutSample(data, x, row, ch) {
  const cx = Math.min(1, Math.max(0, x)) * (LUT_WIDTH - 1);
  // Never blend across the B_CRIT seam between the two families.
  const lo = row < LUT_ROWS_CAPTURE ? 0 : LUT_ROWS_CAPTURE;
  const hiRow = row < LUT_ROWS_CAPTURE ? LUT_ROWS_CAPTURE - 1 : LUT_HEIGHT - 1;
  const cy = Math.min(hiRow, Math.max(lo, row));
  const x0 = Math.min(LUT_WIDTH - 2, Math.floor(cx));
  const y0 = Math.min(hiRow - 1, Math.floor(cy));
  const fx = cx - x0;
  const fy = cy - y0;
  const at = (xx, yy) => data[(yy * LUT_WIDTH + xx) * 4 + ch];
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * Follow a photon from a camera at distance rc (Rs) with impact parameter b,
 * moving inward or outward. Returns the radius after a further sweep s, or
 * null when the photon has escaped (or fallen in) before that sweep.
 * Mirrors the shader; also gives the total sweep to escape (`escapeSweep`).
 * @param {Float32Array} data
 * @param {number} rc
 * @param {number} b
 * @param {boolean} inward
 */
export function photonPath(data, rc, b, inward) {
  const row = lutRow(b);
  const escape = b > B_CRIT;
  const phiEnd = lutSample(data, 0, row, 2);
  const uEnd = lutSample(data, 0, row, 3);
  const uc = 1 / rc;
  const xc = escape ? Math.sqrt(Math.max(0, 1 - uc / uEnd)) : uc;
  const phiC = lutSample(data, xc, row, 0);
  // ψ: sweep from infinity along the path. Escape family: ψ runs to 2 Φ_p
  // (in, periapsis, out). Capture family inward: ψ runs up to the horizon at
  // Φ_h; outward (camera outside the photon sphere): ψ runs back down to 0.
  const back = !escape && !inward;
  const psiC = escape && !inward ? 2 * phiEnd - phiC : phiC;
  const escapeSweep = escape ? 2 * phiEnd - psiC : back ? phiC : phiEnd - phiC;
  const radiusAt = (s) => {
    if (s >= escapeSweep) return null;
    let psi = back ? psiC - s : psiC + s;
    if (escape) {
      if (psi > phiEnd) psi = 2 * phiEnd - psi;
      const g = lutSample(data, psi / phiEnd, row, 1);
      return 1 / Math.max(uEnd * (1 - g * g), 1e-9);
    }
    return 1 / Math.max(lutSample(data, psi / phiEnd, row, 1), 1e-9);
  };
  return { radiusAt, escapeSweep, escapes: escape || !inward };
}
