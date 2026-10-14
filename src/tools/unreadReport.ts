// Unread report across WhatsApp / Telegram / WeChat for the owner. Opens unread chats (marks read), reads
// messages, restores each app's original chat. Never types / presses Enter.
import { MacPlatformBridge } from '../platform/mac/MacPlatformBridge';
import { RapidOcrSidecar, OcrLine } from '../perception/ocr';
import { identifyWhatsAppWindow, WHATSAPP_AX } from '../adapters/whatsapp';
import { scanInbox, openChat as waOpen, parseBubbles, isGroupChat } from '../adapters/whatsappInbox';
import { findTelegramWindow, deriveTelegramRegions, readHeader, parseList, parseMessages, nameEq, TG_BUNDLES } from '../adapters/telegram';
import { parseSession, isWxGroup, parseBubble, wxNameEq, classifyCell, nicknameRect, WX_BUNDLES } from '../adapters/wechat';
import * as fs from 'fs';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms)); const keep = setInterval(() => {}, 1000);
const CAP = 10; let used = 0;
(async () => {
  const b = new MacPlatformBridge(); const j = (a: string[]) => (b as any).j(a); const ocr = new RapidOcrSidecar(); const R: any = {};
  const sub = (bid: string, id: string, d: number): any[] => { try { return j(['subtree', bid, id, String(d)]); } catch { return []; } };
  // ---------------- WhatsApp
  try {
    const B = WHATSAPP_AX.bundleIds[0];
    const w0 = (await b.enumerateWindows([B])).filter(w => w.bounds.h > 100)[0]; await b.raise(w0.windowId); await sleep(1200);
    const win = identifyWhatsAppWindow(await b.enumerateWindows([B]))!;
    const cells = b.chatCells(B); const list = scanInbox(cells); const orig = list.find(c => c.selected)?.name;
    R.whatsapp = { original: orig, rawFirstPage: cells.slice(0, 14).map(c => ({ name: c.name, value: c.value })), unread: [] as any[] };
    for (const c of list.filter(c => c.unread > 0 || c.markedUnread)) {
      if (used >= CAP) break; used++;
      try { await waOpen(b, b, win, b.chatCells(B), c.name); } catch (e: any) { R.whatsapp.unread.push({ name: c.name, error: e.message }); continue; }
      const group = isGroupChat(b.layout(B).map((e: any) => e.identifier).filter(Boolean));
      const ms = parseBubbles(b.bubbleDescs(B), { group }); const n = Math.max(1, c.unread);
      R.whatsapp.unread.push({ name: c.name, group, unread: c.unread, messages: ms.filter(m => !m.self).slice(-n).map(m => ({ sender: m.sender, time: m.time, text: m.text })) });
    }
    if (orig && R.whatsapp.unread.length) { try { await waOpen(b, b, win, b.chatCells(B), orig); R.whatsapp.restored = true; } catch { R.whatsapp.restored = false; } }
  } catch (e: any) { R.whatsapp = { ...(R.whatsapp ?? {}), error: String(e.message ?? e) }; }
  // ---------------- Telegram
  try {
    const any = (await b.enumerateWindows(TG_BUNDLES)).filter(w => w.bounds.h > 100).sort((a, c) => c.bounds.w * c.bounds.h - a.bounds.w * a.bounds.h)[0];
    await b.raise(any.windowId); await sleep(1200);
    let win = findTelegramWindow(await b.enumerateWindows(TG_BUNDLES))!;
    const snap = async () => { win = findTelegramWindow(await b.enumerateWindows(TG_BUNDLES))!; const f = await b.capture(win.windowId); const k = f.width / win.bounds.w;
      const lines = await ocr.recognize(f.source!); const reg = deriveTelegramRegions(lines, k, win.bounds);
      const coloured = (l: OcrLine) => { let c = 0, n = 0; for (let y = Math.round(l.box[1]); y < l.box[3]; y += 2) for (let x = Math.round(l.box[0]); x < l.box[2]; x += 2) {
        const i = (y * f.width + x) * 4, r = f.data[i], g = f.data[i + 1], bb = f.data[i + 2]; const mx = Math.max(r, g, bb), mn = Math.min(r, g, bb); if (mx < 235) { n++; if (mx - mn > 60) c++; } } return n > 10 && c / n > 0.35; };
      fs.rmSync(f.source!, { force: true }); return { k, lines, reg, coloured }; };
    let s = await snap(); const orig = readHeader(s.lines, s.reg, s.k).name; const rows = parseList(s.lines, s.reg, s.k);
    // raw OCR of each row's right column (to confirm the badge format)
    R.telegram = { original: orig, rows: rows.map(r => ({ name: r.name, time: r.time, unread: r.unread })), unread: [] as any[] };
    const open = async (name: string) => { const sx = await snap(); const rr = parseList(sx.lines, sx.reg, sx.k).filter(r => nameEq(r.name, name)); if (rr.length !== 1) return null;
      j(['hidclickat', String(win.bounds.x + rr[0].cx / sx.k), String(win.bounds.y + rr[0].cy / sx.k)]); await sleep(1000); const sy = await snap(); const h = readHeader(sy.lines, sy.reg, sy.k);
      return h.name && nameEq(h.name, name) ? { sy, h } : null; };
    for (const r of rows.filter(r => r.unread > 0)) {
      if (used >= CAP) break; used++;
      const o = await open(r.name); if (!o) { R.telegram.unread.push({ name: r.name, unread: r.unread, error: 'open/verify failed' }); continue; }
      const ms = parseMessages(o.sy.lines, o.sy.reg, o.sy.k, !!o.h.group, o.sy.coloured).filter(m => !m.self);
      R.telegram.unread.push({ name: r.name, group: o.h.group, subtitle: o.h.subtitle, unread: r.unread, messages: ms.slice(-r.unread).map(m => ({ sender: m.sender, time: m.time, text: m.text })) });
    }
    if (orig && R.telegram.unread.length) R.telegram.restored = !!(await open(orig));
  } catch (e: any) { R.telegram = { ...(R.telegram ?? {}), error: String(e.message ?? e) }; }
  // ---------------- WeChat
  try {
    const B = WX_BUNDLES[0];
    const any = (await b.enumerateWindows([B])).filter(w => w.bounds.h > 80).sort((a, c) => c.bounds.w * c.bounds.h - a.bounds.w * a.bounds.h)[0];
    await b.raise(any.windowId); await sleep(1200);
    let win = (await b.enumerateWindows([B])).filter(w => w.onScreen && w.bounds.h > 300)[0];
    const header = () => ({ name: sub(B, 'current_chat_name_label', 0)[0]?.value ?? null, group: isWxGroup(sub(B, 'current_chat_count_label', 0)[0]?.value) });
    const sessions = () => sub(B, 'session_list', 1).filter(e => e.depth === 1 && (e.identifier ?? '').startsWith('session_item_')).map(e => ({ ...parseSession(e.identifier, e.title ?? '', e.frame.y), frame: e.frame, raw: e.title }));
    const lf = () => sub(B, 'session_list', 0)[0].frame;
    const scroll = (d: number) => { const f = lf(); j(['hidwheelat', String(f.x + f.w / 2), String(f.y + Math.min(f.h / 2, 300)), String(d * Math.round(f.h * 0.7))]); };
    const toTop = () => { for (let i = 0; i < 40; i++) { const a = sessions().map(x => x.name).join('|'); scroll(-1); scroll(-1); if (sessions().map(x => x.name).join('|') === a) break; } };
    toTop(); const orig = header().name;
    const seen = new Map<string, any>(); for (let p = 0; p < 4; p++) { sessions().forEach(x => seen.set(x.name, x)); scroll(1); } toTop();
    const unread = [...seen.values()].filter(x => x.unread > 0);
    R.wechat = { original: orig, unreadRaw: unread.map(x => ({ name: x.name, raw: x.raw })), unread: [] as any[] };
    const open = async (name: string) => { toTop(); for (let i = 0; i < 10; i++) { const x = sessions().find(y => wxNameEq(y.name, name)); const f = lf();
      if (x && x.frame.y >= f.y && x.frame.y + x.frame.h <= f.y + f.h) { j(['hidclickat', String(x.frame.x + x.frame.w / 2), String(x.frame.y + x.frame.h / 2)]); await sleep(900); return wxNameEq(header().name ?? '', name); } scroll(1); } return false; };
    for (const x of unread) {
      if (x.name === '折叠的聊天') { R.wechat.unread.push({ name: x.name, unread: x.unread, note: 'folder of folded chats, not opened', preview: x.preview, time: x.time }); continue; }
      if (used >= CAP) break; used++;
      if (!(await open(x.name))) { R.wechat.unread.push({ name: x.name, unread: x.unread, error: 'open/verify failed', preview: x.preview }); continue; }
      const h = header(); win = (await b.enumerateWindows([B])).filter(w => w.onScreen && w.bounds.h > 300)[0];
      const f = await b.capture(win.windowId); const k = f.width / win.bounds.w; const ml = sub(B, 'chat_message_list', 0)[0].frame;
      const px = (X: number, Y: number) => { const i = (Math.round((Y - win.bounds.y) * k) * f.width + Math.round((X - win.bounds.x) * k)) * 4; return [f.data[i], f.data[i + 1], f.data[i + 2]]; };
      const cells = sub(B, 'chat_message_list', 1).filter(e => e.depth === 1 && e.identifier === 'chat_bubble_item_view' && e.frame.h > 0);
      const msgs: any[] = [];
      for (const e of cells) { const c = e.frame; const bg = px(c.x + 4, Math.max(c.y, ml.y) + 2);
        const occ = (x0: number, x1: number, y0: number, y1: number) => { let n = 0, d = 0; for (let y = y0; y < y1; y += 1.5) for (let xx = x0; xx < x1; xx += 1.5) { const p = px(xx, y); n++; if (Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 40) d++; } return n ? d / n : 0; };
        const cls = classifyCell(c, occ, ml.y); const m = parseBubble(e.title ?? '', h.group, !!cls.self);
        if (h.group && cls.self === false) { const r = nicknameRect(c); if (r.y >= ml.y - 2) { const ls = (await ocr.recognize(f.source!, { x: Math.round((r.x - win.bounds.x) * k), y: Math.round((r.y - win.bounds.y) * k), w: Math.round(r.w * k), h: Math.round(r.h * k) })).filter(l => l.score > 0.6); if (ls.length) m.sender = ls.map(l => l.text.trim()).join(' '); } }
        msgs.push(m); }
      fs.rmSync(f.source!, { force: true });
      R.wechat.unread.push({ name: x.name, group: h.group, unread: x.unread, listPreview: x.preview, listTime: x.time, messages: msgs.filter(m => !m.self).slice(-x.unread).map(m => ({ sender: m.sender, text: m.text, kind: m.kind })) });
    }
    if (orig && R.wechat.unread.some((u: any) => u.messages)) R.wechat.restored = await open(orig);
    toTop();
  } catch (e: any) { R.wechat = { ...(R.wechat ?? {}), error: String(e.message ?? e) }; }
  await ocr.close(); console.log(JSON.stringify(R, null, 1)); clearInterval(keep);
})().catch(e => { console.log(JSON.stringify({ fatal: String(e?.stack ?? e) })); clearInterval(keep); });
