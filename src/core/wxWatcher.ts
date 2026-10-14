// Banner = hint only. Authoritative source = WeChat chat list (unread count + preview, AX, no open/mark-read)
// and optionally the chat thread (opening marks read). Periodic list scan is the fallback when banners are missed
// (merged, too fast, WeChat foreground, Focus/DND, previews hidden).
import { ChatNotification } from '../platform/mac/notifications';
export interface SessionSnap { name: string; unread: number; preview: string; time: string }
export interface WatchDeps { listTop(): SessionSnap[]; readThread?(name: string, n: number): Promise<any[]>; now(): number }
export interface WatchEvent { conversation: string; unread: number; preview: string; time: string; source: 'banner' | 'scan'; bannerHints: string[]; messages?: any[] }
export class WxWatcher {
  private last = new Map<string, string>(); private hints = new Map<string, string[]>(); private timer?: any;
  constructor(private d: WatchDeps, private emit: (e: WatchEvent) => void, private opts = { debounceMs: 2500, scanMs: 60000, openThread: false }) {}
  onBanner(n: ChatNotification) { if (n.bundleId !== 'com.tencent.xinWeChat') return;
    (this.hints.get(n.conversation) ?? this.hints.set(n.conversation, []).get(n.conversation)!).push(n.body);
    clearTimeout(this.timer); this.timer = setTimeout(() => this.scan('banner'), this.opts.debounceMs); }
  start() { const t = setInterval(() => this.scan('scan'), this.opts.scanMs); return () => clearInterval(t); }
  async scan(source: 'banner' | 'scan') {
    for (const s of this.d.listTop()) { const fp = `${s.unread}|${s.time}|${s.preview}`; const h = this.hints.get(s.name) ?? [];
      if (s.unread > 0 && (this.last.get(s.name) !== fp || h.length)) {
        const e: WatchEvent = { conversation: s.name, unread: s.unread, preview: s.preview, time: s.time, source: h.length ? 'banner' : source, bannerHints: h };
        if (this.opts.openThread && this.d.readThread) e.messages = await this.d.readThread(s.name, s.unread);
        this.emit(e); }
      this.last.set(s.name, fp); this.hints.delete(s.name); }
  }
}
