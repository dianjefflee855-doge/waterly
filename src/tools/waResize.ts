// Resize test: for each size, set WhatsApp window frame via AX, then derive regions, scan inbox, check header (AX+OCR)
// and parse the given chat. Restores the original frame. Read-only + resize + open chat; no typing/Enter.
import { MacPlatformBridge } from '../platform/mac/MacPlatformBridge';
import { identifyWhatsAppWindow, WHATSAPP_AX, ocrNameEquals, assertChatHeader } from '../adapters/whatsapp';
import { scanInbox, openChat, parseBubbles, isGroupChat } from '../adapters/whatsappInbox';
import { deriveWhatsAppRegions, headerNameRect } from '../adapters/whatsappLayout';
import { RapidOcrSidecar } from '../perception/ocr';
import * as fs from 'fs';
const B = WHATSAPP_AX.bundleIds[0], CHAT = process.argv[2] ?? (() => { throw new Error('usage: waResize <chat name>'); })();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = new MacPlatformBridge(); const j = (a: string[]) => (b as any).j(a);
  const any = (await b.enumerateWindows(WHATSAPP_AX.bundleIds)).filter(w => w.bounds.h > 100)[0];
  if (any) { await b.raise(any.windowId); await sleep(1200); }
  const orig = identifyWhatsAppWindow(await b.enumerateWindows(WHATSAPP_AX.bundleIds))!.bounds;
  const scr = j(['screen']);
  const sizes: [string, number, number][] = [['small', 900, 650], ['narrow', 640, 800], ['medium', 1200, 850], ['large', Math.floor(scr.w), Math.floor(scr.h)], ['tiny', 420, 500]];
  const ocr = new RapidOcrSidecar(); const rows: any[] = [];
  try {
    for (const [name, w, h] of sizes) {
      const row: any = { size: name, req: `${w}x${h}` };
      const r = j(['setframe', B, String(scr.x), String(scr.y), String(w), String(h)]); await sleep(800);
      row.actual = `${Math.round(r.frame.w)}x${Math.round(r.frame.h)}`;
      try {
        await b.raise(identifyWhatsAppWindow(await b.enumerateWindows(WHATSAPP_AX.bundleIds))!.windowId); await sleep(500);
        let win = identifyWhatsAppWindow(await b.enumerateWindows(WHATSAPP_AX.bundleIds))!;
        row.cgMatchesAX = Math.abs(win.bounds.w - r.frame.w) < 2 && Math.abs(win.bounds.h - r.frame.h) < 2;
        let cells = b.chatCells(B); row.inboxChats = cells.length;
        if (cells.length) { try { await openChat(b, b, win, cells, CHAT); row.open = 'ok'; } catch (e: any) { row.open = e.code; } }
        else { try { await assertChatHeader(b, win, CHAT); row.open = 'already(no list)'; } catch { row.open = 'list hidden, not in chat'; } }
        const lay = b.layout(B); const regs = deriveWhatsAppRegions(lay, win.bounds);
        row.regions = regs ? (regs.singlePane ? 'singlePane' : `list ${Math.round(regs.sidebar.w * 100)}% / pane ${Math.round(regs.title.w * 100)}%`) : 'null';
        try { await assertChatHeader(b, win, CHAT); row.headerAX = true; } catch { row.headerAX = false; }
        win = identifyWhatsAppWindow(await b.enumerateWindows(WHATSAPP_AX.bundleIds))!;
        const f = await b.capture(win.windowId); const k = f.width / win.bounds.w; row.img = `${f.width}x${f.height}`;
        const hr = headerNameRect(lay, win.bounds);
        if (hr) { const ls = await ocr.recognize(f.source!, { x: Math.round(hr.x * k), y: Math.round(hr.y * k), w: Math.min(Math.round(hr.w * k), f.width - Math.round(hr.x * k)), h: Math.round(hr.h * k) });
          row.headerOCR = ls.some(l => ocrNameEquals(l.text, CHAT)); }
        fs.rmSync(f.source!, { force: true });
        const ids = lay.map((e: any) => e.identifier).filter(Boolean);
        const m = parseBubbles(b.bubbleDescs(B), { group: isGroupChat(ids) });
        row.parse = `${m.length} bubbles / self ${m.filter(x => x.self).length} / time ${m.filter(x => x.time).length}`;
      } catch (e: any) { row.error = String(e.message ?? e); }
      rows.push(row);
    }
  } finally {
    const rr = j(['setframe', B, String(orig.x), String(orig.y), String(orig.w), String(orig.h)]);
    rows.push({ restored: rr.frame, original: orig });
    await ocr.close();
  }
  console.log(JSON.stringify(rows));
})().catch(e => { console.log(JSON.stringify({ error: String(e) })); process.exit(1); });
