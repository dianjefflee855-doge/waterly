import { describe, it, expect, vi } from 'vitest';
import { Control } from '../src/core/control';
describe('Control', () => {
  it('auto-reply off by default; sending only via approve with exact text', async () => {
    const send = vi.fn(async () => ({ ok: true })); const c = new Control(send);
    expect(c.s.autoReply).toBe(false); c.setSendMode('wechat', 'auto', 'I_ACCEPT_BAN_RISK');
    const d = c.addDraft('wechat', 'A', '你好'); expect(send).not.toHaveBeenCalled();
    await expect(c.approveDraft(d.id, '你好!')).rejects.toThrow(); expect(send).not.toHaveBeenCalled();
    c.editDraft(d.id, '你好呀'); await c.approveDraft(d.id, '你好呀'); expect(send).toHaveBeenCalledTimes(1); expect(d.status).toBe('sent');
    await expect(c.approveDraft(d.id, '你好呀')).rejects.toThrow(); expect(send).toHaveBeenCalledTimes(1);
  });
  it('discarded drafts never send; rules', async () => {
    const send = vi.fn(async () => ({ ok: true })); const c = new Control(send);
    const d = c.addDraft('wechat', 'A', 'x'); c.discardDraft(d.id); await expect(c.approveDraft(d.id, 'x')).rejects.toThrow(); expect(send).not.toHaveBeenCalled();
    expect(c.allowed('wechat', 'B')).toBe(true); c.setRule({ app: 'wechat', conversation: 'B', mode: 'blacklist', reply: false }); expect(c.allowed('wechat', 'B')).toBe(false);
    c.setRule({ app: 'wechat', conversation: 'W', mode: 'whitelist', reply: true }); expect(c.allowed('wechat', 'C')).toBe(false); expect(c.allowed('wechat', 'W')).toBe(true);
  });
  it('feed dedupe', () => { const c = new Control(async () => ({ ok: true })); const at = new Date().toISOString();
    expect(c.addFeed({ app: 'wechat', conversation: 'A', body: 'x', at, source: 'banner' })).not.toBeNull();
    expect(c.addFeed({ app: 'wechat', conversation: 'A', body: 'x', at, source: 'scan' })).toBeNull(); });
});
