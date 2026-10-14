import { Frame, Rect } from '../core/types';
import { PlatformBridge } from '../platform/PlatformBridge';

/** Per-window capture cache (default 100ms TTL) + in-flight dedupe. */
export class CaptureCache {
  private cache = new Map<string, Frame>();
  private inflight = new Map<string, Promise<Frame>>();
  constructor(private bridge: PlatformBridge, private ttlMs = 100, private now = () => Date.now()) {}
  async get(windowId: string): Promise<Frame> {
    const c = this.cache.get(windowId);
    if (c && this.now() - c.capturedAt < this.ttlMs) return c;
    const p = this.inflight.get(windowId);
    if (p) return p;
    const q = this.bridge.capture(windowId).then(f => { f.capturedAt = this.now(); this.cache.set(windowId, f); return f; })
      .finally(() => this.inflight.delete(windowId));
    this.inflight.set(windowId, q);
    return q;
  }
  invalidate(windowId: string) { this.cache.delete(windowId); }
}

/** 64x64 grey block-average signature of a region (area mean, so small badges are not missed). */
export function signature(f: Frame, r?: Rect, size = 64): Float32Array {
  const R = r ?? { x: 0, y: 0, w: f.width, h: f.height };
  const out = new Float32Array(size * size); const cnt = new Uint32Array(size * size);
  for (let y = R.y; y < R.y + R.h; y += 2) for (let x = R.x; x < R.x + R.w; x += 2) {
    const k = (y * f.width + x) * 4;
    const c = Math.min(size - 1, Math.floor((y - R.y) * size / R.h)) * size + Math.min(size - 1, Math.floor((x - R.x) * size / R.w));
    out[c] += (f.data[k] * 0.299 + f.data[k + 1] * 0.587 + f.data[k + 2] * 0.114) / 255; cnt[c]++;
  }
  for (let i = 0; i < out.length; i++) out[i] = cnt[i] ? out[i] / cnt[i] : 0;
  return out;
}
/** max per-cell change: any local change (new badge, new bubble) counts */
export function diff(a: Float32Array, b: Float32Array): number {
  let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m;
}
/** Remembers last signature per window; changed() false => skip OCR/LLM entirely. */
export class FrameDiffer {
  private last = new Map<string, Float32Array>();
  constructor(private threshold = 0.02) {}
  reset(windowId: string) { this.last.delete(windowId); }
  changed(windowId: string, f: Frame, r?: Rect): boolean {
    const s = signature(f, r); const p = this.last.get(windowId); this.last.set(windowId, s);
    return !p || diff(p, s) > this.threshold;
  }
}
