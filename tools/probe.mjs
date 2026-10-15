// Print detector decisions near a point: node tools/probe.mjs file.bmp x y [radius]
import { readBmp } from './bmp.mjs';
import { detect } from '../src/detect.js';
const [f, x, y, rad] = [process.argv[2], ...process.argv.slice(3).map(Number), 200].slice(0, 4);
const res = detect(readBmp(f));
const near = (d) => Math.hypot(d.x - x, d.y - y) < rad;
for (const d of res.dots.filter(near)) console.log('DOT', d.color, Math.round(d.x), Math.round(d.y), 'r', d.r.toFixed(1), 'hue', d.hue?.toFixed(0), 'frac', d.frac?.toFixed(2), 's', d.s?.toFixed(2), 'v', d.v?.toFixed(2));
for (const d of res.rejected.filter(near)) console.log('REJ', d.why, Math.round(d.x), Math.round(d.y), 'area', d.area, 'bw', d.bw, 'bh', d.bh, 'frac', d.frac?.toFixed(2), 'hue', d.hue?.toFixed(0));
