// Motion check against the film: for frame pairs two clip frames apart
// (1/12 s), how far the picture moves (blockFlow per grid cell, spacecraft
// cells left out), in the film and in our frames at the same moments.
// Prints per shot the mean speed (px per frame at 1080 lines) and
// direction of both, and the motion score (frameMatch.js motionScore).
//
//   node scripts/motion-check.mjs [--shots wall,skim] [--every 4] [--keys file.json] [--look '{...}']
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { FILM_SHOTS } from '../src/intro/filmShots.js';
import { FILM_MEASURES } from '../src/intro/filmMeasures.js';
import { clipFrameIntroTime } from '../src/intro/introTimeline.js';
import { motionScore } from '../src/intro/frameMatch.js';
import { openIntro } from './introBrowser.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const shots = arg('shots', FILM_SHOTS.map((s) => s.name).join(',')).split(',');
const every = Number(arg('every', 4));
const keysFile = arg('keys', null);
const look = arg('look', null);
const GAP = 2;
const size = { width: 960, height: 540, samples: 2, steps: 600 };

const pairs = [];
for (const name of shots) {
  const shot = FILM_SHOTS.find((s) => s.name === name);
  const list = FILM_MEASURES.filter((m) => m.shot === name && m.frame + GAP <= shot.last);
  list.forEach((m, i) => {
    if (i % every === 0) pairs.push({ m0: m, m1: { ...m, frame: m.frame + GAP } });
  });
}

// Mean vector and mean length of the cells both sides measured.
function summary(flows) {
  let x = 0;
  let y = 0;
  let len = 0;
  let n = 0;
  for (const f of flows) {
    if (!f) continue;
    x += f[0];
    y += f[1];
    len += Math.hypot(f[0], f[1]);
    n++;
  }
  return n ? { x: x / n, y: y / n, len: len / n, n } : null;
}

const page = await openIntro({ gpu: 'high' });
const rows = [];
try {
  await page.evaluate(`(async () => { window.__lab = await import('/scripts/labPage.js'); return __lab.loadFilm(${JSON.stringify(pairs.flatMap((p) => [p.m0, p.m1]))}); })()`);
  if (keysFile) await page.evaluate(`__app.getIntro().keys = ${readFileSync(keysFile, 'utf8')}`);
  if (look) await page.evaluate(`__app.getIntro().setLook(${look})`);
  for (const p of pairs) {
    const t0 = clipFrameIntroTime(p.m0.frame);
    const t1 = clipFrameIntroTime(p.m1.frame);
    const f = await page.evaluate(`__lab.flowAt(${t0}, ${t1}, ${JSON.stringify(size)}, ${JSON.stringify(p.m0)}, ${JSON.stringify(p.m1)})`);
    // Only cells both sides could measure.
    const both = f.film.map((c, i) => (c && f.ours[i] ? i : -1)).filter((i) => i >= 0);
    rows.push({ shot: p.m0.shot, frame: p.m0.frame, t: t0, film: summary(both.map((i) => f.film[i])), ours: summary(both.map((i) => f.ours[i])), score: motionScore(f.film, f.ours) });
    process.stdout.write('.');
  }
} finally {
  page.close();
}
console.log('');

// px per pair at 960 wide = px per frame at 1080 lines (×2 size, ÷2 frames).
const fmt = (s) => (s ? `${s.len.toFixed(1)} px (${s.x.toFixed(1)}, ${s.y.toFixed(1)})` : '–');
const lines = ['| shot | pairs | film speed (mean vector) | ours | ours / film | motion score |', '|---|---|---|---|---|---|'];
for (const name of shots) {
  const list = rows.filter((r) => r.shot === name && r.film && r.ours);
  if (!list.length) continue;
  const mean = (k) => {
    const v = list.map((r) => r[k]);
    return { len: v.reduce((a, s) => a + s.len, 0) / v.length, x: v.reduce((a, s) => a + s.x, 0) / v.length, y: v.reduce((a, s) => a + s.y, 0) / v.length };
  };
  const film = mean('film');
  const ours = mean('ours');
  const score = list.reduce((a, r) => a + (Number.isFinite(r.score) ? r.score : 0), 0) / list.length;
  lines.push(`| ${name} | ${list.length} | ${fmt(film)} | ${fmt(ours)} | ${(ours.len / Math.max(film.len, 0.01)).toFixed(2)} | ${score.toFixed(3)} |`);
}
lines.push('', '| frame | t | film | ours | score |', '|---|---|---|---|---|');
for (const r of rows) lines.push(`| ${r.shot} ${r.frame} | ${r.t.toFixed(2)} | ${fmt(r.film)} | ${fmt(r.ours)} | ${Number.isFinite(r.score) ? r.score.toFixed(3) : '–'} |`);
mkdirSync('renders/motion', { recursive: true });
const out = `renders/motion/${arg('label', 'motion')}.md`;
writeFileSync(out, lines.join('\n') + '\n');
console.log(lines.slice(0, 2 + shots.length).join('\n'));
console.log(`wrote ${out}`);
