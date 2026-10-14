// Spawns the native ncwatch helper (read-only Notification Center banner watcher) and turns its JSON lines into
// per-app triggers. Never sends anything, never reads any DB/files: it only consumes ncwatch's stdout.
import { parseBanner, ChatNotification } from '../platform/mac/notifications';
import type { AppId } from '../core/control';

export function appForBundle(bundleId: string): AppId | null {
  if (bundleId.includes('WeChat')) return 'wechat';
  if (bundleId.toLowerCase().includes('whatsapp')) return 'whatsapp';
  if (bundleId.toLowerCase().includes('telegram')) return 'telegram';
  return null;
}

export type NcEvent = { kind: 'start'; trusted: boolean } | { kind: 'banner'; app: AppId; n: ChatNotification } | { kind: 'error'; error: string } | { kind: 'end' };

/** Parse one stdout line; returns null for malformed / irrelevant lines. */
export function parseLine(line: string): NcEvent | null {
  const l = line.trim(); if (!l.startsWith('{')) return null;
  let e: any; try { e = JSON.parse(l); } catch { return null; }
  if (!e || typeof e !== 'object') return null;
  if (e.error) return { kind: 'error', error: String(e.error) };
  if (e.kind === 'start') return { kind: 'start', trusted: e.trusted === true };
  if (e.kind === 'end') return { kind: 'end' };
  if (e.kind !== 'banner' || !Array.isArray(e.texts) || !Array.isArray(e.desc)) return null;
  const n = parseBanner({ ts: String(e.ts ?? new Date().toISOString()), texts: e.texts.map(String), desc: e.desc.map(String), ids: e.ids });
  if (!n) return null; const app = appForBundle(n.bundleId); if (!app) return null;
  return { kind: 'banner', app, n };
}

/** Line buffer: feed arbitrary chunks, get complete lines back. */
export class LineBuffer { private buf = '';
  push(chunk: string): string[] { this.buf += chunk; const parts = this.buf.split('\n'); this.buf = parts.pop() ?? '';
    if (this.buf.length > 1 << 20) this.buf = ''; return parts; } }

export interface ChildLike { stdout: { on(ev: 'data', cb: (d: any) => void): any } | null; stderr?: { on(ev: 'data', cb: (d: any) => void): any } | null;
  on(ev: 'exit', cb: (code: number | null) => void): any; on(ev: 'error', cb: (e: Error) => void): any; kill(sig?: any): any }
export interface NcWatchOpts {
  bin: string; spawn: (bin: string, args: string[]) => ChildLike;
  onBanner: (app: AppId, n: ChatNotification) => void;   // every new banner (immediate)
  onTrigger: (app: AppId) => void;                         // debounced per app: scan that app
  onLog?: (level: 'info' | 'warn', msg: string) => void;
  debounceMs?: number; seconds?: number; backoffMs?: number[];
  setTimeout?: (f: () => void, ms: number) => any; clearTimeout?: (t: any) => void;
}

export class NcWatch {
  private child: ChildLike | null = null; private stopped = true; private fails = 0; private restartT: any = null;
  private debT = new Map<AppId, any>(); private st: (f: () => void, ms: number) => any; private ct: (t: any) => void;
  constructor(private o: NcWatchOpts) { this.st = o.setTimeout ?? ((f, ms) => setTimeout(f, ms)); this.ct = o.clearTimeout ?? (t => clearTimeout(t)); }
  get running() { return !!this.child; }
  start() { if (!this.stopped) return; this.stopped = false; this.launch(); }
  stop() { this.stopped = true; if (this.restartT) { this.ct(this.restartT); this.restartT = null; }
    for (const t of this.debT.values()) this.ct(t); this.debT.clear();
    const c = this.child; this.child = null; try { c?.kill('SIGTERM'); } catch {} }
  /** exposed for tests */
  handleLine(line: string) { const ev = parseLine(line); if (!ev) return;
    if (ev.kind === 'start') { this.fails = 0; this.o.onLog?.(ev.trusted ? 'info' : 'warn', `通知监听器启动，辅助功能授权=${ev.trusted}`); return; }
    if (ev.kind === 'error') { this.o.onLog?.('warn', '通知监听器错误：' + ev.error); return; }
    if (ev.kind === 'end') return;
    try { this.o.onBanner(ev.app, ev.n); } catch {}
    const prev = this.debT.get(ev.app); if (prev) this.ct(prev);
    this.debT.set(ev.app, this.st(() => { this.debT.delete(ev.app); try { this.o.onTrigger(ev.app); } catch {} }, this.o.debounceMs ?? 1500)); }
  private launch() {
    if (this.stopped) return; let c: ChildLike;
    try { c = this.o.spawn(this.o.bin, [String(this.o.seconds ?? 86400)]); } catch (e: any) { this.o.onLog?.('warn', '通知监听器无法启动：' + String(e?.message ?? e)); return this.scheduleRestart(); }
    this.child = c; const lb = new LineBuffer(); let done = false;
    c.stdout?.on('data', d => { if (this.child === c) for (const l of lb.push(String(d))) this.handleLine(l); });
    const exit = (why: string) => { if (done) return; done = true; if (this.child !== c) return; this.child = null;
      if (!this.stopped) { this.o.onLog?.('warn', `通知监听器退出（${why}），稍后重启`); this.scheduleRestart(); } };
    c.on('exit', code => exit('code ' + code)); c.on('error', e => exit(String(e?.message ?? e)));
  }
  private scheduleRestart() { if (this.stopped || this.restartT) return;
    const b = this.o.backoffMs ?? [2000, 5000, 15000, 60000]; const ms = b[Math.min(this.fails, b.length - 1)]; this.fails++;
    this.restartT = this.st(() => { this.restartT = null; this.launch(); }, ms); }
}
