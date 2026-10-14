// Notification-banner listener (Accessibility on com.apple.notificationcenterui). No DB, no WeChat files.
import { spawn } from 'child_process';
export interface ChatNotification { app: string; bundleId: string; conversation: string; sender?: string; body: string; isGroup?: boolean; receivedAt: string; raw: { texts: string[]; desc: string[] } }
const APPS: Record<string, string> = { '微信': 'com.tencent.xinWeChat', 'WeChat': 'com.tencent.xinWeChat', 'WhatsApp': 'net.whatsapp.WhatsApp', 'Telegram': 'ru.keepcoder.Telegram' };
// Real macOS 26 banner (captured 2026-10-13): AXGroup subrole AXNotificationCenterBanner, desc "微信 <title>, <body>",
// children AXStaticText id=title (conversation) and id=body. receivedAt = capture time, NOT send time.
export function parseBanner(ev: { ts: string; texts: string[]; desc: string[]; ids?: string[] }): ChatNotification | null {
  const d = ev.desc[0] ?? ''; const app = Object.keys(APPS).find(a => d.startsWith(a + ' ') || ev.texts[0] === a);
  if (!app) return null;
  const t = ev.texts[0] === app ? ev.texts.slice(1) : ev.texts;
  const conversation = (t[0] ?? '').trim(); const bodyRaw = t.slice(1).join('\n').trim();
  // group banners: body "sender: text" (WeChat may prefix "[N条]")
  const b = bodyRaw.replace(/^\[\d+条\]\s*/, ''); const m = b.match(/^([^:：\n]{1,40})[:：]\s?([\s\S]*)$/);
  return { app, bundleId: APPS[app], conversation, sender: m?.[1], body: m ? m[2] : b, isGroup: m ? true : undefined, receivedAt: ev.ts, raw: { texts: ev.texts, desc: ev.desc } };
}
export function listen(bin: string, cb: (n: ChatNotification) => void, onlyBundle = 'com.tencent.xinWeChat', seconds = 86400) {
  const p = spawn(bin, [String(seconds)]); let buf = '';
  p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1);
    try { const e = JSON.parse(l); if (e.kind === 'banner') { const n = parseBanner(e); if (n && n.bundleId === onlyBundle) cb(n); } } catch {} } });
  return () => p.kill();
}
