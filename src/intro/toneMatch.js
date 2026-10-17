/**
 * Tone match to the film (pure): per colour channel, the curve that maps
 * our frames' brightness distribution onto the film's (histogram matching),
 * read at the tone curve's knots (introLook.js CURVE_KNOTS). Used per shot
 * (scripts/match-tone.mjs), so each shot gets the film's own light and dark
 * and colour, whatever the physics gives.
 */

/** Histogram bins per channel. */
export const TONE_BINS = 256;

/** An empty histogram: three channels of TONE_BINS counts. */
export function emptyHist() {
  return { r: new Float64Array(TONE_BINS), g: new Float64Array(TONE_BINS), b: new Float64Array(TONE_BINS), n: 0 };
}

/**
 * Add an image's pixels (rgb 0-1, rows top to bottom) under a mask (1 =
 * counted; none = all) to a histogram.
 * @param {{ r: Float64Array, g: Float64Array, b: Float64Array, n: number }} hist
 * @param {{ w: number, h: number, rgb: Float32Array }} img
 * @param {Float32Array | Uint8Array | null} mask
 */
export function addToHist(hist, img, mask = null) {
  const bin = (v) => Math.min(TONE_BINS - 1, Math.max(0, Math.floor(v * TONE_BINS)));
  for (let i = 0, n = img.w * img.h; i < n; i++) {
    if (mask && !mask[i]) continue;
    hist.r[bin(img.rgb[3 * i])]++;
    hist.g[bin(img.rgb[3 * i + 1])]++;
    hist.b[bin(img.rgb[3 * i + 2])]++;
    hist.n++;
  }
  return hist;
}

/** Sum of two histograms (plain arrays are fine too: page results). */
export function mergeHist(a, b) {
  const out = emptyHist();
  for (const c of ['r', 'g', 'b']) for (let i = 0; i < TONE_BINS; i++) out[c][i] = (a[c][i] ?? 0) + (b[c][i] ?? 0);
  out.n = a.n + b.n;
  return out;
}

/** The value below which a share q of a channel's pixels lies (linear inside a bin). */
function quantileOf(counts, n, q) {
  const want = Math.min(Math.max(q, 0), 1) * n;
  let seen = 0;
  for (let i = 0; i < TONE_BINS; i++) {
    if (seen + counts[i] >= want && counts[i] > 0) return (i + (want - seen) / counts[i]) / TONE_BINS;
    seen += counts[i];
  }
  return 1;
}

/**
 * The matching curve at the knots: for each knot level x, our share of
 * pixels at or below x (mid-rank inside x's bin, so a pile of pure black
 * maps to the middle of the film's darkest share, not its top) read back
 * through the film's distribution. Monotone, 0-1.
 * @param {ReturnType<typeof emptyHist>} ours
 * @param {ReturnType<typeof emptyHist>} film
 * @param {number[]} knots input levels, 0 to 1
 * @returns {number[][]} [r, g, b] per knot
 */
export function matchCurve(ours, film, knots) {
  const out = knots.map(() => [0, 0, 0]);
  ['r', 'g', 'b'].forEach((c, ci) => {
    let last = 0;
    knots.forEach((x, k) => {
      const b = Math.min(TONE_BINS - 1, Math.floor(x * TONE_BINS));
      let below = 0;
      for (let i = 0; i < b; i++) below += ours[c][i];
      // Linear inside the bin; at black, the middle of the pile.
      const frac = x === 0 ? 0.5 : Math.min(1, x * TONE_BINS - b);
      const share = ours.n > 0 ? (below + frac * ours[c][b]) / ours.n : x;
      const y = film.n > 0 ? quantileOf(film[c], film.n, share) : x;
      last = Math.max(last, Math.min(1, y));
      out[k][ci] = last;
    });
  });
  return out;
}
