// Validate group detection, sender parsing (vs OCR) and header-name OCR. Read-only + opening chats. Prints counts/booleans only.
import { MacPlatformBridge } from '../platform/mac/MacPlatformBridge';
import { identifyWhatsAppWindow, WHATSAPP_AX, ocrNameEquals } from '../adapters/whatsapp';
import { openChat, parseBubbles, isGroupChat, senderOcrAgreement } from '../adapters/whatsappInbox';
import { headerNameRect } from '../adapters/whatsappLayout';
import { RapidOcrSidecar } from '../perception/ocr';
import * as fs from 'fs';
const B = WHATSAPP_AX.bundleIds[0];
(async () => {
  const b = new MacPlatformBridge(); const chats = process.argv.slice(2);
  const any = (await b.enumerateWindows(WHATSAPP_AX.bundleIds)).filter(w => w.bounds.h > 100)[0];
  if (any) { await b.raise(any.windowId); await new Promise(r => setTimeout(r, 1200)); }
  const win = identifyWhatsAppWindow(await b.enumerateWindows(WHATSAPP_AX.bundleIds))!;
  const ocr = new RapidOcrSidecar(); const out: any[] = [];
  for (const c of chats) {
    const rec: any = { chat: c };
    try { await openChat(b, b, win, b.chatCells(B), c); rec.opened = true; } catch (e: any) { rec.opened = false; rec.err = e.code; out.push(rec); continue; }
    const lay = b.layout(B); const ids = lay.map(e => e.identifier).filter(Boolean);
    const hv = ((b as any).j(['subtree', B, 'NavigationBar_HeaderViewButton', '0']) as any[])[0]?.value;
    const group = isGroupChat(ids, hv); rec.group = group;
    const cells = ((b as any).j(['subtree', B, 'ChatMessagesTableView', '1']) as any[]).filter(e => e.identifier === 'WAMessageBubbleTableViewCell' && e.description).sort((a, z) => a.frame.y - z.frame.y);
    const msgs = parseBubbles(cells.map(e => e.description), { group, myNames: (process.env.WATERLY_MY_NAMES ?? '').split(',').filter(Boolean) });
    rec.parse = { bubbles: msgs.length, self: msgs.filter(m => m.self).length, withTime: msgs.filter(m => m.time).length,
      distinctSenders: new Set(msgs.filter(m => !m.self && m.sender).map(m => m.sender)).size, mentions: msgs.reduce((s, m) => s + m.mentions.length, 0), mentionsMe: msgs.filter(m => m.mentionsMe).length };
    const f = await b.capture(win.windowId); const k = f.width / win.bounds.w;
    const hr = headerNameRect(lay, win.bounds)!;
    const px = { x: Math.round(hr.x * k), y: Math.round(hr.y * k), w: Math.round(hr.w * k), h: Math.round(hr.h * k) };
    for (const s of [1, 2]) { const ls = await ocr.recognize(f.source!, px, s); rec[`headerOcr${s}x`] = { lines: ls.length, nameMatch: ls.some(l => ocrNameEquals(l.text, c)), best: ls.length ? +Math.max(...ls.map(l => l.score)).toFixed(2) : null }; }
    if (group) {
      const paneX = Math.round((lay.find(e => e.identifier === 'ChatMessagesTableView')!.frame.x - win.bounds.x) * k);
      const lines = await ocr.recognize(f.source!, { x: paneX, y: 0, w: f.width - paneX, h: f.height });
      rec.senderOcr = senderOcrAgreement(cells.map((e, i) => ({ sender: msgs[i].sender, self: msgs[i].self,
        top: { x: (e.frame.x - win.bounds.x) * k, y: (e.frame.y - win.bounds.y) * k } })).filter(m => m.top.y >= 0), lines, 40 * k);
    }
    fs.rmSync(f.source!, { force: true }); out.push(rec);
  }
  await ocr.close(); console.log(JSON.stringify(out, null, 1));
})().catch(e => { console.log(JSON.stringify({ error: String(e) })); process.exit(1); });
