// Minimal 24-bit BMP reader/writer for running the detector under Node.
// Convert photos with: sips -s format bmp in.HEIC --out out.bmp
import fs from 'node:fs';

export function readBmp(path) {
  const b = fs.readFileSync(path);
  const off = b.readUInt32LE(10);
  const w = b.readInt32LE(18);
  const hRaw = b.readInt32LE(22);
  const bpp = b.readUInt16LE(28);
  if (bpp !== 24 && bpp !== 32) throw new Error(`unsupported bpp ${bpp}`);
  const h = Math.abs(hRaw);
  const topDown = hRaw < 0;
  const bytes = bpp / 8;
  const stride = Math.ceil((w * bytes) / 4) * 4;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = off + (topDown ? y : h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      const s = row + x * bytes, d = (y * w + x) * 4;
      data[d] = b[s + 2]; data[d + 1] = b[s + 1]; data[d + 2] = b[s]; data[d + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

export function writeBmp(path, img) {
  const { width: w, height: h, data } = img;
  const stride = Math.ceil((w * 3) / 4) * 4;
  const b = Buffer.alloc(54 + stride * h);
  b.write('BM', 0); b.writeUInt32LE(b.length, 2); b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14); b.writeInt32LE(w, 18); b.writeInt32LE(-h, 22);
  b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(stride * h, 34);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = 54 + y * stride + x * 3;
      b[d] = data[s + 2]; b[d + 1] = data[s + 1]; b[d + 2] = data[s];
    }
  }
  fs.writeFileSync(path, b);
}
