// Inbox check: scan (read-only), optional open test. Prints names only for the chats it opens/unread list; no message text.
import { MacPlatformBridge } from '../platform/mac/MacPlatformBridge';
import { identifyWhatsAppWindow, WHATSAPP_AX } from '../adapters/whatsapp';
import { scanInbox, unreadChats, openChat, parseBubbles, crossCheck, isGroupChat } from '../adapters/whatsappInbox';
import { WhatsAppAdapter } from '../adapters/configs';
import { deriveWhatsAppRegions } from '../adapters/whatsappLayout';
import { BaseAdapter } from '../adapters/AppAdapter';
import { Perception } from '../perception/pipeline';
(async () => {
  const [mode, ...names] = process.argv.slice(2); // mode: scan | open <A> <B> (open A, verify, then reopen B)
  const B = WHATSAPP_AX.bundleIds[0], b = new MacPlatformBridge();
  let wins = await b.enumerateWindows(WHATSAPP_AX.bundleIds);
  let win = identifyWhatsAppWindow(wins);
  if (!win) { const any = wins.find(w => w.bounds.h > 100); if (any) { await b.raise(any.windowId); await new Promise(r => setTimeout(r, 1200)); }
    win = identifyWhatsAppWindow(await b.enumerateWindows(WHATSAPP_AX.bundleIds)); }
  if (!win) { console.log('{"result":"no_window"}'); return; }
  const cells = b.chatCells(B), list = scanInbox(cells), unread = unreadChats(list);
  const out: any = { windowId: win.windowId, chats: list.length, current: list.find(c => c.selected)?.name ?? null, pinned: list.filter(c => c.pinned).length, muted: list.filter(c => c.muted).length,
    unread: unread.map(c => ({ name: c.name, unread: c.unread, marked: c.markedUnread, mentioned: c.mentioned })) };
  try { // colour badge cross-check on screenshot of the AX-derived chat-list region
    await b.raise(win.windowId); await new Promise(r => setTimeout(r, 500));
    win = identifyWhatsAppWindow(await b.enumerateWindows(WHATSAPP_AX.bundleIds)) ?? win;
    const regs = deriveWhatsAppRegions(b.layout(B)); const ad = new BaseAdapter({ ...new WhatsAppAdapter().config, ...(regs ? { regions: regs } : {}) });
    const f = await b.capture(win.windowId); const badges = new Perception(null as any).unread(ad, f);
    out.crossCheck = crossCheck(unread.length, badges.length);
    require('fs').rmSync(f.source!, { force: true });
  } catch (e: any) { out.crossCheck = { error: String(e.message ?? e) }; }
  const shape = () => { const ids = b.layout(B).map((e: any) => e.identifier).filter(Boolean); const group = isGroupChat(ids);
    const m = parseBubbles(b.bubbleDescs(B), { group, myNames: (process.env.WATERLY_MY_NAMES ?? '').split(',').filter(Boolean) });
    return { group, bubbles: m.length, self: m.filter(x => x.self).length, distinctSenders: new Set(m.filter(x => !x.self).map(x => x.sender)).size,
      unknownSender: m.filter(x => !x.self && !x.sender).length, mentions: m.reduce((s, x) => s + x.mentions.length, 0), mentionsMe: m.filter(x => x.mentionsMe).length }; };
  out.currentChatParse = shape();
  if (mode === 'open') {
    out.open = [];
    for (const n of names) {
      try { await openChat(b, b, win, b.chatCells(B), n); out.open.push({ name: n, ok: true, parse: shape() }); }
      catch (e: any) { out.open.push({ name: n, ok: false, code: e.code, msg: e.message }); }
    }
  }
  console.log(JSON.stringify(out, null, 1));
})().catch(e => { console.log(JSON.stringify({ error: String(e) })); process.exit(1); });
