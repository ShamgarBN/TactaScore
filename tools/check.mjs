// Regression check against hand-verified photos (kept locally in samples/full, not in git).
// Usage: node tools/check.mjs
import fs from 'node:fs';
import { readBmp } from './bmp.mjs';
import { detect } from '../src/detect.js';

const EXPECTED = {
  'Cardcolors.bmp': { red: 4, yellow: 2, green: 6, blue: 1, purple: 6, pink: 4 },
  'Endgame.bmp': { red: 39, yellow: 40, blue: 48, pink: 42 }, // red unverified
  'Counter.bmp': { red: 5, yellow: 8, blue: 4 }, // granite countertop
};

let fail = 0;
for (const [file, want] of Object.entries(EXPECTED)) {
  const path = `samples/full/${file}`;
  if (!fs.existsSync(path)) { console.log(`skip  ${file} (missing)`); continue; }
  const got = detect(readBmp(path)).scores;
  const bad = Object.keys(got).filter((k) => (want[k] ?? 0) !== got[k]);
  if (bad.length) fail++;
  console.log(`${bad.length ? 'FAIL' : 'ok  '}  ${file}${bad.map((k) => `  ${k}: got ${got[k]}, want ${want[k] ?? 0}`).join('')}`);
}
process.exit(fail ? 1 : 0);
