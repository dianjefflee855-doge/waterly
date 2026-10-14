// Waterly control-panel state. Sending happens ONLY via approveDraft() (explicit user click). Auto-reply defaults OFF;
// even when ON it only creates drafts — nothing is sent without approval.
export type AppId = 'wechat' | 'whatsapp' | 'telegram';
export interface AppStatus { id: AppId; name: string; running: boolean; permission: 'ok' | 'missing' | 'unknown'; lastScan?: string; unread?: number; note?: string }
export interface FeedItem { id: string; app: AppId; conversation: string; sender?: string; body: string; at: string; source: 'banner' | 'scan'; read?: boolean; imported?: boolean }
export interface Draft { id: string; app: AppId; conversation: string; text: string; context: string; createdAt: string; status: 'pending' | 'sending' | 'sent' | 'copied' | 'discarded' | 'failed'; error?: string; via?: SendMode; fallback?: 'locked' }
export interface Rule { app: AppId; conversation: string; mode: 'whitelist' | 'blacklist'; reply: boolean }
export interface LlmSettings { provider?: 'minimax' | 'openai'; model: string; baseUrl: string; hasKey: boolean; systemPrompt: string }
export interface LogLine { at: string; level: 'info' | 'warn' | 'error'; msg: string }
// Send mode (decided 2026-10-13) for personal WeChat/WhatsApp accounts. 'clipboard' (default): approved reply is copied to the
// clipboard + a notification asks the user to paste it themselves. 'auto' (advanced, opt-in, 封号风险): Waterly pastes + presses send.
// Either way the approval queue is mandatory: nothing leaves approveDraft() without an explicit user click.
export type SendMode = 'clipboard' | 'auto';
export type ModeApp = 'wechat' | 'whatsapp';
export const MODE_APPS: ModeApp[] = ['wechat', 'whatsapp'];
export const APP_NAMES: Record<string, string> = { wechat: '微信', whatsapp: 'WhatsApp', telegram: 'Telegram' };
export const AUTO_SEND_CONFIRM = 'I_ACCEPT_BAN_RISK';
export const CONTEXT_LIMIT_DEFAULT = 20;
export const CONTEXT_LIMIT_MIN = 5;
export const CONTEXT_LIMIT_MAX = 100;
/** clamp 上下文条数 into [5, 100]; non-finite → default */
export function clampContextLimit(n: any): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return CONTEXT_LIMIT_DEFAULT;
  return Math.min(CONTEXT_LIMIT_MAX, Math.max(CONTEXT_LIMIT_MIN, v));
}
export type PersonaId = 'self' | 'support' | 'assistant' | 'custom';
export const PERSONA_IDS: PersonaId[] = ['self', 'support', 'assistant', 'custom'];
export const PERSONA_LABELS: Record<PersonaId, string> = { self: '本人口吻', support: '客服', assistant: '助理', custom: '自定义' };
export const PERSONA_PROMPTS: Record<Exclude<PersonaId, 'custom'>, string> = {
  self: '你是用户本人的聊天助手，代替用户回复对方。回复简短自然、口语化，一到两句话，只输出要发送的文字。',
  support: '你是专业客服，礼貌、清晰、以解决问题为导向。回复简洁有条理，必要时分点说明，只输出要发送的文字。',
  assistant: '你是用户的私人助理，替用户安排事务、跟进事项。语气得体专业又不失亲切，回复简明，只输出要发送的文字。',
};
/** Build the MiniMax system prompt from persona (+ optional extra notes / custom text). */
export function resolvePersonaPrompt(persona: PersonaId, custom = '', extra = ''): string {
  const base = persona === 'custom'
    ? (String(custom || '').trim() || PERSONA_PROMPTS.self)
    : PERSONA_PROMPTS[persona] ?? PERSONA_PROMPTS.self;
  const note = String(extra || '').trim();
  return note && persona !== 'custom' ? `${base}\n补充：${note}` : base;
}
import { HistoryStore, HistoryMeta, clampHistoryDays, HISTORY_DAYS_DEFAULT, prune } from './history';
export const FEED_CAP = 20000;
export interface Settings { sendMode: Record<ModeApp, SendMode>; contextLimit: number; persona: PersonaId; personaCustom: string; historyDays: number; lockFallback: boolean; riskAck?: Partial<Record<ModeApp, string>> }
export const defaultSettings = (): Settings => ({ sendMode: { wechat: 'clipboard', whatsapp: 'clipboard' }, contextLimit: CONTEXT_LIMIT_DEFAULT, persona: 'self', personaCustom: '', historyDays: HISTORY_DAYS_DEFAULT, lockFallback: true });
/** sanitize anything loaded from disk: unknown/invalid values fall back to the safe default */
export function normalizeSettings(raw: any): Settings { const d = defaultSettings();
  for (const a of MODE_APPS) { const v = raw?.sendMode?.[a]; if (v === 'auto' || v === 'clipboard') d.sendMode[a] = v; }
  if (raw?.contextLimit != null) d.contextLimit = clampContextLimit(raw.contextLimit);
  if (PERSONA_IDS.includes(raw?.persona)) d.persona = raw.persona;
  if (typeof raw?.personaCustom === 'string') d.personaCustom = raw.personaCustom.slice(0, 2000);
  if (raw?.riskAck && typeof raw.riskAck === 'object') { d.riskAck = {}; for (const a of MODE_APPS) if (typeof raw.riskAck[a] === 'string') d.riskAck[a] = raw.riskAck[a]; }
  if (typeof raw?.lockFallback === 'boolean') d.lockFallback = raw.lockFallback;
  if (raw?.historyDays != null) d.historyDays = clampHistoryDays(raw.historyDays);
  return d; }
export interface SettingsStore { load(): any; save(s: Settings): void }
export type Copier = (d: Draft) => Promise<{ ok: boolean; error?: string }>;
export interface DraftError { at: string; app: AppId; conversation: string; code: string; error: string }
export interface ControlState { lastDraftError?: DraftError | null; autoReply: boolean; settings: Settings; apps: AppStatus[]; feed: FeedItem[]; drafts: Draft[]; rules: Rule[]; llm: LlmSettings; logs: LogLine[] }
export type Sender = (d: Draft) => Promise<{ ok: boolean; error?: string }>;
let seq = 0; const nid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
export class Control {
  s: ControlState;
  constructor(private sender: Sender, private now = () => new Date().toISOString(), private copier?: Copier, private store?: SettingsStore, private history?: HistoryStore, private schedule: (f: () => void) => void = f => f()) {
    let loaded: Settings = defaultSettings(); try { loaded = normalizeSettings(store?.load()); } catch {}
    this.s = { autoReply: false, settings: loaded, feed: [], drafts: [], rules: [], logs: [],
      apps: [{ id: 'wechat', name: '微信', running: false, permission: 'unknown' }, { id: 'whatsapp', name: 'WhatsApp', running: false, permission: 'unknown' }, { id: 'telegram', name: 'Telegram', running: false, permission: 'unknown' }],
      llm: { provider: 'minimax', model: 'MiniMax-M2', baseUrl: 'https://api.minimaxi.com/v1', hasKey: false, systemPrompt: '' } };
    if (history) { try { const h = history.load(); this.hmeta = h.meta; this.s.feed = h.feed.slice(0, FEED_CAP); this.s.drafts = h.drafts;
      if (prune(this.s, this.s.settings.historyDays, Date.parse(this.now())) > 0) this.flush(); } catch (e: any) { this.log('warn', '读取历史失败：' + String(e?.message ?? e)); } }
  }
  /** screen-lock probe (main wires it to axhelper screenlocked); used by 锁屏时自动改为复制 */
  isLocked: () => boolean = () => false;
  setLockFallback(on: boolean) { this.s.settings.lockFallback = !!on; this.store?.save(this.s.settings); this.log('info', `锁屏时自动改为复制：${on ? '开' : '关'}`); }
  hmeta: HistoryMeta = { v: 1 }; private dirty = false;
  /** persist feed+drafts (debounced via schedule) */
  markDirty() { if (!this.history || this.dirty) return; this.dirty = true; this.schedule(() => this.flush()); }
  flush() { this.dirty = false; if (!this.history) return; try { this.history.save({ meta: this.hmeta, feed: this.s.feed, drafts: this.s.drafts }); } catch (e: any) { this.log('error', '保存历史失败：' + String(e?.message ?? e)); } }
  historyCount() { return this.s.feed.length; }
  setHistoryDays(n: number) { const v = clampHistoryDays(n); this.s.settings.historyDays = v; this.store?.save(this.s.settings);
    const k = prune(this.s, v, Date.parse(this.now())); this.log('info', `历史保留天数：${v}${k ? `，已清理 ${k} 条过期记录` : ''}`); this.flush(); return v; }
  pruneHistory() { const k = prune(this.s, this.s.settings.historyDays, Date.parse(this.now())); if (k) this.flush(); return k; }
  clearHistory() { const n = this.s.feed.length; this.s.feed = []; this.s.drafts = this.s.drafts.filter(d => d.status === 'pending');
    this.log('info', `已清空历史（${n} 条消息）`); this.flush(); return n; }
  /** mark all feed items of a conversation as read (e.g. WeChat list shows 0 unread). Returns how many changed. */
  markConvRead(app: AppId, conversation: string) { let n = 0; for (const f of this.s.feed) if (f.app === app && f.conversation === conversation && !f.read) { f.read = true; n++; }
    if (n) this.markDirty(); return n; }
  log(level: LogLine['level'], msg: string) { this.s.logs.unshift({ at: this.now(), level, msg }); this.s.logs.length = Math.min(this.s.logs.length, 500); }
  setAutoReply(on: boolean) { this.s.autoReply = on; this.log('info', `自动回复总开关：${on ? '开（仅生成草稿，发送仍需人工确认）' : '关'}`); }
  // apps without a 发送方式 setting (Telegram) have no wired auto-send: always clipboard (was 'auto' → '该应用的发送尚未接入').
  sendModeFor(app: AppId): SendMode { return (MODE_APPS as string[]).includes(app) ? this.s.settings.sendMode[app as ModeApp] : 'clipboard'; }
  /** Enabling 'auto' requires the explicit confirm token (UI shows the 封号风险 warning first). Switching back to clipboard never needs it. */
  setSendMode(app: ModeApp, mode: SendMode, confirm?: string) {
    if (!MODE_APPS.includes(app)) throw new Error('该应用不支持发送方式设置');
    if (mode !== 'auto' && mode !== 'clipboard') throw new Error('未知发送方式');
    if (mode === 'auto' && this.s.settings.sendMode[app] !== 'auto' && confirm !== AUTO_SEND_CONFIRM) throw new Error('开启自动输入发送需要确认封号风险');
    if (mode === 'auto' && confirm === AUTO_SEND_CONFIRM) this.s.settings.riskAck = { ...(this.s.settings.riskAck ?? {}), [app]: this.now() };
    this.s.settings.sendMode[app] = mode; this.store?.save(this.s.settings);
    this.log(mode === 'auto' ? 'warn' : 'info', `${app === 'wechat' ? '微信' : 'WhatsApp'}发送方式：${mode === 'auto' ? '自动输入发送（高级，有封号风险）' : '复制到剪贴板'}`);
  }
  setContextLimit(n: number) {
    const v = clampContextLimit(n);
    this.s.settings.contextLimit = v; this.store?.save(this.s.settings);
    this.log('info', `上下文条数：${v}`); return v;
  }
  setPersona(persona: PersonaId, custom?: string) {
    if (!PERSONA_IDS.includes(persona)) throw new Error('未知回复身份');
    this.s.settings.persona = persona;
    if (custom !== undefined) this.s.settings.personaCustom = String(custom).slice(0, 2000);
    this.store?.save(this.s.settings);
    this.log('info', `回复身份：${PERSONA_LABELS[persona]}`);
  }
  personaPrompt(extraSystem = ''): string {
    return resolvePersonaPrompt(this.s.settings.persona, this.s.settings.personaCustom, extraSystem);
  }
  allowed(app: AppId, conv: string) {
    const r = this.s.rules.filter(x => x.app === app); const hit = r.find(x => x.conversation === conv);
    if (hit) return hit.mode === 'whitelist' && hit.reply;
    return !r.some(x => x.mode === 'whitelist'); // any whitelist present => only whitelisted
  }
  addFeed(f: Omit<FeedItem, 'id'>) { const dup = this.s.feed.find(x => x.app === f.app && x.conversation === f.conversation && x.body === f.body && Math.abs(Date.parse(x.at) - Date.parse(f.at)) < 10000);
    if (dup) return null; const it = { ...f, id: nid('f') } as FeedItem;
    // keep newest-first order even for out-of-order inserts (imports)
    if (!this.s.feed.length || !(it.at < this.s.feed[0].at)) this.s.feed.unshift(it); else { const i = this.s.feed.findIndex(x => x.at <= it.at); i < 0 ? this.s.feed.push(it) : this.s.feed.splice(i, 0, it); }
    this.s.feed.length = Math.min(this.s.feed.length, FEED_CAP); this.markDirty(); return it; }
  addDraft(app: AppId, conversation: string, text: string, context = '') { const d: Draft = { id: nid('d'), app, conversation, text, context, createdAt: this.now(), status: 'pending' }; this.s.drafts.unshift(d); this.log('info', `新草稿：${conversation}`); this.markDirty(); return d; }
  editDraft(id: string, text: string) { const d = this.get(id); if (d.status !== 'pending') throw new Error('只能编辑待审批草稿'); d.text = text; this.markDirty(); }
  discardDraft(id: string) { const d = this.get(id); if (d.status === 'pending' || d.status === 'failed') d.status = 'discarded'; this.markDirty(); }
  async approveDraft(id: string, confirmedText: string) {
    const d = this.get(id); if (d.status !== 'pending' && d.status !== 'failed') throw new Error('草稿状态不可发送');
    if (confirmedText !== d.text) throw new Error('确认文本与草稿不一致'); if (!d.text.trim()) throw new Error('空草稿');
    let mode = this.sendModeFor(d.app);
    if (mode === 'auto' && this.s.settings.lockFallback) { let locked = false; try { locked = this.isLocked(); } catch {} if (locked) { mode = 'clipboard'; d.fallback = 'locked'; this.log('warn', `Mac 已锁屏，改为复制到剪贴板：${d.conversation}`); } }
    d.via = mode;
    if (mode === 'clipboard') {
      if (!this.copier) throw new Error('剪贴板模式不可用');
      d.status = 'sending'; this.log('info', `人工确认，复制到剪贴板：${d.conversation}`);
      const r = await this.copier(d).catch(e => ({ ok: false, error: String(e?.message ?? e) }));
      d.status = r.ok ? 'copied' : 'failed'; d.error = r.error; this.markDirty(); this.log(r.ok ? 'info' : 'error', r.ok ? `已复制，请到${APP_NAMES[d.app] ?? d.app}粘贴发送：${d.conversation}` : `复制失败：${d.conversation}：${r.error}`); return d;
    }
    d.status = 'sending'; this.log('info', `人工确认发送：${d.conversation}`);
    const r = await this.sender(d).catch(e => ({ ok: false, error: String(e?.message ?? e) }));
    d.status = r.ok ? 'sent' : 'failed'; d.error = r.error; this.markDirty(); this.log(r.ok ? 'info' : 'error', r.ok ? `已发送：${d.conversation}` : `发送失败：${d.conversation}：${r.error}`); return d;
  }
  setRule(r: Rule) { this.s.rules = this.s.rules.filter(x => !(x.app === r.app && x.conversation === r.conversation)).concat(r); }
  removeRule(app: AppId, conversation: string) { this.s.rules = this.s.rules.filter(x => !(x.app === app && x.conversation === conversation)); }
  private get(id: string) { const d = this.s.drafts.find(x => x.id === id); if (!d) throw new Error('草稿不存在'); return d; }
}
