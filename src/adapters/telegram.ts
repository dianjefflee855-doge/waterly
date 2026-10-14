/**
 * Telegram for macOS (ru.keepcoder.Telegram) adapter. Its window exposes NO AX children (only the focused
 * composer via AXFocusedUIElement), so list/header/messages come from screenshot + OCR, and chats are opened
 * by clicking the OCR-located row, then verified by OCR of the header.
 */
import { OcrLine } from '../perception/ocr';
import { WindowInfo, Rect } from '../core/types';

export const TG_BUNDLES = ['ru.keepcoder.Telegram'];
export interface PtRect { x: number; y: number; w: number; h: number }
export interface TgRegions { list: PtRect; header: PtRect; messages: PtRect; composer: PtRect; listW: number; singlePane: boolean }

const norm = (s: string) => s.normalize('NFKC').replace(/[\s\u200e\u200f]/g, '').toLowerCase();
export const nameEq = (a: string, b: string) => !!b && norm(a) === norm(b);
const center = (l: OcrLine) => ({ x: (l.box[0] + l.box[2]) / 2, y: (l.box[1] + l.box[3]) / 2 });

export function findTelegramWindow(wins: WindowInfo[]) {
  return wins.filter(w => TG_BUNDLES.includes(w.bundleId) && w.onScreen && w.bounds.w > 300 && w.bounds.h > 300)
    .sort((a, b) => b.bounds.w * b.bounds.h - a.bounds.w * a.bounds.h)[0];
}

/**
 * Regions in window points. The list column has fixed width in points (default ~346pt); we locate it from the
 * OCR of the search field ("搜索"/"Search") whose box spans the list column. Narrow windows collapse to single pane.
 */
export function deriveTelegramRegions(lines: OcrLine[], k: number, win: { w: number; h: number }): TgRegions {
  const search = lines.map(l => ({ l, c: center(l) })).find(({ l, c }) => /搜索|search/i.test(l.text) && c.y / k < 90);
  // search placeholder is centred in the list column -> list width ≈ 2 * centre x (+ margin)
  let listW = search ? Math.round((search.c.x / k) * 2) : 346;
  const singlePane = !search || listW > win.w * 0.8;
  if (singlePane) listW = 0;
  const top = 55, bottom = 52;
  return {
    listW, singlePane,
    list: { x: 0, y: 100, w: listW, h: Math.max(0, win.h - 100 - 50) },
    header: { x: listW, y: 0, w: win.w - listW, h: top },
    messages: { x: listW, y: top, w: win.w - listW, h: win.h - top - bottom },
    composer: { x: listW, y: win.h - bottom, w: win.w - listW, h: bottom },
  };
}
export const toPx = (r: PtRect, k: number): Rect => ({ x: Math.round(r.x * k), y: Math.round(r.y * k), w: Math.round(r.w * k), h: Math.round(r.h * k) });
const inR = (l: OcrLine, r: PtRect, k: number) => { const c = center(l); return c.x >= r.x * k && c.x < (r.x + r.w) * k && c.y >= r.y * k && c.y < (r.y + r.h) * k; };

export interface TgHeader { name: string | null; subtitle: string | null; group: boolean | null }
/** Header: the top-left text line is the chat name, the line under it the subtitle (members / last seen). */
export function readHeader(lines: OcrLine[], reg: TgRegions, k: number): TgHeader {
  const hs = lines.filter(l => inR(l, reg.header, k) && l.score > 0.5).sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
  if (!hs.length) return { name: null, subtitle: null, group: null };
  // The header bar is translucent: scrolled message text can show through above/behind it. Prefer the line that
  // has a subtitle (members / last seen) right under it and left-aligned with it; else the highest-score line.
  const SUB = /位成员|成员|members?|subscribers?|订阅者|在线|最后上线|最近|last seen|online|recently|机器人|bot/i;
  const subOf = (n: OcrLine) => hs.find(l => l !== n && l.box[1] > n.box[1] + 4 && l.box[1] < n.box[3] + 20 * k && Math.abs(l.box[0] - n.box[0]) < 40 * k);
  const name = hs.find(n => { const s2 = subOf(n); return !!s2 && SUB.test(s2.text); }) ?? [...hs].sort((a, b) => b.score - a.score)[0];
  const sub = subOf(name);
  const st = sub?.text ?? null;
  const group = st == null ? null : /位成员|成员|members?|subscribers?|订阅者|在线.*成员/i.test(st) ? true : /在线|最后上线|最近|last seen|online|recently|机器人|bot/i.test(st) ? false : null;
  return { name: name.text.trim(), subtitle: st, group };
}

export interface TgRow { name: string; time?: string; unread: number; y: number; cx: number; cy: number }
/** Chat-list rows (~69pt tall): name = top-left line, time = top-right, unread = numeric line at bottom-right. */
export function parseList(lines: OcrLine[], reg: TgRegions, k: number, rowH = 69): TgRow[] {
  if (reg.singlePane) return [];
  const ls = lines.filter(l => inR(l, reg.list, k)).sort((a, b) => a.box[1] - b.box[1]);
  const textX = 60 * k; // after avatar
  const rows: TgRow[] = [];
  for (const l of ls) {
    if (l.box[0] < textX || l.box[0] > reg.listW * k * 0.7) continue;
    if (/已归档|archived/i.test(l.text)) continue; // archive entry row is not a chat
    const prev = rows[rows.length - 1];
    if (prev && l.box[1] - prev.y < rowH * k * 0.55) continue; // second line of same row
    rows.push({ name: l.text.trim(), unread: 0, y: l.box[1], cx: (l.box[0] + l.box[2]) / 2, cy: l.box[1] + rowH * k * 0.3 });
  }
  for (const r of rows) {
    const same = ls.filter(l => l.box[1] >= r.y - 6 * k && l.box[1] < r.y + rowH * k * 0.85 && l.box[0] > reg.listW * k * 0.7);
    r.time = same.find(l => l.box[1] < r.y + 15 * k)?.text.trim();
    const badge = same.find(l => l.box[1] >= r.y + 15 * k && /^\d{1,4}\+?$/.test(l.text.trim()));
    if (badge) r.unread = parseInt(badge.text, 10);
  }
  return rows;
}

export interface TgMsg { self: boolean; sender: string | null; text: string; time?: string; mentions: string[] }
/**
 * Messages from OCR: lines right of pane centre are self. In groups, an incoming bubble starts with a coloured
 * sender-name line (isColoured callback samples the pixels). Trailing "HH:MM" is split off as time.
 */
export function parseMessages(lines: OcrLine[], reg: TgRegions, k: number, group: boolean, isColoured: (l: OcrLine) => boolean): TgMsg[] {
  const mid = (reg.messages.x + reg.messages.w / 2) * k;
  const ls = lines.filter(l => inR(l, reg.messages, k) && l.score > 0.5).sort((a, b) => a.box[1] - b.box[1]);
  const out: TgMsg[] = []; let sender: string | null = null; let lastBottom = -1e9;
  for (const l of ls) {
    let t = l.text.trim(); let time: string | undefined;
    const m = t.match(/^(.*?)\s*(\d{1,2}:\d{2})$/); if (m) { t = m[1].trim(); time = m[2]; }
    const self = center(l).x > mid && l.box[0] > mid - 40 * k;
    const gap = l.box[1] - lastBottom; lastBottom = l.box[3];
    if (!self && group && !time && isColoured(l) && t.length <= 40) { sender = t; continue; }
    if (!t && time && out.length) { out[out.length - 1].time ??= time; continue; }
    if (!t) continue;
    const prev = out[out.length - 1];
    if (prev && prev.self === self && !prev.time && gap < 8 * k) { prev.text += ' ' + t; prev.time = time; prev.mentions = [...prev.text.matchAll(/@([\w\u4e00-\u9fff]+)/g)].map(x => x[1]); continue; }
    out.push({ self, sender: self ? 'self' : group ? sender : null, text: t, time, mentions: [...t.matchAll(/@([\w\u4e00-\u9fff]+)/g)].map(x => x[1]) });
  }
  return out;
}
