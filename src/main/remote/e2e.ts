// Port of relay/shared/e2e.js (WebCrypto only). ECDH P-256 + HKDF-SHA256 -> AES-256-GCM, AAD = from|to|seq.
const te = new TextEncoder(), td = new TextDecoder();
const subtle = (globalThis as any).crypto.subtle as SubtleCrypto;
export const b64u = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url');
export const unb64u = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));
const ALG = { name: 'ECDH', namedCurve: 'P-256' };
export async function genKeyPair() { return subtle.generateKey(ALG, true, ['deriveBits']) as Promise<CryptoKeyPair>; }
export async function exportPub(kp: CryptoKeyPair) { return b64u(await subtle.exportKey('raw', kp.publicKey)); }
export async function exportPriv(kp: CryptoKeyPair) { return JSON.stringify(await subtle.exportKey('jwk', kp.privateKey)); }
export async function importPriv(jwk: string) { return subtle.importKey('jwk', JSON.parse(jwk), ALG, true, ['deriveBits']); }
export async function deriveKey(myPriv: CryptoKey, peerPub: string, accountId: string, deviceId: string) {
  const peer = await subtle.importKey('raw', unb64u(peerPub), ALG, false, []);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: peer } as any, myPriv, 256);
  const hk = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode(accountId + '|' + deviceId), info: te.encode('waterly-e2e-v1') } as any, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function safetyNumber(macPub: string, phonePub: string) {
  const h = new Uint8Array(await subtle.digest('SHA-256', te.encode('waterly-sas|' + macPub + '|' + phonePub)));
  return String((((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0) % 1000000).padStart(6, '0');
}
export class Channel {
  seq = Date.now() * 1000; lastIn = 0;
  constructor(private key: CryptoKey, private me: string, private peer: string) {}
  async seal(obj: any) {
    const seq = ++this.seq; const iv = (globalThis as any).crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(this.me + '|' + this.peer + '|' + seq) }, this.key, te.encode(JSON.stringify(obj)));
    return { t: 'e2e', to: this.peer, seq, iv: b64u(iv), ct: b64u(ct) };
  }
  async open(env: any) {
    if (env.from !== this.peer || !(env.seq > this.lastIn)) throw new Error('replay_or_wrong_peer');
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64u(env.iv), additionalData: te.encode(env.from + '|' + this.me + '|' + env.seq) }, this.key, unb64u(env.ct));
    this.lastIn = env.seq; return JSON.parse(td.decode(pt));
  }
}
