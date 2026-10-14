import { describe, it, expect } from 'vitest';
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import { MiniMaxClient } from '../src/llm/minimax';
import { loadWaterlyEnv } from '../src/llm/env';

const hist = [{ speaker: 'other' as const, text: '在吗？明天几点开会', box: [0, 0, 0, 0] as [number, number, number, number] }];

describe('MiniMaxClient (mocked fetch)', () => {
  it('posts OpenAI-compatible request, maps roles, strips <think>', async () => {
    let req: any;
    const c = new MiniMaxClient({ apiKey: 'k', baseUrl: 'https://x/v1', model: 'm', fetch: async (url, init) => { req = { url, init }; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '<think>hmm</think>下午三点' } }] }), text: async () => '' }; } });
    expect(await c.reply(hist, { app: 'Telegram', contact: '李四' })).toBe('下午三点');
    expect(req.url).toBe('https://x/v1/chat/completions');
    expect(req.init.headers.Authorization).toBe('Bearer k');
    const body = JSON.parse(req.init.body); expect(body.model).toBe('m'); expect(body.messages[1]).toEqual({ role: 'user', content: '在吗？明天几点开会' });
  });
  it('throws on HTTP error and on missing key', async () => {
    const c = new MiniMaxClient({ apiKey: 'k', fetch: async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => 'bad' }) });
    await expect(c.reply(hist, { app: 'a', contact: 'b' })).rejects.toThrow(/401/);
    await expect(new MiniMaxClient({ apiKey: '' }).reply(hist, { app: 'a', contact: 'b' })).rejects.toThrow(/MINIMAX_API_KEY/);
  });
});

const ENV = path.join(os.homedir(), '.config/waterly/.env');
describe.skipIf(!fs.existsSync(ENV) || !process.env.WATERLY_LIVE)('MiniMax live smoke (WATERLY_LIVE=1, key from ~/.config/waterly/.env)', () => {
  it('real call returns non-empty text', async () => {
    loadWaterlyEnv(ENV);
    const r = await new MiniMaxClient().reply(hist, { app: 'Telegram', contact: '李四' });
    expect(r.length).toBeGreaterThan(0);
    console.log('LIVE_OK chars=' + r.length);
  });
});

import { mergeConfig, defaultConfig, publicConfig, ConfigStore } from '../src/main/localConfig';
import * as nfs from 'fs'; import * as nos from 'os'; import * as npath from 'path';
describe('BYO key local config', () => {
  it('defaults need setup, no key built in', () => { const c = defaultConfig(); expect(c.apiKey).toBe(''); expect(c.relayUrl).toBe(''); expect(publicConfig(c).needsSetup).toBe(true); });
  it('openai-compatible provider + keep/clear secrets + url validation', () => {
    let c = mergeConfig(defaultConfig(), { provider: 'openai', baseUrl: 'https://x.example/v1/', model: 'm', apiKey: 'sk-1', setupDone: true });
    expect(c).toMatchObject({ provider: 'openai', baseUrl: 'https://x.example/v1', model: 'm', apiKey: 'sk-1' });
    expect(mergeConfig(c, { apiKey: '' }).apiKey).toBe('sk-1'); expect(mergeConfig(c, { apiKey: null }).apiKey).toBe('');
    expect(() => mergeConfig(c, { relayUrl: 'not a url' })).toThrow(); expect(JSON.stringify(publicConfig(c))).not.toContain('sk-1'); });
  it('persists 0600', () => { const f = npath.join(nfs.mkdtempSync(npath.join(nos.tmpdir(), 'wcfg')), 'config.json'); new ConfigStore(f).update({ apiKey: 'sk-2', setupDone: true });
    expect(nfs.statSync(f).mode & 0o777).toBe(0o600); expect(new ConfigStore(f).c.apiKey).toBe('sk-2'); });
});

import { stripThink } from '../src/llm/minimax';
describe('stripThink', () => { it('handles closed, unclosed and orphan-close think', () => {
  expect(stripThink('<think>a\nb</think>\n\n好的')).toBe('好的');
  expect(stripThink('<think>a</think>x<think>b</think>y')).toBe('xy');
  expect(stripThink('<think>truncated reasoning...')).toBe('');
  expect(stripThink('reasoning</think>好')).toBe('好'); }); });
