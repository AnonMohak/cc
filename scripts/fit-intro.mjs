// Fit the intro to the film clip: a Nelder–Mead search (src/intro/fitMath.js)
// over chosen camera-key fields and look values, each try rendered on the
// GPU at a few measured film moments and scored against the clip
// (frameMatch.js), plus the error of the measured features (ring, dome and
// shadow circles, the edge-on line). Needs the clip frames
// (scripts/clip-frames.mjs) and ffmpeg.
//
//   node scripts/fit-intro.mjs --spec renders/fit/gap.json
//
// Spec (JSON): label, shots (film shots the frames come from), every (every
// n-th measured frame, default 3) or frames (clip frames), size { width,
// height, samples, steps }, params [{ path, min, max }] (look.NAME,
// key.N.FIELD, shot.NAME: fitMath.js applyParams), iterations, keys (a keys
// JSON file to start from), look (base look values to start from),
// features (weight of the feature error, default 1), step (simplex size),
// window { tFrom, tTo } (the keys `shot.` values go on; default: the shots').
// Output: renders/fit/<label>/ (result.json with the best values, keys and
// look; best.jpg film | ours; log.txt).
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILM_SHOTS, shotSeconds } from '../src/intro/filmShots.js';
import { FILM_MEASURES } from '../src/intro/filmMeasures.js';
import { clipFrameIntroTime, FILM_SCHEDULE, CAMERA_KEYS } from '../src/intro/introTimeline.js';
import { MARCH_LOOK, COMPOSITE_LOOK, SPRAY_LOOK } from '../src/intro/introLook.js';
import { nelderMead, applyParams, fromShare, toShare } from '../src/intro/fitMath.js';
import { readRGB, writeRGB, canvas } from './imageIO.mjs';
import { openIntro } from './introBrowser.mjs';

const argv = process.argv.slice(2);
const specFile = argv[argv.indexOf('--spec') + 1];
const spec = JSON.parse(readFileSync(specFile, 'utf8'));
const label = spec.label || 'fit';
const outDir = join('renders/fit', label);
mkdirSync(outDir, { recursive: true });
const log = (line) => {
  console.log(line);
  appendFileSync(join(outDir, 'log.txt'), line + '\n');
};
writeFileSync(join(outDir, 'log.txt'), '');

const size = { width: 960, height: 540, samples: 2, steps: 700, ...(spec.size || {}) };
const shots = spec.shots || [FILM_SHOTS[0].name];
const startKeys = spec.keys ? JSON.parse(readFileSync(spec.keys, 'utf8')) : CAMERA_KEYS;
const startLook = { ...MARCH_LOOK, ...COMPOSITE_LOOK, ...SPRAY_LOOK, ...(spec.look || {}) };
const featureWeight = spec.features ?? 1;

// The film moments: every n-th measured frame of the shots (or the given ones).
const targets = spec.frames
  ? FILM_MEASURES.filter((m) => spec.frames.includes(m.frame))
  : shots.flatMap((name) => FILM_MEASURES.filter((m) => m.shot === name).filter((_, i, all) => i % (spec.every ?? 3) === 0 || i === all.length - 1));
const film = targets.map((m) => ({ m, t: clipFrameIntroTime(m.frame) }));

// `shot.` values apply to the keys inside the fitted shots' time window.
const sched = shots.map((name) => ({ ...FILM_SCHEDULE.find((s) => s.shot === name), len: shotSeconds(FILM_SHOTS.find((s) => s.name === name)) }));
const window = spec.window ?? { tFrom: Math.min(...sched.map((s) => s.start)), tTo: Math.max(...sched.map((s) => s.start + s.len)) };

// Start values: the current ones (spec.init overrides).
const params = spec.params;
const current = (p) => {
  const [kind, ...rest] = p.path.split('.');
  const m = /^([A-Z0-9_]+)(?:\[(\d)\])?$/.exec(rest.join('.'));
  if (kind === 'key') return startKeys[Number(rest[0])][rest[1]];
  if (kind === 'keys') return startKeys[Number(rest[0].split('-')[0])][rest[1]];
  const inShot = kind === 'shot' ? startKeys.find((k) => k.t >= window.tFrom && k.t <= window.tTo && k.look?.[m[1]] !== undefined) : null;
  const v = inShot ? inShot.look[m[1]] : startLook[m[1]];
  return m[2] !== undefined ? v[Number(m[2])] : v;
};
const x0 = params.map((p, i) => toShare(p, spec.init?.[i] ?? current(p)));

const circleError = (a, b) => (a && b ? Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy), Math.abs(a.r - b.r)) : a ? 0.3 : 0);
function featureError(m, f) {
  let e = 0;
  let n = 0;
  for (const k of ['ring', 'dome', 'shadow']) {
    if (!m[k]) continue;
    e += circleError(m[k], f[k]);
    n++;
  }
  if (m.horizon) {
    e += f.horizon ? Math.abs(m.horizon.v - f.horizon.v) : 0.1;
    n++;
  }
  if (m.spray) {
    e += f.spray ? Math.max(Math.abs(m.spray.cx - f.spray.cx), Math.abs(m.spray.cy - f.spray.cy), Math.abs(m.spray.spread - f.spray.spread), Math.abs(m.spray.share - f.spray.share)) : 0.3;
    n++;
  }
  return n ? e / n : 0;
}

const page = await openIntro({ gpu: spec.gpu || 'high' });
let best = { value: Infinity };
try {
  log(`GPU: ${page.gpu}; ${targets.length} frames; ${params.length} params`);
  // The page scores (scripts/labPage.js): only numbers come back.
  await page.evaluate(`(async () => { window.__lab = await import('/scripts/labPage.js'); return __lab.loadFilm(${JSON.stringify(targets)}); })()`);
  const evaluate = async (x) => {
    const values = params.map((p, i) => fromShare(p, x[i]));
    const { keys, look } = applyParams(params, values, startKeys, startLook, window);
    const results = await page.evaluate(`(() => {
      const i = __app.getIntro();
      i.keys = ${JSON.stringify(keys)};
      i.setLook(${JSON.stringify(look)});
      return ${JSON.stringify(film)}.map((f) => __lab.scoreAt(f.t, ${JSON.stringify(size)}, f.m, { features: ${featureWeight > 0} }));
    })()`);
    let loss = 0;
    const frames = results.map((r, k) => {
      const fe = featureWeight ? featureError(film[k].m, r.features) : 0;
      loss += 1 - r.score.total + featureWeight * fe;
      return { f: film[k], score: r.score, fe };
    });
    loss /= film.length;
    return { loss, values, keys, look, frames };
  };
  const result = await nelderMead(
    async (x) => {
      const r = await evaluate(x);
      if (r.loss < best.value) best = { value: r.loss, x, values: r.values, keys: r.keys, look: r.look };
      return r.loss;
    },
    x0,
    {
      iterations: spec.iterations ?? 100,
      step: spec.step ?? 0.15,
      onStep: (x, value, n) => log(`${n}\t${value.toFixed(4)}\t${params.map((p, i) => `${p.path}=${fromShare(p, x[i]).toFixed(3)}`).join(' ')}`),
    },
  );
  const start = await evaluate(x0);
  const final = await evaluate(best.x);
  log(`start loss ${start.loss.toFixed(4)} -> best ${final.loss.toFixed(4)} (${result.evaluations} tries)`);
  for (const fr of final.frames) log(`  ${fr.f.m.shot} ${fr.f.m.frame}: total ${fr.score.total.toFixed(3)} (shape ${fr.score.shape.toFixed(2)} tone ${fr.score.tone.toFixed(2)} colour ${fr.score.colour.toFixed(2)} detail ${fr.score.detail.toFixed(2)} streaks ${fr.score.streaks.toFixed(2)}) feature error ${fr.fe.toFixed(3)}`);
  writeFileSync(
    join(outDir, 'result.json'),
    JSON.stringify({ label, loss: final.loss, startLoss: start.loss, params: params.map((p, i) => ({ ...p, value: final.values[i] })), keys: final.keys, look: final.look }, null, 1),
  );
  // The sheet: film | ours at the best values.
  const tw = 320;
  const th = 180;
  const sheet = canvas(2 * (2 * tw + 12), Math.ceil(film.length / 2) * (th + 4));
  for (const [i, f] of film.entries()) {
    const jpg = join(outDir, `ours_${f.m.shot}_${f.m.frame}.jpg`);
    writeFileSync(jpg, Buffer.from(await page.evaluate(`__lab.grab(${f.t}, ${JSON.stringify(size)})`), 'base64'));
    const x0p = (i % 2) * (2 * tw + 12);
    const y0p = Math.floor(i / 2) * (th + 4);
    sheet.paste(readRGB(join('images/clip', f.m.shot, `${String(f.m.frame).padStart(4, '0')}.png`), tw, th), tw, th, x0p, y0p);
    sheet.paste(readRGB(jpg, tw, th), tw, th, x0p + tw + 2, y0p);
  }
  writeRGB(join(outDir, 'best.jpg'), sheet.w, sheet.h, sheet.rgb);
  log(`wrote ${outDir}/ (result.json, best.jpg)`);
} finally {
  page.close();
}
