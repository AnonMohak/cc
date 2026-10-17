// A headless browser on the real GPU with the intro open (?tune: it neither
// ends nor locks input), for the offline render and the lab scripts. Starts
// its own Vite dev server and Edge (or BROWSER) and drives them over the
// DevTools protocol (no packages needed).
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VITE_PORT = 5299;
const CDP_PORT = 9533;
const BROWSER = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

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

/**
 * Open a page of the app (served from the current folder) in a headless
 * browser and wait until `ready` (a page expression) is true. `gpu: 'high'`
 * asks for the discrete GPU on a laptop with two.
 * @returns {Promise<{ evaluate: (expression: string) => Promise<any>, send: (method: string, params?: object) => Promise<any>, on: (method: string, fn: (params: any) => void) => void, close: () => void }>}
 */
export async function openPage({ gpu = null, path = '/', ready = 'true', width = 1280, height = 720 } = {}) {
  // A dev server left from an earlier run would answer instead of ours (and
  // serve its own folder): stop rather than measure the wrong code.
  if (await fetch(`http://localhost:${VITE_PORT}/`).then(() => true, () => false)) {
    throw new Error(`port ${VITE_PORT} is in use (an old dev server?): stop it first`);
  }
  const vite = spawn(`npx vite --port ${VITE_PORT} --strictPort`, { shell: true, stdio: 'ignore' });
  const profile = mkdtempSync(join(tmpdir(), 'intro-render-'));
  const browser = spawn(
    BROWSER,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      '--no-first-run',
      '--ignore-gpu-blocklist',
      '--enable-gpu',
      '--use-angle=d3d11',
      ...(gpu === 'high' ? ['--force_high_performance_gpu'] : []),
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const close = () => {
    kill(browser);
    kill(vite);
    // The browser's temporary profile (it may still be locked for a moment).
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // left for the system's temp cleanup
    }
  };
  try {
    await waitFor(async () => (await fetch(`http://localhost:${VITE_PORT}/`)).ok, 'the dev server');
    let version;
    await waitFor(async () => (version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()), 'the browser');

    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    let id = 0;
    const waiters = new Map();
    // Page events (screencast frames and the like) for the caller.
    const listeners = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.method && listeners.has(m.method)) listeners.get(m.method)(m.params);
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
    // A call that hangs (a lost GPU device) fails after 3 minutes instead of
    // blocking a long fit forever.
    const evaluate = async (expression) => {
      let timer;
      const timeout = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('page call timed out (3 min)')), 180000)));
      const r = await Promise.race([s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), timeout]).finally(() => clearTimeout(timer));
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
      return r.result.value;
    };
    await s('Runtime.enable');
    await s('Page.navigate', { url: `http://localhost:${VITE_PORT}${path}` });
    await waitFor(() => evaluate(`!!(${ready})`), `the page (${ready})`);
    return {
      evaluate,
      send: s,
      on: (method, fn) => listeners.set(method, fn),
      close: () => {
        ws.close();
        close();
      },
    };
  } catch (err) {
    close();
    throw err;
  }
}

/**
 * Open the intro in a headless browser (the tune view: it neither ends nor
 * locks input), live frames held for renderStill.
 * @returns {Promise<{ evaluate: (expression: string) => Promise<any>, gpu: string, close: () => void }>}
 */
export async function openIntro({ gpu = null } = {}) {
  const page = await openPage({ gpu, path: '/?tune', ready: 'window.__app?.getIntro()?.ready' });
  try {
    const gpuName = await page.evaluate(`(() => { const gl = __app.renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()`);
    await page.evaluate('__app.getIntro().holdLive = true');
    return { evaluate: page.evaluate, gpu: gpuName, close: page.close };
  } catch (err) {
    page.close();
    throw err;
  }
}

/**
 * Render one intro frame in the page (IntroCinematic.renderStill) and return
 * it as RGB bytes, rows top to bottom.
 * @param {(expression: string) => Promise<any>} evaluate
 */
export async function renderFrame(evaluate, t, { width, height, samples, steps, tile = 256 }) {
  const b64 = await evaluate(`(() => {
    const W = ${width}, H = ${height};
    const px = __app.getIntro().renderStill(__app.renderer, ${t}, ${JSON.stringify({ width, height, samples, steps, tile })});
    const rgb = new Uint8Array(W * H * 3);
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4;
      for (let x = 0; x < W; x++) {
        rgb[(y * W + x) * 3] = px[src + x * 4];
        rgb[(y * W + x) * 3 + 1] = px[src + x * 4 + 1];
        rgb[(y * W + x) * 3 + 2] = px[src + x * 4 + 2];
      }
    }
    let text = '';
    for (let k = 0; k < rgb.length; k += 0x8000) text += String.fromCharCode(...rgb.subarray(k, k + 0x8000));
    return btoa(text);
  })()`);
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
