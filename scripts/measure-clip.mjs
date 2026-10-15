// Measure the film clip's black-hole shots (after scripts/clip-frames.mjs):
// four frames per second, the spacecraft masks (never drawn, left out of
// every score) and the features the camera fit aims at: the thin ring's
// circle and the disc's edge-on line (gap and dome), the shadow's edge
// (wall and skim), and the light and dark. Writes the numbers to
// src/intro/filmMeasures.js and check sheets (the measures drawn over the
// frames) to renders/measure/. Needs ffmpeg on the PATH.
//
//   node scripts/measure-clip.mjs            (--clip-dir images/clip)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILM_SHOTS } from '../src/intro/filmShots.js';
import { MEASURE_STEP, MEASURE_W, MEASURE_H, measureMask, measureFeatures } from '../src/intro/filmFeatures.js';
import { luma, imageFromBytes, crop, trackTemplate } from '../src/intro/frameMatch.js';
import { readRGB, readSequence, writeRGB, canvas } from './imageIO.mjs';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split('--')
    .filter(Boolean)
    .map((part) => {
      const [key, ...value] = part.trim().split(/\s+/);
      return [key, value.join(' ')];
    }),
);
const clipDir = args['clip-dir'] || 'images/clip';
const sheetDir = 'renders/measure';
mkdirSync(sheetDir, { recursive: true });

/**
 * The small spacecraft (the Endurance) found by eye in a few frames: [clip
 * frame, u (share of the width), v (share of the height), radius (px of the
 * 1080-line frame)]. Between them it is tracked.
 */
const SHIP_SEEDS = {
  'gap-dome': [
    [10, 0.479, 0.476, 13],
    [130, 0.592, 0.414, 10],
  ],
  wall: [
    [274, 0.7466, 0.454, 13],
    [466, 0.4226, 0.592, 9],
  ],
  skim: [
    [538, 0.438, 0.48, 33],
    [610, 0.5126, 0.569, 21],
  ],
};

const FULL_W = 1920;
const FULL_H = 1080;
const frameFile = (shot, f) => join(clipDir, shot, `${String(f).padStart(4, '0')}.png`);

/** Linear through the two seeds (extrapolated past them). */
function predict(seeds, f) {
  const [a, b] = seeds;
  const s = (f - a[0]) / (b[0] - a[0]);
  return [1, 2, 3].map((k) => a[k] + (b[k] - a[k]) * s);
}

/** The small ship's place in frame f: tracked near the prediction (full resolution). */
function trackShip(shot, f, templates) {
  const seeds = SHIP_SEEDS[shot];
  const [u, v, r] = predict(seeds, f);
  const nearest = seeds.reduce((best, s) => (Math.abs(s[0] - f) < Math.abs(best[0] - f) ? s : best));
  if (!templates.has(nearest[0])) {
    const y = luma(imageFromBytes(readRGB(frameFile(shot, nearest[0]), FULL_W, FULL_H), FULL_W, FULL_H));
    const size = Math.round(2.4 * nearest[3]) + 6;
    const x0 = Math.round(nearest[1] * FULL_W - size / 2);
    const y0 = Math.round(nearest[2] * FULL_H - size / 2);
    templates.set(nearest[0], { t: crop(y, FULL_W, x0, y0, size, size), size });
  }
  const { t, size } = templates.get(nearest[0]);
  const y = luma(imageFromBytes(readRGB(frameFile(shot, f), FULL_W, FULL_H), FULL_W, FULL_H));
  const hit = trackTemplate(y, FULL_W, FULL_H, t, size, size, Math.round(u * FULL_W - size / 2), Math.round(v * FULL_H - size / 2), 16);
  if (hit.ncc < 0.5) return { u, v, r, tracked: false };
  return { u: (hit.x + size / 2) / FULL_W, v: (hit.y + size / 2) / FULL_H, r, tracked: true };
}

const round = (x, d = 4) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const entries = [];

for (const shot of FILM_SHOTS) {
  const count = shot.last - shot.first + 1;
  const frames = readSequence(join(clipDir, shot.name, '%04d.png'), shot.first, count, MEASURE_W, MEASURE_H, MEASURE_STEP);
  const templates = new Map();
  const thumbs = [];
  frames.forEach((bytes, k) => {
    const f = shot.first + k * MEASURE_STEP;
    const found = SHIP_SEEDS[shot.name] ? trackShip(shot.name, f, templates) : null;
    // r as a share of the height from here on.
    const ship = found && { ...found, r: found.r / FULL_H };
    const mask = measureMask(shot.name, ship);
    const img = imageFromBytes(bytes, MEASURE_W, MEASURE_H);
    const m = measureFeatures(shot.name, img, mask);
    entries.push({
      frame: f,
      shot: shot.name,
      ship: ship && { u: round(ship.u), v: round(ship.v), r: round(ship.r) },
      ring: m.ring && { cx: round(m.ring.cx), cy: round(m.ring.cy), r: round(m.ring.r), n: m.ring.n },
      horizon: m.horizon && { v: round(m.horizon.v), tilt: round(m.horizon.tilt) },
      dome: m.dome && { cx: round(m.dome.cx), cy: round(m.dome.cy), r: round(m.dome.r), area: round(m.dome.area) },
      shadow: m.shadow && { cx: round(m.shadow.cx), cy: round(m.shadow.cy), r: round(m.shadow.r), area: round(m.shadow.area) },
      tone: m.tone.map((q) => round(q, 3)),
    });
    thumbs.push({ bytes, f, m, mask, ship });
  });

  // Check sheet: thumbnails (a third of the measure size) with the masks
  // dimmed, the ship's cut (red), the ring or shadow circle (green) and the
  // edge-on line (cyan).
  const tw = MEASURE_W / 3;
  const th = MEASURE_H / 3;
  const cols = 6;
  const rows = Math.ceil(thumbs.length / cols);
  const sheet = canvas(cols * (tw + 4), rows * (th + 4));
  thumbs.forEach(({ bytes, m, mask, ship }, i) => {
    const small = new Uint8Array(tw * th * 3);
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        for (let c = 0; c < 3; c++) {
          let s = 0;
          for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) s += bytes[3 * ((3 * y + dy) * MEASURE_W + 3 * x + dx) + c];
          const keep = mask[(3 * y + 1) * MEASURE_W + 3 * x + 1];
          small[3 * (y * tw + x) + c] = (s / 9) * (keep ? 1 : 0.25);
        }
      }
    }
    const x0 = (i % cols) * (tw + 4);
    const y0 = Math.floor(i / cols) * (th + 4);
    sheet.paste(small, tw, th, x0, y0);
    sheet.clip(x0, y0, x0 + tw, y0 + th);
    const H = th; // shares of the height → thumbnail pixels
    if (ship) sheet.circle(x0 + ship.u * tw, y0 + ship.v * th, (1.5 * ship.r + 6 / FULL_H) * H, [255, 60, 60]);
    if (m.ring) sheet.circle(x0 + m.ring.cx * H, y0 + m.ring.cy * H, m.ring.r * H, [60, 255, 90]);
    if (m.shadow) sheet.circle(x0 + m.shadow.cx * H, y0 + m.shadow.cy * H, m.shadow.r * H, [60, 255, 90]);
    if (m.dome) sheet.circle(x0 + m.dome.cx * H, y0 + m.dome.cy * H, m.dome.r * H, [255, 220, 60]);
    if (m.horizon) {
      const v0 = m.horizon.v - (m.horizon.tilt * tw) / 2 / H;
      sheet.line(x0, y0 + v0 * H, x0 + tw - 1, y0 + (v0 + (m.horizon.tilt * tw) / H) * H, [60, 230, 255]);
    }
  });
  writeRGB(join(sheetDir, `${shot.name}.jpg`), sheet.w, sheet.h, sheet.rgb);
  const found = (key) => thumbs.filter((t) => t.m[key]).length;
  console.log(`${shot.name}: ${thumbs.length} frames, ring ${found('ring')}, horizon ${found('horizon')}, dome ${found('dome')}, shadow ${found('shadow')}`);
}

const body = entries.map((e) => `  ${JSON.stringify(e)},`).join('\n');
writeFileSync(
  'src/intro/filmMeasures.js',
  `/**
 * Generated by scripts/measure-clip.mjs: the film clip measured four times a
 * second (numbers only; the clip stays on the user's disk). Per clip frame:
 * the small spacecraft (u, v as shares of the width and height, r of the
 * height; left out of every score), the thin ring's circle, the dome's and
 * the shadow's edge circles (cx, cy, r as shares of the height, from the
 * top-left; area a share of the frame), the
 * disc's edge-on line (v, share of the height at the centre; tilt), and the
 * luma's 10th, 50th and 90th percentiles. Null: not found in that frame.
 * Do not edit by hand.
 */
export const FILM_MEASURES = [
${body}
];
`,
);
console.log(`wrote src/intro/filmMeasures.js (${entries.length} frames)`);
