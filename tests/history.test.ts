import { describe, it, expect } from 'vitest';
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import { Control, normalizeSettings } from '../src/core/control';
import { HistoryStore, clampHistoryDays } from '../src/core/history';
import { ingestNcLog } from '../src/main/ncimport';
import { buildConvs, ConvIds, historyPage, convKey } from '../src/main/remote/snapshot';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wh-'));
const banner = (ts: string, conv: string, body: string) => JSON.stringify({ kind: 'banner', via: 'AXCreated', ts, desc: [`微信 ${conv}, ${body}`], texts: [conv, body] });
const mk = (dir: string, now = '2026-10-13T14:00:00Z') => new Control(async () => ({ ok: true }), () => now, async () => ({ ok: true }), undefined, new HistoryStore(path.join(dir, 'history.jsonl'), fs as any, path.dirname));
const lf = (p: string) => ({ size: () => fs.statSync(p).size, read: (a: number, b: number) => fs.readFileSync(p).subarray(a, b).toString('utf8') });

describe('history store', () => {
  it('persists feed + drafts across restart with 0600', async () => {
    const d = tmp(); const c = mk(d); c.addFeed({ app: 'wechat', conversation: 'A', body: 'hi', at: '2026-10-13T07:00:00Z', source: 'banner' });
    const dr = c.addDraft('wechat', 'A', 'yo'); await c.approveDraft(dr.id, 'yo'); c.flush();
    expect(fs.statSync(path.join(d, 'history.jsonl')).mode & 0o777).toBe(0o600);
    const c2 = mk(d); expect(c2.s.feed.map(f => f.body)).toEqual(['hi']); expect(c2.s.drafts[0].status).toBe('copied'); expect(c2.s.autoReply).toBe(false);
  });
  it('retention prunes old, clamp + default 30, clearHistory keeps pending drafts', () => {
    expect(normalizeSettings({}).historyDays).toBe(30); expect(clampHistoryDays(0)).toBe(1); expect(clampHistoryDays(999)).toBe(365);
    const d = tmp(); const c = mk(d); c.addFeed({ app: 'wechat', conversation: 'A', body: 'old', at: '2026-09-01T00:00:00Z', source: 'banner' });
    c.addFeed({ app: 'wechat', conversation: 'A', body: 'new', at: '2026-10-13T00:00:00Z', source: 'banner' }); c.flush();
    expect(mk(d).s.feed.map(f => f.body)).toEqual(['new']);
    c.addDraft('wechat', 'A', 'p'); expect(c.clearHistory()).toBeGreaterThan(0); expect(c.s.drafts.length).toBe(1); expect(mk(d).s.feed.length).toBe(0);
  });
});
describe('ncwatch.log import', () => {
  it('imports once (read+imported), dedupes, then tails from persisted offset', () => {
    const d = tmp(); const log = path.join(d, 'nc.log');
    fs.writeFileSync(log, ['{"kind":"start","trusted":true}', banner('2026-10-13T07:52:57Z', '明明就', 'test'), banner('2026-10-13T07:52:58Z', '明明就', 'test'), banner('2026-10-13T08:00:00Z', 'B', '你好'), ''].join('\n'));
    const c = mk(d); const r = ingestNcLog(c, lf(log)); expect(r.added).toBe(2); expect(c.hmeta.importedCount).toBe(2);
    expect(c.s.feed.every(f => f.read && f.imported)).toBe(true);
    const c2 = mk(d); expect(c2.s.feed.length).toBe(2); expect(ingestNcLog(c2, lf(log)).added).toBe(0);
    fs.appendFileSync(log, banner('2026-10-13T09:00:00Z', 'B', '新') + '\n' + '{"kind":"ban'); // partial line not consumed
    expect(ingestNcLog(c2, lf(log)).added).toBe(1); expect(c2.s.feed[0].read).toBeFalsy(); expect(c2.hmeta.importedCount).toBe(2);
    fs.appendFileSync(log, 'ner"}\n'); expect(ingestNcLog(c2, lf(log)).added).toBe(0);
  });
});
describe('snapshot from history', () => {
  it('includes read history, read flag, unread count, paging', () => {
    const d = tmp(); const c = mk(d);
    for (let i = 0; i < 70; i++) c.addFeed({ app: 'wechat', conversation: 'A', body: 'm' + i, at: new Date(Date.parse('2026-10-13T06:00:00Z') + i * 60000).toISOString(), source: 'banner', read: i < 68 });
    const ids = new ConvIds(); const [a] = buildConvs(c.s, ids, 50, new Date('2026-10-13T14:00:00Z'));
    const m = a.msgs.filter((x: any) => x[0] !== 'd'); expect(m.length).toBe(50); expect(a.more).toBe(20); expect(a.unread).toBe(2); expect(m[0][4]).toBe(1); expect(m[49][4]).toBe(0);
    expect(m[49][1]).toBe('m69'); expect(a.msgs[0]).toEqual(['d', '今天']);
    const p = historyPage(c.s, convKey('wechat', 'A'), a.before, 50); expect(p.msgs.filter((x: any) => x[0] !== 'd').length).toBe(20); expect(p.more).toBe(0);
  });
});
