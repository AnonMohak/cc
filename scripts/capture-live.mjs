// Frames of the intro from the live renderer (for versions without the
// offline IntroCinematic.renderStill, such as branch lore-accurate): the
// intro plays at --sub times the frame rate (its frames blend over real
// time, as live), and every --sub-th frame is saved. Same options as
// scripts/render-intro.mjs for a sequence, so scripts/render-batches.mjs
// can drive it (--script). Vite serves the current folder: run it from the
// version's checkout.
//
//   node scripts/capture-live.mjs --from 0 --to 65 --fps 24 --width 960 --height 540 --out renders/x --format jpg [--sub 4] [--resume] [--limit N] [--gpu high]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openIntro } from './introBrowser.mjs';

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const next = argv[i + 1];
  args[argv[i].slice(2)] = next === undefined || next.startsWith('--') ? true : next;
}
const num = (k, d) => (args[k] === undefined ? d : Number(args[k]));
const out = args.out || 'renders/live';
const format = args.format === 'png' ? 'png' : 'jpg';
const width = num('width', 960);
const height = num('height', 540);
const fps = num('fps', 24);
const sub = num('sub', 4);
const from = num('from', 0);
const to = num('to', 65);

const all = [];
for (let i = 0; from + i / fps <= to + 1e-9; i++) all.push([`frame_${String(i + 1).padStart(5, '0')}.${format}`, from + i / fps]);
const remaining = all.filter(([name]) => !(args.resume && existsSync(join(out, name))));
const frames = args.limit === undefined ? remaining : remaining.slice(0, num('limit', remaining.length));
mkdirSync(out, { recursive: true });

const page = await openIntro({ gpu: args.gpu === true ? null : args.gpu });
try {
  console.log(`GPU: ${page.gpu}`);
  await page.evaluate(`(() => {
    const r = __app.renderer;
    r.setAnimationLoop(null);
    const intro = __app.getIntro();
    intro.holdLive = false;
    intro.fixedTime = null;
    r.setPixelRatio(1);
    r.setSize(${width}, ${height}, false);
    intro.setSize?.(${width}, ${height});
    window.__capture = async (t, warm) => {
      const gl = r.getContext();
      // Sub-frames up to t (more before the first frame: the blend settles).
      const n = warm ? 4 * ${sub} : ${sub};
      for (let k = n - 1; k >= 0; k--) {
        const tk = t - k / (${fps} * ${sub});
        intro.update(tk);
        intro.render(r);
      }
      const px = new Uint8Array(${width * height * 4});
      gl.readPixels(0, 0, ${width}, ${height}, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const canvas = new OffscreenCanvas(${width}, ${height});
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(${width}, ${height});
      for (let y = 0; y < ${height}; y++) img.data.set(px.subarray((${height} - 1 - y) * ${width} * 4, (${height} - y) * ${width} * 4), y * ${width} * 4);
      for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
      ctx.putImageData(img, 0, 0);
      const bytes = new Uint8Array(await (await canvas.convertToBlob(${format === 'jpg' ? "{ type: 'image/jpeg', quality: 0.95 }" : "{ type: 'image/png' }"})).arrayBuffer());
      let text = '';
      for (let k = 0; k < bytes.length; k += 0x8000) text += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
      return btoa(text);
    };
  })()`);
  let previous = null;
  for (const [name, t] of frames) {
    // A gap (a resumed run) or the first frame: let the blend settle again.
    const warm = previous === null || Math.abs(t - previous - 1 / fps) > 1e-6;
    const data = await page.evaluate(`__capture(${t}, ${warm})`);
    writeFileSync(join(out, name), Buffer.from(data, 'base64'));
    previous = t;
  }
  console.log(`wrote ${frames.length} frames to ${out}`);
} finally {
  page.close();
}
