import { RawCell } from './whatsappInbox';

export interface ListScroller {
  cells(): RawCell[];
  info(): { bar: boolean; barSettable: boolean; barValue: number; listFrame: { h: number } };
  setBar(v: number): { ok: boolean; barValue: number };
  wheel(dy: number): { ok: boolean; barValue: number };
  /** AX page scroll (AXScrollDownByPage/UpByPage); preferred when available */
  page?(dir: 'down' | 'up'): { ok: boolean; barValue: number };
}
export interface ScanResult { chats: RawCell[]; visibleFirstPage: number; pages: number; method: 'bar' | 'page' | 'wheel'; reachedEnd: boolean; backToTop: boolean; ms: number }
const key = (c: RawCell) => c.name.replace(/[\u200e\u200f]/g, '').trim();

/** Page through the chat list, dedupe by name, stop at end (bar==1 or no new cells twice), then return to top. */
export function scanAllChats(s: ListScroller, opts: { maxPages?: number; pageFrac?: number } = {}): ScanResult {
  const t0 = Date.now(); const maxPages = opts.maxPages ?? 60;
  const seen = new Map<string, RawCell>(); const order: string[] = [];
  const add = (cs: RawCell[]) => { let n = 0; for (const c of cs) { const k = key(c); if (!k || seen.has(k)) continue; seen.set(k, c); order.push(k); n++; } return n; };
  const first = s.cells(); add(first);
  const firstNames = first.map(key).slice(0, 3).join('|');
  const inf = s.info(); const method: 'bar' | 'page' | 'wheel' = inf.bar && inf.barSettable ? 'bar' : s.page ? 'page' : 'wheel';
  const page = Math.max(200, Math.round(inf.listFrame.h * (opts.pageFrac ?? 0.8)));
  let pages = 1, stale = 0, reachedEnd = false, prevSig = '';
  // bar path: step size estimated from page height relative to content; fall back to wheel if bar does not move
  let v = Math.max(0, inf.barValue);
  while (pages < maxPages) {
    let r: { ok: boolean; barValue: number };
    if (method === 'bar') { v = Math.min(1, v + 0.1); r = s.setBar(v); } else if (method === 'page') r = s.page!('down'); else r = s.wheel(page);
    pages++;
    const cs = s.cells(); const sig = cs.map(key).join('|'); const added = add(cs);
    if ((method === 'bar' && v >= 1) || (r.barValue >= 0.999)) { reachedEnd = true; break; }
    if (added === 0 && sig === prevSig) { if (++stale >= 2) { reachedEnd = true; break; } } else stale = 0;
    prevSig = sig;
  }
  // back to top
  let backToTop = false;
  let lastSig = '';
  for (let i = 0; i < maxPages && !backToTop; i++) {
    if (method === 'bar') s.setBar(0); else if (method === 'page') s.page!('up'); else s.wheel(-page * 3);
    const sig = s.cells().map(key).join('|');
    backToTop = sig.split('|').slice(0, 3).join('|') === firstNames;
    if (!backToTop && sig === lastSig) break; // cannot move further up
    lastSig = sig;
  }
  return { chats: order.map(k => seen.get(k)!), visibleFirstPage: first.length, pages, method, reachedEnd, backToTop, ms: Date.now() - t0 };
}
