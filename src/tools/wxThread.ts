// Read recent WeChat conversation in one chat (read-only). Scroll up N screens, then walk down merging screens.
import { MacPlatformBridge } from '../platform/mac/MacPlatformBridge';
import { isWxGroup, parseBubble, wxNameEq, classifyCell, parseSession, WX_BUNDLES } from '../adapters/wechat';
import * as fs from 'fs';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms)); const keep = setInterval(() => {}, 1000);
const TARGET = process.env.WX_CHAT!, UP = +(process.env.WX_UP ?? 6);
(async () => {
  const b = new MacPlatformBridge(); const j = (a: string[]) => (b as any).j(a); const B = WX_BUNDLES[0];
  const sub = (id: string, d: number): any[] => { try { return j(['subtree', B, id, String(d)]); } catch { return []; } };
  const any = (await b.enumerateWindows([B])).filter(w => w.bounds.h > 80).sort((a, c) => c.bounds.w * c.bounds.h - a.bounds.w * a.bounds.h)[0];
  await b.raise(any.windowId); await sleep(1000);
  const hdr = () => sub('current_chat_name_label', 0)[0]?.value ?? '';
  const sessions = () => sub('session_list', 1).filter(e => e.depth === 1 && (e.identifier ?? '').startsWith('session_item_')).map(e => ({ ...parseSession(e.identifier, e.title ?? '', e.frame.y), frame: e.frame }));
  const lf = () => sub('session_list', 0)[0].frame;
  const lscroll = (d: number) => { const f = lf(); j(['hidwheelat', String(f.x + f.w / 2), String(f.y + Math.min(f.h / 2, 300)), String(d * Math.round(f.h * 0.7))]); };
  const toTop = () => { for (let i = 0; i < 40; i++) { const a = sessions().map(x => x.name).join('|'); lscroll(-1); lscroll(-1); if (sessions().map(x => x.name).join('|') === a) break; } };
  const open = async (name: string) => { toTop(); for (let i = 0; i < 10; i++) { const x = sessions().find(y => wxNameEq(y.name, name)); const f = lf();
    if (x && x.frame.y >= f.y && x.frame.y + x.frame.h <= f.y + f.h) { j(['hidclickat', String(x.frame.x + x.frame.w / 2), String(x.frame.y + x.frame.h / 2)]); await sleep(900); return wxNameEq(hdr(), name); } lscroll(1); } return false; };
  const orig = hdr(); const out: any = { orig };
  if (!(await open(TARGET))) { console.log(JSON.stringify({ ...out, error: 'open failed' })); clearInterval(keep); return; }
  const group = isWxGroup(sub('current_chat_count_label', 0)[0]?.value);
  const ml = () => sub('chat_message_list', 0)[0].frame;
  const mscroll = (d: number) => { const f = ml(); j(['hidwheelat', String(f.x + f.w / 2), String(f.y + f.h / 2), String(d * Math.round(f.h * 0.8))]); };
  const screen = async () => {
    const win = (await b.enumerateWindows([B])).filter(w => w.onScreen && w.bounds.h > 300)[0]; const f = await b.capture(win.windowId); const k = f.width / win.bounds.w; const m = ml();
    const px = (X: number, Y: number) => { const i = (Math.round((Y - win.bounds.y) * k) * f.width + Math.round((X - win.bounds.x) * k)) * 4; return [f.data[i], f.data[i + 1], f.data[i + 2]]; };
    const res: any[] = [];
    for (const e of sub('chat_message_list', 1).filter(e => e.depth === 1 && e.frame.h > 0 && e.frame.y + e.frame.h > m.y && e.frame.y < m.y + m.h)) {
      const t = (e.title ?? e.value ?? e.description ?? '').trim(); if (!t) continue;
      if (e.identifier !== 'chat_bubble_item_view') { res.push({ sys: t, id: e.identifier }); continue; }
      const c = e.frame; const bg = px(c.x + 4, Math.max(c.y, m.y) + 2);
      const occ = (x0: number, x1: number, y0: number, y1: number) => { let n = 0, d = 0; for (let y = y0; y < y1; y += 1.5) for (let xx = x0; xx < x1; xx += 1.5) { const p = px(xx, y); n++; if (Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 40) d++; } return n ? d / n : 0; };
      const cl = classifyCell(c, occ, m.y); const pb = parseBubble(t, group, !!cl.self);
      res.push({ raw: t, self: cl.self, sure: cl.self !== null, L: +cl.left.toFixed(2), R: +cl.right.toFixed(2), kind: pb.kind, text: pb.text });
    }
    fs.rmSync(f.source!, { force: true }); return res;
  };
  const key = (x: any) => (x.sys ?? x.raw);
  let tops: string[] = [];
  for (let i = 0; i < UP; i++) { mscroll(-1); await sleep(500); }
  const acc: any[] = [];
  for (let i = 0; i < UP + 3; i++) {
    const s = await screen(); let best = 0;
    for (let o = Math.min(acc.length, s.length); o > 0; o--) { let ok = true; for (let q = 0; q < o; q++) if (key(acc[acc.length - o + q]) !== key(s[q])) { ok = false; break; } if (ok) { best = o; break; } }
    acc.push(...s.slice(best)); const sig = s.map(key).join('|'); if (tops.includes(sig)) break; tops.push(sig);
    mscroll(1); await sleep(500);
  }
  out.group = group; out.msgs = acc;
  out.restored = orig ? await open(orig) : null; toTop();
  console.log(JSON.stringify(out, null, 1)); clearInterval(keep);
})().catch(e => { console.log(JSON.stringify({ fatal: String(e?.stack ?? e) })); clearInterval(keep); });
