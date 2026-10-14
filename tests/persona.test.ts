import { describe, it, expect, vi } from 'vitest';
import { Control, resolvePersonaPrompt, PERSONA_PROMPTS, normalizeSettings } from '../src/core/control';
import { MiniMaxClient } from '../src/llm/minimax';

describe('reply persona', () => {
  it('resolvePersonaPrompt: presets, custom, extra notes', () => {
    expect(resolvePersonaPrompt('self')).toBe(PERSONA_PROMPTS.self);
    expect(resolvePersonaPrompt('support')).toContain('客服');
    expect(resolvePersonaPrompt('assistant')).toContain('助理');
    expect(resolvePersonaPrompt('self', '', '多用表情')).toContain('补充：多用表情');
    expect(resolvePersonaPrompt('custom', '用老板口吻')).toBe('用老板口吻');
    expect(resolvePersonaPrompt('custom', '')).toBe(PERSONA_PROMPTS.self);
    // custom ignores extra append path (extra only for presets)
    expect(resolvePersonaPrompt('custom', 'X', 'Y')).toBe('X');
  });
  it('persists persona in settings store', () => {
    const store = { data: null as any, load: () => store.data, save: (s: any) => { store.data = JSON.parse(JSON.stringify(s)); } };
    const c = new Control(async () => ({ ok: true }), undefined, undefined, store);
    expect(c.s.settings.persona).toBe('self');
    c.setPersona('support'); expect(c.s.settings.persona).toBe('support');
    c.setPersona('custom', '老板腔'); expect(c.s.settings.personaCustom).toBe('老板腔');
    const c2 = new Control(async () => ({ ok: true }), undefined, undefined, store);
    expect(c2.s.settings.persona).toBe('custom'); expect(c2.s.settings.personaCustom).toBe('老板腔');
    expect(normalizeSettings({ persona: 'nope' }).persona).toBe('self');
  });
  it('personaPrompt feeds MiniMax system message', async () => {
    const store = { data: null as any, load: () => store.data, save: (s: any) => { store.data = s; } };
    const c = new Control(async () => ({ ok: true }), undefined, undefined, store);
    c.setPersona('support');
    let body: any;
    const llm = new MiniMaxClient({ apiKey: 'k', systemPrompt: c.personaPrompt(), fetch: async (_u, init) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '好的' } }] }), text: async () => '' }; } });
    await llm.reply([{ speaker: 'other', text: '你好', box: [0,0,0,0] }], { app: '微信', contact: 'A' });
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('客服');
  });
});
