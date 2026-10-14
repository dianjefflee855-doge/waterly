// Read-only: screenshot Telegram main window, OCR, report keyword booleans only (login state / Saved Messages).
import { MacPlatformBridge } from '../platform/mac/MacPlatformBridge';
import { RapidOcrSidecar } from '../perception/ocr';
import * as fs from 'fs';
(async () => {
  const b = new MacPlatformBridge();
  const w = (await b.enumerateWindows(['ru.keepcoder.Telegram'])).filter(x => x.onScreen && x.bounds.h > 300).sort((a, c) => c.bounds.w * c.bounds.h - a.bounds.w * a.bounds.h)[0];
  if (!w) { console.log('{"result":"no_window"}'); return; }
  const f = await b.capture(w.windowId); const ocr = new RapidOcrSidecar(); const ls = await ocr.recognize(f.source!); await ocr.close(); fs.rmSync(f.source!, { force: true });
  const t = ls.map(l => l.text).join(' ').toLowerCase();
  const kws = ['saved messages', '收藏夹', '已保存', 'your phone', 'phone number', 'start messaging', '开始', 'log in', '登录', 'qr', '二维码', 'chats', '聊天', 'search', '搜索', 'write a message', '写消息', 'message', '消息', 'online', '在线', 'last seen', '最后'];
  console.log(JSON.stringify({ windowId: w.windowId, bounds: w.bounds, lines: ls.length, meanScore: ls.length ? +(ls.reduce((s, l) => s + l.score, 0) / ls.length).toFixed(2) : null,
    timeLike: ls.filter(l => /^\d{1,2}:\d{2}$/.test(l.text.trim())).length, kw: Object.fromEntries(kws.map(k => [k, t.includes(k)])) }));
})();
