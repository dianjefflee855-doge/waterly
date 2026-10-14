// Waterly Relay：只做认证 + 按账号隔离的密文转发。看不到明文。
import { json, randToken, sha256, ctEq, pairCode } from './util.js';
export { Room } from './room.js';
export { Directory } from './directory.js';

function cors(env, req) {
  const origin = req.headers.get('origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
  const ok = allowed.includes('*') || allowed.includes(origin);
  return ok && origin ? {
    'access-control-allow-origin': origin, 'vary': 'origin',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  } : {};
}
const ACC_RE = /^[A-Za-z0-9_-]{16,64}$/;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const h = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    const withCors = r => { for (const [k, v] of Object.entries(h)) r.headers.set(k, v); return r; };
    try {
      if (url.pathname === '/healthz') return withCors(json({ ok: true }));

      // 1) Mac 注册账号：返回 accountId + macToken（只返回一次，服务端只存哈希）
      if (url.pathname === '/v1/accounts' && req.method === 'POST') {
        if (env.REGISTRATION_KEY) {
          const k = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
          if (!ctEq(k, env.REGISTRATION_KEY)) return withCors(json({ error: 'forbidden' }, 403));
        }
        const body = await req.json().catch(() => ({}));
        if (typeof body.macPub !== 'string' || body.macPub.length > 200) return withCors(json({ error: 'bad_request' }, 400));
        const accountId = randToken(18);
        const room = env.ROOMS.get(env.ROOMS.idFromName(accountId));
        const r = await room.fetch('https://room/init', { method: 'POST', body: JSON.stringify({ accountId, macPub: body.macPub }) });
        return withCors(new Response(r.body, r));
      }

      // 2) Mac 申请配对码（需 macToken）
      if (url.pathname === '/v1/pair/start' && req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        if (!ACC_RE.test(body.accountId || '')) return withCors(json({ error: 'bad_request' }, 400));
        const room = env.ROOMS.get(env.ROOMS.idFromName(body.accountId));
        const code = pairCode();
        const r = await room.fetch('https://room/pair/start', { method: 'POST', headers: { authorization: req.headers.get('authorization') || '' }, body: JSON.stringify({ code, ttl: Number(env.PAIR_CODE_TTL_SEC || 300) }) });
        if (!r.ok) return withCors(new Response(r.body, r));
        const dir = env.DIRECTORY.get(env.DIRECTORY.idFromName('global'));
        await dir.fetch('https://dir/put', { method: 'POST', body: JSON.stringify({ codeHash: await sha256(code), accountId: body.accountId, ttl: Number(env.PAIR_CODE_TTL_SEC || 300) }) });
        return withCors(new Response(r.body, r));
      }

      // 3) 手机用配对码换设备令牌（码一次性、限时；失败计数防爆破）
      if (url.pathname === '/v1/pair/claim' && req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (code.length !== 8 || typeof body.phonePub !== 'string' || body.phonePub.length > 200) return withCors(json({ error: 'bad_request' }, 400));
        const ip = req.headers.get('cf-connecting-ip') || 'local';
        const dir = env.DIRECTORY.get(env.DIRECTORY.idFromName('global'));
        const lr = await dir.fetch('https://dir/take', { method: 'POST', body: JSON.stringify({ codeHash: await sha256(code), ip }) });
        if (!lr.ok) return withCors(new Response(lr.body, lr));
        const { accountId } = await lr.json();
        const room = env.ROOMS.get(env.ROOMS.idFromName(accountId));
        const r = await room.fetch('https://room/pair/claim', { method: 'POST', body: JSON.stringify({ code, phonePub: body.phonePub, name: String(body.name || '手机').slice(0, 40), ttlDays: Number(env.DEVICE_TOKEN_TTL_DAYS || 30) }) });
        return withCors(new Response(r.body, r));
      }

      // 4) WebSocket：/v1/ws?account=...  首帧发送 {t:'auth', deviceId, token}
      if (url.pathname === '/v1/ws') {
        if (req.headers.get('upgrade') !== 'websocket') return withCors(json({ error: 'expected_websocket' }, 426));
        const acc = url.searchParams.get('account') || '';
        if (!ACC_RE.test(acc)) return json({ error: 'bad_request' }, 400);
        const room = env.ROOMS.get(env.ROOMS.idFromName(acc));
        return room.fetch(req);
      }
      return withCors(json({ error: 'not_found' }, 404));
    } catch (e) {
      return withCors(json({ error: 'internal' }, 500));
    }
  },
};
