// 每个账号一个 Room。保存：macPub、macToken 哈希、设备表（令牌哈希/过期/吊销）。
// 转发 e2e 信封：relay 只看 from/to/seq，payload 是密文。
import { json, randToken, sha256, ctEq } from './util.js';

const MAX_FRAME = 256 * 1024;

export class Room {
  constructor(state, env) { this.state = state; this.s = state.storage; this.env = env; }

  async fetch(req) {
    const url = new URL(req.url);
    if (req.headers.get('upgrade') === 'websocket') return this.ws(req);
    const b = await req.json().catch(() => ({}));
    const now = Date.now();
    if (url.pathname === '/init') {
      if (await this.s.get('meta')) return json({ error: 'exists' }, 409);
      const macToken = randToken(32);
      await this.s.put('meta', { accountId: b.accountId, macPub: b.macPub, macTokenHash: await sha256(macToken), created: now });
      return json({ accountId: b.accountId, macToken });
    }
    if (url.pathname === '/pair/start') {
      const meta = await this.s.get('meta');
      const tok = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
      if (!meta || !ctEq(await sha256(tok), meta.macTokenHash)) return json({ error: 'unauthorized' }, 401);
      await this.s.put('pair', { codeHash: await sha256(b.code), exp: now + b.ttl * 1000 });
      return json({ code: b.code, expiresAt: now + b.ttl * 1000, accountId: meta.accountId });
    }
    if (url.pathname === '/pair/claim') {
      const meta = await this.s.get('meta'); const p = await this.s.get('pair');
      if (!meta || !p || p.exp < now || !ctEq(await sha256(b.code), p.codeHash)) return json({ error: 'invalid_code' }, 404);
      await this.s.delete('pair');
      const deviceId = 'd_' + randToken(9);
      const token = randToken(32);
      const dev = { deviceId, name: b.name, phonePub: b.phonePub, tokenHash: await sha256(token), created: now, exp: now + b.ttlDays * 86400000, revoked: false };
      await this.s.put('dev:' + deviceId, dev);
      // 通知在线的 Mac：有新设备（带手机公钥，Mac 据此派生 E2E 密钥）
      this.toMac({ t: 'device_paired', deviceId, name: b.name, phonePub: b.phonePub, exp: dev.exp });
      return json({ accountId: meta.accountId, deviceId, token, exp: dev.exp, macPub: meta.macPub });
    }
    return json({ error: 'not_found' }, 404);
  }

  sockets(role) { return this.state.getWebSockets().filter(w => { try { const a = w.deserializeAttachment(); return a && a.authed && a.role === role && w.readyState === 1; } catch { return false; } }); }
  toMac(msg) { for (const ws of this.sockets('mac')) try { ws.send(JSON.stringify(msg)); } catch {} }

  async ws(req) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ authed: false, at: Date.now() });
    // 5 秒内必须完成认证
    if (!(await this.s.getAlarm())) await this.s.setAlarm(Date.now() + 5000);
    return new Response(null, { status: 101, webSocket: client });
  }

  async alarm() {
    const now = Date.now(); let pending = false;
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      if (!a.authed && a.at) { if (now - a.at > 5000) ws.close(4001, 'auth_timeout'); else pending = true; }
    }
    // 过期设备踢下线
    for (const ws of this.sockets('phone')) {
      const a = ws.deserializeAttachment();
      const d = await this.s.get('dev:' + a.deviceId);
      if (!d || d.revoked || d.exp < now) ws.close(4003, 'token_expired');
    }
    if (pending) await this.s.setAlarm(now + 2000);
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_FRAME) return ws.close(1009, 'too_big');
    let m; try { m = JSON.parse(raw); } catch { return ws.close(4000, 'bad_json'); }
    const a = ws.deserializeAttachment();
    if (!a.authed) return this.auth(ws, m);
    if (m.t === 'ping') return ws.send('{"t":"pong"}');

    if (m.t === 'e2e') {
      // 信封：{t, to, seq, iv, ct}，relay 填 from，不解密
      if (typeof m.ct !== 'string' || typeof m.iv !== 'string' || !Number.isSafeInteger(m.seq)) return;
      const env = JSON.stringify({ t: 'e2e', from: a.role === 'mac' ? 'mac' : a.deviceId, to: m.to, seq: m.seq, iv: m.iv, ct: m.ct });
      if (a.role === 'phone') { for (const s of this.sockets('mac')) s.send(env); return; }
      // Mac -> 指定手机
      for (const s of this.sockets('phone')) if (s.deserializeAttachment().deviceId === m.to) s.send(env);
      return;
    }
    if (a.role === 'mac') {
      if (m.t === 'list_devices') {
        const list = [...(await this.s.list({ prefix: 'dev:' })).values()].map(d => ({ deviceId: d.deviceId, name: d.name, phonePub: d.phonePub, exp: d.exp, revoked: d.revoked, online: this.sockets('phone').some(s => s.deserializeAttachment().deviceId === d.deviceId) }));
        return ws.send(JSON.stringify({ t: 'devices', list }));
      }
      if (m.t === 'revoke' && typeof m.deviceId === 'string') {
        const d = await this.s.get('dev:' + m.deviceId);
        if (d) { d.revoked = true; d.tokenHash = ''; await this.s.put('dev:' + m.deviceId, d); }
        for (const s of this.sockets('phone')) if (s.deserializeAttachment().deviceId === m.deviceId) s.close(4003, 'revoked');
        return ws.send(JSON.stringify({ t: 'revoked', deviceId: m.deviceId }));
      }
    }
    if (a.role === 'phone' && m.t === 'refresh') {
      // 令牌轮换：旧令牌立即失效
      const d = await this.s.get('dev:' + a.deviceId);
      const token = randToken(32);
      d.tokenHash = await sha256(token); d.exp = Date.now() + Number(this.env.DEVICE_TOKEN_TTL_DAYS || 30) * 86400000;
      await this.s.put('dev:' + a.deviceId, d);
      return ws.send(JSON.stringify({ t: 'token', token, exp: d.exp }));
    }
  }

  async auth(ws, m) {
    const meta = await this.s.get('meta');
    if (m.t !== 'auth' || !meta) return ws.close(4001, 'unauthorized');
    if (m.role === 'mac') {
      if (!ctEq(await sha256(String(m.token || '')), meta.macTokenHash)) return ws.close(4001, 'unauthorized');
      for (const old of this.sockets('mac')) old.close(4002, 'replaced');
      ws.serializeAttachment({ authed: true, role: 'mac' });
    } else {
      const d = await this.s.get('dev:' + String(m.deviceId || ''));
      if (!d || d.revoked || d.exp < Date.now() || !ctEq(await sha256(String(m.token || '')), d.tokenHash)) return ws.close(4001, 'unauthorized');
      ws.serializeAttachment({ authed: true, role: 'phone', deviceId: d.deviceId });
      this.toMac({ t: 'presence', deviceId: d.deviceId, online: true });
      if (!(await this.s.getAlarm())) await this.s.setAlarm(Math.min(d.exp, Date.now() + 3600000));
    }
    ws.send(JSON.stringify({ t: 'ready', role: m.role === 'mac' ? 'mac' : 'phone', macOnline: this.sockets('mac').length > 0 }));
    if (m.role !== 'mac') return;
    for (const s of this.sockets('phone')) s.send(JSON.stringify({ t: 'presence', deviceId: 'mac', online: true }));
  }

  webSocketClose(ws) { this.onGone(ws); }
  webSocketError(ws) { this.onGone(ws); }
  onGone(ws) {
    const a = ws.deserializeAttachment() || {};
    if (a.role === 'mac') for (const s of this.sockets('phone')) try { s.send(JSON.stringify({ t: 'presence', deviceId: 'mac', online: false })); } catch {}
    if (a.role === 'phone') this.toMac({ t: 'presence', deviceId: a.deviceId, online: false });
  }
}
