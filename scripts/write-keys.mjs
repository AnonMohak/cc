// Write fitted camera keys (a JSON array, e.g. a fit's result) into
// src/intro/introKeys.js, grouped by film shot with a comment each. Numbers
// are rounded to 4 significant decimals.
//
//   node scripts/write-keys.mjs renders/fit/keys.json
import { readFileSync, writeFileSync } from 'node:fs';
import { FILM_SCHEDULE } from '../src/intro/introTimeline.js';
import { FILM_SHOTS, shotSeconds } from '../src/intro/filmShots.js';

const keys = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const round = (v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : Array.isArray(v) ? v.map(round) : v);
const NOTES = {
  'gap-dome': "Gap → dome: the film's dolly zoom (inside the clear gap with a wide lens, back over the inner edge and up over the cloud tops as the lens narrows).",
  clouds: 'Low over the orange cloud tops toward the glow.',
  wall: 'The flame wall: the far disc bent up beside the shadow.',
  skim: 'Skimming the cloud tops toward the shadow.',
  bright: 'Looking up into the bright bent light.',
  'hole-far': 'The hole from farther away (it fades in over its first 0.8 s).',
  inside: 'Inside: the push-in has filled the frame with the shadow; the spray of specks over the black.',
};
const shotAt = (t) => {
  for (const { shot, start } of FILM_SCHEDULE) {
    const len = shotSeconds(FILM_SHOTS.find((s) => s.name === shot));
    if (t >= start - 1e-6 && t <= start + len + 1e-6) return shot;
  }
  return null;
};
const lines = [];
let last;
for (const k of keys) {
  const shot = shotAt(k.t);
  const group = shot ?? 'move';
  if (group !== last) {
    lines.push(shot ? `  // ${shot}: ${NOTES[shot]}` : '  // Move between the shots.');
    last = group;
  }
  const out = Object.fromEntries(Object.entries(k).filter(([, v]) => v !== undefined).map(([n, v]) => [n, n === 'look' ? Object.fromEntries(Object.entries(v).map(([a, b]) => [a, round(b)])) : round(v)]));
  lines.push(`  ${JSON.stringify(out)},`);
}
writeFileSync(
  'src/intro/introKeys.js',
  `/**
 * The intro's camera keys (introTimeline.js reads them), as data: t (s), r
 * (Rs), el (deg above the disc plane), az (deg, the disc turns toward
 * +azimuth), lead (deg the view turns from the hole toward the motion),
 * aimY (Rs: the aim point's height), roll (deg), fov (deg, vertical), exp
 * (exposure), sparse (0–1: inner gas thinned to clumps), haze, sat, ghost,
 * and look (introLook.js values for this key; eased between keys).
 *
 * Inside the film shots (introTimeline.js FILM_SCHEDULE) the keys sit at
 * measured clip frames, first solved from the measured shadow circles
 * (shotSolve.js), then fitted to the clip (scripts/fit-intro.mjs); between
 * the shots they are set by hand. Written by scripts/write-keys.mjs.
 */

export const CAMERA_KEYS = [
${lines.join('\n')}
];
`,
);
console.log(`wrote src/intro/introKeys.js (${keys.length} keys)`);
