// 全局配对码目录：codeHash -> accountId（只存哈希，一次性，限时）+ 按 IP 的失败限流
export class Directory {
  constructor(state) { this.state = state; this.s = state.storage; }
  async fetch(req) {
    const url = new URL(req.url); const b = await req.json();
    const now = Date.now();
    if (url.pathname === '/put') {
      await this.s.put('c:' + b.codeHash, { accountId: b.accountId, exp: now + b.ttl * 1000 });
      await this.s.setAlarm(now + b.ttl * 1000 + 1000);
      return new Response('{}');
    }
    if (url.pathname === '/take') {
      const fk = 'f:' + b.ip; const f = (await this.s.get(fk)) || { n: 0, t: now };
      if (now - f.t > 10 * 60 * 1000) { f.n = 0; f.t = now; }
      if (f.n >= 10) return new Response('{"error":"rate_limited"}', { status: 429 });
      const v = await this.s.get('c:' + b.codeHash);
      if (!v || v.exp < now) { f.n++; await this.s.put(fk, f); return new Response('{"error":"invalid_code"}', { status: 404 }); }
      await this.s.delete('c:' + b.codeHash);
      return new Response(JSON.stringify({ accountId: v.accountId }));
    }
    return new Response('{}', { status: 404 });
  }
  async alarm() {
    const now = Date.now();
    for (const [k, v] of await this.s.list({ prefix: 'c:' })) if (v.exp < now) await this.s.delete(k);
    for (const [k, v] of await this.s.list({ prefix: 'f:' })) if (now - v.t > 600000) await this.s.delete(k);
  }
}
