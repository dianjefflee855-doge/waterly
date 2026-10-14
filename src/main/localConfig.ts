// Local-only user config (BYO key, self-hosted relay). ~/.config/waterly/config.json, mode 0600.
// Secrets (apiKey, registrationKey) stay in the main process; the renderer only sees booleans.
import * as fs from 'fs';
export type Provider = 'minimax' | 'openai';
export interface LocalConfig { provider: Provider; apiKey: string; baseUrl: string; model: string; relayUrl: string; webUrl: string; registrationKey: string; setupDone: boolean }
export const PROVIDER_DEFAULTS: Record<Provider, { baseUrl: string; model: string }> = {
  minimax: { baseUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-M2' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
};
export const defaultConfig = (): LocalConfig => ({ provider: 'minimax', apiKey: '', ...PROVIDER_DEFAULTS.minimax, relayUrl: '', webUrl: '', registrationKey: '', setupDone: false });
const trimUrl = (u: any) => String(u ?? '').trim().replace(/\/+$/, '');
const okUrl = (u: string) => u === '' || /^https?:\/\/[^\s]+$/i.test(u);
/** Validate + merge a patch. Empty-string apiKey/registrationKey in the patch means "keep"; null means "clear". */
export function mergeConfig(cur: LocalConfig, p: any): LocalConfig {
  const n: LocalConfig = { ...cur };
  if (p.provider === 'minimax' || p.provider === 'openai') n.provider = p.provider;
  for (const k of ['baseUrl', 'relayUrl', 'webUrl'] as const) if (p[k] != null) { const v = trimUrl(p[k]); if (!okUrl(v)) throw new Error(`无效地址：${k}`); n[k] = v; }
  if (p.model != null) n.model = String(p.model).trim();
  if (!n.baseUrl) n.baseUrl = PROVIDER_DEFAULTS[n.provider].baseUrl;
  if (!n.model) n.model = PROVIDER_DEFAULTS[n.provider].model;
  for (const k of ['apiKey', 'registrationKey'] as const) { if (p[k] === null) n[k] = ''; else if (typeof p[k] === 'string' && p[k].trim()) n[k] = p[k].trim(); }
  if (p.setupDone != null) n.setupDone = !!p.setupDone;
  return n;
}
export const publicConfig = (c: LocalConfig) => ({ provider: c.provider, baseUrl: c.baseUrl, model: c.model, relayUrl: c.relayUrl, webUrl: c.webUrl,
  hasKey: !!c.apiKey, hasRegistrationKey: !!c.registrationKey, setupDone: c.setupDone, needsSetup: !c.setupDone || !c.apiKey });
export class ConfigStore {
  c: LocalConfig;
  constructor(private file: string, private f: typeof fs = fs) { this.c = defaultConfig(); try { this.c = mergeConfig(this.c, JSON.parse(this.f.readFileSync(file, 'utf8'))); } catch {} }
  update(p: any) { this.c = mergeConfig(this.c, p); this.f.mkdirSync(require('path').dirname(this.file), { recursive: true });
    this.f.writeFileSync(this.file, JSON.stringify(this.c, null, 1), { mode: 0o600 }); try { this.f.chmodSync(this.file, 0o600); } catch {} return this.c; }
}
