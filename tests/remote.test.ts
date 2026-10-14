import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process'; import * as os from 'os'; import * as path from 'path'; import * as fs from 'fs';
import { Control } from '../src/core/control';
import { buildConvs, ConvIds } from '../src/main/remote/snapshot';
import { RemoteAccess } from '../src/main/remote/remote';
// @ts-ignore
import { genKeyPair, exportPub, deriveKey, Channel } from '../relay/shared/e2e.js';

const mkCtl = () => { const sent: any[] = []; const copied: any[] = [];
  const c = new Control(async d => { sent.push(d); return { ok: true }; }, undefined, async d => { copied.push(d); return { ok: true }; }, { load: () => null, save: () => {} });
  return { c, sent, copied }; };

describe('snapshot', () => {
  it('builds convs from feed + drafts only', () => {
    const { c } = mkCtl(); c.addFeed({ app: 'wechat', conversation: '妈妈', body: '吃饭了吗', at: '2026-10-13T13:00:00Z', source: 'banner' });
    c.addFeed({ app: 'whatsapp', conversation: '小王', sender: '小王', body: 'hi', at: '2026-10-13T13:05:00Z', source: 'banner' });
    c.addDraft('wechat', '妈妈', '吃了'); const ids = new ConvIds(); const v = buildConvs(c.s, ids);
    expect(v.map(x => x.name)).toEqual(['妈妈', '小王']); // newest activity (draft) first
    expect(v[0].pf).toBe('wx'); expect(v[0].draft.texts).toEqual(['吃了']); const M = (x: any) => x.msgs.filter((m: any) => m[0] !== 'd'); expect(M(v[0])[0][1]).toBe('吃饭了吗'); expect(M(v[1])[0][1]).toBe('hi'); expect(M(v[0])[0][4]).toBe(0);
    expect(ids.key(v[0].id)).toBe('wechat|妈妈');
  });
});

const PORT = 8798, RELAY = `http://127.0.0.1:${PORT}`; let wr: any;
const up = async () => { try { return (await fetch(RELAY + '/healthz')).ok; } catch { return false; } };
const wait = async (f: () => any, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await f(); if (v) return v; await new Promise(r => setTimeout(r, 50)); } throw new Error('timeout'); };
describe('remote access against local relay', () => {
  beforeAll(async () => { if (await up()) return;
    wr = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', '/tmp/waterly-remote-test-' + process.pid], { cwd: path.join(__dirname, '../relay'), stdio: 'ignore', detached: true });
    await wait(up, 60000); }, 70000);
  afterAll(() => { if (wr) try { process.kill(-wr.pid); } catch {} });
  it('off by default; pairs, snapshots, requires confirm, uses send mode, revokes', async () => {
    const { c, sent, copied } = mkCtl(); c.addFeed({ app: 'wechat', conversation: '妈妈', body: '吃饭了吗', at: new Date().toISOString(), source: 'banner' });
    const sp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wr-')), 'remote.json');
    const evs: any[] = []; const r = new RemoteAccess({ event: e => evs.push(e), relay: RELAY, web: 'https://x/', statePath: sp, getState: () => c.s, log: () => {}, qr: async t => 'data:' + t.length, draft: async (app, conv, o) => { if (conv === 'TG群') { const d = c.addDraft(app as any, conv, 'AI:' + (o.persona ?? '')); return { ok: true, draft: d }; } return { ok: false, code: 'llm_failed', error: 'MiniMax HTTP 500' }; },
      send: async (app, conv, text) => { if (!c.allowed(app as any, conv)) return { ok: false, code: 'rule_blocked', error: 'x' }; const d = c.addDraft(app as any, conv, text); const x = await c.approveDraft(d.id, text); return { ok: x.status === 'sent' || x.status === 'copied', via: x.via, sent: x.status === 'sent', copied: x.status === 'copied' }; } });
    expect(r.status.enabled).toBe(false); await expect(r.startPairing()).rejects.toThrow();
    await r.setEnabled(true); await wait(() => r.status.connected);
    expect((fs.statSync(sp).mode & 0o777)).toBe(0o600);
    const p = await r.startPairing(); expect(p.code).toMatch(/\S{4,}/); expect(p.expiresAt - Date.now()).toBeGreaterThan(200000); expect(p.qrImg).toBeTruthy();
    const kp = await genKeyPair(); const phonePub = await exportPub(kp);
    const cl: any = await (await fetch(RELAY + '/v1/pair/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: p.code, phonePub, name: '测试手机' }) })).json();
    await wait(() => r.status.devices.length === 1);
    const ws = new (globalThis as any).WebSocket(`ws://127.0.0.1:${PORT}/v1/ws?account=${cl.accountId}`); const inbox: any[] = [];
    const ch = new Channel(await deriveKey(kp.privateKey, r.st.macPub, cl.accountId, cl.deviceId), cl.deviceId, 'mac');
    ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', role: 'phone', deviceId: cl.deviceId, token: cl.token }));
    let closed = false; ws.onclose = () => { closed = true; };
    ws.onmessage = async (e: any) => { const m = JSON.parse(e.data); if (m.t === 'e2e') inbox.push(await ch.open(m)); else inbox.push(m); };
    await wait(() => inbox.find(m => m.t === 'ready'));
    const sendE = async (o: any) => ws.send(JSON.stringify(await ch.seal(o)));
    await sendE({ type: 'hello' }); const snap = await wait(() => inbox.find(m => m.type === 'snapshot'));
    expect(snap.convs[0].name).toBe('妈妈'); const id = snap.convs[0].id;
    c.addFeed({ app: 'wechat', conversation: '妈妈', body: '在吗', at: new Date().toISOString(), source: 'banner' }); await r.onStateChanged();
    expect((await wait(() => inbox.find(m => m.type === 'message'))).msg[1]).toBe('在吗');
    await sendE({ type: 'send', id: 'a', convId: id, text: '吃了' });
    expect((await wait(() => inbox.find(m => m.type === 'ack' && m.id === 'a'))).code).toBe('confirm_required'); expect(copied.length + sent.length).toBe(0);
    await sendE({ type: 'send', id: 'b', convId: id, text: '吃了', confirmed: true });
    const ack = await wait(() => inbox.find(m => m.type === 'ack' && m.id === 'b')); expect(ack.ok).toBe(true); expect(ack.via).toBe('clipboard');
    expect(copied.map(d => d.text)).toEqual(['吃了']); expect(sent.length).toBe(0); expect(c.s.autoReply).toBe(false);
    // repro 2026-10-13: Telegram chat, older messages loaded, then reply → was rejected '该应用的发送尚未接入' (Telegram fell into 'auto').
    for (let i = 0; i < 60; i++) c.addFeed({ app: 'telegram', conversation: 'TG群', body: 'old' + i, at: new Date(Date.now() - 3600000 + i * 1000).toISOString(), source: 'banner', read: true, imported: true });
    await sendE({ type: 'hello' }); const snap2 = await wait(() => inbox.find(m => m.type === 'snapshot' && m.convs.some((x: any) => x.name === 'TG群'))); const tg = snap2.convs.find((x: any) => x.name === 'TG群');
    expect(tg.more).toBe(10); await sendE({ type: 'history', convId: tg.id, before: tg.before, limit: 50 });
    expect((await wait(() => inbox.find(m => m.type === 'history'))).msgs.filter((m: any) => m[0] !== 'd').length).toBe(10);
    await sendE({ type: 'draft', id: 'dr', convId: tg.id, persona: 'support', contextLimit: 20 });
    const dr = await wait(() => inbox.find(m => m.type === 'draft' && m.id === 'dr')); expect(dr.ok).toBe(true); expect(dr.text).toBe('AI:support'); expect(dr.draft.texts).toContain('AI:support');
    await sendE({ type: 'draft', id: 'dr2', convId: id, persona: 'self' });
    expect(await wait(() => inbox.find(m => m.type === 'draft' && m.id === 'dr2'))).toMatchObject({ ok: false, code: 'llm_failed', error: 'MiniMax HTTP 500' });
    await sendE({ type: 'send', id: 'tg', convId: tg.id, text: '收到', confirmed: true });
    const tack = await wait(() => inbox.find(m => m.type === 'ack' && m.id === 'tg')); expect(tack.ok).toBe(true); expect(tack.via).toBe('clipboard'); expect(tack.copied).toBe(true); expect(tack.sent).toBe(false); expect(sent.length).toBe(0);
    await sendE({ type: 'send', id: 'x', convId: 99999, text: 'hi', confirmed: true });
    expect((await wait(() => inbox.find(m => m.type === 'ack' && m.id === 'x'))).code).toBe('unknown_conv');
    // stale id but correct pf+name → resolved by name
    await sendE({ type: 'send', id: 'nm', convId: 4242, pf: 'tg', name: 'TG群', text: 'ok', confirmed: true });
    expect((await wait(() => inbox.find(m => m.type === 'ack' && m.id === 'nm'))).ok).toBe(true);
    expect(evs.some(e => e.e === 'ws_open')).toBe(true); expect(evs.some(e => e.e === 'cmd' && e.type === 'send' && e.textLen === 2)).toBe(true);
    expect(evs.some(e => e.e === 'ack' && e.copied === true)).toBe(true); expect(JSON.stringify(evs)).not.toContain('收到');
    c.setRule({ app: 'wechat', conversation: '妈妈', mode: 'blacklist', reply: false });
    await sendE({ type: 'send', id: 'rb', convId: id, text: 'x', confirmed: true });
    const rb = await wait(() => inbox.find(m => m.type === 'ack' && m.id === 'rb')); expect(rb.code).toBe('rule_blocked'); expect(rb.ok).toBe(false);
    r.revoke(cl.deviceId); await wait(() => closed && r.status.devices.length === 0);
    await r.setEnabled(false); expect(r.status.connected).toBe(false);
  }, 30000);
});
