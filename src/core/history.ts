// Local message history (decided 2026-10-13): feed + drafts survive restarts. File ~/.config/waterly/history.jsonl (0600).
// Format: line 1 = {"t":"meta",...}; then {"t":"feed",...} / {"t":"draft",...}. Rewritten atomically (tmp + rename).
// Contains only what Waterly itself captured (banners / AX list scan / its own drafts). Never WeChat DB/files.
import type { FeedItem, Draft } from './control';
export const HISTORY_DAYS_DEFAULT = 30, HISTORY_DAYS_MIN = 1, HISTORY_DAYS_MAX = 365;
export function clampHistoryDays(n: any) { const v = Math.round(Number(n)); if (!Number.isFinite(v)) return HISTORY_DAYS_DEFAULT; return Math.min(HISTORY_DAYS_MAX, Math.max(HISTORY_DAYS_MIN, v)); }
export interface HistoryMeta { v: 1; ncOffset?: number; ncSize?: number; ncImported?: boolean; importedCount?: number }
export interface HistoryData { meta: HistoryMeta; feed: FeedItem[]; drafts: Draft[] }
export interface FsLike { readFileSync(p: string, e: 'utf8'): string; writeFileSync(p: string, d: string, o?: any): void; renameSync(a: string, b: string): void; mkdirSync(p: string, o?: any): any; chmodSync(p: string, m: number): void }
export class HistoryStore {
  constructor(private file: string, private fs: FsLike, private dirname: (p: string) => string) {}
  load(): HistoryData {
    const out: HistoryData = { meta: { v: 1 }, feed: [], drafts: [] }; let raw = '';
    try { raw = this.fs.readFileSync(this.file, 'utf8'); } catch { return out; }
    const drafts = new Map<string, Draft>();
    for (const l of raw.split('\n')) { if (!l.trim()) continue; let o: any; try { o = JSON.parse(l); } catch { continue; }
      if (o.t === 'meta') { const { t, ...m } = o; out.meta = { ...out.meta, ...m }; }
      else if (o.t === 'feed' && o.id && o.conversation != null) { const { t, ...f } = o; out.feed.push(f); }
      else if (o.t === 'draft' && o.id) { const { t, ...d } = o; if (d.status === 'sending') d.status = 'failed', d.error = d.error ?? '重启中断'; drafts.set(d.id, d); } }
    out.drafts = [...drafts.values()];
    out.feed.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)); out.drafts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return out;
  }
  save(d: HistoryData) {
    const lines = [JSON.stringify({ t: 'meta', ...d.meta }), ...d.feed.map(f => JSON.stringify({ t: 'feed', ...f })), ...d.drafts.map(x => JSON.stringify({ t: 'draft', ...x }))];
    this.fs.mkdirSync(this.dirname(this.file), { recursive: true }); const tmp = this.file + '.tmp';
    this.fs.writeFileSync(tmp, lines.join('\n') + '\n', { mode: 0o600 }); try { this.fs.chmodSync(tmp, 0o600); } catch {}
    this.fs.renameSync(tmp, this.file); try { this.fs.chmodSync(this.file, 0o600); } catch {}
  }
}
/** drop items older than `days` (by feed.at / draft.createdAt); pending drafts are kept regardless */
export function prune<T extends { feed: FeedItem[]; drafts: Draft[] }>(s: T, days: number, nowMs = Date.now()) {
  const cut = new Date(nowMs - days * 86400000).toISOString(); const n0 = s.feed.length + s.drafts.length;
  s.feed = s.feed.filter(f => !(f.at < cut)); s.drafts = s.drafts.filter(d => d.status === 'pending' || !(d.createdAt < cut));
  return n0 - s.feed.length - s.drafts.length;
}
