// Read-only calibration: capture WhatsApp main window, OCR with old fixed geometry vs AX-derived regions.
// Prints metrics only; no message text (chat-name check result is boolean).
import { MacPlatformBridge } from '../platform/mac/MacPlatformBridge';
import { identifyWhatsAppWindow, WHATSAPP_AX, headerMatches } from '../adapters/whatsapp';
import { BaseAdapter, FracRect } from '../adapters/AppAdapter';
import { WHATSAPP } from '../adapters/configs';
import { deriveWhatsAppRegions } from '../adapters/whatsappLayout';
import { RapidOcrSidecar, OcrLine } from '../perception/ocr';

const OLD = { sidebar: { x: 0, y: 0, w: 0.277, h: 1 }, title: { x: 0.278, y: 0, w: 0.72, h: 0.07 },
  messages: { x: 0.278, y: 0.072, w: 0.72, h: 0.8 }, input: { x: 0.278, y: 0.88, w: 0.72, h: 0.12 } };
const stats = (ls: OcrLine[]) => ({ lines: ls.length, meanScore: ls.length ? +(ls.reduce((s, l) => s + l.score, 0) / ls.length).toFixed(3) : null,
  lowScore: ls.filter(l => l.score < 0.7).length, cjkLines: ls.filter(l => /[\u4e00-\u9fff]/.test(l.text)).length });
(async () => {
  const names = process.argv.slice(2);
  const b = new MacPlatformBridge();
  // Stage Manager shrinks inactive windows to thumbnails: raise WhatsApp first (no input), then re-enumerate.
  const w0 = (await b.enumerateWindows(WHATSAPP_AX.bundleIds)).filter(w => w.bounds.h > 100).sort((a, c) => c.bounds.w * c.bounds.h - a.bounds.w * a.bounds.h)[0];
  if (w0) { await b.raise(w0.windowId); await new Promise(r => setTimeout(r, 1200)); }
  const win = identifyWhatsAppWindow(await b.enumerateWindows(WHATSAPP_AX.bundleIds));
  if (!win) { console.log('{"result":"no_window"}'); return; }
  const regs = deriveWhatsAppRegions(b.layout(WHATSAPP_AX.bundleIds[0]));
  const f = await b.capture(win.windowId);
  const ocr = new RapidOcrSidecar();
  const full = await ocr.recognize(f.source!);
  const oldAd = new BaseAdapter({ ...WHATSAPP, regions: OLD });
  const before: any = {};
  for (const [n, r] of Object.entries(OLD)) { const p = oldAd.toPx(r, f.width, f.height);
    before[n] = stats(full.filter(l => { const cx = (l.box[0] + l.box[2]) / 2, cy = (l.box[1] + l.box[3]) / 2; return cx >= p.x && cx < p.x + p.w && cy >= p.y && cy < p.y + p.h; })); }
  const newAd = new BaseAdapter({ ...WHATSAPP, regions: regs ?? WHATSAPP.regions });
  const after: any = {}; const per: Record<string, OcrLine[]> = {};
  for (const [n, r] of Object.entries(newAd.config.regions) as [string, FracRect][]) {
    const p = newAd.toPx(r, f.width, f.height);
    const t0 = Date.now(); per[n] = await ocr.recognize(f.source!, p, n === 'title' ? 2 : 1); after[n] = { ...stats(per[n]), ms: Date.now() - t0 };
  }
  const sp = newAd.toPx(newAd.config.regions.sidebar, f.width, f.height);
  const t1 = Date.now(); const up = await ocr.recognize(f.source!, sp, 1.5);
  const sidebarUpscaled = { ...stats(up), ms: Date.now() - t1 };
  await ocr.close();
  const inTitle = (n: string) => per.title.some(l => headerMatches({ role: 'x', description: l.text }, n));
  const msgs = newAd.parseMessages(per.messages, f.width, f.height);
  console.log(JSON.stringify({ windowId: win.windowId, image: [f.width, f.height], derivedFromAX: !!regs, regions: newAd.config.regions,
    before, after, sidebarUpscaled_1_5x: sidebarUpscaled,
    chatNameInHeader: Object.fromEntries(names.map(n => [n, inTitle(n)])),
    chatNameAnywhereFullImage: Object.fromEntries(names.map(n => [n, full.some(l => headerMatches({ role: 'x', description: l.text }, n))])),
    parsed: { total: msgs.length, self: msgs.filter(m => m.speaker === 'self').length, other: msgs.filter(m => m.speaker === 'other').length } }));
})().catch(e => { console.log(JSON.stringify({ error: String(e) })); process.exit(1); });
