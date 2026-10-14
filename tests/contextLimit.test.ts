import { describe, it, expect, vi } from 'vitest';
import { Control, clampContextLimit, normalizeSettings, CONTEXT_LIMIT_DEFAULT } from '../src/core/control';
import { MiniMaxClient } from '../src/llm/minimax';

describe('contextLimit setting', () => {
  it('clamps to 5–100 and defaults', () => {
    expect(clampContextLimit(20)).toBe(20);
    expect(clampContextLimit(5)).toBe(5);
    expect(clampContextLimit(100)).toBe(100);
    expect(clampContextLimit(4)).toBe(5);
    expect(clampContextLimit(101)).toBe(100);
    expect(clampContextLimit('12')).toBe(12);
    expect(clampContextLimit(NaN)).toBe(CONTEXT_LIMIT_DEFAULT);
    expect(clampContextLimit(undefined)).toBe(CONTEXT_LIMIT_DEFAULT);
  });
  it('persists via settings store and reloads', () => {
    const store = { data: null as any, load: vi.fn(() => store.data), save: vi.fn((s: any) => { store.data = JSON.parse(JSON.stringify(s)); }) };
    const c = new Control(async () => ({ ok: true }), undefined, undefined, store);
    expect(c.s.settings.contextLimit).toBe(20);
    expect(c.setContextLimit(6)).toBe(6);
    expect(store.save).toHaveBeenCalled();
    expect(c.setContextLimit(999)).toBe(100);
    const c2 = new Control(async () => ({ ok: true }), undefined, undefined, store);
    expect(c2.s.settings.contextLimit).toBe(100);
    expect(normalizeSettings({ contextLimit: 3 }).contextLimit).toBe(5);
  });
});

describe('MiniMaxClient contextLimit', () => {
  it('slices history to the configured limit (not hard-coded 20)', async () => {
    const hist = Array.from({ length: 30 }, (_, i) => ({ speaker: (i % 2 ? 'self' : 'other') as const, text: `m${i}`, box: [0, 0, 0, 0] as [number, number, number, number] }));
    let body: any;
    const c = new MiniMaxClient({ apiKey: 'k', contextLimit: 6, fetch: async (_u, init) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }), text: async () => '' }; } });
    expect(c.contextLimit).toBe(6);
    await c.reply(hist, { app: '微信', contact: 'A' });
    // system + 6 history
    expect(body.messages).toHaveLength(7);
    expect(body.messages[1].content).toBe('m24');
    expect(body.messages[6].content).toBe('m29');
    const msgs = c.buildMessages(hist, { app: 'a', contact: 'b' });
    expect(msgs.length).toBe(7);
  });
  it('defaults to 20 and clamps constructor input', () => {
    expect(new MiniMaxClient({ apiKey: 'k' }).contextLimit).toBe(20);
    expect(new MiniMaxClient({ apiKey: 'k', contextLimit: 2 }).contextLimit).toBe(5);
    expect(new MiniMaxClient({ apiKey: 'k', contextLimit: 200 }).contextLimit).toBe(100);
  });
});
