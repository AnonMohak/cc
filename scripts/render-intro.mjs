// Offline render of the intro cinematic (IntroCinematic.renderStill) to PNG
// frames, for the pre-rendered intro video. It starts its own Vite dev
// server and a headless Edge (or BROWSER) on the real GPU, and drives them
// over the DevTools protocol (no packages needed).
//
//   node scripts/render-intro.mjs --times 0,12,41            # single frames
//   node scripts/render-intro.mjs --from 0 --to 66 --fps 24  # a sequence
//
// Options: --out renders  --width 1920  --height 1080  --samples 16
//          --steps 1500  --tile 256  --format png|jpg  --resume (skip
//          frames already written, to continue a stopped render)
// Output: <out>/t<seconds>.png for --times, <out>/frame_00001.png… for a
// sequence. renders/ is gitignored.
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
const VITE_PORT = 5299;
const CDP_PORT = 9533;
const BROWSER = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check, what, tries = 150, ms = 200) {
  for (let i = 0; i < tries; i++) {
    if (await check().catch(() => false)) return;
    await sleep(ms);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function kill(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
    else child.kill('SIGTERM');
  } catch {
    // already gone
  }
}

async function main() {
  const frames = frameList().filter(([name]) => !('resume' in args && existsSync(join(out, name))));
  mkdirSync(out, { recursive: true });
  const vite = spawn(`npx vite --port ${VITE_PORT} --strictPort`, { shell: true, stdio: 'ignore' });
  const browser = spawn(
    BROWSER,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${mkdtempSync(join(tmpdir(), 'intro-render-'))}`,
      '--window-size=1280,720',
      '--no-first-run',
      '--ignore-gpu-blocklist',
      '--enable-gpu',
      '--use-angle=d3d11',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  try {
    await waitFor(async () => (await fetch(`http://localhost:${VITE_PORT}/`)).ok, 'the dev server');
    let version;
    await waitFor(async () => (version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()), 'the browser');

    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    let id = 0;
    const waiters = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') console.log('page exception', JSON.stringify(m.params.exceptionDetails).slice(0, 300));
      if (m.id && waiters.has(m.id)) {
        const w = waiters.get(m.id);
        waiters.delete(m.id);
        m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result);
      }
    });
    const send = (method, params = {}, sessionId) => {
      const msg = { id: ++id, method, params, ...(sessionId ? { sessionId } : {}) };
      ws.send(JSON.stringify(msg));
      return new Promise((resolve, reject) => waiters.set(msg.id, { resolve, reject }));
    };
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = (method, params) => send(method, params, sessionId);
    const evaluate = async (expression) => {
      const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
      return r.result.value;
    };
    await s('Runtime.enable');
    // ?tune: the intro neither ends nor locks input.
    await s('Page.navigate', { url: `http://localhost:${VITE_PORT}/?tune` });
    await waitFor(() => evaluate('!!window.__app?.getIntro()?.ready'), 'the intro (noise bake)');
    const gpu = await evaluate(`(() => { const gl = __app.renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()`);
    console.log(`GPU: ${gpu}`);
    await evaluate('__app.getIntro().holdLive = true');

    const started = Date.now();
    for (const [i, [name, t]] of frames.entries()) {
      const begin = Date.now();
      const png = await evaluate(`(async () => {
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
    ws.close();
  } finally {
    kill(browser);
    kill(vite);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
