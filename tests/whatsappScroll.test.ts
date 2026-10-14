import { describe, it, expect } from 'vitest';
import { scanAllChats, ListScroller } from '../src/adapters/whatsappScroll';
const all = Array.from({ length: 37 }, (_, i) => ({ name: `chat${i}`, value: '', y: 0 }));
function fake(bar: boolean, page = false): ListScroller & { pos: number } {
  const vis = 8;
  const f: any = { pos: 0,
    cells: () => all.slice(f.pos, f.pos + vis),
    info: () => ({ bar, barSettable: bar, barValue: 0, listFrame: { h: 560 } }),
    setBar: (v: number) => { f.pos = Math.round(v * (all.length - vis)); return { ok: true, barValue: v }; },
    page: page ? (d: string) => { f.pos = Math.max(0, Math.min(all.length - vis, f.pos + (d === 'down' ? 6 : -6))); return { ok: true, barValue: -1 }; } : undefined,
    wheel: (dy: number) => { f.pos = Math.max(0, Math.min(all.length - vis, f.pos + Math.round(dy / 70))); return { ok: true, barValue: -1 }; } };
  return f;
}
describe('scanAllChats', () => {
  for (const [bar, pg] of [[true, false], [false, false], [false, true]]) it(bar ? 'scroll bar' : pg ? 'AX page' : 'wheel', () => {
    const s = fake(bar, pg); const r = scanAllChats(s);
    expect(r.chats.map(c => c.name)).toEqual(all.map(c => c.name));
    expect(r.reachedEnd).toBe(true); expect(r.backToTop).toBe(true); expect(s.pos).toBe(0);
    expect(r.visibleFirstPage).toBe(8);
  });
});
