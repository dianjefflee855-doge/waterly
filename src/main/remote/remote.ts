// Remote access (Mac side): outbound WebSocket to the Waterly relay; never listens on a port. E2E per paired device.
import * as fs from 'fs'; import * as path from 'path';
import { genKeyPair, exportPub, exportPriv, importPriv, deriveKey, safetyNumber, Channel } from './e2e';
import { buildConvs, ConvIds, convKey, draftFor, historyPage } from './snapshot';
import type { ControlState } from '../../core/control';
export interface Device { deviceId: string; name: string; exp?: number; online: boolean; sas?: string }
export interface RemoteStatus { enabled: boolean; connected: boolean; registered: boolean; devices: Device[]; pairing?: { code: string; expiresAt: number; qr: string; qrImg?: string } | null; error?: string }
export interface RemoteOpts { relay: string; web: string; statePath: string; regKey?: string; fetch?: typeof fetch; WS?: any;
  getState: () => ControlState; send: (app: string, conversation: string, text: string) => Promise<{ ok: boolean; error?: string; code?: string; via?: string }>;
  draft?: (app: string, conversation: string, o: { persona?: any; personaCustom?: string; contextLimit?: number }) => Promise<any>;
  event?: (e: any) => void;
  log: (level: 'info' | 'warn' | 'error', msg: string) => void; onChange?: (s: RemoteStatus) => void; qr?: (text: string) => Promise<string>; setTimeout?: typeof setTimeout }
export class RemoteAccess {
  st: any = { enabled: false }; status: RemoteStatus = { enabled: false, connected: false, registered: false, devices: [], pairing: null };
  private ch = new Map<string, Channel>(); private ws: any; private priv: CryptoKey | null = null; private attempt = 0; private backoff = [500, 1000, 2000, 5000, 10000, 30000];
  private ids = new ConvIds(); private seenFeed = new Set<string>(); private seenDraft = new Set<string>(); private timer: any; private ping: any;
  constructor(private o: RemoteOpts) { try { this.st = JSON.parse(fs.readFileSync(o.statePath, 'utf8')); } catch {} this.status.enabled = !!this.st.enabled; this.status.registered = !!this.st.accountId; }
  private f() { return this.o.fetch ?? fetch; }
  private save() { fs.mkdirSync(path.dirname(this.o.statePath), { recursive: true }); fs.writeFileSync(this.o.statePath, JSON.stringify(this.st), { mode: 0o600 }); try { fs.chmodSync(this.o.statePath, 0o600); } catch {} }
  private ev(e: any) { try { this.o.event?.(e); } catch {} }
  private changed() { this.o.onChange?.(this.status); }
  /** Self-hosted relay changed: reconnect; a new relay URL means a new account (and re-pairing). */
  async configure(p: { relay?: string; web?: string; regKey?: string }, restart = true) {
    if (p.web != null) this.o.web = p.web;
    if (!restart) return this.status;
    if (p.relay != null) { const was = this.st.relay; this.o.relay = p.relay;
      if (this.st.accountId && was && was !== p.relay) { this.st = { enabled: this.st.enabled } as any; this.status.registered = false; this.status.devices = []; }
      this.st.relay = p.relay; this.save(); }
    this.o.regKey = p.regKey;
    this.stop(); if (this.st.enabled) await this.start(); this.changed(); return this.status; }
  async setEnabled(on: boolean) { this.st.enabled = !!on; this.save(); this.status.enabled = !!on; this.o.log('info', `远程访问：${on ? '开' : '关'}`);
    if (on) await this.start(); else this.stop(); this.changed(); return this.status; }
  async ensureAccount() {
    if (!this.st.accountId) {
      const kp = await genKeyPair(); const macPub = await exportPub(kp);
      const r = await this.f()(this.o.relay + '/v1/accounts', { method: 'POST', headers: { 'content-type': 'application/json', ...(this.o.regKey ? { authorization: 'Bearer ' + this.o.regKey } : {}) }, body: JSON.stringify({ macPub }) });
      if (!r.ok) throw new Error('注册中继账号失败 ' + r.status);
      const j: any = await r.json(); Object.assign(this.st, { accountId: j.accountId, macToken: j.macToken, macPub, macPriv: await exportPriv(kp) }); this.save();
      this.o.log('info', '已在中继注册本机账号');
    }
    this.status.registered = true; this.priv = this.priv ?? await importPriv(this.st.macPriv);
  }
  async start() { if (!this.st.enabled) return; if (!this.o.relay) { this.status.error = '未设置中继地址：请在「远程访问」里填写你自己部署的中继'; this.o.log('warn', '远程访问：' + this.status.error); this.changed(); return; } try { await this.ensureAccount(); this.connect(); } catch (e: any) { this.status.error = String(e?.message ?? e); this.o.log('error', '远程访问启动失败：' + this.status.error); this.retry(); this.changed(); } }
  private retry() { if (!this.st.enabled) return; const d = this.backoff[Math.min(this.attempt++, this.backoff.length - 1)]; this.ev({ e: 'retry', inMs: d, attempt: this.attempt }); clearTimeout(this.timer); this.timer = (this.o.setTimeout ?? setTimeout)(() => this.start(), d); }
  private connect() {
    try { this.ws?.close(); } catch {}
    const WS = this.o.WS ?? (globalThis as any).WebSocket; const ws = new WS(this.o.relay.replace(/^http/, 'ws') + '/v1/ws?account=' + this.st.accountId); this.ws = ws;
    ws.onopen = () => { this.ev({ e: 'ws_open' }); ws.send(JSON.stringify({ t: 'auth', role: 'mac', token: this.st.macToken })); };
    ws.onmessage = (ev: any) => this.onMsg(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString()).catch(e => this.o.log('warn', '远程消息处理失败：' + e?.message));
    ws.onclose = (ev: any) => { if (this.ws !== ws) return; this.ev({ e: 'ws_close', code: ev?.code, reason: String(ev?.reason ?? '').slice(0, 60) }); clearInterval(this.ping); const was = this.status.connected; this.status.connected = false; this.changed();
      if (!this.st.enabled) return; if (ev?.code === 4001) { this.status.error = '中继拒绝了本机令牌'; this.o.log('error', this.status.error); return; }
      if (was) this.o.log('warn', `与中继断开(${ev?.code})，自动重连`); this.retry(); };
    ws.onerror = () => {};
  }
  private async onMsg(raw: string) {
    const m = JSON.parse(raw);
    if (m.t !== 'e2e' && m.t !== 'pong') this.ev({ e: 'relay', t: m.t, deviceId: m.deviceId, online: m.online });
    if (m.t === 'ready') { this.attempt = 0; this.status.connected = true; this.status.error = undefined; this.o.log('info', '远程访问：已连上中继 ' + this.o.relay); this.ws.send('{"t":"list_devices"}');
      clearInterval(this.ping); this.ping = setInterval(() => { try { this.ws?.send('{"t":"ping"}'); } catch {} }, 25000); this.changed(); }
    else if (m.t === 'devices') { this.status.devices = []; for (const d of m.list) if (!d.revoked) { const sas = await this.addDevice(d); this.status.devices.push({ deviceId: d.deviceId, name: d.name, exp: d.exp, online: !!d.online, sas }); } this.changed(); }
    else if (m.t === 'device_paired') { const sas = await this.addDevice(m); this.status.devices = this.status.devices.filter(d => d.deviceId !== m.deviceId).concat({ deviceId: m.deviceId, name: m.name, exp: m.exp, online: false, sas });
      this.status.pairing = null; this.o.log('info', `新设备已配对：${m.name}，安全码 ${sas}`); this.changed(); }
    else if (m.t === 'presence' && m.deviceId !== 'mac') { const d = this.status.devices.find(x => x.deviceId === m.deviceId); if (d) { d.online = !!m.online; this.changed(); } }
    else if (m.t === 'revoked') { this.ch.delete(m.deviceId); this.status.devices = this.status.devices.filter(d => d.deviceId !== m.deviceId); this.o.log('info', '已吊销设备 ' + m.deviceId); this.changed(); }
    else if (m.t === 'e2e') await this.onE2E(m);
  }
  private async addDevice(d: any) { if (!this.ch.has(d.deviceId)) this.ch.set(d.deviceId, new Channel(await deriveKey(this.priv!, d.phonePub, this.st.accountId, d.deviceId), 'mac', d.deviceId)); return safetyNumber(this.st.macPub, d.phonePub); }
  private async pushTo(id: string, obj: any) { if (obj && (obj.type === 'ack' || obj.type === 'draft')) this.ev({ e: obj.type, id: obj.id, ok: obj.ok, code: obj.code, via: obj.via, sent: obj.sent, copied: obj.copied, fallback: obj.fallback, app: obj.app, error: obj.ok ? undefined : String(obj.error ?? '').slice(0, 120), to: id }); const c = this.ch.get(id); if (c && this.ws?.readyState === 1) this.ws.send(JSON.stringify(await c.seal(obj))); }
  private async broadcast(obj: any) { for (const id of this.ch.keys()) await this.pushTo(id, obj); }
  snapshot() { return buildConvs(this.o.getState(), this.ids); }
  private async onE2E(env: any) {
    const c = this.ch.get(env.from); if (!c) { this.ev({ e: 'e2e_drop', why: 'unknown_device', from: env.from }); return; } let cmd: any; try { cmd = await c.open(env); } catch (x: any) { this.ev({ e: 'e2e_drop', why: String(x?.message ?? x).slice(0, 60), from: env.from, seq: env.seq }); return this.o.log('warn', '远程：丢弃无法解密或重放的帧'); }
    this.ev({ e: 'cmd', type: cmd.type, id: cmd.id, convId: cmd.convId, from: env.from, textLen: typeof cmd.text === 'string' ? cmd.text.length : undefined, confirmed: cmd.confirmed });
    if (cmd.type === 'hello') { this.markSeen(); return this.pushTo(env.from, { type: 'snapshot', convs: this.snapshot() }); }
    if (cmd.type === 'history') { const k = typeof cmd.convId === 'number' ? this.ids.key(cmd.convId) : undefined;
      if (!k) return this.pushTo(env.from, { type: 'history', convId: cmd.convId, msgs: [], more: 0, error: 'bad_command' });
      const p = historyPage(this.o.getState(), k, typeof cmd.before === 'string' ? cmd.before : '', Number(cmd.limit) || 50);
      return this.pushTo(env.from, { type: 'history', convId: cmd.convId, ...p }); }
    if (cmd.type === 'draft') { const k = typeof cmd.convId === 'number' ? this.ids.key(cmd.convId) : undefined;
      const reply = (o: any) => this.pushTo(env.from, { type: 'draft', id: cmd.id, convId: cmd.convId, ...o });
      if (!k) return reply({ ok: false, code: 'unknown_conv', error: 'Mac 上找不到这个会话（可能 Mac 刚重启），请刷新后重试' });
      if (!this.o.draft) return reply({ ok: false, code: 'not_supported', error: 'Mac 端不支持远程生成草稿' });
      const i = k.indexOf('|'); const app = k.slice(0, i), conv = k.slice(i + 1); this.o.log('info', `远程请求生成草稿 → ${conv}`);
      const r = await this.o.draft(app, conv, { persona: cmd.persona, personaCustom: typeof cmd.personaCustom === 'string' ? cmd.personaCustom.slice(0, 2000) : undefined, contextLimit: cmd.contextLimit })
        .catch((e: any) => ({ ok: false, code: 'llm_failed', error: String(e?.message ?? e) }));
      if (!r.ok) return reply({ ok: false, code: r.code, error: r.error });
      return reply({ ok: true, text: r.draft.text, draft: draftFor(this.o.getState(), app, conv) }); }
    if (cmd.type === 'send') {
      if (cmd.confirmed !== true) return this.pushTo(env.from, { type: 'ack', id: cmd.id, ok: false, code: 'confirm_required', error: '手机端未确认' });
      const k = this.resolveConv(cmd);
      if (!k) return this.pushTo(env.from, { type: 'ack', id: cmd.id, ok: false, code: 'unknown_conv', error: 'Mac 上找不到这个会话（可能 Mac 刚重启），请刷新后重试' });
      if (typeof cmd.text !== 'string' || !cmd.text.trim() || cmd.text.length > 4000) return this.pushTo(env.from, { type: 'ack', id: cmd.id, ok: false, code: 'bad_text', error: '消息为空或超过 4000 字' });
      const i = k.indexOf('|'); const app = k.slice(0, i), conv = k.slice(i + 1);
      this.o.log('info', `远程发送指令（手机已确认）→ ${conv}`);
      const r: any = await this.o.send(app, conv, cmd.text).catch((e: any) => ({ ok: false, code: 'send_failed', error: String(e?.message ?? e) }));
      await this.pushTo(env.from, { type: 'ack', id: cmd.id, ok: r.ok, code: r.ok ? undefined : r.code ?? 'send_failed', error: r.error, via: r.via, sent: !!r.sent, copied: !!r.copied, fallback: r.fallback, app, conv: { id: this.ids.id(k), name: conv } });
      if (r.ok) { this.markSeen(); await this.broadcast({ type: 'snapshot', convs: this.snapshot() }); }
    }
  }
  /** convId, or (after a Mac restart re-numbered ids) the stable app+name the phone also sends */
  private resolveConv(cmd: any) { const byId = typeof cmd.convId === 'number' ? this.ids.key(cmd.convId) : undefined; const app = { wx: 'wechat', wa: 'whatsapp', tg: 'telegram' }[String(cmd.pf)] ?? cmd.app;
    const byKey = typeof cmd.name === 'string' && app ? convKey(app, cmd.name) : undefined;
    if (byKey && byId && byId !== byKey) return byKey; return byId ?? (byKey && this.snapshot().some((c: any) => this.ids.key(c.id) === byKey) ? byKey : undefined); }
  private markSeen() { const s = this.o.getState(); s.feed.forEach(f => this.seenFeed.add(f.id)); s.drafts.forEach(d => this.seenDraft.add(d.id + d.status)); }
  /** Called after every client state change: forward new feed items / draft changes to paired phones. */
  async onStateChanged() {
    if (!this.status.connected || !this.ch.size) return; const s = this.o.getState(); const conv = this.snapshot();
    const newDraft = s.drafts.some(d => !this.seenDraft.has(d.id + d.status));
    if (newDraft) { this.markSeen(); return this.broadcast({ type: 'snapshot', convs: conv }); }
    for (const f of [...s.feed].reverse()) { if (this.seenFeed.has(f.id)) continue; this.seenFeed.add(f.id);
      const c = conv.find(x => x.id === this.ids.id(convKey(f.app, f.conversation))); const msg = c?.msgs[c.msgs.length - 1];
      await this.broadcast({ type: 'message', convId: c?.id, msg, draft: draftFor(s, f.app, f.conversation) ?? undefined }); }
  }
  /** push a fresh snapshot to every paired phone (e.g. after 清空历史) */
  async resync() { if (!this.status.connected || !this.ch.size) return; this.markSeen(); await this.broadcast({ type: 'snapshot', convs: this.snapshot() }); }
  async startPairing() {
    if (!this.st.enabled) throw new Error('请先打开远程访问'); await this.ensureAccount();
    const r = await this.f()(this.o.relay + '/v1/pair/start', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.st.macToken }, body: JSON.stringify({ accountId: this.st.accountId }) });
    if (!r.ok) throw new Error('生成配对码失败 ' + r.status); const j: any = await r.json();
    const qr = `${this.o.web}#pair=${j.code}&relay=${encodeURIComponent(this.o.relay)}&mac=${this.st.macPub}`;
    this.status.pairing = { code: j.code, expiresAt: j.expiresAt, qr, qrImg: this.o.qr ? await this.o.qr(qr) : undefined }; this.o.log('info', '已生成配对码（5 分钟内有效，一次性）'); this.changed(); return this.status.pairing;
  }
  revoke(deviceId: string) { if (!this.status.connected) throw new Error('未连接中继，无法吊销'); this.ws.send(JSON.stringify({ t: 'revoke', deviceId })); }
  stop() { clearTimeout(this.timer); clearInterval(this.ping); const ws = this.ws; this.ws = null; try { ws?.close(); } catch {} this.status.connected = false; this.status.pairing = null; this.ch.clear(); }
}
