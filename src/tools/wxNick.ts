// Read-only: for the current WeChat chat, crop nickname strips of incoming cells, save PNGs, OCR them.
import { MacPlatformBridge } from '../platform/mac/MacPlatformBridge';
import { RapidOcrSidecar } from '../perception/ocr';
import { nicknameRect } from '../adapters/wechat';
import { PNG } from 'pngjs'; import * as fs from 'fs';
(async () => {
  const b = new MacPlatformBridge(); const j = (a: string[]) => (b as any).j(a); const B = 'com.tencent.xinWeChat';
  const w = (await b.enumerateWindows([B])).filter(x => x.onScreen && x.bounds.h > 300)[0];
  const f = await b.capture(w.windowId); const k = f.width / w.bounds.w; const png = PNG.sync.read(fs.readFileSync(f.source!));
  const ml = j(['subtree', B, 'chat_message_list', '0'])[0].frame;
  const cells = (j(['subtree', B, 'chat_message_list', '1']) as any[]).filter(e => e.identifier === 'chat_bubble_item_view' && e.frame.h > 0);
  const ocr = new RapidOcrSidecar(); const out: any[] = [];
  for (const [i, e] of cells.entries()) {
    const r = nicknameRect(e.frame); const reg = { x: Math.round((r.x - w.bounds.x) * k), y: Math.round((r.y - w.bounds.y) * k), w: Math.round(r.w * k), h: Math.round(r.h * k) };
    if (r.y < ml.y) { out.push({ i, skipped: 'above list' }); continue; }
    const c = new PNG({ width: reg.w, height: reg.h }); PNG.bitblt(png, c, reg.x, reg.y, reg.w, reg.h, 0, 0); fs.writeFileSync(`nick_${i}.png`, PNG.sync.write(c));
    const big = { ...reg, y: reg.y - Math.round(6 * k), h: reg.h + Math.round(12 * k) };
    for (const s of [1, 2]) { const ls = await ocr.recognize(f.source!, big, s); out.push({ i, s, lines: ls.map(l => ({ len: l.text.length, score: +l.score.toFixed(2) })) }); }
  }
  await ocr.close(); fs.rmSync(f.source!, { force: true }); console.log(JSON.stringify(out));
})();
