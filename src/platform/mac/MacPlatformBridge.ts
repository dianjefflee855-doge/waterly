import { resPath } from './resources';
import { execFileSync } from 'child_process';
import { PNG } from 'pngjs';
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import { PlatformBridge } from '../PlatformBridge';
import { AccessibilityBridge, AxElement, AxQuery } from '../Accessibility';
import { Frame, FocusState, PermissionStatus, Rect, WindowInfo } from '../../core/types';

export type Runner = (args: string[]) => string;
export const defaultHelper = resPath('native/mac/build/waterly-axhelper');
export const execRunner = (bin = defaultHelper): Runner => args => execFileSync(bin, args, { encoding: 'utf8', timeout: 15000 });

/** macOS bridge backed by the Swift axhelper CLI. Send keys (Return/Enter) are refused unless allowSend. */
export class MacPlatformBridge implements PlatformBridge, AccessibilityBridge {
  private wins = new Map<string, WindowInfo>();
  private clipFile = path.join(os.tmpdir(), `waterly-clip-${process.pid}.json`);
  private clipSaved = false;
  constructor(private run: Runner = execRunner(), private opts: { allowSend?: boolean } = {},
    private shot: (args: string[]) => void = a => { execFileSync('/usr/sbin/screencapture', a, { timeout: 15000 }); }) {}
  private j<T>(args: string[]): T { return JSON.parse(this.run(args)) as T; }
  private win(id: string) { const w = this.wins.get(id); if (!w) throw new Error('unknown window ' + id); return w; }

  async checkPermissions(): Promise<PermissionStatus> { return this.j(['perms']); }
  async enumerateWindows(bundleIds?: string[]): Promise<WindowInfo[]> {
    const raw = this.j<any[]>(['windows']);
    const out = raw.map(r => ({ windowId: r.windowId, pid: r.pid, bundleId: r.bundleId, title: r.title, onScreen: r.onScreen,
      bounds: { x: r.bounds.X, y: r.bounds.Y, w: r.bounds.Width, h: r.bounds.Height } }) as WindowInfo)
      .filter(w => !bundleIds || bundleIds.includes(w.bundleId));
    out.forEach(w => this.wins.set(w.windowId, w));
    return out;
  }
  /** Window-scoped capture via /usr/sbin/screencapture -l (no shadow, silent). Needs Screen Recording. */
  async capture(windowId: string, region?: Rect): Promise<Frame> {
    if (!/^\d+$/.test(windowId)) throw new Error('bad windowId');
    const file = path.join(os.tmpdir(), `waterly-cap-${windowId}-${Date.now()}.png`);
    this.shot(['-x', '-o', '-t', 'png', `-l${windowId}`, file]);
    let png: PNG = PNG.sync.read(fs.readFileSync(file));
    if (region) {
      const out = new PNG({ width: region.w, height: region.h });
      PNG.bitblt(png, out, region.x, region.y, region.w, region.h, 0, 0); png = out;
      fs.writeFileSync(file, PNG.sync.write(png));
    }
    return { windowId, width: png.width, height: png.height, data: new Uint8Array(png.data), source: file, capturedAt: Date.now() };
  }
  async raise(windowId: string) { this.j(['activate', String(this.win(windowId).pid)]); }
  async getFocus(): Promise<FocusState> { return this.j(['focusstate']); }
  async click(): Promise<void> { throw new Error('MacPlatformBridge.click: not implemented yet'); }
  async paste(text: string) {
    const f = await this.getFocus();
    if (!this.clipSaved) { this.j(['clipsave', this.clipFile]); this.clipSaved = true; }
    this.j(['clipset', text]);
    this.j(['key', String(f.pid), 'Cmd+V']);
  }
  async pressKey(combo: string) {
    if (/^(cmd\+)?(return|enter)$/i.test(combo) && !this.opts.allowSend) throw new Error('send key refused (allowSend=false)');
    const f = await this.getFocus();
    this.j(['key', String(f.pid), combo, ...(this.opts.allowSend ? ['--allow-send'] : [])]);
  }
  async restoreClipboard() {
    if (!this.clipSaved) return;
    this.j(['cliprestore', this.clipFile]); fs.rmSync(this.clipFile, { force: true }); this.clipSaved = false;
  }
  /** AX layout (roles/identifiers/frames only, no text) of the app's focused window. */
  layout(bundleId: string): any[] { return this.j(['layout', bundleId]); }
  /** Chat-list cells (name/value/y) — contents stay in-process. */
  chatCells(bundleId: string): { name: string; value: string; y: number }[] {
    return this.j<any[]>(['subtree', bundleId, 'ChatListView_TableView', '1'])
      .filter(e => e.depth === 1 && (e.role === 'AXButton' || e.role === 'AXStaticText') && e.description)
      // the currently open chat's cell is exposed as AXStaticText instead of AXButton
      .map(e => ({ name: e.description, value: e.value ?? '', y: e.frame?.y ?? 0, selected: e.role === 'AXStaticText' }));
  }
  bubbleDescs(bundleId: string): string[] {
    return this.j<any[]>(['subtree', bundleId, 'ChatMessagesTableView', '1'])
      .filter(e => e.identifier === 'WAMessageBubbleTableViewCell' && e.description).sort((a, b) => a.frame.y - b.frame.y).map(e => e.description);
  }
  async openChat(windowId: string, name: string) {
    try { return this.j<any>(['openchat', this.win(windowId).bundleId, name]).ok === true; } catch { return false; }
  }
  /** ListScroller over the WhatsApp chat list (AX scroll bar if settable, else wheel events at the list). */
  listScroller(bundleId: string) {
    return {
      cells: () => this.chatCells(bundleId),
      info: () => this.j<any>(['listscroll', bundleId, 'info']),
      setBar: (v: number) => this.j<any>(['listscroll', bundleId, 'set', String(v)]),
      wheel: (dy: number) => this.j<any>(['listscroll', bundleId, 'wheel', String(Math.round(dy))]),
      page: (dir: 'down' | 'up') => this.j<any>(['listscroll', bundleId, 'page', dir]),
    };
  }
  // --- AccessibilityBridge
  async find(windowId: string, q: AxQuery): Promise<AxElement[]> {
    const w = this.win(windowId);
    const [k, v] = q.identifier ? ['identifier', q.identifier] : ['description', q.description!];
    return this.j<any[]>(['find', w.bundleId, k, v]).map(toAx);
  }
  async focus(windowId: string, el: AxElement) {
    const w = this.win(windowId);
    this.j(['focuselem', String(w.pid), el.identifier ? 'identifier' : 'description', el.identifier ?? el.description!]);
  }
  async focusedElement(windowId: string): Promise<AxElement | null> {
    const d = this.j<any>(['focusedelem', String(this.win(windowId).pid)]);
    return d.role ? toAx(d) : null;
  }
}
const toAx = (d: any): AxElement => ({ role: d.role, identifier: d.identifier, description: d.description, title: d.title,
  settable: d.settable, numChars: d.numChars, frame: d.frame });
