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
// --every (every n-th measured frame, default 2), --groups gap,dome,...,
// --rounds (shadow light rounds, default 4).
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
// `fill`: the shadow gets its own light (SHADOW_*, on the rays the hole
// takes), set in a few rounds so that the finished frames show the film's
// colours inside the film's shadow circle; the curve leaves the shadow out.
// `flat`: one shadow colour, no gradient (a steep curve turns a gradient
// into a rainbow). `luma`: one curve for all three channels (our own
// colours kept: where our colour mix differs from the film's, a curve per
// channel shifts the hue).
const GROUPS = {
  gap: { shot: 'gap-dome', to: 80, keys: [0, 1, 2] },
  dome: { shot: 'gap-dome', from: 84, keys: [3, 4, 5, 6], fill: true },
  clouds: { shot: 'clouds', keys: [8, 9] },
  wall: { shot: 'wall', keys: [11, 12, 13], fill: true },
  skim: { shot: 'skim', keys: [15, 16, 17], fill: true },
  bright: { shot: 'bright', keys: [19, 20], luma: true },
  'hole-far': { shot: 'hole-far', keys: [21, 22], fill: true, flat: true, luma: true },
};
const names = arg('groups', Object.keys(GROUPS).join(',')).split(',');

// (The shadow light is kept: a new run goes on from it.)
const GRADE = (k) => /^(CURVE_\d|CDL_|FILL_)/.test(k);
const rounds = Number(arg('rounds', 4));
// The matched groups' keys lose their old grade (the others keep theirs).
const matched = new Set(names.flatMap((n) => GROUPS[n].keys));
const keys = JSON.parse(readFileSync(keysFile, 'utf8')).map((k, i) => (k.look && matched.has(i) ? { ...k, look: Object.fromEntries(Object.entries(k.look).filter(([n]) => !GRADE(n))) } : k));
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

/** A quantile of a histogram's mean of the three channels (about the luma). */
const level = (h, p) => {
  const q = (c) => {
    let seen = 0;
    for (let i = 0; i < TONE_BINS; i++) if ((seen += h[c][i]) >= h.n * p) return (i + 0.5) / TONE_BINS;
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
    // Exposure first (display ~ linear^(1/2.2) in the mid-tones), twice: on
    // the middle brightness, or for a mostly black shot (the gap) on its
    // bright end.
    const p = level(film, 0.5) < 0.15 ? 0.9 : 0.5;
    for (let pass = 0; pass < 2; pass++) {
      const f = Math.min(4, Math.max(0.25, Math.pow(Math.max(level(film, p), 0.02) / Math.max(level(ours, p), 0.02), 2.2)));
      if (Math.abs(f - 1) < 0.05) break;
      for (const i of g.keys) keys[i].exp *= f;
      await page.evaluate(`__app.getIntro().keys = ${JSON.stringify(keys)}`);
      ({ ours, film } = await measure());
    }
    const grey = (h) => {
      const out = emptyHist();
      for (let i = 0; i < TONE_BINS; i++) out.r[i] = out.g[i] = out.b[i] = h.r[i] + h.g[i] + h.b[i];
      out.n = 3 * h.n;
      return out;
    };
    const curve = g.luma ? matchCurve(grey(ours), grey(film), CURVE_KNOTS) : matchCurve(ours, film, CURVE_KNOTS);
    const grade = { ...Object.fromEntries(curve.map((rgb, i) => [`CURVE_${i}`, rgb.map((v) => Math.round(v * 1000) / 1000)])), CDL_SLOPE: [1, 1, 1], CDL_OFFSET: [0, 0, 0], CDL_POWER: [1, 1, 1] };
    for (const i of g.keys) keys[i].look = { ...(keys[i].look || {}), ...grade };
    if (g.fill) {
      // The shadow's own light: rounds of render, compare our colour inside
      // the film's shadow circle with the film's, scale (display ~
      // linear^(1/2.2)).
      const mean = async (fn) => {
        const sum = { inner: [0, 0, 0], outer: [0, 0, 0], nIn: 0, nOut: 0 };
        for (const m of frames(g)) {
          const c = await page.evaluate(fn(m));
          if (!c) continue;
          for (let k = 0; k < 3; k++) {
            sum.inner[k] += c.inner[k];
            sum.outer[k] += c.outer[k];
          }
          sum.nIn += c.nIn;
          sum.nOut += c.nOut;
        }
        const avg = (v, n) => v.map((x) => x / Math.max(n, 1));
        if (g.flat) {
          const all = avg(sum.inner.map((x, k) => x + sum.outer[k]), sum.nIn + sum.nOut);
          return { inner: all, outer: all, n: sum.nIn + sum.nOut };
        }
        const outer = sum.nOut ? avg(sum.outer, sum.nOut) : avg(sum.inner, sum.nIn);
        return { inner: sum.nIn ? avg(sum.inner, sum.nIn) : outer, outer, n: sum.nIn + sum.nOut };
      };
      const filmC = await mean((m) => `__lab.filmShadowColour(${JSON.stringify(m)})`);
      if (filmC.n > 0) {
        const exp = keys[g.keys[0]].exp;
        const had = keys[g.keys[0]].look?.SHADOW_IN;
        let lin = had
          ? { inner: had, outer: g.flat ? had : keys[g.keys[0]].look.SHADOW_OUT }
          : { inner: filmC.inner.map((v) => Math.pow(v, 2.2) / exp), outer: filmC.outer.map((v) => Math.pow(v, 2.2) / exp) };
        for (let round = 0; round < rounds; round++) {
          for (const i of g.keys) keys[i].look = { ...keys[i].look, SHADOW_ON: 1, SHADOW_IN: lin.inner, SHADOW_OUT: lin.outer };
          await page.evaluate(`__app.getIntro().keys = ${JSON.stringify(keys)}`);
          const ourC = await mean((m) => `__lab.ourShadowColour(${clipFrameIntroTime(m.frame)}, ${JSON.stringify(size)}, ${JSON.stringify(m)})`);
          // (Damped: the steep curves of some shots made full steps swing.)
          const step = (v, f, o) => v.map((x, k) => Math.max(1e-5, x * Math.min(2, Math.max(0.5, Math.pow(Math.max(f[k], 0.01) / Math.max(o[k], 0.01), 1.1)))));
          lin = { inner: step(lin.inner, filmC.inner, ourC.inner), outer: step(lin.outer, filmC.outer, ourC.outer) };
          console.log(`${name} shadow round ${round}: ours ${ourC.inner.map((v) => v.toFixed(2)).join('/')} vs film ${filmC.inner.map((v) => v.toFixed(2)).join('/')} (edge ${ourC.outer.map((v) => v.toFixed(2)).join('/')} vs ${filmC.outer.map((v) => v.toFixed(2)).join('/')})`);
        }
        const r4 = (v) => v.map((x) => Math.round(x * 1e5) / 1e5);
        for (const i of g.keys) keys[i].look = { ...keys[i].look, SHADOW_ON: 1, SHADOW_IN: r4(lin.inner), SHADOW_OUT: r4(lin.outer) };
        await page.evaluate(`__app.getIntro().keys = ${JSON.stringify(keys)}`);
      }
    }
    console.log(`${name} (${frames(g).length} frames): ${curve.map((rgb) => rgb.map((v) => v.toFixed(2)).join('/')).join('  ')}`);
  }
} finally {
  page.close();
}
writeFileSync(outFile, JSON.stringify(keys, null, 1));
console.log(`wrote ${outFile}`);
