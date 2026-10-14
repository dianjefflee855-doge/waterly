// Telegram check: list scan with system wheel (pointer restored), find Saved Messages, open chats by name (re-verified
// row position before click, header OCR check), dry-run paste/clear ONLY in Saved Messages with empty composer.
// Never touches any other chat's composer. No Enter/send.
import { MacPlatformBridge } from '../platform/mac/MacPlatformBridge';
import { RapidOcrSidecar, OcrLine } from '../perception/ocr';
import { findTelegramWindow, deriveTelegramRegions, readHeader, parseList, parseMessages, nameEq, TG_BUNDLES } from '../adapters/telegram';
import * as fs from 'fs';
const log = (...a: any[]) => { if (process.env.TG_DEBUG) console.error('[tg]', ...a); };
const keep = setInterval(() => {}, 1000);
const SAVED = ['收藏夹', 'Saved Messages', '已保存的消息', '保存的消息', '我的收藏'];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const FINAL = process.argv[2] ?? 'LD游戏技术群';
(async () => {
  const b = new MacPlatformBridge(); const j = (a: string[]) => (b as any).j(a);
  const ocr = new RapidOcrSidecar(); const R: any = {};
  const getWin = async () => findTelegramWindow(await b.enumerateWindows(TG_BUNDLES))!;
  const any = (await b.enumerateWindows(TG_BUNDLES)).filter(w => w.bounds.h > 100).sort((a, c) => c.bounds.w * c.bounds.h - a.bounds.w * a.bounds.h)[0];
  await b.raise(any.windowId); await sleep(1200);
  let win = await getWin(); const pid = win.pid;
  const snap = async () => {
    win = await getWin(); const f = await b.capture(win.windowId); const k = f.width / win.bounds.w;
    const lines = await ocr.recognize(f.source!); const reg = deriveTelegramRegions(lines, k, win.bounds);
    const coloured = (l: OcrLine) => { let c = 0, n = 0; for (let y = Math.round(l.box[1]); y < l.box[3]; y += 2) for (let x = Math.round(l.box[0]); x < l.box[2]; x += 2) {
      const i = (y * f.width + x) * 4, r = f.data[i], g = f.data[i + 1], bb = f.data[i + 2]; const mx = Math.max(r, g, bb), mn = Math.min(r, g, bb);
      if (mx < 235) { n++; if (mx - mn > 60) c++; } } return n > 10 && c / n > 0.35; };
    fs.rmSync(f.source!, { force: true }); return { k, lines, reg, coloured };
  };
  const hdr = (s: any) => readHeader(s.lines, s.reg, s.k);
  const sig = (s: any) => parseList(s.lines, s.reg, s.k).map(r => r.name).join('|');
  const wheel = (s: any, dy: number) => { return j(['hidwheelat', String(win.bounds.x + s.reg.listW / 2), String(win.bounds.y + 400), String(dy)]); };
  const openByName = async (name: string) => {
    const sx = await snap(); const rows = parseList(sx.lines, sx.reg, sx.k).filter(r => nameEq(r.name, name));
    if (rows.length !== 1) return { name, ok: false, why: `list matches ${rows.length}` };
    const sz = await snap(); const again = parseList(sz.lines, sz.reg, sz.k).filter(r => nameEq(r.name, name));
    if (again.length !== 1 || Math.abs(again[0].y - rows[0].y) > 4 * sz.k) return { name, ok: false, why: 'list moved between capture and click' };
    j(['hidclickat', String(win.bounds.x + again[0].cx / sz.k), String(win.bounds.y + again[0].cy / sz.k)]); await sleep(900);
    const sy = await snap(); const h = hdr(sy);
    const m = parseMessages(sy.lines, sy.reg, sy.k, !!h.group, sy.coloured);
    return { name, ok: !!h.name && nameEq(h.name, name), header: h.name, group: h.group,
      parse: { msgs: m.length, self: m.filter(x => x.self).length, senders: new Set(m.filter(x => !x.self && x.sender).map(x => x.sender)).size, withTime: m.filter(x => x.time).length, mentions: m.reduce((a, x) => a + x.mentions.length, 0) } };
  };
  try {
    let s = await snap(); R.start = { header: hdr(s).name, listW: s.reg.listW };
    // 1) verify re-check-before-click fix: open first visible chat that is not the current one and not yt
    const rows0 = parseList(s.lines, s.reg, s.k);
    const t1 = rows0.find(r => !nameEq(r.name, hdr(s).name ?? '') && !nameEq(r.name, 'yt'));
    R.openTest = t1 ? await openByName(t1.name) : { skipped: true };
    if (!R.openTest.ok) throw new Error('open test failed; stopping before any composer action');
    // 2) scroll scan with system wheel (pointer restored)
    s = await snap(); const firstSig = sig(s); const t0 = Date.now();
    const seen = new Map<string, number>(); parseList(s.lines, s.reg, s.k).forEach(r => seen.set(r.name, r.unread));
    let saved: string | null = [...seen.keys()].find(n => SAVED.some(x => nameEq(n, x))) ?? null;
    let prev = firstSig, stale = 0, pages = 1, moved = false;
    const page = Math.round((win.bounds.h - 200) * 0.7);
    while (pages < 60 && stale < 2) {
      wheel(s, page); pages++; s = await snap(); const cs = sig(s); if (cs !== prev) moved = true;
      let added = 0; parseList(s.lines, s.reg, s.k).forEach(r => { if (!seen.has(r.name)) { seen.set(r.name, r.unread); added++; } });
      saved ??= [...seen.keys()].find(n => SAVED.some(x => nameEq(n, x))) ?? null;
      stale = added === 0 && cs === prev ? stale + 1 : 0; prev = cs; log('page', pages, seen.size);
      if (saved && process.env.TG_STOP_AT_SAVED) break;
    }
    // locate saved while scrolling back up (keep position where it's visible for opening)
    let savedVisible = false; let back = false;
    for (let i = 0; i < 60; i++) {
      if (saved && parseList(s.lines, s.reg, s.k).some(r => nameEq(r.name, saved!))) { savedVisible = true; break; }
      wheel(s, -page); s = await snap(); if (sig(s) === firstSig) { back = true; break; }
    }
    R.scan = { method: 'hidwheel', moved, total: seen.size, pages, ms: Date.now() - t0, unreadChats: [...seen.values()].filter(v => v > 0).length, savedMessages: saved, savedVisible };
    // 3) Saved Messages dry-run
    if (saved && savedVisible) {
      const o = await openByName(saved); R.saved = o;
      if (o.ok) {
        s = await snap(); const c = s.reg.composer;
        j(['hidclickat', String(win.bounds.x + c.x + c.w / 2), String(win.bounds.y + c.y + c.h / 2)]); await sleep(400);
        const s2 = await snap(); const e0 = j(['focusedelem', String(pid)]);
        if (nameEq(hdr(s2).name ?? '', saved) && e0.role === 'AXTextArea' && e0.numChars === 0 && j(['focusstate']).pid === pid) {
          const cf = `/tmp/waterly-tgclip-${process.pid}.json`; j(['clipsave', cf]);
          try {
            j(['clipset', '[Waterly试运行，不会发送]']); j(['key', String(pid), 'Cmd+V']); await sleep(400);
            const e1 = j(['focusedelem', String(pid)]); const s3 = await snap();
            const safe = j(['focusstate']).pid === pid && e1.role === 'AXTextArea' && nameEq(hdr(s3).name ?? '', saved);
            if (safe) { j(['key', String(pid), 'Cmd+A']); j(['key', String(pid), 'Delete']); await sleep(400); }
            const e2 = j(['focusedelem', String(pid)]);
            R.dryRun = { before: 0, pasted: e1.numChars, expected: 17, after: e2.numChars, clearedSafely: safe };
          } finally { j(['cliprestore', cf]); fs.rmSync(cf, { force: true }); R.clipboardRestored = true; }
        } else R.dryRun = { skipped: true, why: `header/composer check failed role=${e0.role} chars=${e0.numChars}` };
      }
    } else R.dryRun = { skipped: true, why: saved ? 'saved not visible' : 'Saved Messages not found' };
    // 4) back to top, reopen FINAL
    for (let i = 0; i < 60; i++) { s = await snap(); if (sig(s) === firstSig) break; wheel(s, -page * 2); }
    R.backToTop = sig(await snap()) === firstSig;
    R.final = await openByName(FINAL);
  } catch (e: any) { R.error = String(e.stack ?? e); }
  finally { await ocr.close(); }
  console.log(JSON.stringify(R, null, 1)); clearInterval(keep);
})().catch(e => { console.log(JSON.stringify({ fatal: String(e?.stack ?? e) })); clearInterval(keep); });
