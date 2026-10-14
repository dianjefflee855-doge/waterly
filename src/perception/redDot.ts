import { Frame, Rect } from '../core/types';
import { HsvRange } from '../adapters/AppAdapter';

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx ? d / mx : 0, mx];
}
export interface Blob { x: number; y: number; cx: number; cy: number; area: number; w: number; h: number }

/** Find unread badges: HSV mask in region -> 4-connected components -> area filter. */
export function detectBadges(f: Frame, region: Rect, ranges: HsvRange[], minArea: number, maxArea: number): Blob[] {
  const { x: X, y: Y, w: W, h: H } = region;
  const mask = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = ((Y + j) * f.width + X + i) * 4;
    const [h, s, v] = rgbToHsv(f.data[k], f.data[k + 1], f.data[k + 2]);
    if (ranges.some(r => h >= r.hMin && h <= r.hMax && s >= r.sMin && s <= r.sMax && v >= r.vMin && v <= r.vMax)) mask[j * W + i] = 1;
  }
  const blobs: Blob[] = []; const stack: number[] = [];
  for (let p = 0; p < mask.length; p++) {
    if (mask[p] !== 1) continue;
    let area = 0, sx = 0, sy = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    mask[p] = 2; stack.push(p);
    while (stack.length) {
      const q = stack.pop()!; const qx = q % W, qy = (q / W) | 0;
      area++; sx += qx; sy += qy; x0 = Math.min(x0, qx); y0 = Math.min(y0, qy); x1 = Math.max(x1, qx); y1 = Math.max(y1, qy);
      for (const n of [q - 1, q + 1, q - W, q + W]) {
        if (n < 0 || n >= mask.length || mask[n] !== 1) continue;
        if ((n === q - 1 && qx === 0) || (n === q + 1 && qx === W - 1)) continue;
        mask[n] = 2; stack.push(n);
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    // badges are roughly round/pill shaped
    if (area >= minArea && area <= maxArea && bh > 0 && bw / bh < 4)
      blobs.push({ x: X + x0, y: Y + y0, w: bw, h: bh, area, cx: X + sx / area, cy: Y + sy / area });
  }
  return blobs.sort((a, b) => a.cy - b.cy);
}
