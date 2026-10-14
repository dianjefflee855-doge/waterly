export const enc = new TextEncoder();
export function b64u(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ''; for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function randToken(n = 32) { return b64u(crypto.getRandomValues(new Uint8Array(n))); }
export async function sha256(s) { return b64u(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
// 配对码：8 位，去掉易混字符
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function pairCode() {
  const r = crypto.getRandomValues(new Uint8Array(8));
  return [...r].map(x => ALPH[x % ALPH.length]).join('');
}
export function ctEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
}
