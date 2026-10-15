// The intro lab: render our frames at chosen film moments (on the real GPU,
// IntroCinematic.renderStill), score them against the film clip
// (frameMatch.js) and write film | ours sheets, for quick trials of looks and
// camera keys. Needs the clip frames (scripts/clip-frames.mjs) and ffmpeg.
//
//   node scripts/intro-lab.mjs --shots gap-dome,wall --every 4 --label try1
//   node scripts/intro-lab.mjs --exp renders/lab/try2.json
//
// Options (or the same keys in an --exp JSON file): --label, --shots (film
// shots, default all), --every (every n-th measured frame, default 2),
// --width 960 --height 540 --samples 4 --steps 800, --gpu high (default),
// --look '{"EMIT":10}' (introLook.js values), --keys <file.json> (camera
// keys instead of introKeys.js), --times 9.7,18.5 (extra moments to show
// without a film frame). Output: renders/lab/<label>/ (sheet.jpg, score.md).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILM_SHOTS } from '../src/intro/filmShots.js';
import { FILM_MEASURES } from '../src/intro/filmMeasures.js';
import { clipFrameIntroTime } from '../src/intro/introTimeline.js';
import { MEASURE_W, MEASURE_H, measureMask, scoreMask, measureFeatures } from '../src/intro/filmFeatures.js';
import { imageFromBytes, halveImage, halve, frameStats, scoreFrame, SCORE_WEIGHTS } from '../src/intro/frameMatch.js';
import { readRGB, writeRGB, canvas } from './imageIO.mjs';
import { openIntro, renderFrame } from './introBrowser.mjs';

const cli = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split(' --')
    .map((p) => p.replace(/^--/, ''))
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf(' ');
      return i < 0 ? [part, ''] : [part.slice(0, i), part.slice(i + 1).trim()];
    }),
);
const exp = cli.exp ? JSON.parse(readFileSync(cli.exp, 'utf8')) : {};
const opt = (k, fallback) => cli[k] ?? exp[k] ?? fallback;
const label = opt('label', 'lab');
const outDir = join('renders/lab', label);
mkdirSync(outDir, { recursive: true });
const shots = String(opt('shots', FILM_SHOTS.map((s) => s.name).join(','))).split(',');
const every = Number(opt('every', 2));
const size = { width: Number(opt('width', MEASURE_W)), height: Number(opt('height', MEASURE_H)), samples: Number(opt('samples', 4)), steps: Number(opt('steps', 800)) };
const look = typeof opt('look', null) === 'string' ? JSON.parse(opt('look')) : opt('look', null);
const keysOpt = opt('keys', null);
const keys = typeof keysOpt === 'string' ? JSON.parse(readFileSync(keysOpt, 'utf8')) : keysOpt;
const extraTimes = String(opt('times', '')).split(',').filter(Boolean).map(Number);

/** RGB bytes at w × h from RGB bytes at sw × sh (nearest; for sheets only). */
function resize(src, sw, sh, w, h) {
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = 3 * (Math.floor((y * sh) / h) * sw + Math.floor((x * sw) / w));
      out.set(src.subarray(i, i + 3), 3 * (y * w + x));
    }
  }
  return out;
}

const targets = [];
for (const name of shots) {
  const list = FILM_MEASURES.filter((m) => m.shot === name);
  list.forEach((m, i) => {
    if (i % every === 0 || i === list.length - 1) targets.push(m);
  });
}

const page = await openIntro({ gpu: opt('gpu', 'high') });
const rows = [];
try {
  console.log(`GPU: ${page.gpu}`);
  if (look) await page.evaluate(`__app.getIntro().setLook(${JSON.stringify(look)})`);
  if (keys) await page.evaluate(`__app.getIntro().keys = ${JSON.stringify(keys)}`);
  for (const m of targets) {
    const t = clipFrameIntroTime(m.frame);
    const ours = await renderFrame(page.evaluate, t, size);
    const ourBytes = size.width === MEASURE_W ? ours : resize(ours, size.width, size.height, MEASURE_W, MEASURE_H);
    const filmBytes = readRGB(join('images/clip', m.shot, `${String(m.frame).padStart(4, '0')}.png`), MEASURE_W, MEASURE_H);
    const mask = measureMask(m.shot, m.ship);
    const mask2 = halve(new Float32Array(MEASURE_W * MEASURE_H), MEASURE_W, MEASURE_H, scoreMask(m)).mask;
    const film = frameStats(halveImage(imageFromBytes(filmBytes, MEASURE_W, MEASURE_H)), mask2);
    const ourImg = imageFromBytes(ourBytes, MEASURE_W, MEASURE_H);
    const score = scoreFrame(film, frameStats(halveImage(ourImg), mask2), mask2);
    const f = measureFeatures(m.shot, ourImg, mask);
    rows.push({ m, t, score, f, filmBytes, ourBytes });
    process.stdout.write(`${m.shot} ${m.frame} t=${t.toFixed(2)} total ${score.total.toFixed(3)}\n`);
  }
  for (const t of extraTimes) {
    const ours = await renderFrame(page.evaluate, t, size);
    rows.push({ m: null, t, ourBytes: size.width === MEASURE_W ? ours : resize(ours, size.width, size.height, MEASURE_W, MEASURE_H) });
  }
} finally {
  page.close();
}

// Score table: per shot means, then per frame, with the feature values.
const parts = [...Object.keys(SCORE_WEIGHTS), 'total'];
const lines = [`# ${label}`, '', `| shot | n | ${parts.join(' | ')} |`, `|${'---|'.repeat(parts.length + 2)}`];
const scored = rows.filter((r) => r.m);
for (const name of [...shots, 'all']) {
  const list = name === 'all' ? scored : scored.filter((r) => r.m.shot === name);
  if (!list.length) continue;
  lines.push(`| ${name} | ${list.length} | ${parts.map((k) => (list.reduce((a, r) => a + r.score[k], 0) / list.length).toFixed(3)).join(' | ')} |`);
}
const fmt = (c) => (c ? `(${c.cx.toFixed(3)}, ${c.cy.toFixed(3)}) r ${c.r.toFixed(3)}` : '–');
lines.push('', '| frame | t | total | film circle | ours | film line | ours |', '|---|---|---|---|---|---|---|');
for (const r of scored) {
  const key = r.m.ring ? 'ring' : r.m.dome ? 'dome' : r.m.shadow ? 'shadow' : null;
  lines.push(`| ${r.m.shot} ${r.m.frame} | ${r.t.toFixed(2)} | ${r.score.total.toFixed(3)} | ${key ? `${key} ${fmt(r.m[key])}` : '–'} | ${key ? fmt(r.f[key]) : '–'} | ${r.m.horizon ? r.m.horizon.v.toFixed(3) : '–'} | ${r.f.horizon ? r.f.horizon.v.toFixed(3) : '–'} |`);
}
writeFileSync(join(outDir, 'score.md'), lines.join('\n') + '\n');
console.log(lines.slice(0, 4 + shots.length + 1).join('\n'));

// Sheet: film | ours, two pairs a row; extra moments show ours only.
const tw = 320;
const th = 180;
const cols = 2;
const sheet = canvas(cols * (2 * tw + 12), Math.ceil(rows.length / cols) * (th + 4));
rows.forEach((r, i) => {
  const x0 = (i % cols) * (2 * tw + 12);
  const y0 = Math.floor(i / cols) * (th + 4);
  if (r.filmBytes) sheet.paste(resize(r.filmBytes, MEASURE_W, MEASURE_H, tw, th), tw, th, x0, y0);
  sheet.paste(resize(r.ourBytes, MEASURE_W, MEASURE_H, tw, th), tw, th, x0 + tw + 2, y0);
});
writeRGB(join(outDir, 'sheet.jpg'), sheet.w, sheet.h, sheet.rgb);
console.log(`wrote ${outDir}/ (sheet.jpg, score.md)`);
