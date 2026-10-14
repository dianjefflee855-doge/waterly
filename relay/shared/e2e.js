// Waterly E2E（浏览器与 Node 通用，仅依赖 WebCrypto）
// 密钥协商：ECDH P-256（各浏览器都支持；X25519 在 WebCrypto 中支持尚不全，后续可切换）
// 派生：HKDF-SHA256(salt = accountId|deviceId, info = "waterly-e2e-v1") -> AES-256-GCM
// AAD = from|to|seq，接收方要求 seq 单调递增（防重放/乱序注入）
const te = new TextEncoder(), td = new TextDecoder();
const subtle = globalThis.crypto.subtle;
export const b64u = b => { const u = b instanceof Uint8Array ? b : new Uint8Array(b); let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
export const unb64u = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const ALG = { name: 'ECDH', namedCurve: 'P-256' };
export async function genKeyPair() { return subtle.generateKey(ALG, true, ['deriveBits']); }
export async function exportPub(kp) { return b64u(await subtle.exportKey('raw', kp.publicKey)); }
export async function exportPriv(kp) { return JSON.stringify(await subtle.exportKey('jwk', kp.privateKey)); }
export async function importPriv(jwkStr) { return subtle.importKey('jwk', JSON.parse(jwkStr), ALG, true, ['deriveBits']); }
export async function deriveKey(myPriv, peerPubB64, accountId, deviceId) {
  const peer = await subtle.importKey('raw', unb64u(peerPubB64), ALG, false, []);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: peer }, myPriv, 256);
  const hk = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode(accountId + '|' + deviceId), info: te.encode('waterly-e2e-v1') }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
// 安全码：双方屏幕显示同一 6 位数字即可确认没有中间人
export async function safetyNumber(macPub, phonePub) {
  const h = new Uint8Array(await subtle.digest('SHA-256', te.encode('waterly-sas|' + macPub + '|' + phonePub)));
  const n = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
  return String(n % 1000000).padStart(6, '0');
}
export async function fingerprint(pub) { return b64u(new Uint8Array(await subtle.digest('SHA-256', te.encode(pub))).slice(0, 12)); }
export class Channel {
  constructor(key, me, peer) { this.key = key; this.me = me; this.peer = peer; this.seq = Date.now() * 1000; this.lastIn = 0; }
  async seal(obj) {
    const seq = ++this.seq; const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(this.me + '|' + this.peer + '|' + seq) }, this.key, te.encode(JSON.stringify(obj)));
    return { t: 'e2e', to: this.peer, seq, iv: b64u(iv), ct: b64u(ct) };
  }
  async open(env) {
    if (env.from !== this.peer || !(env.seq > this.lastIn)) throw new Error('replay_or_wrong_peer');
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64u(env.iv), additionalData: te.encode(env.from + '|' + this.me + '|' + env.seq) }, this.key, unb64u(env.ct));
    this.lastIn = env.seq; return JSON.parse(td.decode(pt));
  }
}
