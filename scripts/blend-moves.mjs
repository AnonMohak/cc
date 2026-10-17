// The camera moves between film shots get the mean of the two shots'
// grades (tone curve, CDL and shadow light, from scripts/match-tone.mjs), so
// the picture does not pass through the base grade on the way (a dip in
// brightness and colour). A move key is a key without its own tone curve
// that has graded keys before and after it.
//
//   node scripts/blend-moves.mjs renders/fit/keys.json
import { readFileSync, writeFileSync } from 'node:fs';
import { CURVE_KNOTS } from '../src/intro/introLook.js';

const file = process.argv[2] || 'renders/fit/keys.json';
const keys = JSON.parse(readFileSync(file, 'utf8'));
const graded = (k) => k.look && Array.isArray(k.look.CURVE_0);
const mean = (a, b) => a.map((v, i) => Math.round(((v + b[i]) / 2) * 1e5) / 1e5);
const GRADE = [...CURVE_KNOTS.map((_, i) => `CURVE_${i}`), 'CDL_SLOPE', 'CDL_OFFSET', 'CDL_POWER'];

keys.forEach((k, i) => {
  if (graded(k)) return;
  const before = keys.slice(0, i).reverse().find(graded);
  const after = keys.slice(i + 1).find(graded);
  if (!before || !after) return;
  const look = { ...(k.look || {}) };
  for (const name of GRADE) look[name] = mean(before.look[name], after.look[name]);
  const on = [before, after].map((g) => g.look.SHADOW_ON ?? 0);
  if (on[0] + on[1] > 0) {
    const zero = [0, 0, 0];
    const pick = (name) => mean(before.look[name] ?? after.look[name] ?? zero, after.look[name] ?? before.look[name] ?? zero);
    Object.assign(look, { SHADOW_ON: (on[0] + on[1]) / 2, SHADOW_IN: pick('SHADOW_IN'), SHADOW_OUT: pick('SHADOW_OUT') });
  }
  k.look = look;
  console.log(`key ${i} (t ${k.t}): grade between t ${before.t} and t ${after.t}`);
});
writeFileSync(file, JSON.stringify(keys, null, 1));
