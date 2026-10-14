import { ChatMessage } from '../core/types';

export interface LlmClient { reply(history: ChatMessage[], ctx: { app: string; contact: string }): Promise<string> }
export type FetchLike = (url: string, init: any) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;

export interface MiniMaxOptions { apiKey?: string; baseUrl?: string; model?: string; fetch?: FetchLike; timeoutMs?: number; systemPrompt?: string; contextLimit?: number }

/** Remove MiniMax-M2 reasoning: closed <think>…</think> blocks and an unclosed trailing <think> (truncated output). */
export const stripThink = (raw: string) => raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/, '').replace(/^[\s\S]*?<\/think>/, '').trim();

/** MiniMax via its OpenAI-compatible /chat/completions endpoint. Text only — no TTS. */
export class MiniMaxClient implements LlmClient {
  apiKey: string; baseUrl: string; model: string; private f: FetchLike; timeoutMs: number; systemPrompt: string; contextLimit: number;
  constructor(o: MiniMaxOptions = {}) {
    this.apiKey = o.apiKey ?? process.env.MINIMAX_API_KEY ?? '';
    this.baseUrl = (o.baseUrl ?? process.env.MINIMAX_BASE_URL ?? 'https://api.minimaxi.com/v1').replace(/\/$/, '');
    this.model = o.model ?? process.env.MINIMAX_MODEL ?? 'MiniMax-M2';
    this.f = o.fetch ?? (globalThis.fetch as any);
    this.timeoutMs = o.timeoutMs ?? 30000;
    this.systemPrompt = o.systemPrompt ?? '你是用户本人的聊天助手，代替用户回复对方。回复简短自然、口语化，一到两句话，只输出要发送的文字。';
    const n = Math.round(Number(o.contextLimit ?? 20));
    this.contextLimit = Number.isFinite(n) ? Math.min(100, Math.max(5, n)) : 20;
  }
  buildMessages(history: ChatMessage[], ctx: { app: string; contact: string }) {
    return [
      { role: 'system', content: `${this.systemPrompt}\n(应用: ${ctx.app}; 对方: ${ctx.contact})` },
      ...history.slice(-this.contextLimit).map(m => ({ role: m.speaker === 'self' ? 'assistant' : 'user', content: m.text })),
    ];
  }
  async reply(history: ChatMessage[], ctx: { app: string; contact: string }): Promise<string> {
    if (!this.apiKey) throw new Error('MINIMAX_API_KEY not set');
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const r = await this.f(`${this.baseUrl}/chat/completions`, {
        method: 'POST', signal: ac.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, messages: this.buildMessages(history, ctx), temperature: 0.7, max_tokens: 2048 }),
      });
      if (!r.ok) throw new Error(`MiniMax HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json();
      const raw: string = j?.choices?.[0]?.message?.content ?? '';
      const text = stripThink(raw);
      if (!text) throw new Error('MiniMax empty reply');
      return text;
    } finally { clearTimeout(t); }
  }
}
