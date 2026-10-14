import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import { NcWatch, parseLine, LineBuffer } from '../src/main/ncwatch';

const wx = (t = '张三', b = '你好') => JSON.stringify({ ts: '2026-10-13T09:00:00Z', kind: 'banner', via: 'poll', texts: ['微信', t, b], desc: ['微信 , ' + t], ids: [] });
function clock() { let now = 0; const q: { at: number; f: () => void; id: number }[] = []; let id = 0;
  return { st: (f: () => void, ms: number) => { q.push({ at: now + ms, f, id: ++id }); return id; }, ct: (t: number) => { const i = q.findIndex(x => x.id === t); if (i >= 0) q.splice(i, 1); },
    adv(ms: number) { now += ms; for (;;) { q.sort((a, b) => a.at - b.at); if (!q.length || q[0].at > now) break; q.shift()!.f(); } } }; }
function fakeChild() { const c: any = new EventEmitter(); c.stdout = new EventEmitter(); c.killed = false; c.kill = () => { c.killed = true; }; return c; }

describe('ncwatch parser', () => {
  it('ignores malformed / irrelevant lines', () => {
    for (const l of ['', 'garbage', '{bad json', '{"kind":"dump","tree":[]}', JSON.stringify({ kind: 'banner', texts: ['Mail', 'x'], desc: ['Mail , x'] }), '{"kind":"banner"}']) expect(parseLine(l)).toBeNull();
  });
  it('parses start/error/banner', () => {
    expect(parseLine('{"kind":"start","pid":1,"observer":true,"trusted":true}')).toEqual({ kind: 'start', trusted: true });
    expect(parseLine('{"error":"notificationcenterui not running"}')?.kind).toBe('error');
    const e: any = parseLine(wx()); expect(e.kind).toBe('banner'); expect(e.app).toBe('wechat'); expect(e.n.conversation).toBe('张三');
  });
  it('line buffer handles split chunks', () => {
    const lb = new LineBuffer(); expect(lb.push('{"a"')).toEqual([]); expect(lb.push(':1}\n{"b":2}\n{"c"')).toEqual(['{"a":1}', '{"b":2}']);
  });
});

describe('NcWatch', () => {
  it('feeds every banner, debounces trigger per app, restarts with backoff, stops cleanly', () => {
    const c = clock(); const kids: any[] = []; const banners: string[] = []; const trig: string[] = [];
    const w = new NcWatch({ bin: '/x/ncwatch', spawn: (b, a) => { expect(a).toEqual(['86400']); const k = fakeChild(); kids.push(k); return k; },
      onBanner: (_a, n) => banners.push(n.body), onTrigger: a => trig.push(a), setTimeout: c.st, clearTimeout: c.ct, backoffMs: [100, 1000] });
    w.start(); expect(kids.length).toBe(1);
    kids[0].stdout.emit('data', wx('张三', '一') + '\n' + wx('张三', '二').slice(0, 20)); kids[0].stdout.emit('data', wx('张三', '二').slice(20) + '\nnoise\n');
    expect(banners).toEqual(['一', '二']); c.adv(1000); expect(trig).toEqual([]); c.adv(600); expect(trig).toEqual(['wechat']);
    kids[0].emit('exit', 1); expect(w.running).toBe(false); c.adv(99); expect(kids.length).toBe(1); c.adv(1); expect(kids.length).toBe(2);
    kids[1].emit('error', new Error('x')); c.adv(999); expect(kids.length).toBe(2); c.adv(1); expect(kids.length).toBe(3);
    w.stop(); expect(kids[2].killed).toBe(true); kids[2].emit('exit', null); c.adv(100000); expect(kids.length).toBe(3);
  });
});
