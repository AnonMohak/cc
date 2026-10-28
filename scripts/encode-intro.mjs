// Encode the rendered intro frames (scripts/render-intro.mjs) into the two
// videos the intro plays (src/intro/introVideo.js INTRO_VIDEO_FILES):
// AV1 in WebM (smaller, newer browsers) and H.264 in MP4 (everywhere).
// Needs ffmpeg on the PATH (with libaom-av1 and libx264).
//
//   node scripts/encode-intro.mjs --in renders/full --format jpg
//
// Options: --in <frames dir>  --format png|jpg  --fps 24  --out public/video
//          --av1-crf 34  --h264-crf 22  --portrait (the portrait frames:
//          writes PORTRAIT_VIDEO_FILES, intro-portrait-*)
// Cloudflare Pages serves files up to 25 MiB: keep each video under that.
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
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
const ext = args.format === 'png' ? 'png' : 'jpg';
const input = join(args.in || 'renders/full', `frame_%05d.${ext}`);
const total = readdirSync(args.in || 'renders/full').filter((f) => /^frame_\d{5}\./.test(f) && f.endsWith(ext)).length;
const fps = args.fps || '24';
const out = args.out || 'public/video';
mkdirSync(out, { recursive: true });

// A progress bar from ffmpeg's -progress lines: redrawn in place on a
// terminal, one line per 5% in a log file.
function progress(name, frame) {
  const share = total ? Math.min(frame / total, 1) : 0;
  const bar = '#'.repeat(Math.round(share * 30)).padEnd(30, '.');
  const line = `${name} [${bar}] ${(share * 100).toFixed(0).padStart(3)}% (${frame}/${total})`;
  if (process.stdout.isTTY) process.stdout.write(`\r${line}`);
  else if (Math.floor(share * 20) > progress.step) {
    progress.step = Math.floor(share * 20);
    console.log(line);
  }
}

const run = (name, codec) =>
  new Promise((resolve, reject) => {
    const file = join(out, name);
    console.log(`encoding ${file}…`);
    progress.step = -1;
    const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-nostats', '-progress', 'pipe:1', '-framerate', fps, '-i', input, ...codec, '-pix_fmt', 'yuv420p', '-an', file], { stdio: ['ignore', 'pipe', 'inherit'] });
    let rest = '';
    ff.stdout.on('data', (chunk) => {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop();
      for (const l of lines) if (l.startsWith('frame=')) progress(name, Number(l.slice(6)));
    });
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (process.stdout.isTTY) process.stdout.write('\n');
      if (code !== 0) return reject(new Error(`ffmpeg exited with ${code}`));
      const mb = statSync(file).size / 2 ** 20;
      console.log(`${file}: ${mb.toFixed(1)} MiB${mb > 25 ? '  (over the 25 MiB Cloudflare Pages limit: raise the CRF)' : ''}`);
      resolve();
    });
  });

const prefix = 'portrait' in args ? 'intro-portrait' : 'intro';
await run(`${prefix}-av1.webm`, ['-c:v', 'libaom-av1', '-crf', args['av1-crf'] || '34', '-b:v', '0', '-cpu-used', '4', '-row-mt', '1', '-g', '48']);
await run(`${prefix}-h264.mp4`, ['-c:v', 'libx264', '-crf', args['h264-crf'] || '22', '-preset', 'slow', '-profile:v', 'high', '-g', '48', '-movflags', '+faststart']);
