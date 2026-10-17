// Offline render of the intro cinematic (IntroCinematic.renderStill) to PNG
// frames, for the pre-rendered intro video. It starts its own Vite dev
// server and a headless Edge (or BROWSER) on the real GPU, and drives them
// over the DevTools protocol (no packages needed; scripts/introBrowser.mjs).
//
//   node scripts/render-intro.mjs --times 0,12,41            # single frames
//   node scripts/render-intro.mjs --from 0 --to 66 --fps 24  # a sequence
//
// Options: --out renders  --width 1920  --height 1080  --samples 16
//          --steps 1500  --tile 256  --format png|jpg  --resume (skip
//          frames already written, to continue a stopped render)
//          --limit N (render at most N of the frames left, then stop: for
//          scripts/render-batches.mjs)
//          --gpu high (the discrete GPU on a laptop with two)
// Output: <out>/t<seconds>.png for --times, <out>/frame_00001.png… for a
// sequence. renders/ is gitignored.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openIntro } from './introBrowser.mjs';

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
const num = (key, fallback) => (args[key] === undefined ? fallback : Number(args[key]));
const width = num('width', 1920);
const height = num('height', 1080);
const options = { width, height, samples: num('samples', 16), steps: num('steps', 1500), tile: num('tile', 256) };
const out = args.out || 'renders';
const format = args.format === 'jpg' ? 'jpg' : 'png';

/** The frames to render: [file name, seconds]. */
function frameList() {
  if (args.times) return args.times.split(',').map((t) => [`t${Number(t)}.${format}`, Number(t)]);
  const from = num('from', 0);
  const to = num('to', 66);
  const fps = num('fps', 24);
  const list = [];
  for (let i = 0; from + i / fps <= to + 1e-9; i++) list.push([`frame_${String(i + 1).padStart(5, '0')}.${format}`, from + i / fps]);
  return list;
}

async function main() {
  const remaining = frameList().filter(([name]) => !('resume' in args && existsSync(join(out, name))));
  const frames = args.limit === undefined ? remaining : remaining.slice(0, num('limit', remaining.length));
  mkdirSync(out, { recursive: true });
  const page = await openIntro({ gpu: args.gpu });
  try {
    console.log(`GPU: ${page.gpu}`);
    const started = Date.now();
    for (const [i, [name, t]] of frames.entries()) {
      const begin = Date.now();
      const png = await page.evaluate(`(async () => {
        const W = ${width}, H = ${height};
        const px = __app.getIntro().renderStill(__app.renderer, ${t}, ${JSON.stringify(options)});
        const canvas = new OffscreenCanvas(W, H);
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(W, H);
        for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
        ctx.putImageData(img, 0, 0);
        const bytes = new Uint8Array(await (await canvas.convertToBlob(${format === 'jpg' ? "{ type: 'image/jpeg', quality: 0.95 }" : "{ type: 'image/png' }"})).arrayBuffer());
        let text = '';
        for (let k = 0; k < bytes.length; k += 0x8000) text += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
        return btoa(text);
      })()`);
      writeFileSync(join(out, name), Buffer.from(png, 'base64'));
      const each = (Date.now() - begin) / 1000;
      const left = ((Date.now() - started) / 1000 / (i + 1)) * (frames.length - i - 1);
      console.log(`${name} (t=${t.toFixed(3)} s) ${each.toFixed(1)} s, ~${Math.round(left / 60)} min left`);
    }
  } finally {
    page.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
