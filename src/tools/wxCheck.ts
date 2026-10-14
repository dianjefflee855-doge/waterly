// WeChat check (AX-first). Read-only + scrolling + opening chats + resize (restored) + dry-run ONLY in 文件传输助手.
// Never touches other chats' composers, never types into search, never presses Enter.
import { MacPlatformBridge } from '../platform/mac/MacPlatformBridge';
import { parseSession, isWxGroup, parseBubble, wxNameEq, WX_BUNDLES, WX_FILE_HELPER, classifyCell, nicknameRect, fingerprint, shouldStop } from '../adapters/wechat';
import * as fs from 'fs';
import { RapidOcrSidecar } from '../perception/ocr';
const ocr = new RapidOcrSidecar();
const B = WX_BUNDLES[0]; const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const keep = setInterval(() => {}, 1000);
const mask = (s: string) => (s ?? '').replace(/\d/g, '9').replace(/[A-Za-z]/g, 'a').replace(/[\u4e00-\u9fff]/g, '汉').replace(/(.)\1{3,}/g, '$1$1$1…').replace(/\n/g, '⏎').slice(0, 50);
const GROUP_TEST = process.argv[2] ?? 'kunkun折腾手记社区群';
(async () => {
  const b = new MacPlatformBridge(); const j = (a: string[]) => (b as any).j(a); const R: any = {};
  const sub = (id: string, d: number): any[] => { try { return j(['subtree', B, id, String(d)]); } catch { return []; } }; // element absent (e.g. no member count in 1:1)
  const getWin = async () => (await b.enumerateWindows(WX_BUNDLES)).filter(w => w.onScreen && w.bounds.h > 300).sort((a, c) => c.bounds.w * c.bounds.h - a.bounds.w * a.bounds.h)[0];
  const all = (await b.enumerateWindows(WX_BUNDLES)).filter(w => w.bounds.h > 80).sort((a, c) => c.bounds.w * c.bounds.h - a.bounds.w * a.bounds.h)[0];
  await b.raise(all.windowId); await sleep(1200);
  let win = await getWin(); const orig = { ...win.bounds };
  const header = () => { const n = sub('current_chat_name_label', 0)[0]?.value ?? null; const c = sub('current_chat_count_label', 0)[0]?.value ?? null; return { name: n, count: c, group: isWxGroup(c) }; };
  const sessions = () => sub('session_list', 1).filter(e => e.depth === 1 && (e.identifier ?? '').startsWith('session_item_')).map(e => ({ ...parseSession(e.identifier, e.title ?? '', e.frame?.y ?? 0), frame: e.frame }));
  const listFrame = () => sub('session_list', 0)[0]?.frame;
  const sig = () => sessions().map(s => s.name).join('|');
  const scroll = (dir: 1 | -1) => { const f = listFrame(); return j(['hidwheelat', String(f.x + f.w / 2), String(f.y + Math.min(f.h / 2, 300)), String(dir * Math.round(f.h * 0.7))]); };
  const toTop = async () => { for (let i = 0; i < 60; i++) { const a = sig(); scroll(-1); scroll(-1); if (sig() === a) return true; } return false; };
  const messages = async (group: boolean) => {
    win = await getWin(); const f = await b.capture(win.windowId); const k = f.width / win.bounds.w;
    const ml = sub('chat_message_list', 0)[0]?.frame;
    const px = (x: number, y: number) => { const X = Math.round((x - win.bounds.x) * k), Y = Math.round((y - win.bounds.y) * k); const i = (Y * f.width + X) * 4; return [f.data[i], f.data[i + 1], f.data[i + 2]]; };
    const cells = sub('chat_message_list', 1).filter(e => e.depth === 1 && e.identifier === 'chat_bubble_item_view' && e.frame?.h > 0 && e.frame.y < ml.y + ml.h);
    const res: any[] = [];
    for (const e of cells) {
      const c = e.frame; const bg = px(c.x + 4, Math.max(c.y, ml.y) + 2);
      const occupied = (x0: number, x1: number, y0: number, y1: number) => { let n = 0, d = 0;
        for (let y = y0; y < y1; y += 1.5) for (let x = x0; x < x1; x += 1.5) { const p = px(x, y); n++; if (Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 40) d++; }
        return n ? d / n : 0; };
      const cls = classifyCell(c, occupied, ml.y);
      const m = parseBubble(e.title ?? '', group, !!cls.self);
      if (group && cls.self === false) {
        const r = nicknameRect(c); if (r.y >= ml.y - 2) {
          const reg = { x: Math.round((r.x - win.bounds.x) * k), y: Math.round((r.y - win.bounds.y) * k), w: Math.round(r.w * k), h: Math.round(r.h * k) };
          const ls = (await ocr.recognize(f.source!, reg, 1)).filter(l => l.score > 0.6).sort((a, z) => a.box[0] - z.box[0]);
          if (ls.length) m.sender = ls.map(l => l.text.trim()).join(' ');
        }
      }
      res.push({ ...m, selfSure: cls.self !== null, l: cls.left, r: cls.right });
    }
    fs.rmSync(f.source!, { force: true });
    return res;
  };
  const open = async (name: string) => {
    await toTop();
    for (let i = 0; i < 40; i++) {
      const s = sessions().find(x => wxNameEq(x.name, name));
      if (s) {
        const lf = listFrame(); if (s.frame.y < lf.y || s.frame.y + s.frame.h > lf.y + lf.h) { scroll(1); continue; }
        let how = 'axpress'; const pr = j(['axpress', B, 'session_item_' + s.name]);
        if (!pr.ok) { how = 'hidclick'; j(['hidclickat', String(s.frame.x + s.frame.w / 2), String(s.frame.y + s.frame.h / 2)]); }
        await sleep(800); const h = header();
        return { name, how, ok: !!h.name && wxNameEq(h.name, name), header: h.name, group: h.group };
      }
      const a = sig(); scroll(1); if (sig() === a) break;
    }
    return { name, ok: false, why: 'not found in list' };
  };
  try {
    const h0 = header(); R.start = { header: h0.name, group: h0.group, win: orig };
    R.probe = { sessionItemActions: j(['elemactions', B, sessions()[0] ? 'session_item_' + sessions()[0].name : 'x'])[0]?.actions, listActions: j(['elemactions', B, 'session_list'])[0]?.actions };
    // inbox scan: (1) capped scan builds the fingerprint cache, (2) incremental rescan stops when unchanged
    const cacheFile = 'wx_scan_cache.json';
    const scanOnce = async (prev: Record<string, string> | null, maxPages: number) => {
      await toTop(); const t0 = Date.now(); const seen = new Map<string, any>(); let pages = 0, stale = 0; const streak = { n: 0 }; let stoppedEarly = false;
      while (pages < maxPages) {
        const page = sessions(); pages++; let add = 0; page.forEach(x => { if (!seen.has(x.name)) { seen.set(x.name, x); add++; } });
        if (shouldStop(page.filter(x => x.name !== '折叠的聊天'), prev, streak)) { stoppedEarly = true; break; }
        const a = sig(); scroll(1); if (sig() === a) { stale++; if (stale >= 2) break; } else stale = 0;
      }
      const back = await toTop(); const list = [...seen.values()];
      return { list, pages, ms: Date.now() - t0, stoppedEarly, backToTop: back };
    };
    const full = await scanOnce(null, +(process.env.WX_PAGES ?? 15));
    fs.writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(full.list.map(x => [x.name, fingerprint(x)]))));
    const inc = await scanOnce(JSON.parse(fs.readFileSync(cacheFile, 'utf8')), 200);
    const list = full.list;
    const unreadFirst = [...inc.list].filter(x => x.unread > 0 || x.mentioned).sort((a, z) => (z.mentioned ? 1 : 0) - (a.mentioned ? 1 : 0) || z.unread - a.unread);
    R.scan = { capped: { pages: full.pages, chats: full.list.length, ms: full.ms }, incremental: { pages: inc.pages, chats: inc.list.length, ms: inc.ms, stoppedEarly: inc.stoppedEarly, backToTop: inc.backToTop },
      unreadFirst: unreadFirst.map(x => [x.name, x.unread, x.mentioned]), fileHelper: list.some(x => WX_FILE_HELPER.includes(x.name)) };
    R.open = [];
    const summarize = (ms: any[]) => ({ msgs: ms.length, selfSure: ms.filter(m => m.selfSure).length, self: ms.filter(m => m.self).length,
      other: ms.filter(m => m.selfSure && !m.self).length, senders: new Set(ms.filter(m => !m.self && m.sender).map(m => m.sender)).size,
      withSender: ms.filter(m => m.selfSure && !m.self && m.sender).length, mentions: ms.reduce((a, m) => a + m.mentions.length, 0), lr: ms.map(m => [m.l, m.r]) });
    for (const name of [WX_FILE_HELPER[0], process.env.WX_ONE ?? '刘小胖', GROUP_TEST]) {
      const o = await open(name); R.open.push({ ...o, parse: o.ok ? summarize(await messages(!!o.group)) : null });
    }
    // resize
    R.resize = [];
    for (const [w, hh] of (process.env.WX_RESIZE ? [[900, 650], [700, 520]] : [])) {
      const r = j(['setframe', B, String(orig.x), String(orig.y), String(w), String(hh)]); await sleep(900);
      const s = sessions(); const lf = listFrame(); const h = header(); const inp = sub('chat_input_field', 0)[0]; const ml = sub('chat_message_list', 0)[0];
      R.resize.push({ req: `${w}x${hh}`, actual: `${Math.round(r.frame.w)}x${Math.round(r.frame.h)}`, listVisible: !!lf && lf.w > 0, rows: s.length, header: h.name, composer: !!inp, msgList: !!ml });
    }
  } catch (e: any) { R.error = String(e.stack ?? e); }
  finally {
    j(['setframe', B, String(orig.x), String(orig.y), String(orig.w), String(orig.h)]); await sleep(600);
    if (R.start?.header) { try { R.restoreChat = await open(R.start.header); await toTop(); } catch (e: any) { R.restoreChat = String(e); } }
  }
  await ocr.close(); console.log(JSON.stringify(R, null, 1)); clearInterval(keep);
})().catch(e => { console.log(JSON.stringify({ fatal: String(e?.stack ?? e) })); clearInterval(keep); });
