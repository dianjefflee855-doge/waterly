// 端到端测试：起 wrangler dev，跑 mac-agent + 模拟手机
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { MacAgent } from '../mac-agent/agent.js';
import { genKeyPair, exportPub, deriveKey, safetyNumber, Channel } from '../shared/e2e.js';

const PORT = 8799, RELAY = `http://127.0.0.1:${PORT}`;
let wr;
before(async () => {
  try { if ((await fetch(RELAY + '/healthz')).ok) return; } catch {}
  wr = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--var', 'PAIR_CODE_TTL_SEC:300', '--persist-to', '/tmp/waterly-relay-test-' + process.pid], { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe', detached: true });
  for (let i = 0; i < 120; i++) { try { if ((await fetch(RELAY + '/healthz')).ok) return; } catch {} await new Promise(r => setTimeout(r, 500)); }
  throw new Error('wrangler dev did not start');
});
after(() => { if (wr) try { process.kill(-wr.pid); } catch {} });

const quiet = () => {};
async function phonePair(code) {
  const kp = await genKeyPair(); const phonePub = await exportPub(kp);
  const r = await fetch(RELAY + '/v1/pair/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, phonePub, name: '测试手机' }) });
  return { r, kp, phonePub, body: await r.json() };
}
function phoneConnect(accountId, deviceId, token) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${RELAY.replace('http', 'ws')}/v1/ws?account=${accountId}`);
    const inbox = []; let waiters = [];
    ws.on('open', () => ws.send(JSON.stringify({ t: 'auth', role: 'phone', deviceId, token })));
    ws.on('message', d => { const m = JSON.parse(d); inbox.push(m); waiters.forEach(w => w()); if (m.t === 'ready') resolve(api); });
    const api = { ws, inbox, closed: new Promise(r => ws.on('close', (c) => { r(c); resolve(api); })),
      next: async (pred, ms = 5000) => { const t0 = Date.now(); for (;;) { const i = inbox.findIndex(pred); if (i >= 0) return inbox.splice(i, 1)[0]; if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => { waiters.push(r); setTimeout(r, 100); }); waiters = []; } } };
  });
}

test('配对、E2E 远程查看、确认后发送、吊销', async () => {
  const mac = await new MacAgent({ relay: RELAY, log: quiet }).init(); await mac.connect();
  let macSas; const paired = new Promise(r => { mac.onPaired = (_, s) => { macSas = s; r(); }; });
  const { code } = await mac.startPairing();
  assert.match(code, /^[A-Z2-9]{8}$/);

  const p = await phonePair(code); assert.equal(p.r.status, 200);
  const { accountId, deviceId, token, macPub } = p.body;
  await paired;
  assert.equal(await safetyNumber(macPub, p.phonePub), macSas, '双方安全码一致');

  // 码一次性
  assert.equal((await phonePair(code)).r.status, 404);

  // 错误令牌被拒
  const bad = await phoneConnect(accountId, deviceId, 'x' + token.slice(1));
  assert.equal(await bad.closed, 4001);

  const ph = await phoneConnect(accountId, deviceId, token);
  const ch = new Channel(await deriveKey(p.kp.privateKey, macPub, accountId, deviceId), deviceId, 'mac');
  ph.ws.send(JSON.stringify(await ch.seal({ type: 'hello' })));
  const snapEnv = await ph.next(m => m.t === 'e2e');
  assert.ok(!snapEnv.ct.includes('妈妈'), 'relay 只转发密文');
  const snap = await ch.open(snapEnv);
  assert.equal(snap.type, 'snapshot'); assert.equal(snap.convs[0].id, 101);

  // 重放同一帧被拒
  await assert.rejects(ch.open(snapEnv));

  // 未确认的发送被 Mac 拒绝
  ph.ws.send(JSON.stringify(await ch.seal({ type: 'send', id: 'a', convId: 101, text: '吃了' })));
  assert.equal((await ch.open(await ph.next(m => m.t === 'e2e'))).error, 'confirm_required');
  ph.ws.send(JSON.stringify(await ch.seal({ type: 'send', id: 'b', convId: 101, text: '吃了', confirmed: true })));
  const ack = await ch.open(await ph.next(m => m.t === 'e2e'));
  assert.deepEqual([ack.type, ack.ok], ['ack', true]);
  assert.equal(mac.sent[0].text, '吃了');
  const echo = await ch.open(await ph.next(m => m.t === 'e2e'));
  assert.equal(echo.type, 'message');

  // Mac 推新消息
  await mac.incoming(101, '周末回来吗');
  const inc = await ch.open(await ph.next(m => m.t === 'e2e'));
  assert.equal(inc.msg[1], '周末回来吗');

  // 令牌轮换：旧令牌失效
  ph.ws.send('{"t":"refresh"}');
  const nt = await ph.next(m => m.t === 'token');
  assert.notEqual(nt.token, token);
  assert.equal(await (await phoneConnect(accountId, deviceId, token)).closed, 4001);

  // 吊销：在线连接被踢，新令牌也不能再连
  mac.revoke(deviceId);
  assert.equal(await ph.closed, 4003);
  assert.equal(await (await phoneConnect(accountId, deviceId, nt.token)).closed, 4001);
  mac.stop();
});

test('账号隔离：A 的令牌进不了 B 的房间', async () => {
  const A = await new MacAgent({ relay: RELAY, log: quiet }).init(); await A.connect();
  const B = await new MacAgent({ relay: RELAY, log: quiet }).init(); await B.connect();
  const { code } = await A.startPairing();
  const p = await phonePair(code);
  const x = await phoneConnect(B.state.accountId, p.body.deviceId, p.body.token);
  assert.equal(await x.closed, 4001);
  // 用 A 的 macToken 给 B 申请配对码也不行
  const r = await fetch(RELAY + '/v1/pair/start', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + A.state.macToken }, body: JSON.stringify({ accountId: B.state.accountId }) });
  assert.equal(r.status, 401);
  A.stop(); B.stop();
});

test('配对码爆破限流', async () => {
  let last;
  for (let i = 0; i < 12; i++) last = (await phonePair('ZZZZZZZZ')).r.status;
  assert.equal(last, 429);
});

test('Mac 断线自动重连', async () => {
  const m = await new MacAgent({ relay: RELAY, log: quiet }).init(); await m.connect();
  const first = m.ws; first.terminate();
  for (let i = 0; i < 40 && (m.ws === first || m.ws.readyState !== 1); i++) await new Promise(r => setTimeout(r, 100));
  assert.equal(m.ws.readyState, 1); m.stop();
});
