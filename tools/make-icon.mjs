// Generates the home-screen icons: node tools/make-icon.mjs (then convert BMP -> PNG with sips)
import { writeBmp } from './bmp.mjs';
for (const size of [180, 512]) {
  const data = new Uint8ClampedArray(size * size * 4);
  const cols = [[91, 147, 214], [229, 83, 60], [242, 169, 59], [224, 65, 143]];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    let c = [17, 17, 17];
    const q = (x < size / 2 ? 0 : 1) + (y < size / 2 ? 0 : 2);
    const cx = (q % 2 ? 0.72 : 0.28) * size, cy = (q > 1 ? 0.72 : 0.28) * size;
    const d = Math.hypot(x - cx, y - cy);
    if (d < size * 0.2) c = cols[q];
    if (d < size * 0.07) c = [250, 250, 250];
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  writeBmp(`icon-${size}.bmp`, { width: size, height: size, data });
}
