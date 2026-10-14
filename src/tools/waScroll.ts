// Full chat-list scan with scrolling at given window sizes; restores frame and scroll position. No typing/Enter.
import { MacPlatformBridge } from '../platform/mac/MacPlatformBridge';
import { identifyWhatsAppWindow, WHATSAPP_AX } from '../adapters/whatsapp';
import { scanAllChats } from '../adapters/whatsappScroll';
import { scanInbox, unreadChats } from '../adapters/whatsappInbox';
const B = WHATSAPP_AX.bundleIds[0]; const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = new MacPlatformBridge(); const j = (a: string[]) => (b as any).j(a);
  const any = (await b.enumerateWindows(WHATSAPP_AX.bundleIds)).filter(w => w.bounds.h > 100)[0];
  if (any) { await b.raise(any.windowId); await sleep(1200); }
  const orig = identifyWhatsAppWindow(await b.enumerateWindows(WHATSAPP_AX.bundleIds))!.bounds;
  const sizes: [string, number, number][] = [['original', orig.w, orig.h], ['small', 900, 650]];
  const rows: any[] = [];
  try {
    for (const [name, w, h] of sizes) {
      j(['setframe', B, String(orig.x), String(orig.y), String(w), String(h)]); await sleep(800);
      const sc = b.listScroller(B); const info = sc.info();
      for (let i = 0; i < 30; i++) { const a = JSON.stringify(sc.cells().map(c => c.name)); sc.page('up'); if (JSON.stringify(sc.cells().map(c => c.name)) === a) break; } // start from top
      const r = scanAllChats(sc);
      const list = scanInbox(r.chats);
      rows.push({ size: name, wxh: `${w}x${h}`, info: { bar: info.bar, barSettable: info.barSettable }, method: r.method, visibleFirstPage: r.visibleFirstPage,
        total: r.chats.length, pages: r.pages, reachedEnd: r.reachedEnd, backToTop: r.backToTop, ms: r.ms,
        unread: unreadChats(list).length, pinned: list.filter(c => c.pinned).length });
    }
  } finally { j(['setframe', B, String(orig.x), String(orig.y), String(orig.w), String(orig.h)]); }
  console.log(JSON.stringify(rows));
})().catch(e => { console.log(JSON.stringify({ error: String(e) })); process.exit(1); });
