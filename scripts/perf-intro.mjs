// Real-time speed of the intro: frame time of the live renderer (the
// fallback when the pre-rendered video is missing) at chosen moments, at
// 1920 × 1080, on the default GPU (the integrated one on a laptop with two;
// --gpu high for the discrete one). Each frame is waited for (a 1-pixel
// read), so the time is the GPU's. Run it from another checkout to compare
// versions (Vite serves the current folder):
//
//   node scripts/perf-intro.mjs [--times 2,14,26,39,48,54,62] [--frames 30] [--gpu high] [--keys file.json]
import { openIntro } from './introBrowser.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const times = arg('times', '2,5,14,26,39,48,54,62').split(',').map(Number);
const frames = Number(arg('frames', 30));
const keysFile = arg('keys', null);

const page = await openIntro({ gpu: arg('gpu', null) });
try {
  console.log(`GPU: ${page.gpu}`);
  console.log(`spray layer: ${await page.evaluate("typeof __app.getIntro().spray")}`);
  if (keysFile) await page.evaluate(`__app.getIntro().keys = ${(await import('node:fs')).readFileSync(keysFile, 'utf8')}`);
  const result = await page.evaluate(`(() => {
    const r = __app.renderer;
    const gl = r.getContext();
    const intro = __app.getIntro();
    // The app's own loop off: only these frames run.
    r.setAnimationLoop(null);
    intro.holdLive = false;
    r.setPixelRatio(1);
    r.setSize(1920, 1080, false);
    intro.setSize(1920, 1080);
    const px = new Uint8Array(4);
    const out = [];
    for (const t of ${JSON.stringify(times)}) {
      intro.fixedTime = t;
      const frame = () => {
        intro.update(t);
        intro.render(r);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      };
      for (let i = 0; i < 6; i++) frame();
      const ms = [];
      for (let i = 0; i < ${frames}; i++) {
        const t0 = performance.now();
        frame();
        ms.push(performance.now() - t0);
      }
      ms.sort((a, b) => a - b);
      out.push({ t, median: ms[ms.length >> 1], p90: ms[Math.floor(ms.length * 0.9)] });
    }
    return out;
  })()`);
  console.log('| t (s) | median ms | 90th ms |\n|---|---|---|');
  for (const r of result) console.log(`| ${r.t} | ${r.median.toFixed(1)} | ${r.p90.toFixed(1)} |`);
  const mean = result.reduce((a, r) => a + r.median, 0) / result.length;
  console.log(`mean of medians: ${mean.toFixed(1)} ms (${(1000 / mean).toFixed(1)} fps)`);
} finally {
  page.close();
}
