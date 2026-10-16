// Tacta dot detector. Pure JS, no dependencies: runs in the browser and in Node.
//
// Pipeline:
//   1. Mark "white" pixels (bright, low saturation).
//   2. Group them into connected blobs; keep blobs that are dot-sized and round.
//   3. Sample a ring of pixels around each blob. A scoring dot sits inside a solid
//      colored shape, so its ring is mostly one card color. White marks on black
//      (center symbols, glare, the start card) and outline lines fail this test.
//   4. Assign each dot's ring color to a player color, refining the color centers
//      to the photo's lighting (k-means seeded with the reference hues).

export const COLORS = {
  red:    { hue: 5,   label: 'Red',    css: '#e5533c' },
  yellow: { hue: 40,  label: 'Yellow', css: '#f2a93b' },
  green:  { hue: 90,  label: 'Green',  css: '#6fae45' },
  blue:   { hue: 210, label: 'Blue',   css: '#5b93d6' },
  purple: { hue: 255, label: 'Purple', css: '#7b5fc0' },
  pink:   { hue: 335, label: 'Pink',   css: '#e0418f' },
};

const DEFAULTS = {
  whiteMinLow: 0.45,   // min of the darkest channel
  localWindow: 0.02,   // half-width of the local-brightness box, as share of long side
  localContrast: 35,   // dot must beat the local mean (darkest channel) by this much
  whiteMaxS: 0.24,     // max saturation for a dot pixel
  minArea: 28,         // px, at working resolution (r ~3); smaller is noise
  maxArea: 8000,
  minFill: 0.66,       // blob area / bbox area (circle ~0.785)
  maxFill: 0.95,
  maxAspect: 1.6,
  minCoreFill: 0.92,   // share of white pixels within 0.7r of the center
  colorMinS: 0.2,      // ring pixel must be this saturated to count as card color
  colorMinSCool: 0.1,  // ...or this, for blue/purple hues
  colorMinV: 0.40,     // ...and this bright (rejects dark wood)
  ringMinColorFrac: 0.8,
  ringMaxVSpread: 0.2, // max brightness variation of the ring (relative); real card color is flat
  ringMinAgree: 0.75,  // share of colored ring pixels that agree on one color
  sizeTolerance: [0.55, 1.8], // dot radius relative to median
  maxSide: 4096,       // downscale larger images to this long side
};

function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
  let h = 0;
  if (c > 0) {
    if (mx === r) h = ((g - b) / c + 6) % 6;
    else if (mx === g) h = (b - r) / c + 2;
    else h = (r - g) / c + 4;
    h *= 60;
  }
  return [h, mx ? c / mx : 0, mx / 255];
}

const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

export function downscale(img, maxSide) {
  const { width: w, height: h, data } = img;
  const f = Math.max(w, h) / maxSide;
  if (f <= 1) return { img, scale: 1 };
  const nw = Math.round(w / f), nh = Math.round(h / f);
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor(y * f), y1 = Math.max(y0 + 1, Math.floor((y + 1) * f));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor(x * f), x1 = Math.max(x0 + 1, Math.floor((x + 1) * f));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < h; yy++) {
        for (let xx = x0; xx < x1 && xx < w; xx++) {
          const i = (yy * w + xx) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
      }
      const o = (y * nw + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { img: { width: nw, height: nh, data: out }, scale: f };
}

function findBlobs(mask, w, h) {
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const blobs = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || label[start]) continue;
    const id = blobs.length + 1;
    let sp = 0, area = 0, sx = 0, sy = 0;
    let minX = w, maxX = 0, minY = h, maxY = 0;
    stack[sp++] = start; label[start] = id;
    while (sp) {
      const p = stack[--sp];
      const x = p % w, y = (p - x) / w;
      area++; sx += x; sy += y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = id; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !label[p - w]) { label[p - w] = id; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !label[p + w]) { label[p + w] = id; stack[sp++] = p + w; }
    }
    blobs.push({ area, x: sx / area, y: sy / area, bw: maxX - minX + 1, bh: maxY - minY + 1 });
  }
  return blobs;
}

function coreFill(mask, w, b) {
  const r = Math.sqrt(b.area / Math.PI) * 0.7;
  let n = 0, on = 0;
  for (let dy = -Math.ceil(r); dy <= r; dy++) {
    for (let dx = -Math.ceil(r); dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      n++; on += mask[Math.round(b.y + dy) * w + Math.round(b.x + dx)] || 0;
    }
  }
  return n ? on / n : 0;
}

// Sample a ring around a blob; return the mean hue of the colored pixels and
// how much of the ring they cover.
function sampleRing(img, b, o) {
  const { width: w, height: h, data } = img;
  const r = Math.sqrt(b.area / Math.PI);
  let n = 0, colored = 0, cx = 0, cy = 0, sumS = 0, sumV = 0;
  const hues = [], cvs = [];
  for (const k of [1.7, 2.1, 2.5]) {
    const rr = r * k + 1;
    for (let a = 0; a < 40; a++) {
      const t = (a / 40) * Math.PI * 2;
      const x = Math.round(b.x + Math.cos(t) * rr), y = Math.round(b.y + Math.sin(t) * rr);
      n++;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = (y * w + x) * 4;
      const [hh, s, v] = hsv(data[i], data[i + 1], data[i + 2]);
      // Glare can wash purple out to a pale lavender, so cool hues get a lower
      // saturation bar. Warm low-saturation pixels are just black card under
      // warm light and must not count.
      const minS = hh >= 200 && hh <= 300 ? o.colorMinSCool : o.colorMinS;
      if (s >= minS && v >= o.colorMinV) {
        colored++; hues.push(hh); cvs.push(v); sumS += s; sumV += v;
        cx += Math.cos((hh * Math.PI) / 180); cy += Math.sin((hh * Math.PI) / 180);
      }
    }
  }
  if (!colored) return { frac: 0, hues };
  const hue = ((Math.atan2(cy, cx) * 180) / Math.PI + 360) % 360;
  // Printed card color is flat; a speckled surface (granite, wood grain) is not.
  const meanV = sumV / colored;
  const vSpread = Math.sqrt(cvs.reduce((a, v) => a + (v - meanV) ** 2, 0) / colored) / meanV;
  return { frac: colored / n, hue, hues, s: sumS / colored, v: meanV, vSpread, r };
}

function nearestColor(hue, centers) {
  let best = null, bd = Infinity;
  for (const [name, c] of Object.entries(centers)) {
    const d = hueDist(hue, c);
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}

export function detect(input, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { img, scale } = downscale(input, o.maxSide);
  const { width: w, height: h, data } = img;

  // A dot pixel is near-neutral, bright, and clearly brighter than the area
  // around it. The local test matters: glare can wash a pale card color (purple)
  // nearly white, but it's flat, while a dot stands out from its shape.
  const low = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) low[p] = Math.min(data[i], data[i + 1], data[i + 2]);
  const integral = new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += low[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
    }
  }
  const win = Math.max(8, Math.round(Math.max(w, h) * o.localWindow));
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - win), y1 = Math.min(h, y + win + 1);
    for (let x = 0; x < w; x++) {
      const p = y * w + x, i = p * 4;
      const mn = low[p];
      if (mn < o.whiteMinLow * 255) continue;
      const mx = Math.max(data[i], data[i + 1], data[i + 2]);
      if ((mx - mn) / mx > o.whiteMaxS) continue;
      const x0 = Math.max(0, x - win), x1 = Math.min(w, x + win + 1);
      const sum = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
      if (mn - sum / ((x1 - x0) * (y1 - y0)) >= o.localContrast) mask[p] = 1;
    }
  }

  const rejected = [];
  let cands = [];
  for (const b of findBlobs(mask, w, h)) {
    if (b.area < o.minArea) continue;
    if (b.area > o.maxArea) { if (b.area < o.maxArea * 20) rejected.push({ ...b, why: 'area' }); continue; }
    const fill = b.area / (b.bw * b.bh);
    const aspect = Math.max(b.bw, b.bh) / Math.min(b.bw, b.bh);
    if (fill < o.minFill || fill > o.maxFill || aspect > o.maxAspect) { rejected.push({ ...b, why: 'shape' }); continue; }
    // A printed dot is solid: everything near its center is white. Digits on
    // number badges ("4", "6"...) have holes and gaps there.
    if (coreFill(mask, w, b) < o.minCoreFill) { rejected.push({ ...b, why: 'core' }); continue; }
    const ring = sampleRing(img, b, o);
    if (ring.frac < o.ringMinColorFrac) { rejected.push({ ...b, why: 'ring' }); continue; }
    if (ring.vSpread > o.ringMaxVSpread) { rejected.push({ ...b, why: 'speckle' }); continue; }
    const agree = ring.hues.filter((hh) => hueDist(hh, ring.hue) < 25).length / ring.hues.length;
    if (agree < o.ringMinAgree) { rejected.push({ ...b, why: 'mixed' }); continue; }
    const ci = (Math.round(b.y) * w + Math.round(b.x)) * 4;
    const dotV = Math.max(data[ci], data[ci + 1], data[ci + 2]) / 255;
    cands.push({ ...b, ...ring, hues: undefined, dotV });
  }

  // Size consistency: all scoring dots are printed the same size. Pick the
  // reference size by vote, weighting each vote by radius: background specks
  // (granite, crumbs) can outnumber real dots but are always much smaller.
  if (cands.length) {
    let med = 0, best = -1;
    for (const c of cands) {
      const votes = cands.filter((d) => d.r >= c.r * 0.75 && d.r <= c.r * 1.33).length * c.r;
      if (votes > best) { best = votes; med = c.r; }
    }
    const [lo, hi] = o.sizeTolerance;
    cands = cands.filter((c) => {
      const ok = c.r >= med * lo && c.r <= med * hi;
      if (!ok) rejected.push({ ...c, why: 'size' });
      return ok;
    });
  }

  // Assign colors; adapt the reference hues to this photo's lighting.
  let centers = Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [k, v.hue]));
  for (let iter = 0; iter < 5; iter++) {
    for (const c of cands) c.color = nearestColor(c.hue, centers);
    const next = {};
    for (const name of Object.keys(centers)) {
      const members = cands.filter((c) => c.color === name);
      if (!members.length) { next[name] = centers[name]; continue; }
      let cx = 0, cy = 0;
      for (const m of members) { cx += Math.cos((m.hue * Math.PI) / 180); cy += Math.sin((m.hue * Math.PI) / 180); }
      const mean = ((Math.atan2(cy, cx) * 180) / Math.PI + 360) % 360;
      // Don't let a center drift far from its reference color.
      next[name] = hueDist(mean, COLORS[name].hue) < 20 ? mean : centers[name];
    }
    centers = next;
  }

  const scores = Object.fromEntries(Object.keys(COLORS).map((k) => [k, 0]));
  for (const c of cands) scores[c.color]++;
  const toFull = (d) => ({ ...d, x: d.x * scale, y: d.y * scale, r: (d.r ?? Math.sqrt(d.area / Math.PI)) * scale });
  return { scores, dots: cands.map(toFull), rejected: rejected.map(toFull), centers };
}
