// AI draft generation from the conversation's own history (feed + sent/copied drafts). Drafts only — never sends.
// Used by: desktop 「生成草稿」, phone remote 'draft' command, and auto-reply (only when the master switch is ON).
import { Control, AppId, PersonaId, PERSONA_IDS, resolvePersonaPrompt, clampContextLimit } from '../core/control';
import { convItems } from './remote/snapshot';
import type { LlmClient } from '../llm/minimax';
export interface DraftReq { app: AppId; conversation: string; persona?: PersonaId; personaCustom?: string; contextLimit?: number; source?: string }
export type DraftResult = { ok: true; draft: any } | { ok: false; code: 'no_key' | 'rule_blocked' | 'empty_context' | 'llm_failed' | 'busy'; error: string };
export interface DraftDeps { ctl: Control; hasKey: () => boolean; client: (o: { systemPrompt: string; contextLimit: number }) => LlmClient }
export class Drafter {
  private busy = new Set<string>();
  constructor(private d: DraftDeps) {}
  history(app: AppId, conversation: string, limit: number) {
    const c = convItems(this.d.ctl.s).get(app + '|' + conversation); const items = c ? c.items : [];
    return items.slice(-limit).map(i => ({ speaker: i.dir === 'out' ? 'self' : 'other', text: i.text, box: [0, 0, 0, 0] }) as any);
  }
  async generate(r: DraftReq): Promise<DraftResult> {
    const { ctl } = this.d; const k = r.app + '|' + r.conversation; const fail = (code: any, error: string): DraftResult => { ctl.log('error', `生成草稿失败（${r.conversation}）：${error}`); ctl.s.lastDraftError = { at: new Date().toISOString(), app: r.app, conversation: r.conversation, code, error }; return { ok: false, code, error }; };
    if (!ctl.allowed(r.app, r.conversation)) return fail('rule_blocked', '该会话被「会话规则」禁止回复');
    if (!this.d.hasKey()) return fail('no_key', '未配置 MiniMax API Key（客户端没有内置 Key，也没有 ~/.config/waterly/.env）');
    if (this.busy.has(k)) return { ok: false, code: 'busy', error: '这个会话的草稿正在生成中' };
    const s = ctl.s.settings; const persona = PERSONA_IDS.includes(r.persona as any) ? r.persona! : s.persona;
    const custom = persona === 'custom' ? (r.personaCustom ?? s.personaCustom) : s.personaCustom;
    const limit = clampContextLimit(r.contextLimit ?? s.contextLimit); const hist = this.history(r.app, r.conversation, limit);
    if (!hist.length) return fail('empty_context', '这个会话还没有可用的消息上下文');
    this.busy.add(k);
    try {
      const text = await this.d.client({ systemPrompt: resolvePersonaPrompt(persona, custom, ctl.s.llm.systemPrompt), contextLimit: limit }).reply(hist, { app: r.app, contact: r.conversation });
      const draft = ctl.addDraft(r.app, r.conversation, text, r.source ?? hist[hist.length - 1].text); ctl.s.lastDraftError = null; return { ok: true, draft };
    } catch (e: any) { return fail('llm_failed', String(e?.name === 'AbortError' ? 'MiniMax 请求超时' : e?.message ?? e).slice(0, 300)); }
    finally { this.busy.delete(k); }
  }
}
