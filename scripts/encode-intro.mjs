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
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
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
const input = join(args.in || 'renders/full', `frame_%05d.${args.format === 'png' ? 'png' : 'jpg'}`);
const fps = args.fps || '24';
const out = args.out || 'public/video';
mkdirSync(out, { recursive: true });

const run = (name, codec) => {
  const file = join(out, name);
  console.log(`encoding ${file}…`);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', fps, '-i', input, ...codec, '-pix_fmt', 'yuv420p', '-an', file], { stdio: 'inherit' });
  const mb = statSync(file).size / 2 ** 20;
  console.log(`${file}: ${mb.toFixed(1)} MiB${mb > 25 ? '  (over the 25 MiB Cloudflare Pages limit: raise the CRF)' : ''}`);
};

const prefix = 'portrait' in args ? 'intro-portrait' : 'intro';
run(`${prefix}-av1.webm`, ['-c:v', 'libaom-av1', '-crf', args['av1-crf'] || '34', '-b:v', '0', '-cpu-used', '4', '-row-mt', '1', '-g', '48']);
run(`${prefix}-h264.mp4`, ['-c:v', 'libx264', '-crf', args['h264-crf'] || '22', '-preset', 'slow', '-profile:v', 'high', '-g', '48', '-movflags', '+faststart']);
