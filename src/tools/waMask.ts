import { MacPlatformBridge } from '../platform/mac/MacPlatformBridge';
const mask = (s: string) => s.replace(/\u200e/g, '‹').replace(/[0-9]/g, '9').replace(/[\u4e00-\u9fff]/g, '汉').replace(/[A-Za-z]/g, 'a').replace(/(.)\1{3,}/g, '$1$1$1…').slice(0, 30);
const b = new MacPlatformBridge();
const cells = ((b as any).j(['subtree', 'net.whatsapp.WhatsApp', 'ChatMessagesTableView', '1']) as any[]).filter(e => e.identifier === 'WAMessageBubbleTableViewCell').sort((a, z) => a.frame.y - z.frame.y);
for (const e of cells) { const p = (e.description ?? '').split(/, /); console.log(Math.round(e.frame.x), p.length, JSON.stringify([p[0], ...p.slice(-4)].map(mask))); }
