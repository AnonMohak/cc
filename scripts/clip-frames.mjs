// Extract the film clip's black-hole shots (src/intro/filmShots.js) as
// full-resolution PNG frames, for measuring only. The clip and the frames
// stay on your disk: images/ is gitignored, never commit them.
// Needs ffmpeg on the PATH.
//
//   node scripts/clip-frames.mjs --clip C:/path/interstellar.mp4
//
// Options: --out images/clip  --only wall,skim
// Output: <out>/<shot>/<clip frame, 4 digits>.png
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FILM_SHOTS } from '../src/intro/filmShots.js';

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
const clip = args.clip || process.env.INTRO_CLIP;
if (!clip || !existsSync(clip)) {
  console.error('Give the clip: --clip <path> (or INTRO_CLIP).');
  process.exit(1);
}
const out = args.out || 'images/clip';
const only = args.only ? args.only.split(',') : null;

for (const shot of FILM_SHOTS) {
  if (only && !only.includes(shot.name)) continue;
  const dir = join(out, shot.name);
  mkdirSync(dir, { recursive: true });
  const count = shot.last - shot.first + 1;
  if (readdirSync(dir).length === count) {
    console.log(`${shot.name}: ${count} frames already there`);
    continue;
  }
  // Decode from the start and keep the frames by number (exact, no seek
  // rounding); passthrough timing so none is dropped or repeated.
  execFileSync(
    'ffmpeg',
    ['-v', 'error', '-y', '-i', clip, '-vf', `select='between(n\\,${shot.first}\\,${shot.last})'`, '-fps_mode', 'passthrough', '-frames:v', String(count), '-start_number', String(shot.first), join(dir, '%04d.png')],
    { stdio: 'inherit' },
  );
  console.log(`${shot.name}: ${readdirSync(dir).length} frames`);
}
