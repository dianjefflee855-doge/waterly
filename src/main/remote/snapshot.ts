// Build phone-side conversations from the client's state (feed + drafts), which is backed by the local history store
// (~/.config/waterly/history.jsonl). No WeChat DB/files. Messages: ['in'|'out', text, '', 'HH:MM', read(0|1), iso]; ['d', 日期] separators.
import type { ControlState, AppId } from '../../core/control';
const PF: Record<AppId, string> = { wechat: 'wx', whatsapp: 'wa', telegram: 'tg' };
export const convKey = (app: string, conversation: string) => app + '|' + conversation;
const hhmm = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const ymd = (d: Date) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
export function dayLabel(iso: string, now = new Date()) { const d = new Date(iso); if (isNaN(+d)) return '';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (ymd(d) === ymd(now)) return '今天'; if (ymd(d) === ymd(y)) return '昨天';
  return (d.getFullYear() === now.getFullYear() ? '' : d.getFullYear() + '年') + (d.getMonth() + 1) + '月' + d.getDate() + '日'; }
const listTime = (iso: string, now = new Date()) => { const l = dayLabel(iso, now); return l === '今天' ? hhmm(iso) : l; };
export class ConvIds { private m = new Map<string, number>(); private r = new Map<number, string>(); private n = 1;
  id(k: string) { let v = this.m.get(k); if (v == null) { v = this.n++; this.m.set(k, v); this.r.set(v, k); } return v; }
  key(id: number) { return this.r.get(id); } }
export function draftFor(s: ControlState, app: string, conv: string) {
  const ds = s.drafts.filter(d => d.app === app && d.conversation === conv && d.status === 'pending');
  return ds.length ? { opts: ds.map((_, i) => i ? 'AI 草稿 ' + (i + 1) : 'AI 草稿'), texts: ds.map(d => d.text), zh: [] } : null;
}
type Item = { dir: 'in' | 'out'; text: string; at: string; read: boolean; st?: 'copied' };
/** all messages of every conversation, oldest first */
export function convItems(s: ControlState) {
  const by = new Map<string, { app: AppId; name: string; items: Item[] }>();
  const get = (app: AppId, name: string) => { const k = convKey(app, name); let c = by.get(k); if (!c) { c = { app, name, items: [] }; by.set(k, c); } return c; };
  for (const f of s.feed) get(f.app, f.conversation).items.push({ dir: 'in', text: (f.sender && f.sender !== f.conversation ? f.sender + '：' : '') + f.body, at: f.at, read: !!f.read });
  const act = new Map<string, string>();
  for (const d of s.drafts) { if (d.status === 'sent' || d.status === 'copied') get(d.app, d.conversation).items.push({ dir: 'out', text: d.text, at: d.createdAt, read: true, ...(d.status === 'copied' ? { st: 'copied' as const } : {}) });
    else if (d.status === 'pending') { const k = convKey(d.app, d.conversation); get(d.app, d.conversation); if ((act.get(k) ?? '') < d.createdAt) act.set(k, d.createdAt); } }
  for (const [k, c] of by) (c as any).act = act.get(k) ?? '';
  for (const c of by.values()) c.items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return by;
}
/** render items with day separators */
export function renderMsgs(items: Item[], now = new Date()) { const out: any[] = []; let day = '';
  for (const it of items) { const l = dayLabel(it.at, now); if (l && l !== day) { out.push(['d', l]); day = l; } out.push(it.st ? [it.dir, it.text, '', hhmm(it.at), 1, it.at, it.st] : [it.dir, it.text, '', hhmm(it.at), it.read ? 1 : 0, it.at]); }
  return out; }
export function buildConvs(s: ControlState, ids: ConvIds, maxMsgs = 50, now = new Date()) {
  const out: any[] = [];
  for (const [k, c] of convItems(s)) { const items = c.items; const last = items[items.length - 1];
    let unread = 0; for (let i = items.length - 1; i >= 0 && items[i].dir === 'in'; i--) if (!items[i].read) unread++;
    const page = items.slice(-maxMsgs);
    const conv: any = { id: ids.id(k), pf: PF[c.app] ?? c.app, name: c.name, rel: '', acct: '', time: (last || (c as any).act) ? listTime((c as any).act > (last?.at ?? '') ? (c as any).act : last!.at, now) : '', unread, pending: unread > 0, mention: false,
      draft: draftFor(s, c.app, c.name) ?? { opts: [], texts: [], zh: [] }, msgs: renderMsgs(page, now), more: items.length - page.length, before: page[0]?.at ?? '', total: items.length, _at: ((c as any).act > (last?.at ?? '') ? (c as any).act : last?.at ?? '') };
    out.push(conv); }
  out.sort((a, b) => (b._at > a._at ? 1 : b._at < a._at ? -1 : 0)); for (const c of out) delete c._at;
  return out;
}
/** paging: up to `limit` messages strictly older than `before` (iso) for one conversation */
export function historyPage(s: ControlState, key: string, before: string, limit = 50, now = new Date()) {
  const c = convItems(s).get(key); if (!c) return { msgs: [], more: 0, before: '' };
  const older = before ? c.items.filter(i => i.at < before) : c.items; const page = older.slice(-Math.max(1, Math.min(200, limit)));
  return { msgs: renderMsgs(page, now), more: older.length - page.length, before: page[0]?.at ?? before };
}
