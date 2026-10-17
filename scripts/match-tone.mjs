// Tone match per shot: render our frames with a neutral grade (identity tone
// curve and CDL, no grain), compare each colour channel's brightness
// distribution with the film's over the same pixels (spacecraft out), and
// give the shot's camera keys the curve that maps one onto the other
// (src/intro/toneMatch.js), with a neutral CDL. So each shot gets the film's
// own light, dark and colour. First the shot's key exposures are scaled so
// our middle brightness meets the film's (a curve cannot spread out frames
// that are nearly all white or all black). Needs the clip frames
// (scripts/clip-frames.mjs).
//
//   node scripts/match-tone.mjs --keys renders/fit/keys.json --out renders/fit/keys-tone.json
//
// Options: --keys (default renders/fit/keys.json), --out (default: --keys),
// --every (every n-th measured frame, default 2), --groups gap,dome,...
import { readFileSync, writeFileSync } from 'node:fs';
import { FILM_MEASURES } from '../src/intro/filmMeasures.js';
import { clipFrameIntroTime } from '../src/intro/introTimeline.js';
import { CURVE_KNOTS } from '../src/intro/introLook.js';
import { emptyHist, mergeHist, matchCurve, TONE_BINS } from '../src/intro/toneMatch.js';
import { openIntro } from './introBrowser.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const keysFile = arg('keys', 'renders/fit/keys.json');
const outFile = arg('out', keysFile);
const every = Number(arg('every', 2));

// The film shots' parts that share one grade, and their camera keys (index
// in the keys file). The gap and the dome are one film shot, two grades.
// `fill`: the shadow takes the film's own colour there (FILL_*, measured
// inside the film's shadow circle), and the curve leaves the shadow out.
const GROUPS = {
  gap: { shot: 'gap-dome', to: 80, keys: [0, 1, 2] },
  dome: { shot: 'gap-dome', from: 84, keys: [3, 4, 5, 6], fill: true },
  clouds: { shot: 'clouds', keys: [8, 9] },
  wall: { shot: 'wall', keys: [11, 12, 13], fill: true },
  skim: { shot: 'skim', keys: [15, 16, 17], fill: true },
  bright: { shot: 'bright', keys: [19, 20] },
  'hole-far': { shot: 'hole-far', keys: [21, 22], fill: true },
};
const names = arg('groups', Object.keys(GROUPS).join(',')).split(',');

const GRADE = (k) => /^(CURVE_\d|CDL_|FILL_)/.test(k);
const keys = JSON.parse(readFileSync(keysFile, 'utf8')).map((k) => (k.look ? { ...k, look: Object.fromEntries(Object.entries(k.look).filter(([n]) => !GRADE(n))) } : k));
const neutral = {
  ...Object.fromEntries(CURVE_KNOTS.map((x, i) => [`CURVE_${i}`, [x, x, x]])),
  CDL_SLOPE: [1, 1, 1],
  CDL_OFFSET: [0, 0, 0],
  CDL_POWER: [1, 1, 1],
  FILL_A: 0,
  GRAIN: 0,
};
const size = { width: 960, height: 540, samples: 2, steps: 600 };

const frames = (g) => {
  const list = FILM_MEASURES.filter((m) => m.shot === g.shot && m.frame >= (g.from ?? -Infinity) && m.frame <= (g.to ?? Infinity));
  return list.filter((_, i) => i % every === 0 || i === list.length - 1);
};

/** The median of a histogram's mean of the three channels (about the luma). */
const median = (h) => {
  const q = (c) => {
    let seen = 0;
    for (let i = 0; i < TONE_BINS; i++) if ((seen += h[c][i]) >= h.n / 2) return (i + 0.5) / TONE_BINS;
    return 1;
  };
  return (q('r') + q('g') + q('b')) / 3;
};

const page = await openIntro({ gpu: 'high' });
try {
  const all = names.flatMap((n) => frames(GROUPS[n]));
  await page.evaluate(`(async () => { window.__lab = await import('/scripts/labPage.js'); return __lab.loadFilm(${JSON.stringify(all)}); })()`);
  await page.evaluate(`(() => { const i = __app.getIntro(); i.keys = ${JSON.stringify(keys)}; i.setLook(${JSON.stringify(neutral)}); })()`);
  for (const name of names) {
    const g = GROUPS[name];
    const measure = async () => {
      let ours = emptyHist();
      let film = emptyHist();
      for (const m of frames(g)) {
        const h = await page.evaluate(`__lab.histAt(${clipFrameIntroTime(m.frame)}, ${JSON.stringify(size)}, ${JSON.stringify(m)}, { cutShadow: ${!!g.fill} })`);
        ours = mergeHist(ours, h.ours);
        film = mergeHist(film, h.film);
      }
      return { ours, film };
    };
    let { ours, film } = await measure();
    // Exposure first (display ~ linear^(1/2.2) in the mid-tones), twice.
    for (let pass = 0; pass < 2; pass++) {
      const f = Math.min(4, Math.max(0.25, Math.pow(Math.max(median(film), 0.02) / Math.max(median(ours), 0.02), 2.2)));
      if (Math.abs(f - 1) < 0.05) break;
      for (const i of g.keys) keys[i].exp *= f;
      await page.evaluate(`__app.getIntro().keys = ${JSON.stringify(keys)}`);
      ({ ours, film } = await measure());
    }
    const curve = matchCurve(ours, film, CURVE_KNOTS);
    const grade = { ...Object.fromEntries(curve.map((rgb, i) => [`CURVE_${i}`, rgb.map((v) => Math.round(v * 1000) / 1000)])), CDL_SLOPE: [1, 1, 1], CDL_OFFSET: [0, 0, 0], CDL_POWER: [1, 1, 1] };
    if (g.fill) {
      // The film's shadow colours over the shot's frames (where measured).
      const sum = { inner: [0, 0, 0], outer: [0, 0, 0], nIn: 0, nOut: 0 };
      for (const m of frames(g)) {
        const c = await page.evaluate(`__lab.filmShadowColour(${JSON.stringify(m)})`);
        if (!c) continue;
        for (let k = 0; k < 3; k++) {
          sum.inner[k] += c.inner[k];
          sum.outer[k] += c.outer[k];
        }
        sum.nIn += c.nIn;
        sum.nOut += c.nOut;
      }
      const mean = (v, n) => v.map((x) => Math.round((x / Math.max(n, 1)) * 1000) / 1000);
      if (sum.nIn + sum.nOut > 0) {
        Object.assign(grade, { FILL_A: 1, FILL_R: 1.3, FILL_IN: mean(sum.inner, sum.nIn || sum.nOut), FILL_OUT: mean(sum.outer, sum.nOut || sum.nIn) });
        if (!sum.nIn) grade.FILL_IN = mean(sum.outer, sum.nOut);
        console.log(`${name} shadow fill: middle ${grade.FILL_IN.join('/')}, edge ${grade.FILL_OUT.join('/')}`);
      }
    }
    for (const i of g.keys) keys[i].look = { ...(keys[i].look || {}), ...grade };
    console.log(`${name} (${frames(g).length} frames): ${curve.map((rgb) => rgb.map((v) => v.toFixed(2)).join('/')).join('  ')}`);
  }
} finally {
  page.close();
}
writeFileSync(outFile, JSON.stringify(keys, null, 1));
console.log(`wrote ${outFile}`);
