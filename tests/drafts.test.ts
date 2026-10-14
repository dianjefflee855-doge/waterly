import { describe, it, expect } from 'vitest';
import { Control } from '../src/core/control';
import { Drafter } from '../src/main/drafts';
const mk = () => new Control(async () => ({ ok: true }), undefined, async () => ({ ok: true }), { load: () => ({ persona: 'support', contextLimit: 5 }), save: () => {} });
describe('Drafter', () => {
  it('uses conversation history (last 上下文条数), persona prompt, adds pending draft', async () => {
    const c = mk(); for (let i = 0; i < 8; i++) c.addFeed({ app: 'telegram', conversation: 'T', body: 'm' + i, at: `2026-10-13T10:0${i}:00Z`, source: 'banner', read: true, imported: true });
    let seen: any; const dr = new Drafter({ ctl: c, hasKey: () => true, client: o => ({ reply: async (h: any) => { seen = { o, h }; return '好的'; } }) });
    const r = await dr.generate({ app: 'telegram', conversation: 'T' }); expect(r.ok).toBe(true);
    expect(seen.h.map((m: any) => m.text)).toEqual(['m3', 'm4', 'm5', 'm6', 'm7']); expect(seen.o.systemPrompt).toContain('客服');
    expect(c.s.drafts[0]).toMatchObject({ status: 'pending', text: '好的' });
    await dr.generate({ app: 'telegram', conversation: 'T', persona: 'custom', personaCustom: '老板口吻' }); expect(seen.o.systemPrompt).toBe('老板口吻');
  });
  it('reports specific errors instead of silently producing nothing', async () => {
    const c = mk(); c.addFeed({ app: 'wechat', conversation: 'A', body: 'hi', at: '2026-10-13T10:00:00Z', source: 'banner' });
    expect(await new Drafter({ ctl: c, hasKey: () => false, client: () => ({ reply: async () => 'x' }) }).generate({ app: 'wechat', conversation: 'A' })).toMatchObject({ ok: false, code: 'no_key' });
    const bad = new Drafter({ ctl: c, hasKey: () => true, client: () => ({ reply: async () => { throw new Error('MiniMax HTTP 401: invalid key'); } }) });
    expect(await bad.generate({ app: 'wechat', conversation: 'A' })).toMatchObject({ ok: false, code: 'llm_failed', error: 'MiniMax HTTP 401: invalid key' });
    expect(c.s.lastDraftError?.error).toContain('401'); expect(c.s.logs[0].msg).toContain('生成草稿失败');
    expect(await bad.generate({ app: 'wechat', conversation: 'nobody' })).toMatchObject({ code: 'empty_context' });
    c.setRule({ app: 'wechat', conversation: 'A', mode: 'blacklist', reply: false });
    expect(await bad.generate({ app: 'wechat', conversation: 'A' })).toMatchObject({ code: 'rule_blocked' });
    expect(c.s.drafts.length).toBe(0);
  });
  it.skipIf(!process.env.MINIMAX_LIVE)('live MiniMax call with every persona', async () => {
    const { MiniMaxClient } = await import('../src/llm/minimax'); (await import('../src/llm/env')).loadWaterlyEnv();
    const key = process.env.MINIMAX_API_KEY || '';
    for (const p of ['self', 'support', 'assistant', 'custom'] as const) { const c = mk(); c.addFeed({ app: 'wechat', conversation: '测试', body: '明天下午三点开会可以吗？', at: new Date().toISOString(), source: 'banner' });
      const r = await new Drafter({ ctl: c, hasKey: () => !!key, client: o => new MiniMaxClient({ apiKey: key, ...o }) }).generate({ app: 'wechat', conversation: '测试', persona: p, personaCustom: '老板口吻，简短' });
      expect(r.ok, JSON.stringify(r)).toBe(true); }
  }, 120000);
});
