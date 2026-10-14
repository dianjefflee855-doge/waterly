#!/usr/bin/env node
// Waterly mac-agent 模拟器：扮演 Mac 端 Waterly。主动连出到 relay，从不监听端口。
// 用法：node mac-agent/agent.js --relay http://127.0.0.1:8787 [--state ./.mac-agent-state.json] [--pair] [--demo]
import fs from 'node:fs';
import WebSocket from 'ws';
import { genKeyPair, exportPub, exportPriv, importPriv, deriveKey, safetyNumber, Channel } from '../shared/e2e.js';

export class MacAgent {
  constructor({ relay, statePath, regKey, log = console.log, convs, web }) {
    this.web = web; this.relay = relay.replace(/\/$/, ''); this.statePath = statePath; this.regKey = regKey; this.log = log;
    this.channels = new Map(); this.backoff = [500, 1000, 2000, 5000, 10000]; this.attempt = 0; this.stopped = false;
    this.convs = convs || demoConvs(); this.sent = [];
  }
  save() { if (this.statePath) fs.writeFileSync(this.statePath, JSON.stringify(this.state), { mode: 0o600 }); }
  async init() {
    if (this.statePath && fs.existsSync(this.statePath)) { this.state = JSON.parse(fs.readFileSync(this.statePath, 'utf8')); }
    else {
      const kp = await genKeyPair(); const macPub = await exportPub(kp);
      const r = await fetch(this.relay + '/v1/accounts', { method: 'POST', headers: { 'content-type': 'application/json', ...(this.regKey ? { authorization: 'Bearer ' + this.regKey } : {}) }, body: JSON.stringify({ macPub }) });
      if (!r.ok) throw new Error('register failed ' + r.status);
      const { accountId, macToken } = await r.json();
      this.state = { accountId, macToken, macPub, macPriv: await exportPriv(kp) }; this.save();
    }
    this.priv = await importPriv(this.state.macPriv);
    return this;
  }
  async startPairing() {
    const r = await fetch(this.relay + '/v1/pair/start', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.state.macToken }, body: JSON.stringify({ accountId: this.state.accountId }) });
    if (!r.ok) throw new Error('pair start failed ' + r.status);
    const j = await r.json();
    // 二维码内容：relay + 账号 + 码 + Mac 公钥指纹（扫码时可自动校验，无需比对安全码）
    j.qr = `${this.web || "http://127.0.0.1:5173/waterly-aggregate-chat.html"}#pair=${j.code}&relay=${encodeURIComponent(this.relay)}&mac=${this.state.macPub}`;
    return j;
  }
  connect() {
    return new Promise(resolve => {
      const ws = new WebSocket(this.relay.replace(/^http/, 'ws') + '/v1/ws?account=' + this.state.accountId);
      this.ws = ws;
      ws.on('open', () => ws.send(JSON.stringify({ t: 'auth', role: 'mac', token: this.state.macToken })));
      ws.on('message', async raw => {
        const m = JSON.parse(raw.toString());
        if (m.t === 'ready') { this.attempt = 0; ws.send('{"t":"list_devices"}'); resolve(this); this.log('[mac] 已连上 relay'); }
        else if (m.t === 'devices') { for (const d of m.list) if (!d.revoked) await this.addDevice(d); }
        else if (m.t === 'device_paired') { const sas = await this.addDevice(m); this.log(`[mac] 新设备配对：${m.name}（${m.deviceId}），安全码 ${sas}`); this.onPaired?.(m, sas); }
        else if (m.t === 'e2e') await this.onE2E(m);
        else if (m.t === 'revoked') { this.channels.delete(m.deviceId); this.log('[mac] 已吊销 ' + m.deviceId); }
      });
      ws.on('close', (code) => {
        if (this.stopped || code === 4001) return;
        const d = this.backoff[Math.min(this.attempt++, this.backoff.length - 1)];
        this.log(`[mac] 断开(${code})，${d}ms 后重连`); setTimeout(() => this.connect(), d);
      });
      ws.on('error', () => {});
    });
  }
  async addDevice(d) {
    if (!this.channels.has(d.deviceId)) {
      const key = await deriveKey(this.priv, d.phonePub, this.state.accountId, d.deviceId);
      this.channels.set(d.deviceId, new Channel(key, 'mac', d.deviceId));
    }
    return safetyNumber(this.state.macPub, d.phonePub);
  }
  async push(deviceId, obj) { const ch = this.channels.get(deviceId); if (ch && this.ws?.readyState === 1) this.ws.send(JSON.stringify(await ch.seal(obj))); }
  async broadcast(obj) { for (const id of this.channels.keys()) await this.push(id, obj); }
  async onE2E(env) {
    const ch = this.channels.get(env.from); if (!ch) return;
    let cmd; try { cmd = await ch.open(env); } catch { return this.log('[mac] 丢弃无法解密/重放的帧'); }
    if (cmd.type === 'hello') return this.push(env.from, { type: 'snapshot', convs: this.convs });
    if (cmd.type === 'send') {
      // 二次确认：手机必须带 confirmed:true；真实客户端还会按“发送方式”走剪贴板/自动输入
      if (!cmd.confirmed) return this.push(env.from, { type: 'ack', id: cmd.id, ok: false, error: 'confirm_required' });
      const c = this.convs.find(x => x.id === cmd.convId);
      if (!c || typeof cmd.text !== 'string' || !cmd.text.trim()) return this.push(env.from, { type: 'ack', id: cmd.id, ok: false, error: 'bad_command' });
      const t = hhmm(); c.msgs.push(['out', cmd.text, '', t]); c.time = t; c.pending = false; c.unread = 0;
      this.sent.push({ convId: c.id, text: cmd.text });
      this.log(`[mac] 执行发送 → ${c.name}：${cmd.text}（模拟器：不会真的发出）`);
      await this.push(env.from, { type: 'ack', id: cmd.id, ok: true });
      return this.broadcast({ type: 'message', convId: c.id, msg: ['out', cmd.text, '', t] });
    }
  }
  async incoming(convId, text) {
    const c = this.convs.find(x => x.id === convId); const t = hhmm();
    c.msgs.push(['in', text, '', t]); c.time = t; c.unread = (c.unread || 0) + 1; c.pending = true;
    await this.broadcast({ type: 'message', convId, msg: ['in', text, '', t], draft: { opts: ['简洁'], texts: ['收到，我稍后回复你～'], zh: [] } });
  }
  revoke(deviceId) { this.ws.send(JSON.stringify({ t: 'revoke', deviceId })); }
  stop() { this.stopped = true; this.ws?.close(); }
}
const hhmm = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
export function demoConvs() {
  return [
    { id: 101, pf: 'wx', name: '妈妈（来自 Mac）', rel: '长辈', acct: '个人微信', time: '21:00', unread: 1, pending: true, mention: false,
      draft: { opts: ['贴心', '简短'], texts: ['妈，我吃过啦，周末回家！', '吃了，周末回'], zh: [] }, msgs: [['d', '今天'], ['in', '吃饭了吗？', '', '21:00']] },
    { id: 102, pf: 'wa', name: 'Alex（来自 Mac）', rel: '朋友', acct: '+1 555****0100', time: '20:49', unread: 0, pending: false, mention: false,
      draft: { opts: ['轻松'], texts: ['收到～我看看'], zh: [] }, msgs: [['d', '今天'], ['in', '文件收到了', '', '20:49']] },
  ];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const a = new MacAgent({ relay: arg('--relay') || 'http://127.0.0.1:8787', statePath: arg('--state') || '.mac-agent-state.json', web: arg('--web'), regKey: process.env.WATERLY_REGISTRATION_KEY });
  await a.init(); await a.connect();
  if (process.argv.includes('--pair')) { const p = await a.startPairing(); console.log(`\n配对码：${p.code}（5 分钟内有效，一次性）\n二维码内容：${p.qr}\n`); }
  if (process.argv.includes('--demo')) { let i = 0; setInterval(() => a.incoming(101, `模拟新消息 #${++i}`), 15000); }
}
