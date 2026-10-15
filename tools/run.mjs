// Run the detector on a BMP and write a debug overlay.
// Usage: node tools/run.mjs samples/full/Endgame.bmp [out.bmp]
import { readBmp, writeBmp } from './bmp.mjs';
import { detect, COLORS } from '../src/detect.js';

const [, , inPath, outPath] = process.argv;
const img = readBmp(inPath);
const t0 = Date.now();
const res = detect(img);
console.log(`${inPath}: ${Date.now() - t0} ms, ${res.dots.length} dots`);
for (const [k, v] of Object.entries(res.scores)) if (v) console.log(`  ${k.padEnd(7)} ${v}`);
const why = {};
for (const r of res.rejected) why[r.why] = (why[r.why] || 0) + 1;
console.log('  rejected:', JSON.stringify(why), 'centers:', JSON.stringify(Object.fromEntries(Object.entries(res.centers).map(([k, v]) => [k, Math.round(v)]))));

if (outPath) {
  const { width: w, height: h, data } = img;
  const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const ring = (x0, y0, rad, rgb, th) => {
    for (let a = 0; a < 360; a += 1) {
      for (let t = 0; t < th; t++) {
        const x = Math.round(x0 + Math.cos((a * Math.PI) / 180) * (rad + t));
        const y = Math.round(y0 + Math.sin((a * Math.PI) / 180) * (rad + t));
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = (y * w + x) * 4; data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2];
      }
    }
  };
  const rejColor = { ring: [90, 90, 90], mixed: [0, 255, 255], size: [255, 255, 0], shape: [60, 60, 60], area: [255, 0, 255], core: [255, 120, 0] };
  for (const r of res.rejected) if (r.why !== 'shape') ring(r.x, r.y, r.r * 1.6, rejColor[r.why], 5);
  for (const d of res.dots) {
    ring(d.x, d.y, d.r * 2.0, [255, 255, 255], 3);
    ring(d.x, d.y, d.r * 2.0 + 3, hex(COLORS[d.color].css), 8);
  }
  writeBmp(outPath, img);
}
