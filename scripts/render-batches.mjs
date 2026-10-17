// A long intro render in batches: each batch is its own scripts/render-intro.mjs
// run (a fresh dev server and browser) of at most --batch frames, with
// --resume, so every batch's frames are saved and memory is given back
// between batches. After each batch: leftover processes of the render are
// stopped, and the progress and the free memory are logged (<out>.batches.log).
// A batch that renders nothing twice in a row stops the run.
//
//   node scripts/render-batches.mjs --batch 100 [--script scripts/capture-live.mjs] -- --from 0 --to 65 --fps 24 --out renders/preview ...
//
// Everything after -- goes to the render script (render-intro.mjs, or
// --script: one with the same options; --resume and --limit are added).
// Run it from the checkout to render (Vite serves the current folder).
import { spawnSync, execSync } from 'node:child_process';
import { existsSync, readdirSync, appendFileSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';

const argv = process.argv.slice(2);
const split = argv.indexOf('--');
const own = split < 0 ? argv : argv.slice(0, split);
const pass = split < 0 ? [] : argv.slice(split + 1);
const batch = Number(own.includes('--batch') ? own[own.indexOf('--batch') + 1] : 100);
const script = own.includes('--script') ? own[own.indexOf('--script') + 1] : 'scripts/render-intro.mjs';
const out = pass.includes('--out') ? pass[pass.indexOf('--out') + 1] : 'renders';
const num = (k, d) => (pass.includes(`--${k}`) ? Number(pass[pass.indexOf(`--${k}`) + 1]) : d);
// The same frame list as render-intro.mjs: from, from + 1/fps, … ≤ to.
const count = Math.floor((num('to', 66) - num('from', 0)) * num('fps', 24) + 1e-6) + 1;
const log = `${out}.batches.log`;

const done = () => (existsSync(out) ? readdirSync(out).filter((f) => f.startsWith('frame_')).length : 0);
const gb = (bytes) => (bytes / 2 ** 30).toFixed(1);
const say = (line) => {
  const text = `${new Date().toLocaleTimeString()} ${line}`;
  console.log(text);
  appendFileSync(log, text + '\n');
};

// Processes a render can leave behind (its dev server, the headless browser).
function cleanUp() {
  if (process.platform !== 'win32') return;
  try {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'intro-render-|vite.*--port 5299' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' },
    );
  } catch {
    // nothing left
  }
}

let stalled = 0;
cleanUp();
say(`start: ${done()}/${count} frames, batches of ${batch}`);
while (done() < count) {
  const before = done();
  const run = spawnSync('node', [script, ...pass, '--resume', '--limit', String(batch)], { stdio: ['ignore', 'ignore', 'pipe'] });
  cleanUp();
  const after = done();
  say(`Done ${after}/${count} (+${after - before}), free memory ${gb(freemem())} of ${gb(totalmem())} GB`);
  if (after === before) {
    stalled++;
    say(`batch rendered nothing: ${String(run.stderr).trim().split('\n').slice(-2).join(' | ')}`);
    if (stalled >= 2) process.exit(1);
  } else stalled = 0;
}
say('all frames done');
