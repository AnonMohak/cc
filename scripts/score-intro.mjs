// Score our intro against the film clip: at every measured clip frame
// (src/intro/filmMeasures.js, four per second) take our frame at the intro
// moment it maps to, and compare (src/intro/frameMatch.js): shape, light
// and dark, colour, detail, streaks, motion, and the feature errors (ring,
// edge-on line, dome and shadow circles). Spacecraft are masked out of both.
// Writes a table to the console, JSON and side-by-side sheets to
// renders/score/<label>/. Needs ffmpeg on the PATH.
//
//   node scripts/score-intro.mjs --video public/video/intro-h264.mp4 --map old --label baseline
//   node scripts/score-intro.mjs --frames renders/full --fps 24 --map old
//   node scripts/score-intro.mjs --self-offset 6 --label film-quarter-second
//
// --map old: the film-match timeline (anchors at its reference shots);
// --map new: film speed (introTimeline.js FILM_SCHEDULE, from step B1).
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FILM_SHOTS, CLIP_FPS } from '../src/intro/filmShots.js';
import { FILM_MEASURES } from '../src/intro/filmMeasures.js';
import { MEASURE_W, MEASURE_H, MEASURE_STEP, measureMask, scoreMask, measureFeatures } from '../src/intro/filmFeatures.js';
import { imageFromBytes, halveImage, halve, frameStats, scoreFrame, blockFlow, motionScore, SCORE_WEIGHTS } from '../src/intro/frameMatch.js';
import { readRGB, writeRGB, canvas } from './imageIO.mjs';

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
const label = args.label || 'score';
const outDir = join('renders/score', label);
mkdirSync(outDir, { recursive: true });

/**
 * The film-match timeline (before film-match-max): its reference shots as
 * anchors [clip frame, intro seconds] per film shot; between them linear,
 * past them the nearest segment's rate (one anchor: film speed). That
 * timeline had no clouds or bright shot.
 */
const OLD_ANCHORS = {
  'gap-dome': [
    [10, 0],
    [34, 6],
    [58, 12],
    [82, 19.5],
    [130, 25],
  ],
  wall: [
    [298, 37.5],
    [418, 41],
    [466, 44],
  ],
  skim: [[610, 50]],
};

function oldTime(shot, frame) {
  const a = OLD_ANCHORS[shot];
  if (!a) return null;
  if (a.length === 1) return a[0][1] + (frame - a[0][0]) / CLIP_FPS;
  let i = 0;
  while (i < a.length - 2 && frame > a[i + 1][0]) i++;
  const [f0, t0] = a[i];
  const [f1, t1] = a[i + 1];
  return Math.max(0, t0 + ((frame - f0) * (t1 - t0)) / (f1 - f0));
}

async function introTime(shot, frame) {
  if (args['self-offset']) return 0;
  if (args.map === 'new') {
    const { clipFrameIntroTime } = await import('../src/intro/introTimeline.js');
    return clipFrameIntroTime(frame);
  }
  return oldTime(shot, frame);
}

/** Our frame at intro time t (960 × 540 RGB bytes). */
function ourFrame(t) {
  if (args.video) {
    // Accurate seek: decode from the key frame before t.
    return readRGB(args.video, MEASURE_W, MEASURE_H, t);
  }
  const fps = Number(args.fps || 24);
  const n = Math.round(t * fps) + 1;
  const ext = existsSync(join(args.frames, 'frame_00001.jpg')) ? 'jpg' : 'png';
  return readRGB(join(args.frames, `frame_${String(n).padStart(5, '0')}.${ext}`), MEASURE_W, MEASURE_H);
}

const filmFile = (shot, f) => join(clipDir, shot, `${String(f).padStart(4, '0')}.png`);
const W2 = MEASURE_W / 2;
const H2 = MEASURE_H / 2;

const rows = [];
let previous = null;
for (const m of FILM_MEASURES) {
  const t = await introTime(m.shot, m.frame);
  if (t === null || t === undefined) continue;
  const mask = measureMask(m.shot, m.ship);
  const filmImg = imageFromBytes(readRGB(filmFile(m.shot, m.frame), MEASURE_W, MEASURE_H), MEASURE_W, MEASURE_H);
  // --self-offset N: the film against itself N clip frames later (in the
  // same shot), to show what a very close match scores.
  const self = Number(args['self-offset'] || 0);
  const shot = FILM_SHOTS.find((s) => s.name === m.shot);
  const ourBytes = self ? readRGB(filmFile(m.shot, Math.min(shot.last, m.frame + self)), MEASURE_W, MEASURE_H) : ourFrame(t);
  const ourImg = imageFromBytes(ourBytes, MEASURE_W, MEASURE_H);
  const mask2 = halve(new Float32Array(MEASURE_W * MEASURE_H), MEASURE_W, MEASURE_H, scoreMask(m)).mask;
  const film = frameStats(halveImage(filmImg), mask2);
  const ours = frameStats(halveImage(ourImg), mask2);
  const score = scoreFrame(film, ours, mask2);
  // Motion: against the frame six clip frames earlier in the same shot.
  let motion = NaN;
  if (previous && previous.shot === m.shot && previous.frame === m.frame - MEASURE_STEP) {
    const opts = { grid: 4, search: 10, mask: mask2 };
    motion = motionScore(blockFlow(previous.film.y, film.y, W2, H2, opts), blockFlow(previous.ours.y, ours.y, W2, H2, opts));
  }
  previous = { shot: m.shot, frame: m.frame, film, ours };
  // Features of our frame, measured the same way as the film's.
  const f = measureFeatures(m.shot, ourImg, mask);
  const err = (a, b, keys) => (a && b ? Math.max(...keys.map((k) => Math.abs(a[k] - b[k]))) : a ? 'missing' : null);
  rows.push({
    frame: m.frame,
    shot: m.shot,
    t: Math.round(t * 1000) / 1000,
    ...Object.fromEntries(Object.entries(score).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
    motion: Number.isFinite(motion) ? Math.round(motion * 1000) / 1000 : null,
    ringErr: err(m.ring, f.ring, ['cx', 'cy', 'r']),
    horizonErr: err(m.horizon, f.horizon, ['v']),
    domeErr: err(m.dome, f.dome, ['cx', 'cy', 'r']),
    shadowErr: err(m.shadow, f.shadow, ['cx', 'cy', 'r']),
    filmBytes: filmImg,
    ourBytes,
    mask,
  });
  process.stdout.write('.');
}
process.stdout.write('\n');

// The table: means per shot.
const parts = [...Object.keys(SCORE_WEIGHTS), 'total', 'motion'];
const mean = (list, k) => {
  const v = list.map((r) => r[k]).filter((x) => typeof x === 'number' && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
};
const featureSummary = (list, k) => {
  const vals = list.map((r) => r[k]).filter((x) => x !== null);
  if (!vals.length) return '–';
  const missing = vals.filter((x) => x === 'missing').length;
  const nums = vals.filter((x) => typeof x === 'number');
  const avg = nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(3) : '–';
  return missing ? `${avg} (${missing}/${vals.length} missing)` : avg;
};
const lines = [];
lines.push(`| shot | frames | ${parts.join(' | ')} | ring err | line err | dome err | shadow err |`);
lines.push(`|${'---|'.repeat(parts.length + 6)}`);
const groups = [...FILM_SHOTS.map((s) => [s.name, rows.filter((r) => r.shot === s.name)]), ['all', rows]];
for (const [name, list] of groups) {
  if (!list.length) continue;
  lines.push(`| ${name} | ${list.length} | ${parts.map((k) => (Number.isFinite(mean(list, k)) ? mean(list, k).toFixed(3) : '–')).join(' | ')} | ${['ringErr', 'horizonErr', 'domeErr', 'shadowErr'].map((k) => featureSummary(list, k)).join(' | ')} |`);
}
console.log(lines.join('\n'));
console.log('(scores 0–1, higher is better; feature errors in frame heights, lower is better)');
writeFileSync(join(outDir, 'score.md'), lines.join('\n') + '\n');
writeFileSync(join(outDir, 'score.json'), JSON.stringify(rows.map(({ filmBytes, ourBytes, mask, ...r }) => r), null, 1));

// Sheets: per shot, film | ours pairs (every other measured frame), the
// spacecraft mask dimmed on both.
const tw = 320;
const th = 180;
for (const [name, list] of groups.slice(0, -1)) {
  const pick = list.filter((_, i) => i % 2 === 0);
  if (!pick.length) continue;
  const cols = 2;
  const sheet = canvas(cols * (2 * tw + 12), Math.ceil(pick.length / cols) * (th + 4));
  pick.forEach((r, i) => {
    const x0 = (i % cols) * (2 * tw + 12);
    const y0 = Math.floor(i / cols) * (th + 4);
    for (const [k, src] of [[0, r.filmBytes.rgb], [1, null]]) {
      const small = new Uint8Array(tw * th * 3);
      for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
          const sx = 3 * x;
          const sy = 3 * y;
          const keep = r.mask[sy * MEASURE_W + sx] ? 1 : 0.3;
          for (let c = 0; c < 3; c++) {
            const v = src ? src[3 * (sy * MEASURE_W + sx) + c] * 255 : r.ourBytes[3 * (sy * MEASURE_W + sx) + c];
            small[3 * (y * tw + x) + c] = v * keep;
          }
        }
      }
      sheet.paste(small, tw, th, x0 + k * (tw + 2), y0);
    }
  });
  writeRGB(join(outDir, `${name}.jpg`), sheet.w, sheet.h, sheet.rgb);
}
console.log(`wrote ${outDir}/ (score.md, score.json, sheets)`);
