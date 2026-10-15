// Try a list of camera / look variants against the film clip and rank them
// (a coarse grid before a fit): each variant patches the camera keys and
// the look, renders a few measured film moments on the GPU and is scored in
// the page (scripts/labPage.js) like scripts/fit-intro.mjs does.
//
//   node scripts/try-intro.mjs --spec renders/try/wall.json
//
// Spec (JSON): label, frames (clip frames), keys (start keys file), size,
// features (weight), variants: [{ name, keys: { "11": { "fov": 95, ... } },
// look: { NAME: value } }]. Output: renders/try/<label>/ (rank.md, sheet.jpg
// with one row per variant: film | ours for each frame).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILM_MEASURES } from '../src/intro/filmMeasures.js';
import { clipFrameIntroTime, CAMERA_KEYS } from '../src/intro/introTimeline.js';
import { MARCH_LOOK, COMPOSITE_LOOK, SPRAY_LOOK } from '../src/intro/introLook.js';
import { readRGB, writeRGB, canvas } from './imageIO.mjs';
import { openIntro } from './introBrowser.mjs';

const argv = process.argv.slice(2);
const spec = JSON.parse(readFileSync(argv[argv.indexOf('--spec') + 1], 'utf8'));
const outDir = join('renders/try', spec.label || 'try');
mkdirSync(outDir, { recursive: true });
const size = { width: 960, height: 540, samples: 2, steps: 700, ...(spec.size || {}) };
const startKeys = spec.keys ? JSON.parse(readFileSync(spec.keys, 'utf8')) : CAMERA_KEYS;
const baseLook = { ...MARCH_LOOK, ...COMPOSITE_LOOK, ...SPRAY_LOOK };
const film = FILM_MEASURES.filter((m) => spec.frames.includes(m.frame)).map((m) => ({ m, t: clipFrameIntroTime(m.frame) }));
const fw = spec.features ?? 1;

const circleError = (a, b) => (a && b ? Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy), Math.abs(a.r - b.r)) : a ? 0.3 : 0);
const featureError = (m, f) => {
  const parts = [];
  for (const k of ['ring', 'dome', 'shadow']) if (m[k]) parts.push(circleError(m[k], f[k]));
  if (m.horizon) parts.push(f.horizon ? Math.abs(m.horizon.v - f.horizon.v) : 0.1);
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
};

const page = await openIntro({ gpu: 'high' });
const rows = [];
try {
  await page.evaluate(`(async () => { window.__lab = await import('/scripts/labPage.js'); return __lab.loadFilm(${JSON.stringify(film.map((f) => f.m))}); })()`);
  for (const v of spec.variants) {
    const keys = startKeys.map((k, i) => ({ ...k, ...((v.keys || {})[i] || {}) }));
    const look = { ...baseLook, ...(spec.look || {}), ...(v.look || {}) };
    const results = await page.evaluate(`(() => {
      const i = __app.getIntro();
      i.keys = ${JSON.stringify(keys)};
      i.setLook(${JSON.stringify(look)});
      return ${JSON.stringify(film)}.map((f) => __lab.scoreAt(f.t, ${JSON.stringify(size)}, f.m));
    })()`);
    const total = results.reduce((a, r) => a + r.score.total, 0) / results.length;
    const shape = results.reduce((a, r) => a + r.score.shape, 0) / results.length;
    const fe = results.reduce((a, r, k) => a + featureError(film[k].m, r.features), 0) / results.length;
    const jpgs = [];
    for (const f of film) {
      const file = join(outDir, `${v.name}_${f.m.frame}.jpg`);
      writeFileSync(file, Buffer.from(await page.evaluate(`__lab.grab(${f.t}, ${JSON.stringify(size)})`), 'base64'));
      jpgs.push(file);
    }
    rows.push({ name: v.name, total, shape, fe, loss: 1 - total + fw * fe, jpgs });
    console.log(`${v.name}: total ${total.toFixed(3)} shape ${shape.toFixed(3)} feature error ${fe.toFixed(3)}`);
  }
} finally {
  page.close();
}
rows.sort((a, b) => a.loss - b.loss);
writeFileSync(join(outDir, 'rank.md'), ['| variant | loss | total | shape | feature error |', '|---|---|---|---|---|', ...rows.map((r) => `| ${r.name} | ${r.loss.toFixed(3)} | ${r.total.toFixed(3)} | ${r.shape.toFixed(3)} | ${r.fe.toFixed(3)} |`)].join('\n') + '\n');
// Sheet: the film row, then one row per variant (best first).
const tw = 240;
const th = 135;
const sheet = canvas(film.length * (tw + 4) + 4, (rows.length + 1) * (th + 4));
film.forEach((f, j) => sheet.paste(readRGB(join('images/clip', f.m.shot, `${String(f.m.frame).padStart(4, '0')}.png`), tw, th), tw, th, j * (tw + 4), 0));
rows.forEach((r, i) => r.jpgs.forEach((file, j) => sheet.paste(readRGB(file, tw, th), tw, th, j * (tw + 4), (i + 1) * (th + 4))));
writeRGB(join(outDir, 'sheet.jpg'), sheet.w, sheet.h, sheet.rgb);
console.log(rows.map((r) => `${r.name} ${r.loss.toFixed(3)}`).join('\n'));
