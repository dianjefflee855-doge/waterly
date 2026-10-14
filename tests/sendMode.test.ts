import { describe, it, expect, vi } from 'vitest';
import { Control, AUTO_SEND_CONFIRM, normalizeSettings } from '../src/core/control';
const mk = (saved: any = null) => { const send = vi.fn(async () => ({ ok: true })); const copy = vi.fn(async () => ({ ok: true }));
  const store = { data: saved, load: vi.fn(function (this: any) { return store.data; }), save: vi.fn((s: any) => { store.data = JSON.parse(JSON.stringify(s)); }) };
  return { send, copy, store, c: new Control(send, undefined, copy, store) }; };
describe('send mode', () => {
  it('defaults to clipboard for WeChat and WhatsApp; approve copies, never auto-sends', async () => {
    const { c, send, copy } = mk(); expect(c.s.settings.sendMode).toEqual({ wechat: 'clipboard', whatsapp: 'clipboard' }); expect(c.s.settings.contextLimit).toBe(20);
    for (const app of ['wechat', 'whatsapp'] as const) { const d = c.addDraft(app, 'A', 'hi'); await c.approveDraft(d.id, 'hi'); expect(d.status).toBe('copied'); expect(d.via).toBe('clipboard'); }
    expect(copy).toHaveBeenCalledTimes(2); expect(send).not.toHaveBeenCalled();
  });
  it('nothing is copied or sent without approval', async () => { const { c, send, copy } = mk(); c.addDraft('wechat', 'A', 'x'); expect(copy).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled(); });
  it('approval still requires exact text in clipboard mode', async () => { const { c, copy } = mk(); const d = c.addDraft('wechat', 'A', 'x');
    await expect(c.approveDraft(d.id, 'y')).rejects.toThrow(); expect(copy).not.toHaveBeenCalled(); });
  it('enabling auto requires the explicit risk confirm', () => { const { c, store } = mk();
    expect(() => c.setSendMode('wechat', 'auto')).toThrow(/封号/); expect(() => c.setSendMode('wechat', 'auto', 'yes')).toThrow();
    expect(c.s.settings.sendMode.wechat).toBe('clipboard'); expect(store.save).not.toHaveBeenCalled();
    c.setSendMode('wechat', 'auto', AUTO_SEND_CONFIRM); expect(c.s.settings.sendMode.wechat).toBe('auto'); expect(c.s.settings.sendMode.whatsapp).toBe('clipboard');
    c.setSendMode('wechat', 'clipboard'); expect(c.s.settings.sendMode.wechat).toBe('clipboard'); });
  it('auto mode uses the existing send path after approval', async () => { const { c, send, copy } = mk(); c.setSendMode('wechat', 'auto', AUTO_SEND_CONFIRM);
    const d = c.addDraft('wechat', 'A', 'hi'); expect(send).not.toHaveBeenCalled(); await c.approveDraft(d.id, 'hi');
    expect(send).toHaveBeenCalledTimes(1); expect(copy).not.toHaveBeenCalled(); expect(d.status).toBe('sent'); expect(d.via).toBe('auto'); });
  it('persists and reloads; invalid stored values fall back to clipboard', () => { const { c, store, send, copy } = mk(); c.setSendMode('whatsapp', 'auto', AUTO_SEND_CONFIRM);
    const c2 = new Control(send, undefined, copy, store); expect(c2.s.settings.sendMode).toEqual({ wechat: 'clipboard', whatsapp: 'auto' }); expect(c2.s.settings.contextLimit).toBe(20);
    expect(normalizeSettings({ sendMode: { wechat: 'yolo' } })).toEqual({ sendMode: { wechat: 'clipboard', whatsapp: 'clipboard' }, contextLimit: 20, persona: 'self', personaCustom: '', historyDays: 30, lockFallback: true });
    expect(normalizeSettings(null).sendMode.wechat).toBe('clipboard');
    const bad = { load: () => { throw new Error('corrupt'); }, save: vi.fn() }; expect(new Control(send, undefined, copy, bad).s.settings.sendMode.wechat).toBe('clipboard'); });
  it('copy failure marks draft failed and can be retried', async () => { const { c, copy } = mk(); copy.mockResolvedValueOnce({ ok: false, error: 'x' } as any);
    const d = c.addDraft('wechat', 'A', 'hi'); await c.approveDraft(d.id, 'hi'); expect(d.status).toBe('failed'); await c.approveDraft(d.id, 'hi'); expect(d.status).toBe('copied'); });
  it('apps without a 发送方式 setting (Telegram) use clipboard, never auto', async () => { const { c, send, copy } = mk();
    const d = c.addDraft('telegram' as any, 'T', 'hi'); await c.approveDraft(d.id, 'hi'); expect(d.via).toBe('clipboard'); expect(d.status).toBe('copied'); expect(send).not.toHaveBeenCalled(); expect(copy).toHaveBeenCalledTimes(1); });
});
import { Control as C2, AUTO_SEND_CONFIRM as ASC } from '../src/core/control';
import { describe as d2, it as i2, expect as e2, vi as v2 } from 'vitest';
d2('锁屏时自动改为复制 + riskAck', () => {
  const mk2 = () => { const send = v2.fn(async () => ({ ok: true })); const copy = v2.fn(async () => ({ ok: true })); const st: any = { data: null, load: () => st.data, save: (s: any) => { st.data = JSON.parse(JSON.stringify(s)); } };
    return { c: new C2(send, () => '2026-10-14T01:10:00Z', copy, st), send, copy, st }; };
  i2('defaults: lockFallback ON, auto OFF; enabling auto records riskAck', () => { const { c, st } = mk2(); e2(c.s.settings.lockFallback).toBe(true); e2(c.s.settings.sendMode.wechat).toBe('clipboard');
    c.setSendMode('wechat', 'auto', ASC); e2(st.data.riskAck.wechat).toBe('2026-10-14T01:10:00Z'); });
  i2('auto + locked → clipboard (fallback=locked), unlocked → real send path', async () => { const { c, send, copy } = mk2(); c.setSendMode('wechat', 'auto', ASC);
    c.isLocked = () => true; const d = c.addDraft('wechat', '文件传输助手', 'x'); await c.approveDraft(d.id, 'x'); e2(d).toMatchObject({ status: 'copied', via: 'clipboard', fallback: 'locked' }); e2(send).not.toHaveBeenCalled();
    c.isLocked = () => false; const d2_ = c.addDraft('wechat', '文件传输助手', 'y'); await c.approveDraft(d2_.id, 'y'); e2(d2_).toMatchObject({ status: 'sent', via: 'auto' }); e2(copy).toHaveBeenCalledTimes(1);
    c.setLockFallback(false); c.isLocked = () => true; const d3 = c.addDraft('wechat', '文件传输助手', 'z'); await c.approveDraft(d3.id, 'z'); e2(d3.via).toBe('auto'); });
});
