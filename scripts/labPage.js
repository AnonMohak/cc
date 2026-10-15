// Runs inside the intro page (the dev server serves it; imported by the lab
// and fit scripts through scripts/introBrowser.mjs): loads film frames from
// images/clip/, renders our frames (IntroCinematic.renderStill) and scores
// them with the same maths as Node (src/intro/frameMatch.js), so only the
// numbers leave the page. Not part of the app.
import { imageFromBytes, halveImage, halve, frameStats, scoreFrame } from '../src/intro/frameMatch.js';
import { MEASURE_W, MEASURE_H, measureMask, measureFeatures } from '../src/intro/filmFeatures.js';

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
    const mask = measureMask(m.shot, m.ship);
    const mask2 = halve(new Float32Array(MEASURE_W * MEASURE_H), MEASURE_W, MEASURE_H, mask).mask;
    const img = imageFromBytes(rgba, MEASURE_W, MEASURE_H, 4);
    films.set(id, { m, mask, mask2, stats: frameStats(halveImage(img), mask2) });
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
