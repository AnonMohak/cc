/**
 * Pure helpers for the ?tune view (introTuner.js).
 */

/**
 * The film clip's frames (images/frame_NNN.png, one per second; never
 * committed) that match a reference shot: frame number → shot number. The
 * other frames show actors or spacecraft, or repeat a shot.
 */
export const CLIP_FRAME_SHOTS = { 1: 1, 2: 2, 3: 3, 4: 4, 6: 5, 13: 7, 18: 8, 20: 9, 26: 10 };

/**
 * The reference shot number in a file name: a clip frame ("frame_018.png")
 * by CLIP_FRAME_SHOTS (null when it matches no shot), else the last number
 * in it ("shot-7.jpg" → 7, "img_03.png" → 3); null when there is none.
 * @param {string} name
 */
export function shotNumberFromName(name) {
  const base = name.replace(/\.[^.]*$/, '');
  const frame = /^frame_(\d+)$/.exec(base);
  if (frame) return CLIP_FRAME_SHOTS[Number(frame[1])] ?? null;
  const m = /(\d+)(?!.*\d)/.exec(base);
  return m ? Number(m[1]) : null;
}

/**
 * The picture inside flat bars (a video player's grey or black frame): the
 * first and last column and row whose brightness varies along its length.
 * Returns the whole image when it finds no content.
 * @param {Uint8ClampedArray | Uint8Array} data RGBA, row by row
 * @param {number} width
 * @param {number} height
 * @param {number} [threshold] variance of brightness (0–255²) that counts as content
 * @returns {{ x0: number, y0: number, x1: number, y1: number }} x1, y1 exclusive
 */
export function contentBounds(data, width, height, threshold = 40) {
  const luma = (x, y) => {
    const i = (y * width + x) * 4;
    return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  };
  const variance = (count, at) => {
    let sum = 0;
    let sq = 0;
    for (let k = 0; k < count; k++) {
      const v = at(k);
      sum += v;
      sq += v * v;
    }
    const mean = sum / count;
    return sq / count - mean * mean;
  };
  const column = (x) => variance(height, (y) => luma(x, y)) > threshold;
  const row = (y) => variance(width, (x) => luma(x, y)) > threshold;
  let x0 = 0;
  while (x0 < width && !column(x0)) x0++;
  if (x0 === width) return { x0: 0, y0: 0, x1: width, y1: height };
  let x1 = width;
  while (x1 > x0 && !column(x1 - 1)) x1--;
  let y0 = 0;
  while (y0 < height && !row(y0)) y0++;
  let y1 = height;
  while (y1 > y0 && !row(y1 - 1)) y1--;
  return { x0, y0, x1, y1 };
}
