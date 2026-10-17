// Runs inside the intro page (the dev server serves it; imported by the lab
// and fit scripts through scripts/introBrowser.mjs): loads film frames from
// images/clip/, renders our frames (IntroCinematic.renderStill) and scores
// them with the same maths as Node (src/intro/frameMatch.js), so only the
// numbers leave the page. Not part of the app.
import { imageFromBytes, halveImage, halve, frameStats, scoreFrame, luma, blockFlow } from '../src/intro/frameMatch.js';
import { MEASURE_W, MEASURE_H, measureMask, scoreMask, measureFeatures } from '../src/intro/filmFeatures.js';
import { emptyHist, addToHist } from '../src/intro/toneMatch.js';

const films = new Map();

/** RGBA bytes of an image URL at w × h. */
async function loadRGBA(url, w, h) {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, w, h).data;
}

/**
 * Load and measure the film frames (filmMeasures.js entries), once.
 * @param {object[]} measures
 */
export async function loadFilm(measures) {
  for (const m of measures) {
    const id = `${m.shot}/${m.frame}`;
    if (films.has(id)) continue;
    const rgba = await loadRGBA(`/images/clip/${m.shot}/${String(m.frame).padStart(4, '0')}.png`, MEASURE_W, MEASURE_H);
    // Features are measured on the whole frame (spacecraft out); the score
    // leaves the film's shadow out too (scoreMask).
    const mask = measureMask(m.shot, m.ship);
    const mask2 = halve(new Float32Array(MEASURE_W * MEASURE_H), MEASURE_W, MEASURE_H, scoreMask(m)).mask;
    const img = imageFromBytes(rgba, MEASURE_W, MEASURE_H, 4);
    films.set(id, { m, mask, mask2, img, stats: frameStats(halveImage(img), mask2) });
  }
  return films.size;
}

/** Our frame at t as an image (rows top to bottom). */
function render(t, size) {
  const intro = window.__app.getIntro();
  const { width: W, height: H } = size;
  const px = intro.renderStill(window.__app.renderer, t, size);
  const rgb = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const src = (H - 1 - y) * W * 4;
    const dst = y * W * 3;
    for (let x = 0; x < W; x++) {
      rgb[dst + 3 * x] = px[src + 4 * x] / 255;
      rgb[dst + 3 * x + 1] = px[src + 4 * x + 1] / 255;
      rgb[dst + 3 * x + 2] = px[src + 4 * x + 2] / 255;
    }
  }
  return { w: W, h: H, rgb };
}

/** An image at w × h (nearest; our renders are made at the measure size or a whole fraction of it). */
function toMeasureSize(img) {
  if (img.w === MEASURE_W && img.h === MEASURE_H) return img;
  const rgb = new Float32Array(MEASURE_W * MEASURE_H * 3);
  for (let y = 0; y < MEASURE_H; y++) {
    for (let x = 0; x < MEASURE_W; x++) {
      const i = 3 * (Math.floor((y * img.h) / MEASURE_H) * img.w + Math.floor((x * img.w) / MEASURE_W));
      rgb.set(img.rgb.subarray(i, i + 3), 3 * (y * MEASURE_W + x));
    }
  }
  return { w: MEASURE_W, h: MEASURE_H, rgb };
}

/**
 * Render our frame at t and score it against a loaded film frame.
 * @returns {{ score: object, features: object }}
 */
export function scoreAt(t, size, m, { features = true } = {}) {
  const film = films.get(`${m.shot}/${m.frame}`);
  const img = toMeasureSize(render(t, size));
  const score = scoreFrame(film.stats, frameStats(halveImage(img), film.mask2), film.mask2);
  return { score, features: features ? measureFeatures(m.shot, img, film.mask) : null };
}

/**
 * Colour histograms of our frame at t and of a loaded film frame, over the
 * film frame's mask (spacecraft out), for the tone match (toneMatch.js).
 * Plain arrays, so they leave the page as JSON.
 */
export function histAt(t, size, m, { cutShadow = false } = {}) {
  const film = films.get(`${m.shot}/${m.frame}`);
  const mask = cutShadow ? scoreMask(m, MEASURE_W, MEASURE_H, { shadow: false }) : film.mask;
  const plain = (h) => ({ r: Array.from(h.r), g: Array.from(h.g), b: Array.from(h.b), n: h.n });
  const ours = addToHist(emptyHist(), toMeasureSize(render(t, size)), mask);
  return { ours: plain(ours), film: plain(addToHist(emptyHist(), film.img, mask)) };
}

/**
 * The mean colour of an image inside a film frame's shadow (or dome)
 * circle, spacecraft out: the middle (inside 0.6 of the radius) and toward
 * the edge (0.6-0.92).
 * @returns {{ inner: number[], outer: number[], nIn: number, nOut: number } | null}
 */
function shadowColour(img, m, mask) {
  const c = m.shadow ?? m.dome;
  if (!c) return null;
  const { w, h, rgb } = img;
  const inner = [0, 0, 0];
  const outer = [0, 0, 0];
  let nIn = 0;
  let nOut = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const rho = Math.hypot(x / h - c.cx, y / h - c.cy) / c.r;
      if (rho >= 0.92) continue;
      const into = rho < 0.6 ? inner : outer;
      for (let k = 0; k < 3; k++) into[k] += rgb[3 * i + k];
      if (rho < 0.6) nIn++;
      else nOut++;
    }
  }
  return { inner, outer, nIn, nOut };
}

/** The film's shadow colour (shadowColour) for a loaded film frame. */
export function filmShadowColour(m) {
  const film = films.get(`${m.shot}/${m.frame}`);
  return shadowColour(film.img, m, film.mask);
}

/** Our frame's colour inside the film's shadow circle at t. */
export function ourShadowColour(t, size, m) {
  const film = films.get(`${m.shot}/${m.frame}`);
  return shadowColour(toMeasureSize(render(t, size)), m, film.mask);
}

/**
 * Image motion between two loaded film frames and between our frames at t0
 * and t1 (blockFlow on luma at the measure size, cells with spacecraft
 * left out): [dx, dy] px per cell, null where not measurable.
 */
export function flowAt(t0, t1, size, m0, m1, opts = { grid: 6, search: 16 }) {
  const f0 = films.get(`${m0.shot}/${m0.frame}`);
  const f1 = films.get(`${m1.shot}/${m1.frame}`);
  const mask = f0.mask;
  const film = blockFlow(luma(f0.img), luma(f1.img), MEASURE_W, MEASURE_H, { ...opts, mask });
  const a = toMeasureSize(render(t0, size));
  const b = toMeasureSize(render(t1, size));
  const ours = blockFlow(luma(a), luma(b), MEASURE_W, MEASURE_H, { ...opts, mask });
  return { film, ours };
}

/** Our frame at t as a JPEG (base64), for sheets. */
export async function grab(t, size) {
  const img = render(t, size);
  const canvas = new OffscreenCanvas(img.w, img.h);
  const ctx = canvas.getContext('2d');
  const data = ctx.createImageData(img.w, img.h);
  for (let i = 0, n = img.w * img.h; i < n; i++) {
    data.data[4 * i] = img.rgb[3 * i] * 255;
    data.data[4 * i + 1] = img.rgb[3 * i + 1] * 255;
    data.data[4 * i + 2] = img.rgb[3 * i + 2] * 255;
    data.data[4 * i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer());
  let text = '';
  for (let k = 0; k < bytes.length; k += 0x8000) text += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return btoa(text);
}
