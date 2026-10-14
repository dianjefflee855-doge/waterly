import { PNG } from 'pngjs';
import * as fs from 'fs';
import { PlatformBridge } from '../PlatformBridge';
import { Frame, FocusState, PermissionStatus, Rect, WindowInfo } from '../../core/types';

export interface FakeWindowSpec {
  info: WindowInfo;
  /** screenshot files in replay order; current index starts at 0 */
  frames: string[];
  /** advance to next frame on click / after send key */
  advanceOnClick?: boolean;
  advanceOnSend?: boolean;
}
export type FakeEvent =
  | { type: 'click'; windowId: string; x: number; y: number }
  | { type: 'raise'; windowId: string }
  | { type: 'paste'; text: string; focus: FocusState }
  | { type: 'key'; combo: string; focus: FocusState };

/** Replays screenshot files; records all input. Lets tests simulate focus theft. */
export class FakePlatformBridge implements PlatformBridge {
  windows = new Map<string, FakeWindowSpec & { idx: number }>();
  events: FakeEvent[] = [];
  focus: FocusState = { bundleId: 'com.apple.finder', pid: 1, windowId: null };
  permissions: PermissionStatus = { accessibility: true, screenRecording: true };
  /** called after raise(); tests can override focus to simulate another app stealing it */
  onAfterRaise?: (windowId: string) => void;
  onBeforeKey?: (combo: string) => void;
  captures = 0;
  private decoded = new Map<string, PNG>();

  constructor(specs: FakeWindowSpec[]) { for (const s of specs) this.windows.set(s.info.windowId, { ...s, idx: 0 }); }

  async checkPermissions() { return { ...this.permissions }; }
  async enumerateWindows(bundleIds?: string[]) {
    return [...this.windows.values()].map(w => w.info).filter(i => !bundleIds || bundleIds.includes(i.bundleId));
  }
  currentFile(windowId: string) { const w = this.must(windowId); return w.frames[Math.min(w.idx, w.frames.length - 1)]; }
  async capture(windowId: string, _region?: Rect): Promise<Frame> {
    this.captures++;
    const file = this.currentFile(windowId);
    let png = this.decoded.get(file);
    if (!png) { png = PNG.sync.read(fs.readFileSync(file)); this.decoded.set(file, png); }
    return { windowId, width: png.width, height: png.height, data: new Uint8Array(png.data), source: file, capturedAt: Date.now() };
  }
  async raise(windowId: string) {
    const w = this.must(windowId);
    this.events.push({ type: 'raise', windowId });
    this.focus = { bundleId: w.info.bundleId, pid: w.info.pid, windowId };
    this.onAfterRaise?.(windowId);
  }
  async getFocus() { return { ...this.focus }; }
  async click(windowId: string, x: number, y: number) {
    this.events.push({ type: 'click', windowId, x, y });
    const w = this.must(windowId); if (w.advanceOnClick) w.idx++;
  }
  async paste(text: string) { this.events.push({ type: 'paste', text, focus: { ...this.focus } }); }
  async pressKey(combo: string) {
    this.onBeforeKey?.(combo);
    this.events.push({ type: 'key', combo, focus: { ...this.focus } });
    const w = this.focus.windowId ? this.windows.get(this.focus.windowId) : undefined;
    if (w?.advanceOnSend) w.idx++;
  }
  async restoreClipboard() {}
  sentMessages() {
    // a send = paste followed by a key, both with same focus
    const out: { windowId: string | null; text: string }[] = [];
    this.events.forEach((e, i) => { const n = this.events[i + 1];
      if (e.type === 'paste' && n?.type === 'key') out.push({ windowId: n.focus.windowId, text: e.text }); });
    return out;
  }
  private must(id: string) { const w = this.windows.get(id); if (!w) throw new Error('no window ' + id); return w; }
}
